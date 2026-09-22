import { NextRequest, NextResponse } from 'next/server'

import { isLocalRequest } from '@/server/local-access'
import { localAuth } from '@/server/local-auth'

/** Protect the entire application surface, including private previews and newly added APIs. */
export function proxy(req: NextRequest) {
  if (!isLocalRequest(req)) return NextResponse.json({ error: 'Local access only' }, { status: 403 })
  const pathname = req.nextUrl.pathname
  if (pathname.startsWith('/api/mobile/') || pathname === '/api/settings/mobile-token') {
    return NextResponse.json({ error: 'Remote companion is disabled in this release' }, { status: 403 })
  }
  if (pathname === '/api/internal/agenthub-tools') return NextResponse.next() // The route verifies its separate tool token.
  if (pathname === '/pair' || pathname === '/api/auth/pair') return NextResponse.next()
  if (!localAuth().authorize(req)) {
    return pathname.startsWith('/api/') || pathname.startsWith('/deployments/')
      ? NextResponse.json({ error: 'Pair this browser on the local computer' }, { status: 401 })
      : NextResponse.redirect(new URL('/pair', `${req.nextUrl.protocol}//${req.headers.get('host') ?? req.nextUrl.host}`))
  }
  const response = NextResponse.next()
  response.headers.set('Cache-Control', 'no-store')
  response.headers.set('Referrer-Policy', 'no-referrer')
  return response
}

export const config = { matcher: ['/((?!_next/static|_next/image|favicon.ico).*)'] }
