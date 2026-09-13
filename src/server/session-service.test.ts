import Database from 'better-sqlite3'
import { expect, it } from 'vitest'
import { SessionService } from './session-service'

it('restores SDK handles across service recreation and isolates agents and providers', () => {
  const db = new Database(':memory:')
  try {
    const service = new SessionService(db)
    service.store('claude-code').set('c:a', 'claude-a')
    service.store('claude-code').set('c:b', 'claude-b')
    service.store('codex').set('c:a', 'codex-a')
    const restarted = new SessionService(db)
    expect(restarted.store('claude-code').get('c:a')).toBe('claude-a')
    expect(restarted.store('claude-code').get('c:b')).toBe('claude-b')
    expect(restarted.store('codex').get('c:a')).toBe('codex-a')
    restarted.invalidate('c')
    expect(restarted.store('claude-code').get('c:a')).toBeUndefined()
    expect(restarted.store('codex').get('c:a')).toBeUndefined()
  } finally { db.close() }
})
