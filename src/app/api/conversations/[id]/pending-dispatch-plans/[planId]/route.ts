import { NextRequest, NextResponse } from 'next/server'
import { z } from 'zod'

import { reviseDispatchPlan } from '@/server/conversation-service'
import { parseDispatchPlanToolArgs } from '@/server/dispatch-plan'
import { pendingDispatchPlans } from '@/server/pending-dispatch-plans'

interface RouteContext {
  params: Promise<{ id: string; planId: string }>
}

const Body = z.discriminatedUnion('action', [
  z.object({
    action: z.literal('approve'),
  }),
  z.object({
    action: z.literal('reject'),
  }),
  z.object({
    action: z.literal('revise'),
    feedback: z.string().min(1).max(4000),
  }),
  z.object({
    action: z.literal('update'),
    plan: z.array(z.record(z.string(), z.unknown())).min(1).max(50),
  }),
])

/** POST /api/conversations/:id/pending-dispatch-plans/:planId */
export async function POST(req: NextRequest, ctx: RouteContext) {
  const { id, planId } = await ctx.params
  const raw = await req.json().catch(() => null)
  const parsed = Body.safeParse(raw)
  if (!parsed.success) {
    return NextResponse.json({ error: 'Invalid body', issues: parsed.error.issues }, { status: 400 })
  }

  const existing = pendingDispatchPlans.get(planId)
  if (!existing || existing.conversationId !== id) {
    return NextResponse.json({ error: 'Pending dispatch plan not found' }, { status: 404 })
  }

  if (parsed.data.action === 'reject') {
    const ok = pendingDispatchPlans.reject(planId)
    if (!ok) {
      return NextResponse.json({ error: 'Failed to reject pending dispatch plan' }, { status: 500 })
    }
    return NextResponse.json({ ok: true })
  }

  if (parsed.data.action === 'revise') {
    const result = await reviseDispatchPlan({ conversationId: id, planId, feedback: parsed.data.feedback })
    if (!result.ok) {
      return NextResponse.json({ error: result.error }, { status: 400 })
    }
    return NextResponse.json({ ok: true })
  }

  if (parsed.data.action === 'update') {
    // 结构深校验复用 Orchestrator 工具参数的解析器；DAG/agent 合法性由 store.update 的 validator 把关
    let plan
    try {
      plan = parseDispatchPlanToolArgs({ tasks: parsed.data.plan })
    } catch (err) {
      return NextResponse.json(
        { error: err instanceof Error ? err.message : String(err) },
        { status: 400 },
      )
    }
    const result = pendingDispatchPlans.update(planId, plan)
    if (!result.ok) {
      return NextResponse.json({ error: result.error }, { status: 400 })
    }
    // 带回编译后的计划（dependsOn 已归一化），客户端可立即乐观更新而不必等 SSE
    return NextResponse.json({ ok: true, plan: result.pendingPlan.plan })
  }

  const result = pendingDispatchPlans.approve(planId)
  if (!result.ok) {
    return NextResponse.json({ error: result.error }, { status: 400 })
  }

  return NextResponse.json({ ok: true })
}
