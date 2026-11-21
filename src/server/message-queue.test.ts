import { beforeEach, expect, it, vi } from 'vitest'
import { eq } from 'drizzle-orm'
import { db, schema, sqlite } from '@/db/client'
import { createConversation, sendMessage, withdrawLatestUserMessage, regenerateLatestResponse, editAndResendLatestUserMessage } from './conversation-service'
import { claimNextMessage, drainMessageQueue } from './message-queue'
import { recoverInterruptedRuns } from './recovery-service'
import { buildHistoryFor } from './conversation-context'

const { run } = vi.hoisted(() => ({ run: vi.fn((_args: unknown, runId: string) => ({ runId, promise: new Promise(() => {}) })) }))
vi.mock('./agent-runner', () => ({ AgentRunner: { run, abortAndWait: vi.fn(async () => {}) } }))
beforeEach(() => { sqlite.prepare('DELETE FROM conversations').run(); run.mockClear() })
const agent = db.select().from(schema.agents).all()[0]

it.each(['withdraw', 'regenerate', 'edit'] as const)('preserves the previous turn after queued input is dispatched: %s', async (action) => {
  const c = await createConversation({ mode: 'single', agentIds: [agent.id] })
  const first = await sendMessage({ conversationId: c.id, content: 'A' })
  const second = await sendMessage({ conversationId: c.id, content: 'B' })
  sqlite.prepare('UPDATE messages SET created_at=? WHERE id=?').run(100, first.messageId)
  sqlite.prepare('UPDATE messages SET created_at=? WHERE id=?').run(200, second.messageId)
  // The previous answer arrives after B was enqueued; timestamps cannot identify ownership.
  for (const [id, runId] of [['a-reply', first.runIds[0]]]) {
    db.insert(schema.artifacts).values({ id, conversationId: c.id, type: 'document', title: id, content: { type: 'document', format: 'markdown', content: id }, createdByAgentId: agent.id, createdAt: Date.now() + 10 }).run()
    db.insert(schema.messages).values({ id, conversationId: c.id, runId, role: 'agent', status: 'complete', parts: [{ type: 'artifact_ref', artifactId: id }], createdAt: Date.now() + 10 }).run()
  }
  sqlite.prepare("UPDATE agent_runs SET status='complete'").run()
  await drainMessageQueue()
  const secondRun = db.select().from(schema.agentRuns).where(eq(schema.agentRuns.triggerMessageId, second.messageId)).get()!
  db.insert(schema.agentRuns).values({ id: 'b-child', conversationId: c.id, agentId: agent.id, parentRunId: secondRun.id, status: 'complete', startedAt: 1 }).run()
  db.insert(schema.artifacts).values({ id: 'b-artifact', conversationId: c.id, type: 'document', title: 'B', content: { type: 'document', format: 'markdown', content: 'B' }, createdByAgentId: agent.id, createdAt: 1 }).run()
  db.insert(schema.messages).values({ id: 'b-reply', conversationId: c.id, runId: 'b-child', role: 'agent', status: 'complete', parts: [{ type: 'artifact_ref', artifactId: 'b-artifact' }, { type: 'artifact_ref', artifactId: 'a-reply' }], createdAt: 1 }).run()
  sqlite.prepare("INSERT INTO run_workflow_journal(run_id,step,value) VALUES ('b-child','args','{}')").run()
  sqlite.prepare("UPDATE agent_runs SET status='complete'").run()
  if (action === 'withdraw') await withdrawLatestUserMessage(c.id, second.messageId)
  if (action === 'regenerate') await regenerateLatestResponse(c.id)
  if (action === 'edit') await editAndResendLatestUserMessage(c.id, second.messageId, 'edited B')
  expect(db.select().from(schema.messages).where(eq(schema.messages.id, 'a-reply')).get()).toBeDefined()
  expect(db.select().from(schema.artifacts).where(eq(schema.artifacts.id, 'a-reply')).get()).toBeDefined()
  expect(db.select().from(schema.agentRuns).where(eq(schema.agentRuns.id, first.runIds[0])).get()).toBeDefined()
  expect(db.select().from(schema.messages).where(eq(schema.messages.id, 'b-reply')).get()).toBeUndefined()
  expect(db.select().from(schema.agentRuns).where(eq(schema.agentRuns.id, 'b-child')).get()).toBeUndefined()
  expect(db.select().from(schema.artifacts).where(eq(schema.artifacts.id, 'b-artifact')).get()).toBeUndefined()
  expect(sqlite.prepare("SELECT 1 FROM run_workflow_journal WHERE run_id='b-child'").get()).toBeUndefined()
})

it('serializes messages including concurrent sends and keeps pending content out of history', async () => {
  const c = await createConversation({ mode: 'single', agentIds: [agent.id] })
  const first = await sendMessage({ conversationId: c.id, content: 'first' })
  const [second, third] = await Promise.all(['second', 'third'].map((content) => sendMessage({ conversationId: c.id, content })))
  expect(first.runIds).toHaveLength(1)
  expect(second.runIds).toHaveLength(0)
  expect(third.runIds).toHaveLength(0)
  expect(run).toHaveBeenCalledTimes(1)
  expect(JSON.stringify(await buildHistoryFor(agent.id, c.id))).not.toContain('second')
  expect(JSON.stringify(await buildHistoryFor(agent.id, c.id))).not.toContain('third')
  sqlite.prepare("UPDATE agent_runs SET status='complete' WHERE id=?").run(first.runIds[0])
  await drainMessageQueue()
  expect(run).toHaveBeenCalledTimes(2)
  expect(run.mock.calls[1][0]).toMatchObject({ triggerMessageId: second.messageId })
  expect(db.select().from(schema.messages).where(eq(schema.messages.id, third.messageId)).get()?.status).toBe('queued')
  sqlite.prepare("UPDATE agent_runs SET status='complete'").run()
  await drainMessageQueue()
  expect(run.mock.calls[2][0]).toMatchObject({ triggerMessageId: third.messageId })
})

it('deduplicates retried client message IDs and preserves mention/reply information', async () => {
  const c = await createConversation({ mode: 'single', agentIds: [agent.id] })
  const args = { conversationId: c.id, clientMessageId: 'msg_client_once', content: 'one', mentionedAgentIds: [agent.id] }
  const results = await Promise.all([sendMessage(args), sendMessage(args)])
  expect(results[0].messageId).toBe(results[1].messageId)
  expect(sqlite.prepare('SELECT count(*) AS n FROM messages').get()).toEqual({ n: 1 })
  expect(run).toHaveBeenCalledTimes(1)
  expect(db.select().from(schema.messages).all()[0].mentionedAgentIds).toEqual([agent.id])
})

it('keeps interrupted and paused conversations blocked while other conversations can run', async () => {
  const a = await createConversation({ mode: 'single', agentIds: [agent.id] })
  const b = await createConversation({ mode: 'single', agentIds: [agent.id] })
  await sendMessage({ conversationId: a.id, content: 'active' })
  const queued = await sendMessage({ conversationId: a.id, content: 'waiting' })
  recoverInterruptedRuns(sqlite)
  expect(claimNextMessage()).toBeNull()
  await sendMessage({ conversationId: b.id, content: 'independent' })
  expect(run).toHaveBeenCalledTimes(2)
  sqlite.prepare("UPDATE agent_runs SET status='paused' WHERE conversation_id=?").run(a.id)
  expect(claimNextMessage()).toBeNull()
  sqlite.prepare("UPDATE agent_runs SET status='aborted' WHERE conversation_id=?").run(a.id)
  await drainMessageQueue()
  expect(run.mock.calls[2][0]).toMatchObject({ triggerMessageId: queued.messageId })
  await drainMessageQueue()
  expect(run).toHaveBeenCalledTimes(3)
})

it('withdraws queued input without deleting a previous turn response', async () => {
  const c = await createConversation({ mode: 'single', agentIds: [agent.id] })
  await sendMessage({ conversationId: c.id, content: 'active' })
  const queued = await sendMessage({ conversationId: c.id, content: 'withdraw me' })
  db.insert(schema.messages).values({ id: 'reply', conversationId: c.id, role: 'agent', status: 'streaming', parts: [], createdAt: Date.now() + 10 }).run()
  await withdrawLatestUserMessage(c.id, queued.messageId)
  expect(db.select().from(schema.messages).where(eq(schema.messages.id, 'reply')).get()).toBeDefined()
  expect(sqlite.prepare('SELECT 1 FROM conversation_message_queue WHERE message_id=?').get(queued.messageId)).toBeUndefined()
})

it('atomically saves reserved run IDs and recovery args before dispatch', async () => {
  const c = await createConversation({ mode: 'single', agentIds: [agent.id] })
  const first = await sendMessage({ conversationId: c.id, content: 'first' })
  const waiting = await sendMessage({ conversationId: c.id, content: 'waiting' })
  sqlite.prepare("UPDATE agent_runs SET status='complete' WHERE id=?").run(first.runIds[0])
  const claimed = claimNextMessage()!
  expect(claimed.row.message_id).toBe(waiting.messageId)
  const runId = claimed.runs[0].runId
  expect(sqlite.prepare('SELECT status FROM agent_runs WHERE id=?').get(runId)).toEqual({ status: 'queued' })
  const journal = sqlite.prepare("SELECT value FROM run_workflow_journal WHERE run_id=? AND step='args'").get(runId) as { value: string }
  expect(JSON.parse(journal.value)).toMatchObject({ triggerMessageId: waiting.messageId })
  recoverInterruptedRuns(sqlite)
  expect(sqlite.prepare('SELECT status FROM agent_runs WHERE id=?').get(runId)).toEqual({ status: 'interrupted' })
  expect(claimNextMessage()).toBeNull()
})
