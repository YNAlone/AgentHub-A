import { expect, it } from 'vitest'
import { publicAgent, publicSettings } from './public-credentials'
import type { AgentRow, AppSettingsRow } from '@/db/schema'

it('never exposes stored credentials or unknown future private fields in response DTOs', () => {
  const agent = { id: 'agent', apiKey: 'stolen-agent-key', privateFutureField: 'private' } as unknown as AgentRow
  const settings = { id: 'singleton', anthropicApiKey: 'stolen-provider-key', mobileDeviceToken: 'stolen-token', privateFutureField: 'private' } as unknown as AppSettingsRow
  expect(JSON.stringify(publicAgent(agent))).not.toContain('stolen')
  expect(JSON.stringify(publicSettings(settings))).not.toContain('stolen')
  expect(publicAgent(agent)).not.toHaveProperty('privateFutureField')
  expect(publicSettings(settings)).not.toHaveProperty('privateFutureField')
})
