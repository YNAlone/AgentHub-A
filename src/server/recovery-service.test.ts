import Database from 'better-sqlite3'
import { expect, it } from 'vitest'
import { recoverInterruptedRuns } from './recovery-service'

it('marks unfinished work interrupted on startup without completing or approving it', () => {
  const db = new Database(':memory:')
  try {
    db.exec(`CREATE TABLE agent_runs (id TEXT, status TEXT, error TEXT, finished_at INTEGER);
      CREATE TABLE messages (id TEXT, status TEXT);
      INSERT INTO agent_runs VALUES ('r', 'running', NULL, NULL), ('done', 'complete', NULL, 1);
      INSERT INTO messages VALUES ('partial', 'streaming'), ('done', 'complete');`)
    recoverInterruptedRuns(db)
    expect(db.prepare('SELECT status FROM agent_runs WHERE id = ?').get('r')).toEqual({ status: 'interrupted' })
    expect(db.prepare('SELECT status FROM agent_runs WHERE id = ?').get('done')).toEqual({ status: 'complete' })
    expect(db.prepare('SELECT status FROM messages WHERE id = ?').get('partial')).toEqual({ status: 'aborted' })
    expect(recoverInterruptedRuns(db)).toBe(0)
  } finally { db.close() }
})
