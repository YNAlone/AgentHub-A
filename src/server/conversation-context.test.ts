import { expect, it } from 'vitest'
import { db, schema } from '@/db/client'
import { buildHistoryFor } from './conversation-context'

it('rejects zero budgets and mandatory context overflow instead of silently sending oversized or forgotten history', async () => {
  db.insert(schema.conversations).values({ id: 'budget', title: 'budget', mode: 'single', agentIds: [], pinnedMessageIds: ['pinned'], createdAt: 1, updatedAt: 1 }).run()
  db.insert(schema.messages).values({ id: 'pinned', conversationId: 'budget', role: 'user', parts: [{ type: 'text', content: '必须保留的用户约束'.repeat(30) }], status: 'complete', createdAt: 1 }).run()
  await expect(buildHistoryFor('a', 'budget', { tokenBudget: 0 })).rejects.toThrow()
  await expect(buildHistoryFor('a', 'budget', { tokenBudget: 4 })).rejects.toThrow()
  expect(await buildHistoryFor('a', 'budget', { tokenBudget: 2000 })).toHaveLength(1)
})
