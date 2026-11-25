import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import path from 'node:path'

import { afterEach, describe, expect, it, vi } from 'vitest'

import {
  decryptSecret,
  encryptSecret,
  isEncryptedSecret,
  redactSecrets,
} from './crypto-secrets'

const tempDirs: string[] = []

afterEach(() => {
  vi.unstubAllEnvs()
  for (const dir of tempDirs.splice(0)) {
    rmSync(dir, { recursive: true, force: true })
  }
})

describe('crypto-secrets', () => {
  it('encrypts and decrypts secrets round-trip with AGENTHUB_MASTER_KEY', () => {
    vi.stubEnv('AGENTHUB_MASTER_KEY', 'a'.repeat(64))

    const encrypted = encryptSecret('sk-ant-api03-super-secret-value')
    expect(encrypted).not.toBeNull()
    expect(isEncryptedSecret(encrypted)).toBe(true)
    expect(encrypted).not.toContain('super-secret-value')
    expect(decryptSecret(encrypted)).toBe('sk-ant-api03-super-secret-value')
  })

  it('produces distinct ciphertexts for identical plaintexts and avoids double encryption', () => {
    vi.stubEnv('AGENTHUB_MASTER_KEY', 'b'.repeat(64))

    const first = encryptSecret('sk-test-1234567890abcdef')
    const second = encryptSecret('sk-test-1234567890abcdef')
    expect(first).not.toBe(second)
    expect(encryptSecret(first)).toBe(first)
  })

  it('auto-generates a local master.key file when env key is absent', () => {
    const dir = mkdtempSync(path.join(tmpdir(), 'agenthub-master-key-'))
    tempDirs.push(dir)
    vi.stubEnv('AGENTHUB_MASTER_KEY', '')
    vi.stubEnv('AGENTHUB_DATA_DIR', dir)

    const encrypted = encryptSecret('tvly-local-key-1234567890')
    expect(isEncryptedSecret(encrypted)).toBe(true)
    expect(decryptSecret(encrypted)).toBe('tvly-local-key-1234567890')
  })

  it('passes through legacy plaintext values transparently and handles null/empty', () => {
    vi.stubEnv('AGENTHUB_MASTER_KEY', 'c'.repeat(64))

    expect(encryptSecret(null)).toBeNull()
    expect(encryptSecret('   ')).toBeNull()
    expect(decryptSecret(null)).toBeNull()
    expect(decryptSecret('legacy-plaintext-key')).toBe('legacy-plaintext-key')
  })

  it('returns null instead of throwing when master key changes or ciphertext is tampered', () => {
    vi.stubEnv('AGENTHUB_MASTER_KEY', 'd'.repeat(64))
    const encrypted = encryptSecret('sk-secret-key-for-rotation-test')

    vi.stubEnv('AGENTHUB_MASTER_KEY', 'e'.repeat(64))
    expect(decryptSecret(encrypted)).toBeNull()
    expect(decryptSecret('enc:v1:invalid:payload')).toBeNull()
  })

  it('redacts API keys, bearer tokens, and encrypted envelopes from error messages', () => {
    const raw =
      'Auth failed with sk-ant-api03-1234567890abcdef and Bearer eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9 plus tvly-abcdef1234567890'
    const redacted = redactSecrets(raw)

    expect(redacted).not.toContain('sk-ant-api03')
    expect(redacted).not.toContain('eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9')
    expect(redacted).not.toContain('tvly-abcdef')
    expect(redacted).toContain('Bearer [REDACTED]')
  })
})
