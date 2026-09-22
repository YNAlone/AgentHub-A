import type Database from 'better-sqlite3'
import { randomUUID } from 'node:crypto'

export interface Memory {
  id: string
  scope: 'personal' | 'project'
  projectId: string | null
  content: string
  sourceConversationId: string
  sourceMessageIds: string[]
  evidence: string
  status: 'active' | 'pending' | 'expired' | 'deleted'
  createdAt: number
  updatedAt: number
  supersedesId?: string | null
}
type MemoryInput = Omit<Memory, 'id' | 'status' | 'createdAt' | 'updatedAt'> & { explicit: boolean }
const COLUMNS = 'id, scope, project_id AS projectId, content, source_conversation_id AS sourceConversationId, source_message_ids AS sourceMessageIds, evidence, status, created_at AS createdAt, updated_at AS updatedAt, supersedes_id AS supersedesId'
type StoredMemory = Omit<Memory, 'sourceMessageIds'> & { sourceMessageIds: string }
const decode = (row: StoredMemory): Memory => ({ ...row, sourceMessageIds: JSON.parse(row.sourceMessageIds) as string[] })

/** Tombstones retain provenance only, allowing deletion to stop extraction from the same source. */
export class MemoryService {
  constructor(private readonly sqlite: Database.Database, private readonly invalidate: (scope: Memory['scope'], projectId: string | null) => void = () => {}) {
    sqlite.exec(`CREATE TABLE IF NOT EXISTS memories (
      id TEXT PRIMARY KEY, scope TEXT NOT NULL, project_id TEXT, content TEXT NOT NULL,
      source_conversation_id TEXT NOT NULL, source_message_ids TEXT NOT NULL, evidence TEXT NOT NULL,
      status TEXT NOT NULL, created_at INTEGER NOT NULL, updated_at INTEGER NOT NULL
    ); CREATE INDEX IF NOT EXISTS idx_memories_scope ON memories(scope, project_id, status);`)
    const columns = sqlite.prepare('PRAGMA table_info(memories)').all() as { name: string }[]
    if (!columns.some((column) => column.name === 'supersedes_id')) sqlite.exec('ALTER TABLE memories ADD COLUMN supersedes_id TEXT')
  }

  list(): Memory[] {
    return (this.sqlite.prepare(`SELECT ${COLUMNS} FROM memories ORDER BY created_at, id`).all() as StoredMemory[]).map(decode)
  }

  add(input: MemoryInput): Memory | null {
    if (!input.content.trim() || input.content.length > 2000 || !input.sourceMessageIds.length) throw new Error('记忆内容或来源无效')
    if (input.scope === 'project' && !input.projectId) throw new Error('项目记忆必须绑定项目')
    const sourceIds = new Set(input.sourceMessageIds)
    const all = this.list()
    const existing = all.filter((memory) => memory.sourceConversationId === input.sourceConversationId)
    if (existing.some((memory) => memory.status === 'deleted' && memory.sourceMessageIds.some((id) => sourceIds.has(id)))) return null
    if (all.some((memory) => memory.status === 'active' && memory.content === input.content && memory.scope === input.scope && memory.projectId === input.projectId)) return null
    const superseded = all.find((memory) => memory.id === input.supersedesId)
    if (input.supersedesId && (!superseded || superseded.scope !== input.scope || superseded.projectId !== input.projectId || superseded.status === 'deleted')) throw new Error('替代记忆必须属于同一范围')
    const now = Date.now()
    const memory: Memory = { id: randomUUID(), scope: input.scope, projectId: input.scope === 'personal' ? null : input.projectId,
      content: input.content.trim(), sourceConversationId: input.sourceConversationId, sourceMessageIds: [...sourceIds], evidence: input.evidence,
      status: input.explicit ? 'active' : 'pending', createdAt: now, updatedAt: now, supersedesId: input.supersedesId ?? null }
    this.sqlite.transaction(() => {
      this.sqlite.prepare('INSERT INTO memories(id, scope, project_id, content, source_conversation_id, source_message_ids, evidence, status, created_at, updated_at, supersedes_id) VALUES (@id, @scope, @projectId, @content, @sourceConversationId, @sourceMessageIds, @evidence, @status, @createdAt, @updatedAt, @supersedesId)').run({ ...memory, sourceMessageIds: JSON.stringify(memory.sourceMessageIds) })
      if (memory.status === 'active') {
        if (superseded) this.update(superseded.id, { status: 'expired' })
        this.invalidate(memory.scope, memory.projectId)
      }
    })()
    return memory
  }

  update(id: string, patch: { content?: string; status?: Memory['status'] }): Memory {
    const memory = this.list().find((item) => item.id === id)
    if (!memory || memory.status === 'deleted') throw new Error('记忆不存在或已删除')
    if (patch.content !== undefined && (!patch.content.trim() || patch.content.length > 2000)) throw new Error('记忆需为 1–2000 字符')
    const next = { ...memory, ...patch, updatedAt: Date.now() }
    if (next.status === 'deleted') { next.content = ''; next.evidence = '' }
    this.sqlite.transaction(() => {
      if (next.status === 'active' && next.supersedesId) this.sqlite.prepare("UPDATE memories SET status = 'expired', updated_at = ? WHERE id = ? AND status != 'deleted'").run(next.updatedAt, next.supersedesId)
      this.sqlite.prepare('UPDATE memories SET content = ?, evidence = ?, status = ?, updated_at = ? WHERE id = ?').run(next.content, next.evidence, next.status, next.updatedAt, id)
      this.invalidate(memory.scope, memory.projectId)
    })()
    return next
  }

  recall(projectId: string | null): Memory[] {
    return this.list().filter((memory) => memory.status === 'active' && (memory.scope === 'personal' || (projectId !== null && memory.projectId === projectId)))
  }
}
