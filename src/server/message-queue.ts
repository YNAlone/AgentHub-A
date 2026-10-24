import { eq } from 'drizzle-orm'
import { db, schema, sqlite } from '@/db/client'
import { newRunId } from './ids'
import { eventBus } from './event-bus'

interface QueueRow { message_id: string; conversation_id: string; agent_ids: string; run_ids: string }
const BLOCKING = "('queued','running','compacting','paused','interrupted')"

/** All claims use durable placeholder runs, closing the crash window before async Agent startup. */
export function claimNextMessage() {
  return sqlite.transaction(() => {
    const row = sqlite.prepare(`SELECT q.* FROM conversation_message_queue q
      WHERE q.state='queued' AND NOT EXISTS (
        SELECT 1 FROM agent_runs r WHERE r.conversation_id=q.conversation_id AND r.status IN ${BLOCKING})
      ORDER BY q.rowid LIMIT 1`).get() as QueueRow | undefined
    if (!row) return null
    const agents = JSON.parse(row.agent_ids) as string[]
    // Deleting an Agent while its input waits must not poison every conversation's queue.
    if (agents.some((id) => !sqlite.prepare('SELECT 1 FROM agents WHERE id=?').get(id))) {
      sqlite.prepare("UPDATE conversation_message_queue SET state='dispatched' WHERE message_id=?").run(row.message_id)
      sqlite.prepare("UPDATE messages SET status='error' WHERE id=?").run(row.message_id)
      return { row, runs: [] }
    }
    const runs = agents.map((agentId) => ({ runId: newRunId(), args: { agentId, conversationId: row.conversation_id, triggerMessageId: row.message_id } }))
    for (const { runId, args } of runs) {
      sqlite.prepare("INSERT INTO agent_runs(id,conversation_id,agent_id,trigger_message_id,status,started_at) VALUES (?,?,?,?,'queued',?)")
        .run(runId, args.conversationId, args.agentId, args.triggerMessageId, Date.now())
      sqlite.prepare('INSERT INTO run_workflow_journal(run_id,step,value) VALUES (?,?,?)').run(runId, 'args', JSON.stringify(args))
    }
    sqlite.prepare("UPDATE conversation_message_queue SET state='dispatched',run_ids=? WHERE message_id=?").run(JSON.stringify(runs.map((r) => r.runId)), row.message_id)
    sqlite.prepare("UPDATE messages SET status='complete' WHERE id=?").run(row.message_id)
    // A summary created while this message was queued never covered its content.
    sqlite.prepare('DELETE FROM conversation_context_summaries WHERE conversation_id=? AND created_at>=?')
      .run(row.conversation_id, (sqlite.prepare('SELECT created_at FROM messages WHERE id=?').get(row.message_id) as { created_at: number }).created_at)
    return { row, runs }
  }).immediate()
}

/** Polling also drains work after cancelling/resuming a previously paused run. */
export async function drainMessageQueue() {
  const { AgentRunner } = await import('./agent-runner')
  for (;;) {
    const claimed = claimNextMessage()
    if (!claimed) return
    const message = db.select().from(schema.messages).where(eq(schema.messages.id, claimed.row.message_id)).get()!
    eventBus.publish({ type: 'message.added', conversationId: message.conversationId, timestamp: Date.now(), message })
    for (const { runId, args } of claimed.runs) {
      // Unexpected setup failures must not leave a permanent queued placeholder.
      try {
        const { promise } = AgentRunner.run(args, runId)
        void promise.catch(() => {
          sqlite.prepare("UPDATE agent_runs SET status='failed',error='消息启动失败，请重试',finished_at=? WHERE id=? AND status IN ('queued','running')").run(Date.now(), runId)
        })
      } catch {
        sqlite.prepare("UPDATE agent_runs SET status='failed',error='消息启动失败，请重试',finished_at=? WHERE id=?").run(Date.now(), runId)
      }
    }
  }
}

const runtime = globalThis as unknown as { __messageQueueTimer?: ReturnType<typeof setInterval>; __messageQueueDrain?: () => Promise<void> }
/** HMR replaces the callback without adding workers; DB claims serialize concurrent callers. */
export function startMessageQueueWorker() {
  runtime.__messageQueueDrain = drainMessageQueue
  if (runtime.__messageQueueTimer) return
  runtime.__messageQueueTimer = setInterval(() => { void runtime.__messageQueueDrain?.().catch(() => { /* durable rows retry on the next tick */ }) }, 1000)
  runtime.__messageQueueTimer.unref()
}
