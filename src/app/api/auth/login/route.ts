import { NextRequest, NextResponse } from 'next/server'
import { z } from 'zod'

import { loginUser, switchActiveTeam } from '@/server/auth-service'
import { attachSessionCookie } from '@/server/rbac'
import { acceptTeamInvite } from '@/server/team-service'

const LoginBody = z.object({
  email: z.string().email(),
  password: z.string().min(1),
  inviteCode: z.string().min(4).max(64).optional(),
})

export async function POST(req: NextRequest) {
  const raw = await req.json().catch(() => null)
  const parsed = LoginBody.safeParse(raw)
  if (!parsed.success) {
    return NextResponse.json({ error: 'Invalid login payload', issues: parsed.error.issues }, { status: 400 })
  }

  try {
    const { token, session: initialSession } = await loginUser(parsed.data)
    let session = initialSession
    if (parsed.data.inviteCode) {
      const joined = await acceptTeamInvite(parsed.data.inviteCode, initialSession.user.id)
      session = await switchActiveTeam(token, joined.teamId)
    }
    const res = NextResponse.json({ session })
    attachSessionCookie(res, token, req)
    return res
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err)
    return NextResponse.json({ error: message }, { status: 401 })
  }
}
