import type { ChatCompletionMessageParam } from 'openai/resources/chat/completions'
import { setTimeout as delay } from 'node:timers/promises'
import { createHash } from 'node:crypto'
import { estimateRequestTokens, estimateTextTokens, type ContextBudget } from './context-budget'

export type WorkingMessage = ChatCompletionMessageParam
export interface ContextProgress { state: 'compacting' | 'running' | 'paused'; message: string; before?: number; after?: number; attempt?: number }
export class ContextPausedError extends Error { readonly name = 'ContextPausedError' }
export type Summarize = (text: string, signal: AbortSignal) => Promise<string>
export const workingMessageKey = (message: WorkingMessage) => createHash('sha256').update(JSON.stringify(message)).digest('hex')

/** Only explicit provider context errors may retry a request; auth/rate/transport failures keep their semantics. */
export function isContextOverflow(error: unknown): boolean {
  if (!error || typeof error !== 'object') return false
  const value = error as { status?: number; code?: string; message?: string }
  if (value.status && ![400, 413, 422].includes(value.status)) return false
  return value.code === 'context_length_exceeded' ||
    /maximum context length|context (?:window|length).*(?:exceed|limit)|exceed.*context (?:window|length)|too many tokens|input tokens.*exceed/i.test(value.message ?? '')
}

/** A checkpoint with unpaired calls cannot safely replay tools whose side effects are unknown. */
export function pendingContextCalls(messages: WorkingMessage[]): string[] {
  const pending = new Set<string>()
  for (const message of messages) {
    if (message.role === 'assistant') for (const call of message.tool_calls ?? []) pending.add(call.id)
    if (message.role === 'tool') pending.delete(message.tool_call_id)
  }
  return [...pending]
}

/** Split by code points so one oversized tool result can be summarized without losing its tail. */
export async function hierarchicalSummary(text: string, summarize: Summarize, signal: AbortSignal, chunkTokens = 12000): Promise<string> {
  const chunks: string[] = []
  let chunk = ''
  // A character cap bounds each summary request conservatively, including CJK.
  for (const point of text) {
    chunk += point
    if (chunk.length >= Math.floor(chunkTokens / 2)) { chunks.push(chunk); chunk = '' }
  }
  // Balance a small tail with the previous chunk so a ten-character fragment need not shrink alone.
  if (chunk && chunks.length && chunk.length < Math.floor(chunkTokens / 8)) {
    const previous = chunks.pop()! + chunk
    const middle = Math.floor(previous.length / 2)
    chunks.push(previous.slice(0, middle), previous.slice(middle))
  } else if (chunk) chunks.push(chunk)
  let summaries: string[] = []
  for (const source of chunks) {
    signal.throwIfAborted()
    const summary = (await summarize(source, signal)).trim()
    if (!summary || estimateTextTokens(summary) >= estimateTextTokens(source)) throw new Error('摘要未缩小内容，原文已保留。')
    summaries.push(summary)
  }
  for (let level = 0; summaries.length > 1 && level < 8; level++) {
    const combined = summaries.join('\n\n')
    if (estimateTextTokens(combined) <= chunkTokens) {
      const summary = (await summarize(combined, signal)).trim()
      if (!summary || estimateTextTokens(summary) >= estimateTextTokens(combined)) throw new Error('合并摘要未缩小内容。')
      return summary
    }
    const next: string[] = []
    for (let i = 0; i < summaries.length; i += 2) {
      if (!summaries[i + 1]) { next.push(summaries[i]); continue }
      const source = summaries.slice(i, i + 2).join('\n\n')
      const summary = (await summarize(source, signal)).trim()
      if (!summary || estimateTextTokens(summary) >= estimateTextTokens(source)) throw new Error('合并摘要未缩小内容。')
      next.push(summary)
    }
    summaries = next
  }
  if (summaries.length !== 1) throw new Error('摘要层级超出限制，原文已保留。')
  return summaries[0]
}

/** Compaction changes only request context; the caller persists original messages and tool evidence. */
export async function compactWorkingContext(options: {
  messages: WorkingMessage[]; tools: readonly unknown[]; budget: ContextBudget; currentUserIndex: number;
  summarize: Summarize; signal: AbortSignal; force?: boolean; estimate?: number;
  progress?: (value: ContextProgress) => void; retryDelays?: number[]; summaryChunkTokens?: number; protectedMessageKeys?: string[];
}): Promise<{ messages: WorkingMessage[]; currentUserIndex: number }> {
  const { messages, tools, budget, signal } = options
  const before = options.estimate ?? estimateRequestTokens(messages, tools)
  if (!options.force && before < budget.maxInputTokens * (budget.triggerRatio ?? 0.6)) return { messages, currentUserIndex: options.currentUserIndex }
  const protectedKeys = new Set(options.protectedMessageKeys)
  const protectedMessages = messages.filter((message, i) => message.role === 'system' || message.role === 'developer' || i === options.currentUserIndex || protectedKeys.has(workingMessageKey(message)))
  const protectedSet = new Set(protectedMessages)
  const source = messages.filter((message) => !protectedSet.has(message))
  if (pendingContextCalls(messages).length) throw new ContextPausedError('存在尚未完成的工具调用，已保留现场，请先核对执行状态。')
  const target = budget.maxInputTokens * (budget.targetRatio ?? 0.35)
  if (!source.length || estimateRequestTokens(protectedMessages, tools) >= target) {
    throw new ContextPausedError('系统指令或当前输入无法压缩到目标容量，请调整输入或模型窗口后继续。')
  }
  const retryDelays = options.retryDelays ?? [2000, 5000]
  for (let attempt = 0; attempt <= retryDelays.length; attempt++) {
    signal.throwIfAborted()
    options.progress?.({ state: 'compacting', message: attempt ? `重试摘要 ${attempt}/2` : '正在压缩上下文', before, attempt })
    try {
      const summary = await hierarchicalSummary(JSON.stringify(source), options.summarize, signal, options.summaryChunkTokens ?? 4000)
      // URLs can straddle chunk boundaries; retain their exact spelling independently of model paraphrases.
      const urls = [...new Set((JSON.stringify(source).match(/https?:\/\/[^\s"'<>\\\]\[{}]+/g) ?? []).map((url) => url.replace(/[),.;]+$/, '')))]
      const missingUrls = urls.filter((url) => !summary.includes(url))
      const retainedSummary = summary + (missingUrls.length ? '\n来源 URL：\n' + missingUrls.join('\n') : '')
      const result: WorkingMessage[] = [
        ...protectedMessages.filter((m) => m !== messages[options.currentUserIndex]),
        { role: 'user', content: `<working_context_summary>\n${retainedSummary}\n</working_context_summary>` },
        messages[options.currentUserIndex],
      ]
      const after = estimateRequestTokens(result, tools)
      if (after > target || after >= before) throw new Error('摘要尚未达到目标容量。')
      options.progress?.({ state: 'running', message: `上下文压缩完成：估算 ${before} → ${after} tokens，继续执行`, before, after })
      return { messages: result, currentUserIndex: result.length - 1 }
    } catch {
      signal.throwIfAborted()
      if (attempt < retryDelays.length) await delay(retryDelays[attempt], undefined, { signal })
    }
  }
  throw new ContextPausedError('摘要连续失败，已暂停并保留现场。请检查摘要模型或网络后重试并继续。')
}
