import { NextRequest, NextResponse } from 'next/server'

import { SESSION_COOKIE_NAME, switchActiveTeam } from '@/server/auth-service'
import { getRequestSession } from '@/server/rbac'
import { acceptTeamInvite } from '@/server/team-service'

interface RouteContext {
  params: Promise<{ code: string }>
}

export async function POST(req: NextRequest, ctx: RouteContext) {
  const session = await getRequestSession(req)
  if (!session) return NextResponse.json({ error: 'Authentication required' }, { status: 401 })

  const { code } = await ctx.params
  try {
    const result = await acceptTeamInvite(code, session.user.id)
    const token = req.cookies.get(SESSION_COOKIE_NAME)?.value
    const updatedSession = token ? await switchActiveTeam(token, result.teamId) : session
    return NextResponse.json({ ...result, session: updatedSession })
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err)
    return NextResponse.json({ error: message }, { status: 400 })
  }
}
