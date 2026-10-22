import type { ChatCompletionMessageParam, ChatCompletionTool } from 'openai/resources/chat/completions'
import type { ModelLimits } from '@/shared/model-registry'

export interface ContextBudget {
  contextWindow: number
  maxOutputTokens: number
  maxInputTokens: number
  safetyTokens: number
  plainFactor: number
  toolFactor: number
}

/** Share the exact tool schema shape between AgentRunner estimation and the adapter request. */
export function toApiTool(tool: { name: string; description: string; parameters: Record<string, unknown> }): ChatCompletionTool {
  return { type: 'function', function: { name: tool.name, description: tool.description, parameters: tool.parameters } }
}

/** The byte count intentionally overestimates common text tokenizers until a model-specific counter is validated. */
export function estimateRequestTokens(
  messages: ChatCompletionMessageParam[],
  tools?: readonly unknown[],
): number {
  return Buffer.byteLength(JSON.stringify({ messages, tools: tools ?? [] }), 'utf8')
}

/** The provider window is a hard ceiling; user controls can only lower the operational limits. */
export function createContextBudget(
  limits: ModelLimits,
  inputLimitTokens = 128_000,
  outputLimitTokens: number | null = null,
  factors: { plainFactor: number; toolFactor: number } = { plainFactor: 1, toolFactor: 1 },
): ContextBudget {
  const maxOutputTokens = Math.min(limits.maxOutputTokens ?? limits.outputReserve, outputLimitTokens ?? limits.outputReserve)
  // Small legacy windows cannot afford the 8192-token cold-start floor.
  const safetyTokens = Math.min(
    Math.max(8192, Math.ceil(limits.contextWindow * 0.05)),
    Math.floor(Math.max(0, limits.contextWindow - maxOutputTokens) * 0.25),
  )
  const maxInputTokens = Math.min(inputLimitTokens, limits.contextWindow - maxOutputTokens - safetyTokens)
  if (!Number.isSafeInteger(maxInputTokens) || maxInputTokens <= 0 || maxOutputTokens <= 0) {
    throw new Error('模型上下文窗口不足以容纳输出和安全余量。')
  }
  if (![factors.plainFactor, factors.toolFactor].every((factor) => Number.isFinite(factor) && factor > 0 && factor <= 1)) {
    throw new Error('上下文校准系数无效。')
  }
  return { contextWindow: limits.contextWindow, maxOutputTokens, maxInputTokens, safetyTokens, ...factors }
}

/** Check only at request boundaries so streaming does not repeatedly scan unchanged content. */
export function assertRequestFits(
  budget: ContextBudget,
  messages: ChatCompletionMessageParam[],
  tools?: readonly unknown[],
  rawEstimate = estimateRequestTokens(messages, tools),
): number {
  const factor = messages.some((message) => message.role === 'tool') ? budget.toolFactor : budget.plainFactor
  const estimated = Math.ceil(rawEstimate * factor)
  if (estimated > budget.maxInputTokens) {
    throw new Error(`上下文超出输入预算（估算 ${estimated}/${budget.maxInputTokens} tokens）；已保留历史与工具结果，请压缩上下文或调高已核实模型的运行上限。`)
  }
  return estimated
}
