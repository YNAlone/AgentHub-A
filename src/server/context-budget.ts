import type { ChatCompletionMessageParam, ChatCompletionTool } from 'openai/resources/chat/completions'
import type { ModelLimits } from '@/shared/model-registry'

export interface ContextBudget {
  contextWindow: number
  maxOutputTokens: number
  maxInputTokens: number
  safetyTokens: number
  plainFactor: number
  toolFactor: number
  triggerRatio?: number
  targetRatio?: number
}

/** Share the exact tool schema shape between AgentRunner estimation and the adapter request. */
export function toApiTool(tool: { name: string; description: string; parameters: Record<string, unknown> }): ChatCompletionTool {
  return { type: 'function', function: { name: tool.name, description: tool.description, parameters: tool.parameters } }
}

/** Count CJK separately from Latin text; request JSON includes tool schemas and structural overhead. */
export function estimateRequestTokens(
  messages: ChatCompletionMessageParam[],
  tools?: readonly unknown[],
): number {
  return estimateTextTokens(JSON.stringify({ messages, tools: tools ?? [] }))
}

export function estimateTextTokens(text: string): number {
  const cjk = text.match(/[\p{Script=Han}\p{Script=Hiragana}\p{Script=Katakana}\p{Script=Hangul}]/gu)?.length ?? 0
  const punctuation = text.match(/[{}\[\]:,]/g)?.length ?? 0
  return Math.ceil(cjk * 1.5 + punctuation * 0.5 + (text.length - cjk - punctuation) / 3)
}

/** Separate model capacity and output reservation; estimates trigger compaction rather than task failure. */
export function createContextBudget(
  limits: ModelLimits,
  inputLimitTokens = 128_000,
  outputLimitTokens: number | null = null,
  factors: { plainFactor: number; toolFactor: number } = { plainFactor: 1, toolFactor: 1 },
): ContextBudget {
  // Legacy input cap is retained as migration metadata, not a model request gate.
  void inputLimitTokens
  const maxOutputTokens = Math.min(limits.maxOutputTokens ?? limits.outputReserve, outputLimitTokens ?? limits.outputReserve)
  // Keep a proportional safety margin even for small legacy model windows.
  const safetyTokens = Math.min(
    Math.ceil(limits.contextWindow * 0.02),
    Math.floor(Math.max(0, limits.contextWindow - maxOutputTokens) * 0.25),
  )
  const maxInputTokens = limits.contextWindow - maxOutputTokens - safetyTokens
  if (!Number.isSafeInteger(maxInputTokens) || maxInputTokens <= 0 || maxOutputTokens <= 0) {
    throw new Error('模型上下文窗口不足以容纳输出和安全余量。')
  }
  if (![factors.plainFactor, factors.toolFactor].every((factor) => Number.isFinite(factor) && factor > 0 && factor <= 1)) {
    throw new Error('上下文校准系数无效。')
  }
  return { contextWindow: limits.contextWindow, maxOutputTokens, maxInputTokens, safetyTokens, ...factors }
}
