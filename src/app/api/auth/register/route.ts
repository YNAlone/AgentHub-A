import { NextRequest, NextResponse } from 'next/server'
import { z } from 'zod'

import { registerUser } from '@/server/auth-service'
import { attachSessionCookie } from '@/server/rbac'
import { acceptTeamInvite } from '@/server/team-service'

const RegisterBody = z.object({
  email: z.string().email(),
  displayName: z.string().min(1).max(60),
  password: z.string().min(8).max(128),
  avatar: z.string().max(16).optional(),
  teamName: z.string().min(1).max(80).optional(),
  inviteCode: z.string().min(4).max(64).optional(),
})

export async function POST(req: NextRequest) {
  const raw = await req.json().catch(() => null)
  const parsed = RegisterBody.safeParse(raw)
  if (!parsed.success) {
    return NextResponse.json({ error: 'Invalid registration payload', issues: parsed.error.issues }, { status: 400 })
  }

  try {
    const { token, session } = await registerUser(parsed.data)
    if (parsed.data.inviteCode) {
      await acceptTeamInvite(parsed.data.inviteCode, session.user.id)
    }
    const res = NextResponse.json({ session }, { status: 201 })
    attachSessionCookie(res, token, req)
    return res
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err)
    const status = message.includes('already registered') ? 409 : 400
    return NextResponse.json({ error: message }, { status })
  }
}
