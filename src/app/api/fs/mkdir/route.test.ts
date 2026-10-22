import { mkdirSync, mkdtempSync, rmSync, statSync } from 'node:fs'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { NextRequest } from 'next/server'

import { IS_WINDOWS } from '@/server/platform'
import { POST } from './route'

function makeReq(body: unknown) {
  return new NextRequest(
    new Request('http://localhost/api/fs/mkdir', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: typeof body === 'string' ? body : JSON.stringify(body),
    }),
  )
}

let tmpRoot: string

beforeAll(() => {
  tmpRoot = mkdtempSync(path.join(tmpdir(), 'agenthub-mkdir-'))
})

afterAll(() => {
  rmSync(tmpRoot, { recursive: true, force: true })
})

describe('POST /api/fs/mkdir', () => {
  it('creates a folder and returns 201 with the absolute path', async () => {
    const res = await POST(makeReq({ parentPath: tmpRoot, name: '新建项目' }))
    expect(res.status).toBe(201)
    const body = await res.json()
    expect(body.path).toBe(path.join(tmpRoot, '新建项目'))
    expect(statSync(body.path).isDirectory()).toBe(true)
  })

  it.each(['..', '.', 'a/b', 'a\\b', '.hidden', 'bad:name', 'x'.repeat(256), ''])(
    'rejects invalid folder name %j with 400',
    async (name) => {
      const res = await POST(makeReq({ parentPath: tmpRoot, name }))
      expect(res.status).toBe(400)
    },
  )

  it('explains why the name is rejected', async () => {
    const res = await POST(makeReq({ parentPath: tmpRoot, name: 'a/b' }))
    const body = await res.json()
    expect(body.error).toContain('Invalid folder name')
    expect(body.error).toContain('path separators')
  })

  it('rejects whitespace-only name with 400', async () => {
    const res = await POST(makeReq({ parentPath: tmpRoot, name: '   ' }))
    expect(res.status).toBe(400)
  })

  it('returns 404 when parent does not exist', async () => {
    const res = await POST(makeReq({ parentPath: path.join(tmpRoot, 'nope'), name: 'foo' }))
    expect(res.status).toBe(404)
  })

  it('returns 409 when folder already exists', async () => {
    mkdirSync(path.join(tmpRoot, 'exists'), { recursive: false })
    const res = await POST(makeReq({ parentPath: tmpRoot, name: 'exists' }))
    expect(res.status).toBe(409)
    const body = await res.json()
    expect(body.error).toContain('already exists')
  })

  it('returns 400 on non-JSON body', async () => {
    const res = await POST(makeReq('not json'))
    expect(res.status).toBe(400)
  })

  it('returns 400 when parentPath is relative', async () => {
    const res = await POST(makeReq({ parentPath: 'relative/path', name: 'foo' }))
    expect(res.status).toBe(400)
  })

  describe.skipIf(IS_WINDOWS)('POSIX system roots', () => {
    it('returns 403 when parent is a blocked system root (/etc)', async () => {
      const res = await POST(makeReq({ parentPath: '/etc', name: 'foo' }))
      expect(res.status).toBe(403)
    })
  })
})
