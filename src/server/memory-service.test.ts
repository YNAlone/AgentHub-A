import Database from 'better-sqlite3'
import { expect, it } from 'vitest'
import { MemoryService } from './memory-service'

it('expires a superseded fact only when the replacement is explicitly confirmed', () => {
  const db = new Database(':memory:')
  try {
    const memory = new MemoryService(db)
    const old = memory.add({ scope: 'project', projectId: 'p', content: '数据库使用 MySQL', sourceConversationId: 'c', sourceMessageIds: ['m1'], evidence: '确认使用 MySQL', explicit: true })!
    memory.add({ scope: 'project', projectId: 'p', content: '改为 SQLite', sourceConversationId: 'c', sourceMessageIds: ['m2'], evidence: '确认改为 SQLite', explicit: true, supersedesId: old.id })
    expect(memory.recall('p').map((m) => m.content)).toEqual(['改为 SQLite'])
    expect(memory.list().find((m) => m.id === old.id)?.status).toBe('expired')
  } finally { db.close() }
})

it('keeps inferred memories pending, isolates project recall, and blocks deleted-source regeneration', () => {
  const db = new Database(':memory:')
  try {
    const memory = new MemoryService(db)
    const personal = memory.add({ scope: 'personal', projectId: null, content: '偏好中文回复', sourceConversationId: 'c1', sourceMessageIds: ['m1'], evidence: '请记住，我偏好中文回复', explicit: true })!
    const project = memory.add({ scope: 'project', projectId: 'p1', content: '数据库使用 SQLite', sourceConversationId: 'c1', sourceMessageIds: ['m2'], evidence: '可能使用 SQLite', explicit: false })!
    expect(memory.recall('p1').map((m) => m.id)).toEqual([personal.id])
    memory.update(project.id, { status: 'active' })
    expect(memory.recall('p1')).toHaveLength(2)
    expect(memory.recall('p2')).toHaveLength(1)
    memory.update(personal.id, { status: 'deleted' })
    expect(memory.add({ ...personal, explicit: true })).toBeNull()
    expect(memory.recall('p2')).toEqual([])
    expect(() => memory.update(personal.id, { status: 'active' })).toThrow()
  } finally { db.close() }
})
