import { getPersonalSettings } from './personal-settings'
import { buildHistoryFor } from './conversation-context'
import { compactConversation } from './context-compaction-service'

/** Try compaction before exhausting the window; retain full history if summarization is unavailable. */
export async function buildAutomaticHistory(agentId: string, conversationId: string, excludeMessageId: string, budget: number, signal?: AbortSignal, estimateFactor = 1) {
  if (budget <= 0) throw new Error('系统指令和当前输入已用尽上下文预算，请减少输入。')
  if (!getPersonalSettings().automaticCompaction) return buildHistoryFor(agentId, conversationId, { excludeMessageId, tokenBudget: budget, estimateFactor })
  // Reserve a modest amount for the next turn, but never make it a second hard limit.
  const softBudget = Math.max(0, budget - Math.min(16_384, Math.ceil(budget * 0.1)))
  const options = { excludeMessageId, tokenBudget: softBudget, estimateFactor }
  for (let attempt = 0; attempt < 16; attempt++) {
    signal?.throwIfAborted()
    try { return await buildHistoryFor(agentId, conversationId, options) } catch {
      try { await compactConversation(conversationId, signal) } catch (error) {
        signal?.throwIfAborted()
        try { return await buildHistoryFor(agentId, conversationId, { ...options, tokenBudget: budget }) } catch {
          throw new Error(`自动压缩未完成；历史已保留。${error instanceof Error ? error.message : '请重试'}`)
        }
      }
    }
  }
  return buildHistoryFor(agentId, conversationId, { ...options, tokenBudget: budget })
}
