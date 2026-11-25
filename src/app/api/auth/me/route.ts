import { NextRequest, NextResponse } from 'next/server'
import { z } from 'zod'

import { SESSION_COOKIE_NAME, switchActiveTeam } from '@/server/auth-service'
import { getRequestSession, isTeamMode } from '@/server/rbac'

const SwitchTeamBody = z.object({
  activeTeamId: z.string().min(1),
})

export async function GET(req: NextRequest) {
  const session = await getRequestSession(req)
  return NextResponse.json({
    deploymentMode: isTeamMode() ? 'team' : 'local',
    session,
  })
}

export async function PATCH(req: NextRequest) {
  const token = req.cookies.get(SESSION_COOKIE_NAME)?.value
  if (!token) {
    return NextResponse.json({ error: 'Authentication required' }, { status: 401 })
  }
  const raw = await req.json().catch(() => null)
  const parsed = SwitchTeamBody.safeParse(raw)
  if (!parsed.success) {
    return NextResponse.json({ error: 'Invalid body', issues: parsed.error.issues }, { status: 400 })
  }
  try {
    const session = await switchActiveTeam(token, parsed.data.activeTeamId)
    return NextResponse.json({ session })
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err)
    return NextResponse.json({ error: message }, { status: 403 })
  }
}
