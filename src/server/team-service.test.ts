import { eq } from 'drizzle-orm'
import { NextRequest } from 'next/server'
import { afterEach, describe, expect, it, vi } from 'vitest'

import { db, schema } from '@/db/client'
import { registerUser, SESSION_COOKIE_NAME } from './auth-service'
import { createConversation } from './conversation-service'
import { assertConversationTeamAccess, hasMinRole } from './rbac'
import {
  acceptTeamInvite,
  createTeamInvite,
  listTeamMembers,
  removeTeamMember,
  updateTeamMemberRole,
} from './team-service'

const createdUserIds: string[] = []
const createdTeamIds: string[] = []
const createdConvIds: string[] = []

afterEach(async () => {
  vi.unstubAllEnvs()
  for (const convId of createdConvIds.splice(0)) {
    await db.delete(schema.conversations).where(eq(schema.conversations.id, convId))
  }
  for (const teamId of createdTeamIds.splice(0)) {
    await db.delete(schema.teams).where(eq(schema.teams.id, teamId))
  }
  for (const userId of createdUserIds.splice(0)) {
    await db.delete(schema.users).where(eq(schema.users.id, userId))
  }
})

describe('team-service & rbac', () => {
  it('enforces role hierarchy and protects the last team owner', async () => {
    expect(hasMinRole('owner', 'member')).toBe(true)
    expect(hasMinRole('member', 'viewer')).toBe(true)
    expect(hasMinRole('viewer', 'member')).toBe(false)

    const owner = await registerUser({
      email: `owner-${Date.now()}@example.com`,
      displayName: 'Owner',
      password: 'Password1234',
    })
    const member = await registerUser({
      email: `member-${Date.now()}@example.com`,
      displayName: '前端 李四',
      password: 'Password1234',
    })
    createdUserIds.push(owner.session.user.id, member.session.user.id)
    const teamId = owner.session.activeTeamId!
    createdTeamIds.push(teamId, member.session.activeTeamId!)

    await expect(updateTeamMemberRole(teamId, owner.session.user.id, 'member')).rejects.toThrow(
      /last owner/i,
    )
    await expect(removeTeamMember(teamId, owner.session.user.id)).rejects.toThrow(/last owner/i)

    const invite = await createTeamInvite({
      teamId,
      createdByUserId: owner.session.user.id,
      role: 'member',
      maxUses: 1,
    })
    const joined = await acceptTeamInvite(invite.code, member.session.user.id)
    expect(joined.teamId).toBe(teamId)
    expect(joined.role).toBe('member')
    expect(joined.alreadyMember).toBe(false)

    const members = await listTeamMembers(teamId)
    expect(members.map((m) => m.userId)).toContain(member.session.user.id)

    await updateTeamMemberRole(teamId, member.session.user.id, 'viewer')
    await removeTeamMember(teamId, member.session.user.id)
    const afterRemove = await listTeamMembers(teamId)
    expect(afterRemove.map((m) => m.userId)).not.toContain(member.session.user.id)
  })

  it('blocks cross-team conversation access (IDOR) in team mode', async () => {
    vi.stubEnv('AGENTHUB_DEPLOYMENT_MODE', 'team')

    const teamA = await registerUser({
      email: `team-a-${Date.now()}@example.com`,
      displayName: 'Team A Owner',
      password: 'Password1234',
    })
    const outsider = await registerUser({
      email: `outsider-${Date.now()}@example.com`,
      displayName: 'Outsider',
      password: 'Password1234',
    })
    createdUserIds.push(teamA.session.user.id, outsider.session.user.id)
    createdTeamIds.push(teamA.session.activeTeamId!, outsider.session.activeTeamId!)

    const agent = await db.query.agents.findFirst()
    expect(agent).toBeDefined()

    const conv = await createConversation({
      mode: 'single',
      agentIds: [agent!.id],
      teamId: teamA.session.activeTeamId,
      createdByUserId: teamA.session.user.id,
    })
    createdConvIds.push(conv.id)

    const ownerReq = new NextRequest(`http://localhost:3000/api/conversations/${conv.id}/messages`, {
      headers: { cookie: `${SESSION_COOKIE_NAME}=${teamA.token}` },
    })
    const ownerCheck = await assertConversationTeamAccess(ownerReq, conv.id, 'member')
    expect(ownerCheck.ok).toBe(true)

    const outsiderReq = new NextRequest(
      `http://localhost:3000/api/conversations/${conv.id}/messages`,
      { headers: { cookie: `${SESSION_COOKIE_NAME}=${outsider.token}` } },
    )
    const outsiderCheck = await assertConversationTeamAccess(outsiderReq, conv.id, 'viewer')
    expect(outsiderCheck.ok).toBe(false)
    if (!outsiderCheck.ok) {
      expect(outsiderCheck.response.status).toBe(403)
    }
  })
})
