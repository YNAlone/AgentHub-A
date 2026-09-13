'use client'

import { useCallback, useEffect, useState } from 'react'
import Link from 'next/link'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { useAppStore, useConversationList, useAgentList } from '@/stores/app-store'
import type { Project } from '@/server/project-service'
import type { Memory } from '@/server/memory-service'
import type { PersonalSettingsValue } from '@/server/personal-settings'
import type { MessageRow } from '@/db/schema'

interface ProjectsResponse { projects: Project[]; memberships: Record<string, string>; suggestions: { path: string; conversationIds: string[] }[] }
interface CapabilitiesResponse { settings: PersonalSettingsValue; usage: { model: string; inputTokens: number; outputTokens: number; requests: number }[]; jobs: { conversationId: string; status: string; error: string | null }[] }

async function api<T>(url: string, method = 'GET', body?: unknown): Promise<T> {
  const response = await fetch(url, { method, headers: { 'Content-Type': 'application/json' }, body: body === undefined ? undefined : JSON.stringify(body) })
  const result = await response.json()
  if (!response.ok) throw new Error(result.error ?? '操作失败')
  return result as T
}

/** One local management surface exposes project assignment, provenance and background generation controls. */
export function PersonalPanel() {
  const conversations = useConversationList()
  const agents = useAgentList()
  const [projects, setProjects] = useState<ProjectsResponse>({ projects: [], memberships: {}, suggestions: [] })
  const [memories, setMemories] = useState<Memory[]>([])
  const [capabilities, setCapabilities] = useState<CapabilitiesResponse | null>(null)
  const [name, setName] = useState('')
  const [error, setError] = useState('')
  const [notice, setNotice] = useState('')
  const [busy, setBusy] = useState(false)
  const [filter, setFilter] = useState('all')
  const load = useCallback(async () => {
    const [p, m, c] = await Promise.all([api<ProjectsResponse>('/api/projects'), api<{ memories: Memory[] }>('/api/memories'), api<CapabilitiesResponse>('/api/personal/settings')])
    setProjects(p); setMemories(m.memories); setCapabilities(c)
  }, [])
  useEffect(() => { void load().catch((e: Error) => setError(e.message)) }, [load])
  const action = async (work: () => Promise<unknown>) => {
    setBusy(true); setError(''); setNotice('')
    try { await work(); await load(); setNotice('已保存') } catch (e) { setError(e instanceof Error ? e.message : '操作失败') } finally { setBusy(false) }
  }
  const assign = (conversationId: string, projectId: string | null) => api('/api/projects', 'POST', { action: 'assign', conversationId, projectId })
  const updateMemory = (id: string, patch: { status?: Memory['status']; content?: string }) => action(() => api('/api/memories', 'PATCH', { id, ...patch }))
  return <main className="mx-auto max-w-5xl space-y-8 p-6 pb-20">
    <header className="flex items-center justify-between border-b pb-5"><div><h1 className="text-2xl font-semibold">项目与记忆</h1><p className="mt-2 text-sm text-muted-foreground">本机个人工作空间 · 所有修改保存到本机</p></div><Link href="/" className="text-sm underline">返回对话</Link></header>
    {error && <p role="alert" className="rounded border border-destructive p-3 text-destructive">{error}</p>}
    {notice && <p role="status" className="text-sm text-muted-foreground">{notice}</p>}
    {!capabilities && !error && <p role="status" className="text-sm text-muted-foreground">正在加载项目、记忆和设置…</p>}
    <section className="space-y-4"><h2 className="text-lg font-medium">项目</h2>
      <form className="flex gap-2" onSubmit={(e) => { e.preventDefault(); void action(async () => { await api('/api/projects', 'POST', { action: 'create', name }); setName('') }) }}><Input aria-label="新项目名称" placeholder="新项目名称" value={name} onChange={(e) => setName(e.target.value)} maxLength={100} /><Button disabled={busy || !name.trim()}>创建项目</Button></form>
      <label className="flex items-center gap-3 text-sm">查看会话<select className="rounded border bg-background p-2" value={filter} onChange={(e) => setFilter(e.target.value)}><option value="all">全部项目</option><option value="unassigned">未归属</option>{projects.projects.map((p) => <option key={p.id} value={p.id}>{p.name}</option>)}</select></label>
      <div className="divide-y rounded-lg border">{conversations.filter((c) => filter === 'all' || (projects.memberships[c.id] ?? 'unassigned') === filter).map((c) => <div key={c.id} className="flex flex-wrap items-center justify-between gap-3 p-3"><Link href="/" onClick={() => useAppStore.getState().setActiveConversation(c.id)} className="text-sm hover:underline">{c.title}</Link><select aria-label={`${c.title}的项目`} className="max-w-64 rounded border bg-background p-2 text-sm" disabled={busy} value={projects.memberships[c.id] ?? ''} onChange={(e) => void action(() => assign(c.id, e.target.value || null))}><option value="">未归属（临时会话）</option>{projects.projects.map((p) => <option key={p.id} value={p.id}>{p.name}</option>)}</select></div>)}</div>
      {projects.suggestions.length > 0 && <details className="rounded-lg border p-4"><summary className="cursor-pointer text-sm font-medium">根据已有绑定目录生成的归属建议（{projects.suggestions.length}）</summary><p className="my-3 text-sm text-muted-foreground">选择项目即确认归属，不会移动文件。未确认时保持未归属。</p>{projects.suggestions.map((suggestion) => <div key={suggestion.path} className="my-3 flex flex-wrap items-center gap-3"><span className="flex-1 break-all text-sm">{suggestion.path} · {suggestion.conversationIds.length} 段对话</span><select aria-label={`确认${suggestion.path}归属`} className="rounded border bg-background p-2 text-sm" value="" disabled={busy} onChange={(e) => { const id = e.target.value; if (id) void action(async () => { for (const c of suggestion.conversationIds) await assign(c, id) }) }}><option value="">选择项目并确认</option>{projects.projects.map((p) => <option key={p.id} value={p.id}>{p.name}</option>)}</select></div>)}</details>}
    </section>
    <section className="space-y-4"><div><h2 className="text-lg font-medium">长期记忆</h2><p className="mt-1 text-sm text-muted-foreground">个人偏好跨项目使用；项目记忆仅在所属项目使用。推断内容需确认后生效。过时内容可停用，错误或敏感内容可删除；删除会阻止同一来源再次生成。</p></div>
      {!memories.filter((m) => m.status !== 'deleted').length && <p className="rounded-lg border border-dashed p-6 text-sm text-muted-foreground">暂无记忆。后台会从新完成的对话逐步提取。</p>}
      {memories.filter((m) => m.status !== 'deleted' && (filter === 'all' || m.scope === 'personal' || m.projectId === filter)).map((memory) => <MemoryEditor key={`${memory.id}:${memory.updatedAt}`} memory={memory} projectName={projects.projects.find((p) => p.id === memory.projectId)?.name} busy={busy} onUpdate={(patch) => updateMemory(memory.id, patch)} />)}
    </section>
    {capabilities && <section className="space-y-4 rounded-lg border p-5"><h2 className="text-lg font-medium">上下文与后台提取</h2><form className="space-y-4" onSubmit={(e) => { e.preventDefault(); void action(() => api('/api/personal/settings', 'PATCH', capabilities.settings)) }}>
      <label className="flex items-center gap-2 text-sm"><input type="checkbox" checked={capabilities.settings.automaticCompaction} onChange={(e) => setCapabilities({ ...capabilities, settings: { ...capabilities.settings, automaticCompaction: e.target.checked } })} />接近上下文上限时自动压缩（保留完整原始历史）</label>
      <label className="flex items-center gap-2 text-sm"><input type="checkbox" checked={capabilities.settings.memoryEnabled} onChange={(e) => setCapabilities({ ...capabilities, settings: { ...capabilities.settings, memoryEnabled: e.target.checked } })} />允许后台提取记忆</label>
      <label className="flex items-center gap-2 text-sm"><input type="checkbox" checked={capabilities.settings.memoryUseEnabled} onChange={(e) => setCapabilities({ ...capabilities, settings: { ...capabilities.settings, memoryUseEnabled: e.target.checked } })} />在新请求中使用已生效的记忆</label>
      <label className="block space-y-2 text-sm"><span>摘要与记忆模型</span><select className="block w-full rounded border bg-background p-2" value={capabilities.settings.auxiliaryAgentId ?? ''} onChange={(e) => setCapabilities({ ...capabilities, settings: { ...capabilities.settings, auxiliaryAgentId: e.target.value || null } })}><option value="">使用当前会话可用的模型配置</option>{agents.filter((a) => a.adapterName !== 'mock').map((a) => <option key={a.id} value={a.id}>{a.name} · {a.modelId ?? a.adapterName}</option>)}</select></label>
      <div className="flex flex-wrap gap-4"><label className="text-sm">每批输入上限（字符）<Input type="number" min={4000} max={60000} value={capabilities.settings.memoryInputChars} onChange={(e) => setCapabilities({ ...capabilities, settings: { ...capabilities.settings, memoryInputChars: Number(e.target.value) } })} /></label><label className="text-sm">并发请求数<Input type="number" min={1} max={2} value={capabilities.settings.memoryConcurrency} onChange={(e) => setCapabilities({ ...capabilities, settings: { ...capabilities.settings, memoryConcurrency: Number(e.target.value) } })} /></label></div>
      <Button disabled={busy}>保存设置 / 重试失败提取</Button></form>
      <details><summary className="cursor-pointer text-sm">辅助模型用量与提取状态</summary><div className="mt-3 space-y-2 text-sm">{capabilities.usage.map((u) => <p key={u.model}>{u.model}：{u.requests} 次请求，输入 {u.inputTokens} / 输出 {u.outputTokens} tokens</p>)}{capabilities.jobs.map((job) => <p key={job.conversationId}>{conversations.find((c) => c.id === job.conversationId)?.title ?? job.conversationId}：{job.status}{job.error && ` · ${job.error}`}</p>)}</div></details>
    </section>}
  </main>
}

function MemoryEditor({ memory, projectName, busy, onUpdate }: { memory: Memory; projectName?: string; busy: boolean; onUpdate: (patch: { status?: Memory['status']; content?: string }) => Promise<void> }) {
  const [content, setContent] = useState(memory.content)
  const [deleting, setDeleting] = useState(false)
  const [sources, setSources] = useState('')
  const loadSources = async () => {
    try {
      const data = await api<{ messages: MessageRow[]; missing: string[] }>(`/api/memories?source=${encodeURIComponent(memory.id)}`)
      setSources(data.messages.map((m) => `${m.id}\n${m.parts.filter((p) => p.type === 'text').map((p) => p.content).join('\n')}`).join('\n\n') + (data.missing.length ? '\n部分原消息已删除，保留的引用见上方。' : ''))
    } catch (e) { setSources(e instanceof Error ? e.message : '来源加载失败') }
  }
  return <article className="space-y-3 rounded-lg border p-4"><div className="flex flex-wrap gap-2 text-xs text-muted-foreground"><span>{memory.scope === 'personal' ? '个人偏好' : `项目：${projectName ?? memory.projectId}`}</span><span>{{ active: '已生效', pending: '待确认', expired: '已停用', deleted: '已删除' }[memory.status]}</span></div>
    <textarea aria-label="记忆内容" className="min-h-20 w-full resize-y rounded border bg-background p-2 text-sm" maxLength={2000} value={content} onChange={(e) => setContent(e.target.value)} />
    <div className="flex flex-wrap gap-2"><Button size="sm" variant="outline" disabled={busy || !content.trim() || content === memory.content} onClick={() => void onUpdate({ content })}>保存修改</Button>{memory.status !== 'active' && <Button size="sm" disabled={busy} onClick={() => void onUpdate({ status: 'active' })}>确认生效</Button>}{memory.status === 'active' && <Button size="sm" variant="outline" disabled={busy} onClick={() => void onUpdate({ status: 'expired' })}>停用</Button>}<Button size="sm" variant="outline" disabled={busy} onClick={() => setDeleting(!deleting)}>删除</Button></div>
    {deleting && <div className="flex flex-wrap items-center gap-3 rounded bg-muted p-3 text-sm"><span>删除内容并阻止同一来源重新生成？原对话会保留。</span><Button size="sm" variant="destructive" disabled={busy} onClick={() => void onUpdate({ status: 'deleted' })}>确认删除</Button><Button size="sm" variant="ghost" onClick={() => setDeleting(false)}>取消</Button></div>}
    <details><summary className="cursor-pointer text-xs text-muted-foreground">查看来源</summary><blockquote className="my-2 border-l-2 pl-3 text-sm">{memory.evidence}</blockquote><Button size="sm" variant="outline" onClick={() => void loadSources()}>加载原始消息</Button>{sources && <pre className="mt-2 max-h-64 overflow-auto whitespace-pre-wrap break-words rounded bg-muted p-3 text-xs">{sources}</pre>}</details>
  </article>
}
