import type Database from 'better-sqlite3'
import type { StreamEvent } from '@/shared/types'

export interface JournalEntry { id: number; event: StreamEvent }

/** SQLite AUTOINCREMENT prevents cursor reuse across server restarts and retention cleanup. */
export class EventJournal {
  constructor(private readonly sqlite: Database.Database, private readonly retention = 10000) {
    sqlite.exec('CREATE TABLE IF NOT EXISTS stream_events (id INTEGER PRIMARY KEY AUTOINCREMENT, event TEXT NOT NULL)')
    sqlite.exec('CREATE TABLE IF NOT EXISTS dispatch_events (id INTEGER PRIMARY KEY, conversation_id TEXT NOT NULL REFERENCES conversations(id) ON DELETE CASCADE, event TEXT NOT NULL)')
  }
  append(event: StreamEvent): number {
    return this.sqlite.transaction(() => {
      const id = Number(this.sqlite.prepare('INSERT INTO stream_events(event) VALUES (?)').run(JSON.stringify(event)).lastInsertRowid)
      if (['dispatch.plan', 'dispatch.start', 'dispatch.end'].includes(event.type)) {
        // Execution plans outlive the short replay window; approval promises are never persisted as executable grants.
        this.sqlite.prepare('INSERT INTO dispatch_events VALUES (?, ?, ?)').run(id, event.conversationId, JSON.stringify(event))
      }
      this.sqlite.prepare('DELETE FROM stream_events WHERE id <= ?').run(id - this.retention)
      return id
    })()
  }
  cursor(): number {
    return (this.sqlite.prepare('SELECT COALESCE(MAX(id), 0) AS id FROM stream_events').get() as { id: number }).id
  }
  after(cursor: number): JournalEntry[] | null {
    const min = (this.sqlite.prepare('SELECT COALESCE(MIN(id), 0) AS id FROM stream_events').get() as { id: number }).id
    if (!Number.isSafeInteger(cursor) || cursor < Math.max(0, min - 1) || cursor > this.cursor()) return null
    return (this.sqlite.prepare('SELECT id, event FROM stream_events WHERE id > ? ORDER BY id').all(cursor) as { id: number; event: string }[])
      .map((row) => ({ id: row.id, event: JSON.parse(row.event) as StreamEvent }))
  }
}
