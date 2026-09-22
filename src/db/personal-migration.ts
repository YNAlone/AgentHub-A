import type Database from 'better-sqlite3'

/** Additive, transactional migration preserves existing conversations and workspace files. */
export function migratePersonalSchema(sqlite: Database.Database): void {
  sqlite.transaction(() => {
    sqlite.exec(`
    CREATE TABLE IF NOT EXISTS projects (
      id TEXT PRIMARY KEY, name TEXT NOT NULL, created_at INTEGER NOT NULL
    );
    CREATE TABLE IF NOT EXISTS project_conversations (
      conversation_id TEXT PRIMARY KEY REFERENCES conversations(id) ON DELETE CASCADE,
      project_id TEXT NOT NULL REFERENCES projects(id) ON DELETE CASCADE
    );
    CREATE INDEX IF NOT EXISTS idx_project_conversations_project ON project_conversations(project_id);
    CREATE TABLE IF NOT EXISTS sdk_sessions (namespace TEXT NOT NULL, session_key TEXT NOT NULL, handle TEXT NOT NULL, PRIMARY KEY(namespace, session_key));
    CREATE TABLE IF NOT EXISTS sdk_context_revisions (namespace TEXT, session_key TEXT, signature TEXT, PRIMARY KEY(namespace, session_key));
    CREATE TABLE IF NOT EXISTS memories (
      id TEXT PRIMARY KEY, scope TEXT NOT NULL, project_id TEXT, content TEXT NOT NULL,
      source_conversation_id TEXT NOT NULL, source_message_ids TEXT NOT NULL, evidence TEXT NOT NULL,
      status TEXT NOT NULL, created_at INTEGER NOT NULL, updated_at INTEGER NOT NULL
    );
    CREATE INDEX IF NOT EXISTS idx_memories_scope ON memories(scope, project_id, status);
    CREATE TABLE IF NOT EXISTS memory_jobs (conversation_id TEXT PRIMARY KEY REFERENCES conversations(id) ON DELETE CASCADE,
      cursor INTEGER NOT NULL DEFAULT 0, status TEXT NOT NULL DEFAULT 'pending', error TEXT, updated_at INTEGER NOT NULL);
    CREATE TABLE IF NOT EXISTS personal_settings (id TEXT PRIMARY KEY, value TEXT NOT NULL);
    CREATE TABLE IF NOT EXISTS auxiliary_usage (id INTEGER PRIMARY KEY AUTOINCREMENT, model TEXT NOT NULL, input_tokens INTEGER NOT NULL, output_tokens INTEGER NOT NULL, created_at INTEGER NOT NULL);
    CREATE TABLE IF NOT EXISTS stream_events (id INTEGER PRIMARY KEY AUTOINCREMENT, event TEXT NOT NULL);
    CREATE TABLE IF NOT EXISTS dispatch_events (id INTEGER PRIMARY KEY, conversation_id TEXT NOT NULL REFERENCES conversations(id) ON DELETE CASCADE, event TEXT NOT NULL);
    `)
    const memoryColumns = sqlite.prepare('PRAGMA table_info(memories)').all() as { name: string }[]
    if (!memoryColumns.some((column) => column.name === 'supersedes_id')) sqlite.exec('ALTER TABLE memories ADD COLUMN supersedes_id TEXT')
  })()
}
