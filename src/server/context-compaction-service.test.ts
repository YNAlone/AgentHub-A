import { expect, it, vi } from 'vitest'
const model = vi.hoisted(() => ({ create: vi.fn() }))
vi.mock('openai', () => ({ default: class { chat = { completions: { create: model.create } } } }))
import { db, schema } from '@/db/client'
import { compactConversation, getLatestContextSummary } from './context-compaction-service'
import { buildHistoryFor } from './conversation-context'
import { eq } from 'drizzle-orm'

it('rejects a summary when its original messages changed during the model request', async () => {
  db.insert(schema.agents).values({ id: 'race-agent', name: 'summary', avatar: 'S', description: 'test', capabilities: [], systemPrompt: 'test', adapterName: 'custom', modelProvider: 'openai-compatible', modelId: 'test-model', apiKey: 'fake-test-key', apiBaseUrl: 'https://model.invalid', toolNames: [], createdAt: 1 }).run()
  db.insert(schema.conversations).values({ id: 'race', title: 'race', mode: 'single', agentIds: ['race-agent'], createdAt: 1, updatedAt: 1 }).run()
  for (let i = 0; i < 8; i++) db.insert(schema.messages).values({ id: `race-${i}`, conversationId: 'race', role: 'user', parts: [{ type: 'text', content: '旧约束' }], status: 'complete', createdAt: 1 }).run()
  model.create.mockImplementationOnce(async () => {
    db.update(schema.messages).set({ parts: [{ type: 'text', content: '修改后的约束' }] }).where(eq(schema.messages.id, 'race-0')).run()
    return { choices: [{ message: { content: '旧约束摘要' }, finish_reason: 'stop' }] }
  })
  await expect(compactConversation('race')).rejects.toThrow('来源')
  expect(await getLatestContextSummary('race')).toBeNull()
})

it('keeps source history on model failure and preserves same-millisecond recent messages after compaction', async () => {
  db.insert(schema.agents).values({ id: 'summary-agent', name: 'summary', avatar: 'S', description: 'test', capabilities: [], systemPrompt: 'test', adapterName: 'custom', modelProvider: 'openai-compatible', modelId: 'test-model', apiKey: 'fake-test-key', apiBaseUrl: 'https://model.invalid', toolNames: [], createdAt: 1 }).run()
  db.insert(schema.conversations).values({ id: 'compact-test', title: 'compact', mode: 'single', agentIds: ['summary-agent'], createdAt: 1, updatedAt: 1 }).run()
  for (let i = 0; i < 8; i++) db.insert(schema.messages).values({ id: `compact-${i}`, conversationId: 'compact-test', role: 'user', parts: [{ type: 'text', content: `约束 ${i}：只使用 SQLite，文件在 /project/app.ts。` }], status: 'complete', createdAt: 1 }).run()
  model.create.mockRejectedValueOnce(new Error('model unavailable'))
  await expect(compactConversation('compact-test')).rejects.toThrow('model unavailable')
  expect(await getLatestContextSummary('compact-test')).toBeNull()
  expect(await buildHistoryFor('summary-agent', 'compact-test')).toHaveLength(8)
  model.create.mockResolvedValueOnce({ choices: [{ message: { content: '保留约束0与1：仅 SQLite，文件 /project/app.ts。' }, finish_reason: 'stop' }], usage: { prompt_tokens: 100, completion_tokens: 20 } })
  const result = await compactConversation('compact-test')
  expect(result.summary.sourceMessageCount).toBe(2)
  const restored = await buildHistoryFor('summary-agent', 'compact-test')
  expect(restored).toHaveLength(7)
  expect(JSON.stringify(restored)).toContain('约束 2')
  expect(db.select().from(schema.messages).all().filter((m) => m.id.startsWith('compact-'))).toHaveLength(8)
})
