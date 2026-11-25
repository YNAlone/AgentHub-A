import { NextRequest, NextResponse } from 'next/server'
import { z } from 'zod'

import { SESSION_COOKIE_NAME, switchActiveTeam } from '@/server/auth-service'
import { getRequestSession } from '@/server/rbac'
import { createTeam } from '@/server/team-service'

const CreateTeamBody = z.object({
  name: z.string().min(1).max(80),
})

export async function GET(req: NextRequest) {
  const session = await getRequestSession(req)
  if (!session) {
    return NextResponse.json({ error: 'Authentication required' }, { status: 401 })
  }
  return NextResponse.json({ teams: session.teams, activeTeamId: session.activeTeamId })
}

export async function POST(req: NextRequest) {
  const session = await getRequestSession(req)
  if (!session) {
    return NextResponse.json({ error: 'Authentication required' }, { status: 401 })
  }
  const raw = await req.json().catch(() => null)
  const parsed = CreateTeamBody.safeParse(raw)
  if (!parsed.success) {
    return NextResponse.json({ error: 'Invalid body', issues: parsed.error.issues }, { status: 400 })
  }

  try {
    const team = await createTeam(session.user.id, parsed.data.name)
    const token = req.cookies.get(SESSION_COOKIE_NAME)?.value
    const updatedSession = token ? await switchActiveTeam(token, team.id) : session
    return NextResponse.json({ team, session: updatedSession }, { status: 201 })
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err)
    return NextResponse.json({ error: message }, { status: 400 })
  }
}
