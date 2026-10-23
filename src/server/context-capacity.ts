import { z } from 'zod'
import { getModelLimits, type ModelLimits } from '@/shared/model-registry'
import type { AdapterName, ModelProvider } from '@/shared/types'
import { sqlite } from '@/db/client'

export const CapacityOverride = z.object({
  adapter: z.enum(['custom', 'claude-code', 'codex', 'mock']),
  provider: z.enum(['anthropic', 'openai', 'deepseek', 'volcano-ark', 'openai-compatible']).nullable(), endpoint: z.string().max(2048), model: z.string().min(1).max(200),
  contextWindow: z.number().int().min(16000).max(10_000_000),
  outputReserve: z.number().int().min(1024).max(393216).default(8192),
}).strict().refine((v) => v.outputReserve < v.contextWindow * 0.5, '输出预留必须小于窗口的一半')
export const CapacityOverrides = z.array(CapacityOverride).max(100)
export type CapacityIdentity = { adapter: AdapterName; provider: ModelProvider | null; endpoint: string | null; model: string | null }

/** Store normalized endpoint identities without URL credentials or query strings. */
export function normalizeEndpoint(endpoint: string | null): string {
  if (!endpoint) return ''
  const url = new URL(endpoint)
  if (!['https:', 'http:'].includes(url.protocol)) throw new Error('模型地址必须使用 HTTP(S)')
  return `${url.origin}${url.pathname.replace(/\/+$/, '')}`
}
export function getCapacityOverrides(): z.infer<typeof CapacityOverrides> {
  const row = sqlite.prepare("SELECT value FROM personal_settings WHERE id = 'context-capacities'").get() as { value: string } | undefined
  return CapacityOverrides.parse(row ? JSON.parse(row.value) : [])
}
export function saveCapacityOverrides(value: unknown) {
  const rows = CapacityOverrides.parse(value).map((row) => ({ ...row, endpoint: normalizeEndpoint(row.endpoint) }))
  const identities = rows.map(({ adapter, provider, endpoint, model }) => JSON.stringify([adapter, provider, endpoint, model]))
  if (new Set(identities).size !== rows.length) throw new Error('模型容量配置重复')
  sqlite.prepare("INSERT INTO personal_settings(id,value) VALUES ('context-capacities',?) ON CONFLICT(id) DO UPDATE SET value=excluded.value").run(JSON.stringify(rows))
  return rows
}
export function resolveContextCapacity(identity: CapacityIdentity): ModelLimits {
  const endpoint = normalizeEndpoint(identity.endpoint)
  const configured = getCapacityOverrides().find((row) => row.adapter === identity.adapter && row.provider === identity.provider && row.endpoint === endpoint && row.model === identity.model)
  if (configured) {
    const known = getModelLimits(identity.provider, identity.model, identity.endpoint)
    const outputReserve = Math.min(configured.outputReserve, known.maxOutputTokens ?? configured.outputReserve)
    return { contextWindow: configured.contextWindow, outputReserve, maxOutputTokens: outputReserve }
  }
  // This endpoint/model combination was explicitly confirmed by the workspace owner.
  if (identity.adapter === 'custom' && identity.provider === 'deepseek' && identity.model === 'deepseek-v4-flash' && endpoint === 'https://open.bigmodel.cn/api/anthropic') {
    return { contextWindow: 1_000_000, outputReserve: 8192, maxOutputTokens: 65536 }
  }
  const limits = getModelLimits(identity.provider, identity.model, identity.endpoint)
  return { ...limits, outputReserve: Math.min(8192, limits.maxOutputTokens ?? limits.outputReserve) }
}
