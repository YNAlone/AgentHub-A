import { createHash, randomBytes, scryptSync, timingSafeEqual } from 'node:crypto'

import { and, eq } from 'drizzle-orm'

import { db, schema } from '@/db/client'
import type { TeamRole } from '@/db/schema'
import { newTeamId, newUserId } from '@/server/ids'

export const SESSION_COOKIE_NAME = 'agenthub_session'
const SESSION_TTL_MS = 14 * 24 * 60 * 60 * 1000
const SCRYPT_KEYLEN = 64

export interface PublicUser {
  id: string
  email: string
  displayName: string
  avatar: string
  createdAt: number
}

export interface UserTeamSummary {
  id: string
  name: string
  slug: string
  role: TeamRole
}

export interface SessionContext {
  user: PublicUser
  activeTeamId: string | null
  activeRole: TeamRole | null
  teams: UserTeamSummary[]
}

export function hashPassword(password: string): string {
  const salt = randomBytes(16).toString('hex')
  const derived = scryptSync(password, salt, SCRYPT_KEYLEN).toString('hex')
  return `scrypt:${salt}:${derived}`
}

export function verifyPassword(password: string, storedHash: string): boolean {
  const parts = storedHash.split(':')
  if (parts.length !== 3 || parts[0] !== 'scrypt') return false
  const [, salt, expectedHex] = parts
  const expected = Buffer.from(expectedHex, 'hex')
  const actual = scryptSync(password, salt, expected.length)
  return actual.length === expected.length && timingSafeEqual(actual, expected)
}

function hashSessionToken(rawToken: string): string {
  return createHash('sha256').update(rawToken, 'utf8').digest('hex')
}

function slugifyTeamName(name: string): string {
  const base = name
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 32)
  const suffix = randomBytes(3).toString('hex')
  return `${base || 'team'}-${suffix}`
}

export function toPublicUser(row: {
  id: string
  email: string
  displayName: string
  avatar: string
  createdAt: number
}): PublicUser {
  return {
    id: row.id,
    email: row.email,
    displayName: row.displayName,
    avatar: row.avatar,
    createdAt: row.createdAt,
  }
}

async function issueSession(userId: string, activeTeamId: string | null): Promise<string> {
  const rawToken = randomBytes(32).toString('hex')
  const now = Date.now()
  await db.insert(schema.userSessions).values({
    tokenHash: hashSessionToken(rawToken),
    userId,
    activeTeamId,
    expiresAt: now + SESSION_TTL_MS,
    createdAt: now,
  })
  return rawToken
}

export interface RegisterUserArgs {
  email: string
  displayName: string
  password: string
  avatar?: string
  teamName?: string
}

export async function registerUser(args: RegisterUserArgs): Promise<{
  token: string
  session: SessionContext
}> {
  const email = args.email.trim().toLowerCase()
  const displayName = args.displayName.trim()
  if (!email) throw new Error('Email is required')
  if (!displayName) throw new Error('Display name is required')
  if (args.password.length < 8) throw new Error('Password must be at least 8 characters')

  const existing = await db.query.users.findFirst({
    where: eq(schema.users.email, email),
  })
  if (existing) throw new Error('Email is already registered')

  const now = Date.now()
  const userId = newUserId()
  const teamId = newTeamId()
  const teamName = args.teamName?.trim() || `${displayName} 的团队`
  const slug = slugifyTeamName(teamName)

  await db.insert(schema.users).values({
    id: userId,
    email,
    displayName,
    avatar: args.avatar?.trim() || '👤',
    passwordHash: hashPassword(args.password),
    createdAt: now,
  })

  await db.insert(schema.teams).values({
    id: teamId,
    name: teamName,
    slug,
    createdByUserId: userId,
    createdAt: now,
  })

  await db.insert(schema.teamMembers).values({
    teamId,
    userId,
    role: 'owner',
    joinedAt: now,
  })

  const token = await issueSession(userId, teamId)
  const session = await getSessionContext(token)
  if (!session) throw new Error('Failed to load newly created session')
  return { token, session }
}

export async function loginUser(args: {
  email: string
  password: string
}): Promise<{ token: string; session: SessionContext }> {
  const email = args.email.trim().toLowerCase()
  const user = await db.query.users.findFirst({
    where: eq(schema.users.email, email),
  })
  if (!user || !verifyPassword(args.password, user.passwordHash)) {
    throw new Error('Invalid email or password')
  }

  const memberships = await db
    .select({ teamId: schema.teamMembers.teamId })
    .from(schema.teamMembers)
    .where(eq(schema.teamMembers.userId, user.id))

  const activeTeamId = memberships[0]?.teamId ?? null
  const token = await issueSession(user.id, activeTeamId)
  const session = await getSessionContext(token)
  if (!session) throw new Error('Failed to load session after login')
  return { token, session }
}

export async function getSessionContext(rawToken: string | null | undefined): Promise<SessionContext | null> {
  if (!rawToken) return null
  const tokenHash = hashSessionToken(rawToken)
  const sessionRow = await db.query.userSessions.findFirst({
    where: eq(schema.userSessions.tokenHash, tokenHash),
  })
  if (!sessionRow) return null
  if (sessionRow.expiresAt <= Date.now()) {
    await db.delete(schema.userSessions).where(eq(schema.userSessions.tokenHash, tokenHash))
    return null
  }

  const user = await db.query.users.findFirst({
    where: eq(schema.users.id, sessionRow.userId),
  })
  if (!user) return null

  const memberRows = await db
    .select({
      id: schema.teams.id,
      name: schema.teams.name,
      slug: schema.teams.slug,
      role: schema.teamMembers.role,
    })
    .from(schema.teamMembers)
    .innerJoin(schema.teams, eq(schema.teams.id, schema.teamMembers.teamId))
    .where(eq(schema.teamMembers.userId, user.id))

  const active =
    memberRows.find((t) => t.id === sessionRow.activeTeamId) ?? memberRows[0] ?? null

  return {
    user: toPublicUser(user),
    activeTeamId: active?.id ?? null,
    activeRole: active?.role ?? null,
    teams: memberRows,
  }
}

export async function logoutSession(rawToken: string | null | undefined): Promise<void> {
  if (!rawToken) return
  await db
    .delete(schema.userSessions)
    .where(eq(schema.userSessions.tokenHash, hashSessionToken(rawToken)))
}

export async function switchActiveTeam(rawToken: string, teamId: string): Promise<SessionContext> {
  const current = await getSessionContext(rawToken)
  if (!current) throw new Error('Unauthenticated')

  const membership = await db.query.teamMembers.findFirst({
    where: and(
      eq(schema.teamMembers.teamId, teamId),
      eq(schema.teamMembers.userId, current.user.id),
    ),
  })
  if (!membership) throw new Error('Not a member of target team')

  await db
    .update(schema.userSessions)
    .set({ activeTeamId: teamId })
    .where(eq(schema.userSessions.tokenHash, hashSessionToken(rawToken)))

  const updated = await getSessionContext(rawToken)
  if (!updated) throw new Error('Session missing after team switch')
  return updated
}
