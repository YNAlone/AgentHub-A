import { eq } from 'drizzle-orm'
import { afterEach, describe, expect, it } from 'vitest'

import { db, schema } from '@/db/client'
import {
  getSessionContext,
  hashPassword,
  loginUser,
  logoutSession,
  registerUser,
  switchActiveTeam,
  verifyPassword,
} from './auth-service'
import { createTeam } from './team-service'

const createdUserIds: string[] = []
const createdTeamIds: string[] = []

afterEach(async () => {
  for (const teamId of createdTeamIds.splice(0)) {
    await db.delete(schema.teams).where(eq(schema.teams.id, teamId))
  }
  for (const userId of createdUserIds.splice(0)) {
    await db.delete(schema.users).where(eq(schema.users.id, userId))
  }
})

describe('auth-service', () => {
  it('hashes and verifies passwords safely', () => {
    const hash = hashPassword('StrongPass123!')
    expect(hash.startsWith('scrypt:')).toBe(true)
    expect(verifyPassword('StrongPass123!', hash)).toBe(true)
    expect(verifyPassword('WrongPass123!', hash)).toBe(false)
  })

  it('registers a user with a default owner team, supports login, team switch, and logout', async () => {
    const email = `pm-${Date.now()}@example.com`
    const reg = await registerUser({
      email,
      displayName: 'PM 张三',
      password: 'Password1234',
      teamName: '核心研发组',
    })
    createdUserIds.push(reg.session.user.id)
    if (reg.session.activeTeamId) createdTeamIds.push(reg.session.activeTeamId)

    expect(reg.session.user.displayName).toBe('PM 张三')
    expect(reg.session.activeRole).toBe('owner')
    expect(reg.session.teams).toHaveLength(1)

    await expect(
      registerUser({ email, displayName: '重复用户', password: 'Password1234' }),
    ).rejects.toThrow(/already registered/i)

    const secondTeam = await createTeam(reg.session.user.id, '增长实验组')
    createdTeamIds.push(secondTeam.id)

    const switched = await switchActiveTeam(reg.token, secondTeam.id)
    expect(switched.activeTeamId).toBe(secondTeam.id)

    const loggedIn = await loginUser({ email, password: 'Password1234' })
    expect(loggedIn.session.user.id).toBe(reg.session.user.id)

    await expect(loginUser({ email, password: 'wrong-password' })).rejects.toThrow(
      /invalid email or password/i,
    )

    await logoutSession(reg.token)
    expect(await getSessionContext(reg.token)).toBeNull()
  })
})
