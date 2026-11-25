import { NextRequest, NextResponse } from 'next/server'

import { logoutSession, SESSION_COOKIE_NAME } from '@/server/auth-service'
import { clearSessionCookie } from '@/server/rbac'

export async function POST(req: NextRequest) {
  const token = req.cookies.get(SESSION_COOKIE_NAME)?.value
  await logoutSession(token)
  const res = NextResponse.json({ ok: true })
  clearSessionCookie(res)
  return res
}
