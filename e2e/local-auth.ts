import { createHmac } from 'node:crypto'

// Public test-only material is written exclusively into the isolated E2E data directory.
export const E2E_AUTH = { key: 'agenthub-e2e-test-signing-material-only', pairingCode: 'agenthub-e2e-test-pairing-material-only' }
export function e2eSession(): string {
  const expiry = String(Date.now() + 86400000)
  return `${expiry}.${createHmac('sha256', E2E_AUTH.key).update(expiry).digest('hex')}`
}
