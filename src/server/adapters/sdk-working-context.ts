import type { AgentPlatformAdapter, AdapterInput } from './types'
import type { StreamEvent } from '@/shared/types'
import { compactWorkingContext, ContextPausedError, isContextOverflow, type WorkingMessage } from '@/server/working-context'
import { adapterSessionKey, claudeCodeSessions, codexSessions } from './session-store'

/** SDK boundaries are coarser than Custom requests; never stop a tool while it may be mutating state. */
export async function* sdkWorkingContext(adapter: AgentPlatformAdapter, input: AdapterInput, signal: AbortSignal): AsyncIterable<StreamEvent> {
  const control = input.contextControl
  if (!control || !input.contextBudget) { yield* adapter.stream(input, signal); return }
  const sessionKey = adapterSessionKey(input.conversationId, input.agentId)
  const sessions = adapter.name === 'codex' ? codexSessions : claudeCodeSessions
  let messages: WorkingMessage[] = control.restored?.messages ?? [
    { role: 'system', content: input.systemPrompt }, ...(input.history ?? []), { role: 'user', content: input.prompt },
  ]
  let currentUserIndex = control.restored?.currentUserIndex ?? messages.length - 1
  // Keep checkpoint budgeting aligned with the fresh system instructions sent to the SDK.
  messages = messages.map((message, index) => index === 0 && message.role === 'system' ? { role: 'system', content: input.systemPrompt } : message)
  let recoveries = control.restored?.progress?.state === 'paused' ? 0 : control.restored?.providerRecoveries ?? 0
  let force = control.restored?.progress?.state === 'paused'
  let completed = control.restored?.completed ?? false
  let usage = control.restored?.usage ?? { inputTokens: 0, outputTokens: 0, cacheCreationTokens: 0, cacheReadTokens: 0, lastInputTokens: 0 }
  const pending = new Set<string>()
  let sdkTurnInProgress = false
  if (control.restored?.pendingTool || control.restored?.sdkTurnInProgress) throw new ContextPausedError('SDK 工具执行状态未确认，请先核对副作用后恢复。')
  const save = () => control.save({ messages, currentUserIndex, turn: 0, providerRecoveries: recoveries, usage, completed, sdkTurnInProgress, sdkSessionId: sessions.get(sessionKey), pendingTool: [...pending].join(',') || undefined })
  for (;;) {
    save()
    try {
      const result = await compactWorkingContext({ messages, tools: [], currentUserIndex, budget: input.contextBudget,
        signal, summarize: control.summarize, summaryChunkTokens: control.summaryChunkTokens, force, progress: control.progress, protectedMessageKeys: control.protectedMessageKeys })
      if (result.messages !== messages) {
        messages = result.messages; currentUserIndex = result.currentUserIndex
        sessions.delete(sessionKey)
        save()
      }
      force = false
      if (completed) return
      const rebuilt = !sessions.get(sessionKey)
      const nextInput = rebuilt ? { ...input, history: messages.filter((m, i) => m.role !== 'system' && i !== currentUserIndex),
        prompt: control.restored ? `${input.prompt}\n\n继续已保存的任务；历史中已完成的操作不得重复执行，只执行剩余步骤。` : input.prompt } : input
      sdkTurnInProgress = true
      save()
      for await (const event of adapter.stream(nextInput, signal)) {
        if (event.type === 'tool.call') {
          pending.add(event.callId)
          messages.push({ role: 'assistant', content: null, tool_calls: [{ id: event.callId, type: 'function', function: { name: event.toolName, arguments: JSON.stringify(event.args) } }] })
          save()
        } else if (event.type === 'tool.result') {
          messages.push({ role: 'tool', tool_call_id: event.callId, content: JSON.stringify(event.result) })
          pending.delete(event.callId); save()
        } else if (event.type === 'part.start' && event.part.type === 'text' && event.part.content) {
          messages.push({ role: 'assistant', content: event.part.content })
        } else if (event.type === 'part.delta' && event.delta.type === 'text.append') {
          const previous = messages[messages.length - 1]
          if (previous?.role === 'assistant' && typeof previous.content === 'string' && !previous.tool_calls?.length) previous.content += event.delta.text
          else messages.push({ role: 'assistant', content: event.delta.text })
        } else if (event.type === 'run.usage') { usage = { ...event.usage, lastInputTokens: event.usage.lastInputTokens ?? event.usage.inputTokens }; save() }
        yield event
      }
      if (pending.size) throw new ContextPausedError('SDK 未返回全部工具结果，请核对执行状态后继续。')
      completed = true
      sdkTurnInProgress = false
      save()
      // End-of-turn is always safe even when the SDK hides internal model-request boundaries.
      if (!pending.size) {
        const result = await compactWorkingContext({ messages, tools: [], currentUserIndex, budget: input.contextBudget,
          signal, summarize: control.summarize, summaryChunkTokens: control.summaryChunkTokens, progress: control.progress, protectedMessageKeys: control.protectedMessageKeys })
        if (result.messages !== messages) { messages = result.messages; currentUserIndex = result.currentUserIndex; sessions.delete(sessionKey); save() }
      }
      return
    } catch (error) {
      if (isContextOverflow(error) && !pending.size) {
        sdkTurnInProgress = false
        save()
        if (recoveries++ < 2) { force = true; sessions.delete(sessionKey); continue }
      }
      if (error instanceof ContextPausedError || isContextOverflow(error)) {
        const message = error instanceof ContextPausedError ? error.message : 'SDK 上下文仍超限，请核对模型容量后继续。'
        control.progress({ state: 'paused', message })
        throw new ContextPausedError(message)
      }
      throw error
    }
  }
}
