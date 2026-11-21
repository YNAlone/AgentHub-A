import { expect, it, vi } from 'vitest'
import { eq } from 'drizzle-orm'
import { db, schema, sqlite } from '@/db/client'
import { AgentRunner } from './agent-runner'
import { agentRegistry } from './adapters/registry'
import { createConversation, withdrawLatestUserMessage } from './conversation-service'
import { ContextPausedError } from './working-context'
import { readCheckpoint } from './context-checkpoints'
import { recoverInterruptedRuns } from './recovery-service'
import type { AdapterInput } from './adapters/types'
import type { StreamEvent } from '@/shared/types'

it('resumes the same paused run idempotently, reuses completed results, and preserves pause through recovery', async () => {
  const agent = db.select().from(schema.agents).all()[0]
  db.update(schema.agents).set({ isOrchestrator: false }).where(eq(schema.agents.id, agent.id)).run()
  const conversation = await createConversation({ mode: 'single', agentIds: [agent.id] })
  db.insert(schema.messages).values({ id: 'trigger', conversationId: conversation.id, role: 'user', status: 'complete', parts: [{ type: 'text', content: 'search five times' }], createdAt: Date.now() }).run()
  let operations = 0
  let release: (() => void) | undefined
  const stream = vi.fn(async function* (input: AdapterInput): AsyncIterable<StreamEvent> {
    if (!input.contextControl?.restored) {
      operations++
      input.contextControl!.save({ messages: [{ role: 'user', content: input.prompt }, { role: 'assistant', content: 'completed search results' }],
        currentUserIndex: 0, turn: 5, providerRecoveries: 0,
        usage: { inputTokens: 500, outputTokens: 50, cacheCreationTokens: 0, cacheReadTokens: 0, lastInputTokens: 500 } })
      input.contextControl!.progress({ state: 'paused', message: '摘要失败，现场已保存' })
      throw new ContextPausedError('摘要失败，现场已保存')
    }
    expect(input.contextControl.restored.turn).toBe(5)
    expect(input.contextControl.restored.messages[1].content).toBe('completed search results')
    await new Promise<void>((resolve) => { release = resolve })
    yield { type: 'run.usage', conversationId: input.conversationId, runId: input.runId, timestamp: Date.now(), usage: input.contextControl.restored.usage }
  })
  const spy = vi.spyOn(agentRegistry, 'getAdapter').mockReturnValue({ name: 'custom', stream })
  try {
    const initial = AgentRunner.run({ agentId: agent.id, conversationId: conversation.id, triggerMessageId: 'trigger' })
    expect((await initial.promise).status).toBe('paused')
    recoverInterruptedRuns(sqlite)
    expect(db.select().from(schema.agentRuns).where(eq(schema.agentRuns.id, initial.runId)).get()?.status).toBe('paused')
    const resumed = AgentRunner.resume(initial.runId)!
    const duplicate = AgentRunner.resume(initial.runId)!
    expect(duplicate.promise).toBe(resumed.promise)
    await vi.waitFor(() => expect(release).toBeTypeOf('function'))
    release!()
    expect((await resumed.promise).status).toBe('complete')
    expect(operations).toBe(1)
    expect(stream).toHaveBeenCalledTimes(2)
    expect(db.select().from(schema.agentRuns).all()).toHaveLength(1)
    expect(AgentRunner.resume(initial.runId)).toBeNull()
    const rows = sqlite.prepare('SELECT stage FROM run_context_checkpoints WHERE run_id=?').all(initial.runId) as { stage: string }[]
    expect(readCheckpoint(initial.runId, rows[0].stage)?.checkpoint.turn).toBe(5)
    db.delete(schema.agentRuns).where(eq(schema.agentRuns.id, initial.runId)).run()
    expect(readCheckpoint(initial.runId, rows[0].stage)).toBeNull()
  } finally { spy.mockRestore() }
})

it('cancels a paused run without invoking an adapter', () => {
  const conversation = db.select().from(schema.conversations).all()[0]
  db.insert(schema.agentRuns).values({ id: 'cancel-paused', conversationId: conversation.id, agentId: conversation.agentIds[0], status: 'paused', startedAt: Date.now() }).run()
  expect(AgentRunner.abort('cancel-paused')).toBe(true)
  expect(db.select().from(schema.agentRuns).where(eq(schema.agentRuns.id, 'cancel-paused')).get()?.status).toBe('aborted')
  expect(AgentRunner.abort('cancel-paused')).toBe(false)
})

it('withdrawal waits for cancelled provider cleanup and removes its final error message', async () => {
  const agent = db.select().from(schema.agents).all()[0]
  const conversation = await createConversation({ mode: 'single', agentIds: [agent.id] })
  db.insert(schema.messages).values({ id: 'cancel-trigger', conversationId: conversation.id, role: 'user', status: 'complete', parts: [{ type: 'text', content: 'work' }], createdAt: Date.now() }).run()
  let started = false
  let aborted = false
  let release!: () => void
  const cleanup = new Promise<void>((resolve) => { release = resolve })
  const stream = async function* (input: AdapterInput, signal: AbortSignal): AsyncIterable<StreamEvent> {
    started = true
    await new Promise<void>((resolve) => signal.addEventListener('abort', () => { aborted = true; resolve() }, { once: true }))
    await cleanup
    signal.throwIfAborted()
    yield { type: 'run.end', conversationId: input.conversationId, runId: input.runId, status: 'aborted', timestamp: Date.now() }
  }
  const spy = vi.spyOn(agentRegistry, 'getAdapter').mockReturnValue({ name: 'custom', stream })
  try {
    const running = AgentRunner.run({ agentId: agent.id, conversationId: conversation.id, triggerMessageId: 'cancel-trigger' })
    await vi.waitFor(() => expect(started).toBe(true))
    let removed = false
    const withdrawal = withdrawLatestUserMessage(conversation.id, 'cancel-trigger').then(() => { removed = true })
    await vi.waitFor(() => expect(aborted).toBe(true))
    expect(removed).toBe(false)
    release()
    await withdrawal
    await running.promise
    expect(db.select().from(schema.messages).where(eq(schema.messages.conversationId, conversation.id)).all()).toEqual([])
    expect(db.select().from(schema.agentRuns).where(eq(schema.agentRuns.id, running.runId)).get()).toBeUndefined()
  } finally { release(); spy.mockRestore() }
})
