/**
 * 一次性 schema migration：加 messages_fts 虚拟表 + 3 触发器，回填已有 text part。
 *
 * 幂等：使用 IF NOT EXISTS 守卫；backfill 使用 INSERT OR IGNORE 不会重复插入。
 *
 * 执行：tsx src/db/migrate-add-message-search.ts
 */
import type Database from 'better-sqlite3'

import { sqlite as defaultSqlite } from './client'
import { ensureMessageSearchSchema } from './message-search-schema'


export function runMessageSearchMigration(target: Database.Database = defaultSqlite) {
  ensureMessageSearchSchema(target)
}

// CLI entry
if (require.main === module) {
  runMessageSearchMigration()
  console.log('done')
}