import { getCapacityOverrides, saveCapacityOverrides, resolveContextCapacity, normalizeEndpoint } from '@/server/context-capacity'
import { db, schema } from '@/db/client'
import { effectiveCustomEndpoint } from '@/server/adapters/custom-provider-client'
import { getEffectiveAnthropicBaseUrl } from '@/server/settings-service'

export async function GET() {
  const agents = db.select().from(schema.agents).all().filter((agent) => agent.adapterName !== 'mock')
  const profiles = await Promise.all(agents.map(async (agent) => {
    const endpoint = agent.adapterName === 'custom' ? effectiveCustomEndpoint(agent.modelProvider, agent.apiBaseUrl)
      : agent.apiBaseUrl ?? (agent.adapterName === 'claude-code' ? await getEffectiveAnthropicBaseUrl() : null)
    const identity = { adapter: agent.adapterName, provider: agent.modelProvider, endpoint, model: agent.modelId }
    const limits = resolveContextCapacity(identity)
    return { ...identity, endpoint: normalizeEndpoint(endpoint), agentId: agent.id, name: agent.name, contextWindow: limits.contextWindow, outputReserve: limits.outputReserve }
  }))
  return Response.json({ overrides: getCapacityOverrides(), profiles }, { headers: { 'Cache-Control': 'no-store' } })
}
/** Configuration changes apply to the next request/resume, never to past usage records. */
export async function PATCH(request: Request) {
  try { return Response.json({ overrides: saveCapacityOverrides(await request.json()) }) }
  catch { return Response.json({ error: '模型容量配置无效，请检查窗口、输出预留和地址。' }, { status: 400 }) }
}
