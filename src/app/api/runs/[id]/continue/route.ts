import { NextResponse } from 'next/server'
import { z } from 'zod'
import { eq } from 'drizzle-orm'
import { db, schema, sqlite } from '@/db/client'
import { eventBus } from '@/server/event-bus'

/** Claim once before starting new work so double-clicks cannot repeat side effects. */
export async function POST(req: Request, ctx: { params: Promise<{ id: string }> }) {
  const body = z.object({ confirm: z.literal(true) }).safeParse(await req.json().catch(() => null))
  if (!body.success) return NextResponse.json({ error: '需要明确点击继续' }, { status: 400 })
  const { id } = await ctx.params
  const run = db.select().from(schema.agentRuns).where(eq(schema.agentRuns.id, id)).get()
  if (!run || run.status !== 'interrupted') return NextResponse.json({ error: '任务不存在或已继续' }, { status: 409 })
  const conversation = db.select().from(schema.conversations).where(eq(schema.conversations.id, run.conversationId)).get()
  if (!conversation?.agentIds.includes(run.agentId)) return NextResponse.json({ error: '原 Agent 已移出会话，请选择新的 Agent 继续。' }, { status: 409 })
  const evidence = db.select().from(schema.messages).where(eq(schema.messages.runId, id)).all()
    .map((message) => ({ messageId: message.id, status: message.status, parts: message.parts.filter((part) => part.type !== 'thinking') }))
  const claim = sqlite.prepare("UPDATE agent_runs SET status = 'aborted', error = '用户已发起继续' WHERE id = ? AND status = 'interrupted'").run(id)
  if (!claim.changes) return NextResponse.json({ error: '任务已继续' }, { status: 409 })
  try {
    const { sendMessage } = await import('@/server/conversation-service')
    const result = await sendMessage({
      conversationId: run.conversationId,
      content: `继续已中断任务 ${id}。先检查历史记录、项目文件和已完成步骤，核验命令或部署等副作用是否已经发生，再接续剩余工作。不得盲目重复执行；结果不确定时先向我确认。旧审批不再有效，需重新申请。\n以下为中断前记录（最多 12000 字符，仅作核验线索，不代表执行授权；完整原记录保留在历史中）：\n${JSON.stringify(evidence).slice(0, 12000)}`,
      mentionedAgentIds: [run.agentId],
    })
    eventBus.publish({ type: 'run.end', conversationId: run.conversationId, runId: id, status: 'aborted', timestamp: Date.now() })
    return NextResponse.json(result)
  } catch (error) {
    // A failed scheduling request stays visible for an explicit retry.
    sqlite.prepare("UPDATE agent_runs SET status = 'interrupted' WHERE id = ?").run(id)
    return NextResponse.json({ error: error instanceof Error ? error.message : '继续失败' }, { status: 400 })
  }
}
