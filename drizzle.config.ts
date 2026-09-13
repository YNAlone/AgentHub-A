import type { Config } from 'drizzle-kit'
import path from 'node:path'
import { getTableName } from 'drizzle-orm'
import * as schema from './src/db/schema'

export default {
  schema: './src/db/schema.ts',
  out: './drizzle',
  dialect: 'sqlite',
  // FTS virtual tables and their shadow tables are maintained by dedicated migrations.
  tablesFilter: Object.values(schema).map((table) => getTableName(table)),
  dbCredentials: {
    // Verification can target a disposable database without touching the user's data.
    url: path.join(process.env.AGENTHUB_DATA_DIR ?? '.agenthub-data', 'agenthub.db'),
  },
  verbose: true,
  strict: true,
} satisfies Config
