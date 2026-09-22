import { NextResponse } from 'next/server'
import { z } from 'zod'

import { isLocalRequest, LOCAL_SESSION_COOKIE, SESSION_SECONDS } from '@/server/local-access'
import { localAuth } from '@/server/local-auth'

const Body = z.object({ code: z.string().min(1).max(128) })
let nextAttemptAt = 0

/** Only knowledge of the local pairing file grants a browser session. */
export async function POST(req: Request) {
  if (!isLocalRequest(req)) return NextResponse.json({ error: 'Forbidden' }, { status: 403 })
  if (Date.now() < nextAttemptAt) return NextResponse.json({ error: '稍后重试' }, { status: 429 })
  nextAttemptAt = Date.now() + 1000
  const body = Body.safeParse(await req.json().catch(() => null))
  const token = body.success ? localAuth().pair(body.data.code) : null
  if (!token) return NextResponse.json({ error: '配对码不正确' }, { status: 401 })
  const response = NextResponse.json({ ok: true })
  response.cookies.set(LOCAL_SESSION_COOKIE, token, { httpOnly: true, sameSite: 'strict', path: '/', maxAge: SESSION_SECONDS, secure: new URL(req.url).protocol === 'https:' })
  response.headers.set('Cache-Control', 'no-store')
  return response
}
