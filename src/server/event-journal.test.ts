import Database from 'better-sqlite3'
import { expect, it } from 'vitest'
import { EventJournal } from './event-journal'

it('replays in cursor order after recreation and identifies expired cursors', () => {
  const db = new Database(':memory:')
  try {
    const journal = new EventJournal(db, 2)
    const first = journal.append({ type: 'heartbeat', conversationId: 'c', timestamp: 1 })
    const second = journal.append({ type: 'heartbeat', conversationId: 'c', timestamp: 2 })
    expect(new EventJournal(db, 2).after(first)?.map((item) => item.id)).toEqual([second])
    journal.append({ type: 'heartbeat', conversationId: 'c', timestamp: 3 })
    journal.append({ type: 'heartbeat', conversationId: 'c', timestamp: 4 })
    expect(journal.after(first)).toBeNull()
    expect(journal.after(journal.cursor())).toEqual([])
  } finally { db.close() }
})
