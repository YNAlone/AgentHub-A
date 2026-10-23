import { db, schema } from '@/db/client'
import { eq } from 'drizzle-orm'
import { AgentRunner } from '@/server/agent-runner'

/** The runner atomically claims paused work, making repeated resume requests harmless. */
export async function POST(_request: Request, context: { params: Promise<{ id: string }> }) {
  const { id } = await context.params
  const run = db.select().from(schema.agentRuns).where(eq(schema.agentRuns.id, id)).get()
  if (!run) return Response.json({ error: '任务不存在' }, { status: 404 })
  const conversation = db.select().from(schema.conversations).where(eq(schema.conversations.id, run.conversationId)).get()
  if (!conversation?.agentIds.includes(run.agentId)) return Response.json({ error: '原 Agent 已移出会话，请先恢复 Agent。' }, { status: 409 })
  try {
    const result = AgentRunner.resume(id)
    return Response.json({ runId: id, resumed: !!result }, { status: result ? 202 : 200 })
  } catch {
    return Response.json({ error: '无法恢复检查点，请核对已完成操作后再继续。' }, { status: 409 })
  }
}
