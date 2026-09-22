import { describe, expect, it } from 'vitest'

import { createLocalAccess } from './local-access'

describe('local business access', () => {
  const access = createLocalAccess('test-signing-key', 'test-pairing-code')
  const request = (url: string, headers: Record<string, string> = {}, method = 'GET') =>
    new Request(url, { method, headers })

  it('denies anonymous settings access even from localhost', () => {
    expect(access.authorize(request('http://127.0.0.1:3000/api/settings'))).toBe(false)
  })

  it('accepts Next canonical loopback URLs while validating the actual browser Host and Origin', () => {
    const cookie = `agenthub_session=${access.session()}`
    expect(access.authorize(request('http://localhost:3000/api/settings', { host: '127.0.0.1:3000', origin: 'http://127.0.0.1:3000', cookie }, 'PATCH'))).toBe(true)
    expect(access.authorize(request('http://localhost:3000/api/settings', { host: 'evil.invalid:3000', cookie }))).toBe(false)
  })

  it('accepts a paired cookie but rejects cross-origin writes and non-loopback hosts', () => {
    const cookie = `agenthub_session=${access.session()}`
    expect(access.authorize(request('http://127.0.0.1:3000/api/settings', { cookie }))).toBe(true)
    expect(access.authorize(request('http://127.0.0.1:3000/api/settings', { cookie, origin: 'https://evil.invalid' }, 'PATCH'))).toBe(false)
    expect(access.authorize(request('http://192.168.1.2:3000/api/settings', { cookie }))).toBe(false)
  })

  it('rejects expired and forged sessions and requires the pairing secret', () => {
    expect(access.pair('wrong')).toBeNull()
    expect(access.pair('test-pairing-code')).toBeTruthy()
    expect(access.authorize(request('http://localhost/api/settings', { cookie: 'agenthub_session=forged' }))).toBe(false)
    const old = createLocalAccess('test-signing-key', 'test-pairing-code', () => 0).session()
    expect(access.authorize(request('http://localhost/api/settings', { cookie: `agenthub_session=${old}` }))).toBe(false)
  })
})
