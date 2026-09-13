import { mkdtempSync } from 'node:fs'
import { tmpdir } from 'node:os'
import path from 'node:path'

// Each isolated test module gets a disposable database, including transitive DB imports.
process.env.AGENTHUB_DATA_DIR = mkdtempSync(path.join(tmpdir(), 'agenthub-test-'))
