import type Database from 'better-sqlite3'
import { randomUUID } from 'node:crypto'
import path from 'node:path'

export interface Project { id: string; name: string; createdAt: number }

/** Project membership is independent from workspace paths; assignment never moves files. */
export class ProjectService {
  constructor(private readonly sqlite: Database.Database, private readonly invalidate: (conversationId: string) => void = () => {}) {}

  list(): Project[] {
    return this.sqlite.prepare('SELECT id, name, created_at AS createdAt FROM projects ORDER BY created_at, id').all() as Project[]
  }

  create(name: string): Project {
    if (!name.trim() || name.trim().length > 100) throw new Error('项目名称需为 1–100 字符')
    const project = { id: randomUUID(), name: name.trim(), createdAt: Date.now() }
    this.sqlite.prepare('INSERT INTO projects VALUES (@id, @name, @createdAt)').run(project)
    return project
  }

  memberships(): Record<string, string> {
    const rows = this.sqlite.prepare('SELECT conversation_id AS conversationId, project_id AS projectId FROM project_conversations').all() as { conversationId: string; projectId: string }[]
    return Object.fromEntries(rows.map((row) => [row.conversationId, row.projectId]))
  }

  assign(conversationId: string, projectId: string | null): void {
    this.sqlite.transaction(() => {
      if (!this.sqlite.prepare('SELECT id FROM conversations WHERE id = ?').get(conversationId)) throw new Error('会话不存在')
      if (projectId && !this.sqlite.prepare('SELECT id FROM projects WHERE id = ?').get(projectId)) throw new Error('项目不存在')
      if (projectId) this.sqlite.prepare('INSERT INTO project_conversations VALUES (?, ?) ON CONFLICT(conversation_id) DO UPDATE SET project_id = excluded.project_id').run(conversationId, projectId)
      else this.sqlite.prepare('DELETE FROM project_conversations WHERE conversation_id = ?').run(conversationId)
      this.invalidate(conversationId)
    })()
  }

  suggestions(): { path: string; conversationIds: string[] }[] {
    const rows = this.sqlite.prepare(`SELECT w.conversation_id AS id, w.bound_path AS path FROM workspaces w
      LEFT JOIN project_conversations p ON p.conversation_id = w.conversation_id
      WHERE w.mode = 'local' AND w.bound_path IS NOT NULL AND p.conversation_id IS NULL`).all() as { id: string; path: string }[]
    const groups = new Map<string, { path: string; conversationIds: string[] }>()
    for (const row of rows) {
      const absolute = path.resolve(row.path)
      const normalized = absolute === path.parse(absolute).root ? absolute : absolute.replace(/[\\/]+$/, '')
      const key = process.platform === 'win32' ? normalized.toLowerCase() : normalized
      const group = groups.get(key) ?? { path: normalized, conversationIds: [] }
      group.conversationIds.push(row.id)
      groups.set(key, group)
    }
    return [...groups.values()]
  }
}
