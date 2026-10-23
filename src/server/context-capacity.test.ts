import { beforeEach, expect, it } from 'vitest'
import { saveCapacityOverrides, resolveContextCapacity, normalizeEndpoint } from './context-capacity'
import { createContextBudget } from './context-budget'
import { updatePersonalSettings } from './personal-settings'

const identity = { adapter: 'custom' as const, provider: 'deepseek' as const, endpoint: 'https://open.bigmodel.cn/api/anthropic', model: 'deepseek-v4-flash' }
beforeEach(() => saveCapacityOverrides([]))

it('uses the confirmed 1M identity without leaking capacity to another endpoint or model', () => {
  expect(resolveContextCapacity(identity).contextWindow).toBe(1_000_000)
  expect(resolveContextCapacity({ ...identity, endpoint: 'https://unverified.invalid/v1' }).contextWindow).not.toBe(1_000_000)
  expect(resolveContextCapacity({ ...identity, endpoint: 'https://open.bigmodel.cn/other' }).contextWindow).not.toBe(1_000_000)
  expect(resolveContextCapacity({ ...identity, model: 'other' }).contextWindow).not.toBe(1_000_000)
  const budget = createContextBudget(resolveContextCapacity(identity), 51_712)
  expect(budget.maxInputTokens).toBe(971_808)
  expect(budget.safetyTokens).toBe(20_000)
  expect(budget.maxOutputTokens).toBe(8192)
})

it('persists exact identity overrides and normalizes endpoints without retaining URL credentials', () => {
  saveCapacityOverrides([{ ...identity, contextWindow: 2_000_000, outputReserve: 16384 }])
  expect(resolveContextCapacity(identity).contextWindow).toBe(2_000_000)
  expect(resolveContextCapacity({ ...identity, adapter: 'codex' }).contextWindow).not.toBe(2_000_000)
  expect(normalizeEndpoint('https://user:secret@example.com/v1/?token=hidden')).toBe('https://example.com/v1')
  expect(() => saveCapacityOverrides([{ ...identity, contextWindow: 16000, outputReserve: 8192 }])).toThrow()
  expect(updatePersonalSettings({ automaticCompaction: false }).automaticCompaction).toBe(true)
})
