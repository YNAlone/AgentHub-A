import Database from 'better-sqlite3'
import { afterEach, expect, it } from 'vitest'
import { ProjectService } from './project-service'
import { migratePersonalSchema } from '@/db/personal-migration'

const connections: Database.Database[] = []
it('organizes several conversations only after an explicit project assignment', () => {
  const sqlite = new Database(':memory:')
  connections.push(sqlite)
  sqlite.exec("CREATE TABLE conversations (id TEXT PRIMARY KEY); INSERT INTO conversations VALUES ('c1'), ('c2')")
  migratePersonalSchema(sqlite)
  const projects = new ProjectService(sqlite)
  const project = projects.create('AgentHub')
  expect(projects.memberships()).toEqual({})
  projects.assign('c1', project.id)
  projects.assign('c2', project.id)
  expect(new ProjectService(sqlite).memberships()).toEqual({ c1: project.id, c2: project.id })
  expect(() => projects.assign('c1', 'missing')).toThrow()
  projects.assign('c1', null)
  expect(projects.memberships()).toEqual({ c2: project.id })
})
afterEach(() => connections.splice(0).forEach((db) => db.close()))
