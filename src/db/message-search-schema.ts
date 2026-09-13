import type Database from 'better-sqlite3'

const STATEMENTS: string[] = [
  `CREATE VIRTUAL TABLE IF NOT EXISTS messages_fts USING fts5(content, tokenize='trigram')`,
  `CREATE TRIGGER IF NOT EXISTS messages_fts_ai
     AFTER INSERT ON messages
     WHEN new.status != 'streaming'
     BEGIN
       INSERT INTO messages_fts(rowid, content)
       SELECT new.rowid, (
         SELECT GROUP_CONCAT(json_extract(value, '$.content'), ' ')
         FROM json_each(new.parts)
         WHERE json_extract(value, '$.type') = 'text'
       );
     END`,
  `CREATE TRIGGER IF NOT EXISTS messages_fts_au
     AFTER UPDATE ON messages
     WHEN new.status != 'streaming'
     BEGIN
       DELETE FROM messages_fts WHERE rowid = old.rowid;
       INSERT INTO messages_fts(rowid, content)
       SELECT new.rowid, (
         SELECT GROUP_CONCAT(json_extract(value, '$.content'), ' ')
         FROM json_each(new.parts)
         WHERE json_extract(value, '$.type') = 'text'
       );
     END`,
  `CREATE TRIGGER IF NOT EXISTS messages_fts_ad
     AFTER DELETE ON messages
     BEGIN
       DELETE FROM messages_fts WHERE rowid = old.rowid;
     END`,
  `INSERT OR IGNORE INTO messages_fts(rowid, content)
     SELECT m.rowid, (
       SELECT GROUP_CONCAT(json_extract(value, '$.content'), ' ')
       FROM json_each(m.parts)
       WHERE json_extract(value, '$.type') = 'text'
     )
     FROM messages m`,
]


/** Fresh databases need the same search index and triggers as upgraded installations. */
export function ensureMessageSearchSchema(target: Database.Database): void {
  const indexed = target.prepare("SELECT name FROM sqlite_master WHERE type = 'table' AND name = 'messages_fts'").get()
  target.transaction(() => {
    for (const statement of STATEMENTS.slice(0, -1)) target.exec(statement)
    if (!indexed) target.exec(STATEMENTS[STATEMENTS.length - 1])
  })()
}
