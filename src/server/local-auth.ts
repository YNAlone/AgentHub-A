import { randomBytes } from 'node:crypto'
import { existsSync, linkSync, mkdirSync, readFileSync, unlinkSync, writeFileSync } from 'node:fs'
import path from 'node:path'
import { z } from 'zod'

import { createLocalAccess } from './local-access'

const AuthSchema = z.object({ key: z.string().min(32), pairingCode: z.string().min(32) })

/** A local file lets Next proxy and route workers share credentials without shared globals. */
export function localAuth() {
  const root = process.env.AGENTHUB_DATA_DIR ?? path.resolve(process.cwd(), '.agenthub-data')
  mkdirSync(root, { recursive: true })
  const file = path.join(root, 'local-auth.json')
  if (!existsSync(file)) {
    const temporary = path.join(root, `local-auth-${process.pid}-${randomBytes(8).toString('hex')}.tmp`)
    writeFileSync(temporary, JSON.stringify({ key: randomBytes(32).toString('hex'), pairingCode: randomBytes(24).toString('hex') }), { flag: 'wx', mode: 0o600 })
    try {
      // Publish a complete file atomically; another worker can win without exposing a partial secret file.
      linkSync(temporary, file)
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== 'EEXIST') throw error
    } finally { unlinkSync(temporary) }
  }
  const credentials = AuthSchema.parse(JSON.parse(readFileSync(file, 'utf8')))
  return createLocalAccess(credentials.key, credentials.pairingCode)
}
