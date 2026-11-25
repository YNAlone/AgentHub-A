import { createCipheriv, createDecipheriv, createHash, randomBytes } from 'node:crypto'
import { existsSync, linkSync, mkdirSync, readFileSync, unlinkSync, writeFileSync } from 'node:fs'
import path from 'node:path'

const ENCRYPTED_PREFIX = 'enc:v1:'
const ALGORITHM = 'aes-256-gcm'
const IV_BYTES = 12
const TAG_BYTES = 16
const KEY_BYTES = 32

function resolveDataDir(): string {
  return process.env.AGENTHUB_DATA_DIR ?? path.resolve(process.cwd(), '.agenthub-data')
}

function parseMasterKey(raw: string): Buffer {
  const trimmed = raw.trim()
  if (/^[0-9a-fA-F]{64}$/.test(trimmed)) {
    return Buffer.from(trimmed, 'hex')
  }
  const b64 = Buffer.from(trimmed, 'base64')
  if (b64.length === KEY_BYTES && b64.toString('base64') === trimmed) {
    return b64
  }
  return createHash('sha256').update(trimmed, 'utf8').digest()
}

/** Resolve the 32-byte AES-256-GCM master key from env or a 0600 local key file. */
function resolveMasterKey(): Buffer {
  const envKey = process.env.AGENTHUB_MASTER_KEY?.trim()
  if (envKey) {
    return parseMasterKey(envKey)
  }

  if (process.env.NODE_ENV === 'production' && process.env.AGENTHUB_DEPLOYMENT_MODE === 'team') {
    throw new Error('AGENTHUB_MASTER_KEY is required in production team mode')
  }

  const dir = resolveDataDir()
  mkdirSync(dir, { recursive: true })
  const keyFile = path.join(dir, 'master.key')

  if (!existsSync(keyFile)) {
    const tmp = path.join(dir, `master-${process.pid}-${randomBytes(8).toString('hex')}.tmp`)
    writeFileSync(tmp, randomBytes(KEY_BYTES).toString('hex'), { flag: 'wx', mode: 0o600 })
    try {
      // Publish atomically so concurrent Next.js workers converge on one key file.
      linkSync(tmp, keyFile)
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== 'EEXIST') throw error
    } finally {
      unlinkSync(tmp)
    }
  }

  return parseMasterKey(readFileSync(keyFile, 'utf8'))
}

export function isEncryptedSecret(value: string | null | undefined): boolean {
  return typeof value === 'string' && value.startsWith(ENCRYPTED_PREFIX)
}

/** Encrypt a secret for DB persistence; preserves null/empty and avoids double encryption. */
export function encryptSecret(plaintext: string | null | undefined): string | null {
  if (plaintext === null || plaintext === undefined) return null
  const trimmed = plaintext.trim()
  if (!trimmed) return null
  if (isEncryptedSecret(trimmed)) return trimmed

  const key = resolveMasterKey()
  const iv = randomBytes(IV_BYTES)
  const cipher = createCipheriv(ALGORITHM, key, iv)
  const ciphertext = Buffer.concat([cipher.update(trimmed, 'utf8'), cipher.final()])
  const tag = cipher.getAuthTag()

  return `${ENCRYPTED_PREFIX}${iv.toString('base64')}:${tag.toString('base64')}:${ciphertext.toString('base64')}`
}

/** Decrypt a stored secret; transparently passes through legacy plaintext values. */
export function decryptSecret(stored: string | null | undefined): string | null {
  if (stored === null || stored === undefined) return null
  const trimmed = stored.trim()
  if (!trimmed) return null
  if (!isEncryptedSecret(trimmed)) return trimmed

  const payload = trimmed.slice(ENCRYPTED_PREFIX.length)
  const parts = payload.split(':')
  if (parts.length !== 3) return null

  try {
    const iv = Buffer.from(parts[0], 'base64')
    const tag = Buffer.from(parts[1], 'base64')
    const ciphertext = Buffer.from(parts[2], 'base64')
    if (iv.length !== IV_BYTES || tag.length !== TAG_BYTES) return null

    const key = resolveMasterKey()
    const decipher = createDecipheriv(ALGORITHM, key, iv)
    decipher.setAuthTag(tag)
    const plaintext = Buffer.concat([decipher.update(ciphertext), decipher.final()]).toString('utf8')
    return plaintext || null
  } catch {
    return null
  }
}

const SECRET_PATTERNS: RegExp[] = [
  /\bsk-ant-[A-Za-z0-9_-]{10,}\b/g,
  /\bsk-(?:proj-|svcacct-)?[A-Za-z0-9_-]{16,}\b/g,
  /\btvly-[A-Za-z0-9_-]{10,}\b/g,
  /\b(Bearer\s+)[A-Za-z0-9._~+/-]{16,}=*/gi,
  /\benc:v1:[A-Za-z0-9+/=]+:[A-Za-z0-9+/=]+:[A-Za-z0-9+/=]+/g,
]

/** Strip API keys, bearer tokens, and encrypted envelopes from error text before logging/streaming. */
export function redactSecrets(text: string): string {
  let result = text
  for (const pattern of SECRET_PATTERNS) {
    result = result.replace(pattern, (match, prefix?: string) =>
      typeof prefix === 'string' && prefix.toLowerCase().startsWith('bearer')
        ? `${prefix}[REDACTED]`
        : '[REDACTED]',
    )
  }
  return result
}
