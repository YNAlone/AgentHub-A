import { describe, expect, it } from 'vitest'
import { getModelLimits } from '@/shared/model-registry'
import { createContextBudget, estimateRequestTokens } from './context-budget'

describe('model-aware context budget', () => {
  it('enables 1M only for verified DeepSeek IDs and reserves the transmitted output', () => {
    const flash = getModelLimits('deepseek', 'deepseek-flash')
    expect(flash).toEqual({ contextWindow: 1_000_000, outputReserve: 65_536, maxOutputTokens: 393_216 })
    expect(getModelLimits('deepseek', 'unverified-model').contextWindow).toBe(64_000)
    expect(getModelLimits('openai-compatible', 'deepseek-flash').contextWindow).toBe(32_000)
    expect(getModelLimits('deepseek', 'deepseek-flash', 'https://proxy.invalid/v1').contextWindow).toBe(64_000)
    const budget = createContextBudget(flash, 1_000_000)
    expect(budget).toEqual({ contextWindow: 1_000_000, maxOutputTokens: 65_536, safetyTokens: 20_000, maxInputTokens: 914_464, plainFactor: 1, toolFactor: 1 })
    expect(createContextBudget(flash, 128_000, 8192).maxOutputTokens).toBe(8192)
    expect(createContextBudget(getModelLimits('openai', 'gpt-4')).maxInputTokens).toBe(3932)
  })

  it('estimates Chinese tokens rather than UTF-8 bytes and tool schemas in every complete request', () => {
    const text = [{ role: 'user' as const, content: '中文'.repeat(100) }]
    const withoutTools = estimateRequestTokens(text)
    expect(withoutTools).toBeGreaterThan(300)
    const withTools = estimateRequestTokens(text, [{ function: { name: 'fs_read', description: 'a'.repeat(300) } }])
    expect(withTools).toBeGreaterThan(withoutTools + 100)
    expect(withoutTools).toBeLessThan(Buffer.byteLength(JSON.stringify(text), 'utf8'))
  })
})
