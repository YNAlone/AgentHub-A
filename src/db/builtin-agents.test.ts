import { describe, expect, it } from 'vitest'

import { resolveOrchestratorDefaults } from './builtin-agents'

describe('resolveOrchestratorDefaults', () => {
  it('preserves the DeepSeek defaults without deployment overrides', () => {
    expect(resolveOrchestratorDefaults({})).toEqual({
      adapterName: 'custom',
      modelProvider: 'deepseek',
      modelId: 'deepseek-v4-flash',
    })
  })

  it('routes Anthropic-compatible models through Claude Code', () => {
    expect(
      resolveOrchestratorDefaults({
        ORCHESTRATOR_PROVIDER: 'anthropic',
        ORCHESTRATOR_MODEL_ID: 'glm-5.2[1m]',
      }),
    ).toEqual({
      adapterName: 'claude-code',
      modelProvider: null,
      modelId: 'glm-5.2[1m]',
    })
  })

  it('rejects provider names that cannot be mapped safely', () => {
    expect(() =>
      resolveOrchestratorDefaults({ ORCHESTRATOR_PROVIDER: 'unsupported' }),
    ).toThrow('Unsupported ORCHESTRATOR_PROVIDER')
  })
})
