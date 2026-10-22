/**
 * 模型上下文窗口与输出预留 token 数。
 *
 * Phase D 自动 token 预算用：`agent-runner` 计算 historyBudget = contextWindow - outputReserve
 * - estimate(systemPrompt) - estimate(currentUser) - safetyMargin。UI 的 ContextUsageIndicator
 * 用同一份表展示「上下文 X / Y」。
 *
 * 详见 specs/13-conversation-context.md「Token 预算」节。
 *
 * 维护说明：模型常变（厂商上下文窗常扩），表里都是相对保守的下限。新模型 id 走 provider fallback，
 * 没在表里也跑得起来，只是预算保守一点。要更准就把 id 加进 KNOWN_MODELS。
 */

import type { ModelProvider } from './types'

/** 单位：tokens。整个会话能装进 LLM 一次调用的总 token 上限（input + output）。 */
const PROVIDER_FALLBACK_CONTEXT: Record<ModelProvider, number> = {
  anthropic: 200_000,
  openai: 128_000,
  deepseek: 64_000,
  'volcano-ark': 32_000,
  'openai-compatible': 32_000,
}

/** 未核实模型的保守输出上限；Custom adapter 会将同一值作为 max_tokens 发送。 */
const DEFAULT_OUTPUT_RESERVE = 4096

const KNOWN_MODELS: Record<string, { provider: ModelProvider; context: number; outputReserve?: number; maxOutputTokens?: number }> = {
  // DeepSeek
  'deepseek-chat': { provider: 'deepseek', context: 64_000 },
  // 官方模型表：V4.1 Flash / V4 Pro 为 1M；旧 V4 Flash 名称路由至 V4.1 Flash。
  'deepseek-flash': { provider: 'deepseek', context: 1_000_000, outputReserve: 65_536, maxOutputTokens: 393_216 },
  'deepseek-v4-flash': { provider: 'deepseek', context: 1_000_000, outputReserve: 65_536, maxOutputTokens: 393_216 },
  'deepseek-v4-pro': { provider: 'deepseek', context: 1_000_000, outputReserve: 65_536, maxOutputTokens: 393_216 },
  'deepseek-v4': { provider: 'deepseek', context: 64_000 },
  'deepseek-reasoner': { provider: 'deepseek', context: 128_000, outputReserve: 16_384 }, // R1 系列 thinking 吃 token
  'deepseek-r1': { provider: 'deepseek', context: 128_000, outputReserve: 16_384 },

  // OpenAI
  'gpt-4o': { provider: 'openai', context: 128_000 },
  'gpt-4o-mini': { provider: 'openai', context: 128_000 },
  'gpt-4-turbo': { provider: 'openai', context: 128_000 },
  'gpt-4': { provider: 'openai', context: 8192 },
  'gpt-3.5-turbo': { provider: 'openai', context: 16_385 },
  'o1': { provider: 'openai', context: 200_000, outputReserve: 32_768 },
  'o1-mini': { provider: 'openai', context: 128_000, outputReserve: 16_384 },

  // Anthropic
  'claude-opus-4-7': { provider: 'anthropic', context: 200_000 },
  'claude-opus-4-7[1m]': { provider: 'anthropic', context: 1_000_000 },
  'claude-sonnet-4-6': { provider: 'anthropic', context: 200_000 },
  'claude-opus-4-6': { provider: 'anthropic', context: 200_000 },
  'claude-opus-4-5': { provider: 'anthropic', context: 200_000 },
  'claude-sonnet-4-5': { provider: 'anthropic', context: 200_000 },
  'claude-3-5-sonnet-latest': { provider: 'anthropic', context: 200_000 },
  'claude-haiku-4-5-20251001': { provider: 'anthropic', context: 200_000 },

  // Volcano Ark / 豆包
  'doubao-seed-2-0-lite-260428': { provider: 'volcano-ark', context: 32_000 },
  'doubao-1-5-pro-256k': { provider: 'volcano-ark', context: 256_000 },
  'doubao-pro-128k': { provider: 'volcano-ark', context: 128_000 },
}

export interface ModelLimits {
  /** 总上下文窗口（tokens） */
  contextWindow: number
  /** 给输出预留的 tokens；input + output 不能超 contextWindow */
  outputReserve: number
  /** 已核实的单次最大输出；未核实模型不允许超过默认预留。 */
  maxOutputTokens?: number
}

export function getModelLimits(
  provider: ModelProvider | null | undefined,
  modelId: string | null | undefined,
  apiBaseUrl?: string | null,
): ModelLimits {
  // A familiar model ID on an unrelated compatible endpoint does not verify that endpoint's window.
  const verifiedEndpoint = !apiBaseUrl || provider !== 'deepseek' || (() => {
    try { return new URL(apiBaseUrl).hostname === 'api.deepseek.com' } catch { return false }
  })()
  if (modelId && KNOWN_MODELS[modelId] && (provider == null || KNOWN_MODELS[modelId].provider === provider) && verifiedEndpoint) {
    const m = KNOWN_MODELS[modelId]
    return {
      contextWindow: m.context,
      outputReserve: m.outputReserve ?? DEFAULT_OUTPUT_RESERVE,
      ...(m.maxOutputTokens ? { maxOutputTokens: m.maxOutputTokens } : {}),
    }
  }
  // Provider fallback
  if (provider && PROVIDER_FALLBACK_CONTEXT[provider]) {
    return {
      contextWindow: PROVIDER_FALLBACK_CONTEXT[provider],
      outputReserve: DEFAULT_OUTPUT_RESERVE,
    }
  }
  // 最终兜底（也是 ClaudeCode adapter 用的，因为它没有 modelProvider 字段）
  return { contextWindow: 200_000, outputReserve: DEFAULT_OUTPUT_RESERVE }
}

/** 非请求预算用途保留旧估算；完整请求改用服务端 UTF-8 fallback。 */
export function estimateTokens(text: string): number {
  return Math.ceil(text.length / 4)
}
