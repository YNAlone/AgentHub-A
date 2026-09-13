import type Database from 'better-sqlite3'
import type { AdapterSessionStore } from './adapters/session-store'

/** Services own persistence; adapters receive only the session registry interface. */
export class SessionService {
  constructor(private readonly sqlite: Database.Database) {
    sqlite.exec(`CREATE TABLE IF NOT EXISTS sdk_sessions (
      namespace TEXT NOT NULL, session_key TEXT NOT NULL, handle TEXT NOT NULL,
      PRIMARY KEY(namespace, session_key))`)
    sqlite.exec('CREATE TABLE IF NOT EXISTS sdk_context_revisions (namespace TEXT, session_key TEXT, signature TEXT, PRIMARY KEY(namespace, session_key))')
  }

  store(namespace: string): AdapterSessionStore {
    return {
      get: (key) => (this.sqlite.prepare('SELECT handle FROM sdk_sessions WHERE namespace = ? AND session_key = ?').get(namespace, key) as { handle: string } | undefined)?.handle,
      set: (key, handle) => { this.sqlite.prepare('INSERT INTO sdk_sessions VALUES (?, ?, ?) ON CONFLICT(namespace, session_key) DO UPDATE SET handle = excluded.handle').run(namespace, key, handle) },
      delete: (key) => this.sqlite.prepare('DELETE FROM sdk_sessions WHERE namespace = ? AND session_key = ?').run(namespace, key).changes > 0,
      keys: () => (this.sqlite.prepare('SELECT session_key AS key FROM sdk_sessions WHERE namespace = ?').all(namespace) as { key: string }[]).map((row) => row.key).values(),
      clear: () => { this.sqlite.prepare('DELETE FROM sdk_sessions WHERE namespace = ?').run(namespace) },
    }
  }

  invalidate(conversationId: string): void {
    // Compare the exact prefix rather than SQL LIKE, where '_' in IDs is a wildcard.
    this.sqlite.prepare('DELETE FROM sdk_sessions WHERE substr(session_key, 1, ?) = ?').run(conversationId.length + 1, `${conversationId}:`)
  }

  ensureRevision(namespace: string, key: string, signature: string): void {
    const previous = this.sqlite.prepare('SELECT signature FROM sdk_context_revisions WHERE namespace = ? AND session_key = ?').get(namespace, key) as { signature: string } | undefined
    if (previous?.signature === signature) return
    this.sqlite.transaction(() => {
      this.store(namespace).delete(key)
      this.sqlite.prepare('INSERT INTO sdk_context_revisions VALUES (?, ?, ?) ON CONFLICT(namespace, session_key) DO UPDATE SET signature = excluded.signature').run(namespace, key, signature)
    })()
  }
}
