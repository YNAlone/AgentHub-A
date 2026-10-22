import { describe, expect, it } from 'vitest'
import { getModelLimits } from '@/shared/model-registry'
import { assertRequestFits, createContextBudget, estimateRequestTokens } from './context-budget'

describe('model-aware context budget', () => {
  it('enables 1M only for verified DeepSeek IDs and reserves the transmitted output', () => {
    const flash = getModelLimits('deepseek', 'deepseek-flash')
    expect(flash).toEqual({ contextWindow: 1_000_000, outputReserve: 65_536, maxOutputTokens: 393_216 })
    expect(getModelLimits('deepseek', 'unverified-model').contextWindow).toBe(64_000)
    expect(getModelLimits('openai-compatible', 'deepseek-flash').contextWindow).toBe(32_000)
    expect(getModelLimits('deepseek', 'deepseek-flash', 'https://proxy.invalid/v1').contextWindow).toBe(64_000)
    const budget = createContextBudget(flash, 1_000_000)
    expect(budget).toEqual({ contextWindow: 1_000_000, maxOutputTokens: 65_536, safetyTokens: 50_000, maxInputTokens: 884_464, plainFactor: 1, toolFactor: 1 })
    expect(createContextBudget(flash, 128_000, 8192).maxOutputTokens).toBe(8192)
    expect(createContextBudget(getModelLimits('openai', 'gpt-4')).maxInputTokens).toBe(3072)
  })

  it('counts Chinese UTF-8 bytes and tool schemas in every complete request', () => {
    const text = [{ role: 'user' as const, content: '中文'.repeat(100) }]
    const withoutTools = estimateRequestTokens(text)
    expect(withoutTools).toBeGreaterThan(600)
    const withTools = estimateRequestTokens(text, [{ function: { name: 'fs_read', description: 'a'.repeat(300) } }])
    expect(withTools).toBeGreaterThan(withoutTools + 300)
    expect(() => assertRequestFits({ contextWindow: 1000, maxOutputTokens: 100, maxInputTokens: 500, safetyTokens: 100, plainFactor: 1, toolFactor: 1 }, text)).toThrow('上下文超出')
    expect(assertRequestFits({ contextWindow: 1000, maxOutputTokens: 100, maxInputTokens: 500, safetyTokens: 100, plainFactor: 0.25, toolFactor: 1 }, text)).toBeLessThan(500)
  })
})
