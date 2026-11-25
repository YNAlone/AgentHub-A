import { NextRequest, NextResponse } from 'next/server'
import { z } from 'zod'

import { getRequestSession, hasMinRole } from '@/server/rbac'
import {
  getMemberRole,
  listTeamMembers,
  removeTeamMember,
  updateTeamMemberRole,
} from '@/server/team-service'

interface RouteContext {
  params: Promise<{ id: string }>
}

const UpdateRoleBody = z.object({
  userId: z.string().min(1),
  role: z.enum(['owner', 'member', 'viewer']),
})

const RemoveMemberBody = z.object({
  userId: z.string().min(1),
})

export async function GET(req: NextRequest, ctx: RouteContext) {
  const session = await getRequestSession(req)
  if (!session) return NextResponse.json({ error: 'Authentication required' }, { status: 401 })

  const { id: teamId } = await ctx.params
  const callerRole = await getMemberRole(teamId, session.user.id)
  if (!hasMinRole(callerRole, 'viewer')) {
    return NextResponse.json({ error: 'Forbidden' }, { status: 403 })
  }

  const members = await listTeamMembers(teamId)
  return NextResponse.json({ members })
}

export async function PATCH(req: NextRequest, ctx: RouteContext) {
  const session = await getRequestSession(req)
  if (!session) return NextResponse.json({ error: 'Authentication required' }, { status: 401 })

  const { id: teamId } = await ctx.params
  const callerRole = await getMemberRole(teamId, session.user.id)
  if (!hasMinRole(callerRole, 'owner')) {
    return NextResponse.json({ error: 'Only team owners can change member roles' }, { status: 403 })
  }

  const raw = await req.json().catch(() => null)
  const parsed = UpdateRoleBody.safeParse(raw)
  if (!parsed.success) {
    return NextResponse.json({ error: 'Invalid body', issues: parsed.error.issues }, { status: 400 })
  }

  try {
    await updateTeamMemberRole(teamId, parsed.data.userId, parsed.data.role)
    const members = await listTeamMembers(teamId)
    return NextResponse.json({ members })
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err)
    return NextResponse.json({ error: message }, { status: 400 })
  }
}

export async function DELETE(req: NextRequest, ctx: RouteContext) {
  const session = await getRequestSession(req)
  if (!session) return NextResponse.json({ error: 'Authentication required' }, { status: 401 })

  const { id: teamId } = await ctx.params
  const callerRole = await getMemberRole(teamId, session.user.id)
  if (!hasMinRole(callerRole, 'owner')) {
    return NextResponse.json({ error: 'Only team owners can remove members' }, { status: 403 })
  }

  const raw = await req.json().catch(() => null)
  const parsed = RemoveMemberBody.safeParse(raw)
  if (!parsed.success) {
    return NextResponse.json({ error: 'Invalid body', issues: parsed.error.issues }, { status: 400 })
  }

  try {
    await removeTeamMember(teamId, parsed.data.userId)
    const members = await listTeamMembers(teamId)
    return NextResponse.json({ members })
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err)
    return NextResponse.json({ error: message }, { status: 400 })
  }
}
