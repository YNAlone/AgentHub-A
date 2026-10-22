import { describe, expect, it } from 'vitest'

import type { DispatchPlanItem } from '@/shared/types'

import { compileDispatchPlan, validateDispatchPlan } from './dispatch-plan'
import { pendingDispatchPlans, type PlanReviewOutcome } from './pending-dispatch-plans'

const agents = [{ id: 'ag_pm' }, { id: 'ag_frontend' }]

function validate(plan: DispatchPlanItem[]): DispatchPlanItem[] {
  const compiled = compileDispatchPlan(plan).plan
  validateDispatchPlan(compiled, agents, 'ag_orchestrator')
  return compiled
}

describe('pendingDispatchPlans', () => {
  it('approves the registered plan (revalidated/compiled) without a body', () => {
    const pending = pendingDispatchPlans.register({
      conversationId: 'conv_plan_review_approve',
      agentId: 'ag_orchestrator',
      runId: 'run_plan_review_approve',
      plan: [
        {
          id: 't1',
          agentId: 'ag_pm',
          task: 'Write PRD',
          expectedOutputs: [{ id: 'prd', type: 'document' }],
        },
        {
          id: 't2',
          agentId: 'ag_frontend',
          task: 'Build UI',
          inputs: [{ fromTaskId: 't1', outputId: 'prd' }],
        },
      ],
      validator: validate,
    })
    let resolved: PlanReviewOutcome | undefined
    pendingDispatchPlans.attachResolver(pending.id, (outcome) => {
      resolved = outcome
    })

    const result = pendingDispatchPlans.approve(pending.id)

    expect(result).toEqual({ ok: true })
    expect(resolved?.kind).toBe('approve')
    if (resolved?.kind === 'approve') {
      // compileDispatchPlan derives dependsOn from inputs
      expect(resolved.plan[1].dependsOn).toEqual(['t1'])
    }
    expect(pendingDispatchPlans.get(pending.id)).toBeUndefined()
  })

  it('keeps invalid plans pending on approve', () => {
    const pending = pendingDispatchPlans.register({
      conversationId: 'conv_plan_review_invalid',
      agentId: 'ag_orchestrator',
      runId: 'run_plan_review_invalid',
      plan: [{ id: 't1', agentId: 'ag_missing', task: 'Write PRD' }],
      validator: validate,
    })
    let resolved = false
    pendingDispatchPlans.attachResolver(pending.id, () => {
      resolved = true
    })

    const result = pendingDispatchPlans.approve(pending.id)

    expect(result.ok).toBe(false)
    expect(resolved).toBe(false)
    expect(pendingDispatchPlans.get(pending.id)).toBeDefined()
    expect(pendingDispatchPlans.reject(pending.id)).toBe(true)
  })

  it('resolves rejection and removes the pending plan', () => {
    const pending = pendingDispatchPlans.register({
      conversationId: 'conv_plan_review_reject',
      agentId: 'ag_orchestrator',
      runId: 'run_plan_review_reject',
      plan: [{ id: 't1', agentId: 'ag_pm', task: 'Write PRD' }],
      validator: validate,
    })
    let resolved: PlanReviewOutcome | undefined
    pendingDispatchPlans.attachResolver(pending.id, (outcome) => {
      resolved = outcome
    })

    expect(pendingDispatchPlans.reject(pending.id)).toBe(true)
    expect(resolved?.kind).toBe('reject')
    expect(pendingDispatchPlans.get(pending.id)).toBeUndefined()
  })

  it('resolves revise with the feedback and removes the pending plan', () => {
    const pending = pendingDispatchPlans.register({
      conversationId: 'conv_plan_review_revise',
      agentId: 'ag_orchestrator',
      runId: 'run_plan_review_revise',
      plan: [{ id: 't1', agentId: 'ag_pm', task: 'Write PRD' }],
      validator: validate,
    })
    let resolved: PlanReviewOutcome | undefined
    pendingDispatchPlans.attachResolver(pending.id, (outcome) => {
      resolved = outcome
    })

    expect(pendingDispatchPlans.revise(pending.id, 't2 依赖 t1')).toBe(true)
    expect(resolved).toEqual({ kind: 'revise', feedback: 't2 依赖 t1' })
    expect(pendingDispatchPlans.get(pending.id)).toBeUndefined()
  })

  it('updates the pending plan and approve executes the edited version', () => {
    const pending = pendingDispatchPlans.register({
      conversationId: 'conv_plan_review_update',
      agentId: 'ag_orchestrator',
      runId: 'run_plan_review_update',
      plan: [{ id: 't1', agentId: 'ag_pm', task: 'Write PRD' }],
      validator: validate,
    })
    let resolved: PlanReviewOutcome | undefined
    pendingDispatchPlans.attachResolver(pending.id, (outcome) => {
      resolved = outcome
    })

    const result = pendingDispatchPlans.update(pending.id, [
      { id: 't1', agentId: 'ag_frontend', task: 'Build UI', dependsOn: [] },
      { id: 't2', agentId: 'ag_pm', task: 'Write PRD' },
    ])

    expect(result.ok).toBe(true)
    if (result.ok) {
      expect(result.pendingPlan.plan.map((t) => t.id)).toEqual(['t1', 't2'])
    }
    // 编辑后计划仍处于 pending，未触发 resolver
    expect(resolved).toBeUndefined()
    expect(pendingDispatchPlans.get(pending.id)?.plan[0].agentId).toBe('ag_frontend')

    expect(pendingDispatchPlans.approve(pending.id)).toEqual({ ok: true })
    expect(resolved?.kind).toBe('approve')
    if (resolved?.kind === 'approve') {
      expect(resolved.plan[0].agentId).toBe('ag_frontend')
    }
    expect(pendingDispatchPlans.get(pending.id)).toBeUndefined()
  })

  it('keeps the original plan when an update fails validation', () => {
    const pending = pendingDispatchPlans.register({
      conversationId: 'conv_plan_review_update_invalid',
      agentId: 'ag_orchestrator',
      runId: 'run_plan_review_update_invalid',
      plan: [{ id: 't1', agentId: 'ag_pm', task: 'Write PRD' }],
      validator: validate,
    })

    const result = pendingDispatchPlans.update(pending.id, [
      { id: 't1', agentId: 'ag_pm', task: 'Write PRD' },
      { id: 't2', agentId: 'ag_frontend', task: 'Build UI', dependsOn: ['t_missing'] },
    ])

    expect(result.ok).toBe(false)
    if (!result.ok) expect(result.error).toContain('t_missing')
    expect(pendingDispatchPlans.get(pending.id)?.plan).toHaveLength(1)
  })
})
