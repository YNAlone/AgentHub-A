import { NextRequest, NextResponse } from 'next/server'
import { z } from 'zod'

import { getRequestSession, hasMinRole } from '@/server/rbac'
import { createTeamInvite, getMemberRole } from '@/server/team-service'

interface RouteContext {
  params: Promise<{ id: string }>
}

const CreateInviteBody = z.object({
  role: z.enum(['member', 'viewer']).optional(),
  expiresInHours: z.number().int().min(1).max(720).optional(),
  maxUses: z.number().int().min(1).max(100).optional(),
})

export async function POST(req: NextRequest, ctx: RouteContext) {
  const session = await getRequestSession(req)
  if (!session) return NextResponse.json({ error: 'Authentication required' }, { status: 401 })

  const { id: teamId } = await ctx.params
  const callerRole = await getMemberRole(teamId, session.user.id)
  if (!hasMinRole(callerRole, 'owner')) {
    return NextResponse.json({ error: 'Only team owners can create invites' }, { status: 403 })
  }

  const raw = await req.json().catch(() => ({}))
  const parsed = CreateInviteBody.safeParse(raw)
  if (!parsed.success) {
    return NextResponse.json({ error: 'Invalid body', issues: parsed.error.issues }, { status: 400 })
  }

  const invite = await createTeamInvite({
    teamId,
    createdByUserId: session.user.id,
    role: parsed.data.role,
    expiresInHours: parsed.data.expiresInHours,
    maxUses: parsed.data.maxUses,
  })
  return NextResponse.json({ invite }, { status: 201 })
}
