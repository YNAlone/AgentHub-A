import { eq } from 'drizzle-orm'
import { NextResponse, type NextRequest } from 'next/server'

import { db, schema } from '@/db/client'
import type { TeamRole } from '@/db/schema'
import {
  getSessionContext,
  SESSION_COOKIE_NAME,
  type SessionContext,
} from '@/server/auth-service'
import { getMemberRole } from '@/server/team-service'

const ROLE_RANK: Record<TeamRole, number> = {
  viewer: 1,
  member: 2,
  owner: 3,
}

export function isTeamMode(): boolean {
  return process.env.AGENTHUB_DEPLOYMENT_MODE === 'team'
}

export function hasMinRole(actual: TeamRole | null | undefined, required: TeamRole): boolean {
  if (!actual) return false
  return ROLE_RANK[actual] >= ROLE_RANK[required]
}

/** Validate Origin matches Host on mutating HTTP methods to mitigate CSRF in team mode. */
export function isValidSameOrigin(req: NextRequest): boolean {
  if (!['POST', 'PUT', 'PATCH', 'DELETE'].includes(req.method.toUpperCase())) return true
  const origin = req.headers.get('origin')
  if (!origin) return true
  const host = req.headers.get('x-forwarded-host') ?? req.headers.get('host')
  if (!host) return false
  try {
    return new URL(origin).host === host
  } catch {
    return false
  }
}

export async function getRequestSession(req: NextRequest): Promise<SessionContext | null> {
  const token = req.cookies.get(SESSION_COOKIE_NAME)?.value
  if (!token) return null
  return getSessionContext(token)
}

export type TeamGuardResult =
  | { ok: true; session: SessionContext | null; teamId: string | null }
  | { ok: false; response: NextResponse }

/**
 * Enforce active-team RBAC in team mode; in local single-user mode returns ok with optional session.
 */
export async function requireTeamAccess(
  req: NextRequest,
  minRole: TeamRole,
): Promise<TeamGuardResult> {
  const session = await getRequestSession(req)
  if (!isTeamMode()) {
    return { ok: true, session, teamId: session?.activeTeamId ?? null }
  }
  if (!session) {
    return {
      ok: false,
      response: NextResponse.json({ error: 'Authentication required' }, { status: 401 }),
    }
  }
  if (!session.activeTeamId || !hasMinRole(session.activeRole, minRole)) {
    return {
      ok: false,
      response: NextResponse.json({ error: 'Insufficient team permissions' }, { status: 403 }),
    }
  }
  return { ok: true, session, teamId: session.activeTeamId }
}

/**
 * Prevent cross-team IDOR by verifying the conversation belongs to a team the caller has access to.
 */
export async function assertConversationTeamAccess(
  req: NextRequest,
  conversationId: string,
  minRole: TeamRole,
): Promise<TeamGuardResult> {
  const base = await requireTeamAccess(req, minRole)
  if (!base.ok) return base
  if (!isTeamMode() || !base.session) return base

  const conv = await db.query.conversations.findFirst({
    where: eq(schema.conversations.id, conversationId),
    columns: { id: true, teamId: true },
  })
  if (!conv) {
    return {
      ok: false,
      response: NextResponse.json({ error: 'Conversation not found' }, { status: 404 }),
    }
  }
  if (!conv.teamId) {
    return {
      ok: false,
      response: NextResponse.json({ error: 'Conversation is not assigned to a team' }, { status: 403 }),
    }
  }
  const role = await getMemberRole(conv.teamId, base.session.user.id)
  if (!hasMinRole(role, minRole)) {
    return {
      ok: false,
      response: NextResponse.json({ error: 'Forbidden: cross-team access denied' }, { status: 403 }),
    }
  }
  return { ok: true, session: base.session, teamId: conv.teamId }
}

export function attachSessionCookie(res: NextResponse, token: string, req: NextRequest): void {
  const isSecure =
    req.nextUrl.protocol === 'https:' ||
    req.headers.get('x-forwarded-proto') === 'https'
  res.cookies.set(SESSION_COOKIE_NAME, token, {
    httpOnly: true,
    sameSite: 'lax',
    secure: isSecure,
    path: '/',
    maxAge: 14 * 24 * 60 * 60,
  })
}

export function clearSessionCookie(res: NextResponse): void {
  res.cookies.set(SESSION_COOKIE_NAME, '', {
    httpOnly: true,
    sameSite: 'lax',
    path: '/',
    maxAge: 0,
  })
}
