import { randomBytes } from 'node:crypto'

import { and, eq } from 'drizzle-orm'

import { db, schema } from '@/db/client'
import type { TeamInviteRow, TeamRole, TeamRow } from '@/db/schema'
import { newInviteCode, newTeamId } from '@/server/ids'

const DEFAULT_INVITE_TTL_MS = 7 * 24 * 60 * 60 * 1000

function slugify(name: string): string {
  const base = name
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 32)
  return `${base || 'team'}-${randomBytes(3).toString('hex')}`
}

export async function createTeam(userId: string, name: string): Promise<TeamRow> {
  const trimmed = name.trim()
  if (!trimmed) throw new Error('Team name is required')
  const now = Date.now()
  const row: TeamRow = {
    id: newTeamId(),
    name: trimmed,
    slug: slugify(trimmed),
    createdByUserId: userId,
    createdAt: now,
  }
  await db.insert(schema.teams).values(row)
  await db.insert(schema.teamMembers).values({
    teamId: row.id,
    userId,
    role: 'owner',
    joinedAt: now,
  })
  return row
}

export interface TeamMemberView {
  userId: string
  email: string
  displayName: string
  avatar: string
  role: TeamRole
  joinedAt: number
}

export async function listTeamMembers(teamId: string): Promise<TeamMemberView[]> {
  return db
    .select({
      userId: schema.users.id,
      email: schema.users.email,
      displayName: schema.users.displayName,
      avatar: schema.users.avatar,
      role: schema.teamMembers.role,
      joinedAt: schema.teamMembers.joinedAt,
    })
    .from(schema.teamMembers)
    .innerJoin(schema.users, eq(schema.users.id, schema.teamMembers.userId))
    .where(eq(schema.teamMembers.teamId, teamId))
}

export async function getMemberRole(teamId: string, userId: string): Promise<TeamRole | null> {
  const row = await db.query.teamMembers.findFirst({
    where: and(eq(schema.teamMembers.teamId, teamId), eq(schema.teamMembers.userId, userId)),
  })
  return row?.role ?? null
}

export async function createTeamInvite(args: {
  teamId: string
  createdByUserId: string
  role?: 'member' | 'viewer'
  expiresInHours?: number
  maxUses?: number
}): Promise<TeamInviteRow> {
  const now = Date.now()
  const ttlMs =
    args.expiresInHours && args.expiresInHours > 0
      ? args.expiresInHours * 60 * 60 * 1000
      : DEFAULT_INVITE_TTL_MS

  const invite: TeamInviteRow = {
    code: newInviteCode(),
    teamId: args.teamId,
    role: args.role ?? 'member',
    createdByUserId: args.createdByUserId,
    expiresAt: now + ttlMs,
    maxUses: Math.max(1, args.maxUses ?? 10),
    useCount: 0,
    createdAt: now,
  }
  await db.insert(schema.teamInvites).values(invite)
  return invite
}

export async function acceptTeamInvite(code: string, userId: string): Promise<{
  teamId: string
  role: TeamRole
  alreadyMember: boolean
}> {
  const invite = await db.query.teamInvites.findFirst({
    where: eq(schema.teamInvites.code, code.trim()),
  })
  if (!invite) throw new Error('Invite not found')
  if (invite.expiresAt <= Date.now()) throw new Error('Invite has expired')

  const existing = await db.query.teamMembers.findFirst({
    where: and(eq(schema.teamMembers.teamId, invite.teamId), eq(schema.teamMembers.userId, userId)),
  })
  if (existing) {
    return { teamId: invite.teamId, role: existing.role, alreadyMember: true }
  }

  if (invite.useCount >= invite.maxUses) {
    throw new Error('Invite has reached its usage limit')
  }

  await db.insert(schema.teamMembers).values({
    teamId: invite.teamId,
    userId,
    role: invite.role,
    joinedAt: Date.now(),
  })

  await db
    .update(schema.teamInvites)
    .set({ useCount: invite.useCount + 1 })
    .where(eq(schema.teamInvites.code, invite.code))

  return { teamId: invite.teamId, role: invite.role, alreadyMember: false }
}

async function countTeamOwners(teamId: string): Promise<number> {
  const owners = await db
    .select({ userId: schema.teamMembers.userId })
    .from(schema.teamMembers)
    .where(and(eq(schema.teamMembers.teamId, teamId), eq(schema.teamMembers.role, 'owner')))
  return owners.length
}

export async function updateTeamMemberRole(
  teamId: string,
  targetUserId: string,
  nextRole: TeamRole,
): Promise<void> {
  const existing = await db.query.teamMembers.findFirst({
    where: and(eq(schema.teamMembers.teamId, teamId), eq(schema.teamMembers.userId, targetUserId)),
  })
  if (!existing) throw new Error('Member not found in team')

  if (existing.role === 'owner' && nextRole !== 'owner') {
    if ((await countTeamOwners(teamId)) <= 1) {
      throw new Error('Cannot demote the last owner of a team')
    }
  }

  await db
    .update(schema.teamMembers)
    .set({ role: nextRole })
    .where(and(eq(schema.teamMembers.teamId, teamId), eq(schema.teamMembers.userId, targetUserId)))
}

export async function removeTeamMember(teamId: string, targetUserId: string): Promise<void> {
  const existing = await db.query.teamMembers.findFirst({
    where: and(eq(schema.teamMembers.teamId, teamId), eq(schema.teamMembers.userId, targetUserId)),
  })
  if (!existing) throw new Error('Member not found in team')

  if (existing.role === 'owner' && (await countTeamOwners(teamId)) <= 1) {
    throw new Error('Cannot remove the last owner of a team')
  }

  await db
    .delete(schema.teamMembers)
    .where(and(eq(schema.teamMembers.teamId, teamId), eq(schema.teamMembers.userId, targetUserId)))
}
