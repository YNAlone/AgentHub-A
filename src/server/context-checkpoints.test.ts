import { expect, it } from 'vitest'
import Database from 'better-sqlite3'
import path from 'node:path'
import { readCheckpoint, writeCheckpoint, writeJournal, type ContextCheckpoint } from './context-checkpoints'
import { sqlite } from '@/db/client'

const checkpoint: ContextCheckpoint = { messages: [{ role: 'user', content: 'continue' }], currentUserIndex: 0,
  turn: 5, providerRecoveries: 0, usage: { inputTokens: 10, outputTokens: 5, cacheCreationTokens: 0, cacheReadTokens: 0, lastInputTokens: 10 } }

it('uses compare-and-swap and isolates concurrent runs and stages', () => {
  expect(writeCheckpoint('run-a', 'execute', 0, checkpoint)).toBe(1)
  expect(writeCheckpoint('run-b', 'execute', 0, checkpoint)).toBe(1)
  expect(writeCheckpoint('run-a', 'plan', 0, checkpoint)).toBe(1)
  expect(writeCheckpoint('run-a', 'execute', 1, { ...checkpoint, turn: 6 })).toBe(2)
  expect(() => writeCheckpoint('run-a', 'execute', 1, checkpoint)).toThrow('版本')
  expect(readCheckpoint('run-b', 'execute')?.checkpoint.turn).toBe(5)
  expect(readCheckpoint('run-a', 'execute')?.checkpoint.turn).toBe(6)
})

it('retains checkpoints and workflow evidence across an independent database connection', () => {
  writeJournal('run-a', 'tool-result', { callId: 'done', result: 'saved' })
  const reopened = new Database(path.join(process.env.AGENTHUB_DATA_DIR!, 'agenthub.db'))
  try {
    expect(reopened.prepare('SELECT revision FROM run_context_checkpoints WHERE run_id=? AND stage=?').get('run-a', 'execute')).toEqual({ revision: 2 })
    expect(reopened.prepare('SELECT value FROM run_workflow_journal WHERE run_id=? AND step=?').get('run-a', 'tool-result')).toEqual({ value: JSON.stringify({ callId: 'done', result: 'saved' }) })
    expect(sqlite.prepare("SELECT name FROM sqlite_master WHERE type='trigger' AND name='delete_run_context'").get()).toBeTruthy()
  } finally { reopened.close() }
})
