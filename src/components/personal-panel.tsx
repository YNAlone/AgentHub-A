'use client'

import { useCallback, useEffect, useState } from 'react'
import Link from 'next/link'
import { ArrowLeft, ArrowUpRight, Check, ChevronRight, Folder, FolderPlus, Layers3, MessageSquare, Plus, Search, Settings2, ShieldCheck, Sparkles } from 'lucide-react'
import styles from './personal-panel.module.css'
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
  const [tab, setTab] = useState<'projects' | 'memories' | 'context'>('projects')
  const [query, setQuery] = useState('')
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
  const visibleConversations = conversations.filter((c) => (filter === 'all' || (projects.memberships[c.id] ?? 'unassigned') === filter) && c.title.toLowerCase().includes(query.toLowerCase()))
  const visibleMemories = memories.filter((m) => m.status !== 'deleted' && (filter === 'all' || m.scope === 'personal' || m.projectId === filter))
  const sections = {
    projects: { label: '项目', description: '把相关对话整理在一起，让每个项目拥有自己的上下文。', icon: Folder },
    memories: { label: '长期记忆', description: '留下有用的偏好与经验，让下一次对话从这里继续。', icon: Sparkles },
    context: { label: '上下文', description: '管理历史压缩与记忆提取，平衡上下文、用量和连续性。', icon: Settings2 },
  }
  const setSetting = <K extends keyof PersonalSettingsValue>(key: K, value: PersonalSettingsValue[K]) => {
    if (capabilities) setCapabilities({ ...capabilities, settings: { ...capabilities.settings, [key]: value } })
  }
  return <div className={styles.shell}>
    <aside className={styles.sidebar}>
      <Link href="/" className={styles.brand}><Layers3 size={22} strokeWidth={1.7} /><span>AgentHub</span></Link>
      <Link href="/" className={styles.back}><ArrowLeft size={16} />返回对话</Link>
      <div className={styles.navLabel}>工作空间</div>
      <nav aria-label="工作空间设置" className={styles.nav}>
        {(Object.keys(sections) as (keyof typeof sections)[]).map((key) => {
          const Icon = sections[key].icon
          return <button key={key} type="button" aria-current={tab === key ? 'page' : undefined} onClick={() => { setTab(key); setNotice('') }}><Icon size={17} strokeWidth={1.6} /><span>{sections[key].label}</span>{tab === key && <ChevronRight size={14} />}</button>
        })}
      </nav>
      <div className={styles.local}><span className={styles.localIcon}><ShieldCheck size={17} /></span><div>本机个人空间<small>数据保存在此设备</small></div></div>
    </aside>
    <main className={styles.main}>
      <div className={styles.topbar}><span>工作空间</span><ChevronRight size={13} /><span>{sections[tab].label}</span><span className={styles.privateLabel}><ShieldCheck size={13} />仅本机访问</span></div>
      <div className={styles.content}>
        <header className={styles.header}><div className={styles.eyebrow}>工作空间设置</div><h1>{sections[tab].label}</h1><p>{sections[tab].description}</p></header>
        {error && <p role="alert" className={styles.error}>{error}</p>}
        {notice && <p role="status" className={styles.notice}><Check size={15} />{notice}</p>}
        {!capabilities && !error && <p role="status" className={styles.loading}>正在加载工作空间…</p>}
        {tab === 'projects' && <section aria-label="项目管理" className={styles.section}>
          <div className={styles.sectionHeading}><h2>你的项目 <span>{projects.projects.length}</span></h2><span>一个项目，多段对话</span></div>
          <form className={styles.createProject} onSubmit={(e) => { e.preventDefault(); void action(async () => { await api('/api/projects', 'POST', { action: 'create', name }); setName('') }) }}>
            <FolderPlus size={20} strokeWidth={1.5} /><Input aria-label="新项目名称" placeholder="为新项目起个名字…" value={name} onChange={(e) => setName(e.target.value)} maxLength={100} /><Button disabled={busy || !name.trim()}><Plus size={15} />创建项目</Button>
          </form>
          {projects.projects.length > 0 && <div className={styles.projectGrid}>{projects.projects.map((project) => <button type="button" key={project.id} className={styles.projectTile} aria-pressed={filter === project.id} onClick={() => setFilter(filter === project.id ? 'all' : project.id)}><Folder size={19} strokeWidth={1.5} /><strong>{project.name}</strong><small>{Object.values(projects.memberships).filter((id) => id === project.id).length} 段对话</small><ArrowUpRight size={14} /></button>)}</div>}
          <div className={styles.listHeading}><h2>会话归属</h2><span>{visibleConversations.length} 段对话</span></div>
          <div className={styles.toolbar}><div className={styles.search}><Search size={15} /><input aria-label="搜索会话" placeholder="搜索会话…" value={query} onChange={(e) => setQuery(e.target.value)} /></div><select aria-label="查看会话" value={filter} onChange={(e) => setFilter(e.target.value)}><option value="all">全部项目</option><option value="unassigned">未归属</option>{projects.projects.map((p) => <option key={p.id} value={p.id}>{p.name}</option>)}</select></div>
          <div className={styles.conversations}>{visibleConversations.map((c) => <div key={c.id} className={styles.conversation}><MessageSquare size={17} strokeWidth={1.5} /><Link href="/" onClick={() => useAppStore.getState().setActiveConversation(c.id)}>{c.title}</Link><select aria-label={`${c.title}的项目`} disabled={busy} value={projects.memberships[c.id] ?? ''} onChange={(e) => void action(() => assign(c.id, e.target.value || null))}><option value="">未归属 · 临时会话</option>{projects.projects.map((p) => <option key={p.id} value={p.id}>{p.name}</option>)}</select></div>)}</div>
          {!visibleConversations.length && <div className={styles.empty}><span className={styles.emptyIcon}><MessageSquare size={25} strokeWidth={1.3} /></span><h3>{query || filter !== 'all' ? '没有匹配的会话' : '让对话各有所属'}</h3><p>{query || filter !== 'all' ? '换一个关键词或项目试试。' : '创建项目后，将相关对话归入其中。项目记忆会随之保持独立。'}</p><Link href="/">返回对话 <ArrowUpRight size={14} /></Link></div>}
          {projects.suggestions.length > 0 && <details className={styles.details}><summary>发现 {projects.suggestions.length} 个可整理的目录</summary><p className={styles.hint}>选择项目即确认归属，不会移动文件。</p>{projects.suggestions.map((suggestion) => <div key={suggestion.path} className={styles.suggestion}><span>{suggestion.path}<small>{suggestion.conversationIds.length} 段对话</small></span><select aria-label={`确认${suggestion.path}归属`} value="" disabled={busy} onChange={(e) => { const id = e.target.value; if (id) void action(async () => { for (const c of suggestion.conversationIds) await assign(c, id) }) }}><option value="">选择项目并确认</option>{projects.projects.map((p) => <option key={p.id} value={p.id}>{p.name}</option>)}</select></div>)}</details>}
        </section>}
        {tab === 'memories' && <section aria-label="长期记忆管理" className={styles.section}>
          <div className={styles.memoryIntro}><Sparkles size={20} strokeWidth={1.5} /><div><strong>记住重要的，保留你的控制权</strong><p>个人偏好跨项目使用，项目经验只在对应项目中使用。推断内容经你确认后生效。</p></div></div>
          <div className={styles.listHeading}><h2>已保存的记忆 <span>{visibleMemories.length}</span></h2><select aria-label="按项目筛选记忆" value={filter} onChange={(e) => setFilter(e.target.value)}><option value="all">全部项目</option><option value="unassigned">仅个人偏好</option>{projects.projects.map((p) => <option key={p.id} value={p.id}>{p.name}</option>)}</select></div>
          {!visibleMemories.length && <div className={styles.empty}><span className={styles.emptyIcon}><Sparkles size={26} strokeWidth={1.3} /></span><h3>有用的记忆，会在这里留下</h3><p>开启后台提取后，AgentHub 会从完成的对话中整理偏好和经验。你可以随时查看来源、修改或删除。</p><button type="button" onClick={() => setTab('context')}>管理记忆设置 <ArrowUpRight size={14} /></button></div>}
          <div className={styles.memoryList}>{visibleMemories.map((memory) => <MemoryEditor key={`${memory.id}:${memory.updatedAt}`} memory={memory} projectName={projects.projects.find((p) => p.id === memory.projectId)?.name} busy={busy} onUpdate={(patch) => updateMemory(memory.id, patch)} />)}</div>
          <p className={styles.footnote}><ShieldCheck size={14} />停用过时记忆，或删除不需要的内容。删除后，同一来源不会再次生成记忆。</p>
        </section>}
        {tab === 'context' && capabilities && <section aria-label="上下文与后台提取" className={styles.section}>
          <form onSubmit={(e) => { e.preventDefault(); void action(() => api('/api/personal/settings', 'PATCH', capabilities.settings)) }}>
            <h2 className={styles.groupTitle}>历史与记忆</h2>
            <ToggleRow title="自动压缩上下文" description="接近模型上限时整理历史，完整原始消息始终保留。" checked={capabilities.settings.automaticCompaction} onChange={(value) => setSetting('automaticCompaction', value)} />
            <ToggleRow title="允许后台提取记忆" description="从已完成的对话中提取偏好与项目经验。" checked={capabilities.settings.memoryEnabled} onChange={(value) => setSetting('memoryEnabled', value)} />
            <ToggleRow title="使用已生效的记忆" description="在新请求中加入相关记忆，让对话保持连续。" checked={capabilities.settings.memoryUseEnabled} onChange={(value) => setSetting('memoryUseEnabled', value)} />
            <h2 className={styles.groupTitle}>模型与用量</h2>
            <label className={styles.settingRow}><span><strong>摘要与记忆模型</strong><small>用于历史压缩和后台记忆提取。</small></span><select value={capabilities.settings.auxiliaryAgentId ?? ''} onChange={(e) => setSetting('auxiliaryAgentId', e.target.value || null)}><option value="">跟随当前会话</option>{agents.filter((a) => a.adapterName !== 'mock').map((a) => <option key={a.id} value={a.id}>{a.name} · {a.modelId ?? a.adapterName}</option>)}</select></label>
            <label className={styles.settingRow}><span><strong>每批输入上限</strong><small>单次提取最多读取的字符数，范围 4,000–60,000。</small></span><span className={styles.numberField}><Input aria-label="每批输入上限（字符）" type="number" min={4000} max={60000} value={capabilities.settings.memoryInputChars} onChange={(e) => setSetting('memoryInputChars', Number(e.target.value))} /><span>字符</span></span></label>
            <label className={styles.settingRow}><span><strong>并发请求数</strong><small>同时进行的后台提取任务，较低并发更节省资源。</small></span><select aria-label="并发请求数" value={capabilities.settings.memoryConcurrency} onChange={(e) => setSetting('memoryConcurrency', Number(e.target.value))}><option value={1}>1 个任务</option><option value={2}>2 个任务</option></select></label>
            <div className={styles.saveBar}><p>保存时会重试失败的提取任务。</p><Button disabled={busy}>{busy ? '正在保存…' : '保存设置'}<Check size={14} /></Button></div>
          </form>
          <details className={styles.details}><summary>辅助模型用量与提取状态 <span>{capabilities.jobs.length} 个任务</span></summary><div className={styles.usage}>{!capabilities.usage.length && !capabilities.jobs.length && <p>尚无用量记录。后台提取开始后，消耗和任务状态会显示在这里。</p>}{capabilities.usage.map((u) => <div key={u.model}><strong>{u.model}</strong><span>{u.requests} 次请求 · 输入 {u.inputTokens.toLocaleString()} / 输出 {u.outputTokens.toLocaleString()} tokens</span></div>)}{capabilities.jobs.map((job) => <div key={job.conversationId}><strong>{conversations.find((c) => c.id === job.conversationId)?.title ?? job.conversationId}</strong><span>{{ pending: '等待提取', running: '正在提取', complete: '已完成', failed: '提取失败' }[job.status] ?? job.status}{job.error && ` · ${job.error}`}</span></div>)}</div></details>
        </section>}
      </div>
    </main>
  </div>
}

/** Native checkbox semantics retain keyboard access while the visual control reads as a switch. */
function ToggleRow({ title, description, checked, onChange }: { title: string; description: string; checked: boolean; onChange: (value: boolean) => void }) {
  return <label className={styles.settingRow}><span><strong>{title}</strong><small>{description}</small></span><input className={styles.toggle} type="checkbox" aria-label={title} checked={checked} onChange={(event) => onChange(event.target.checked)} /></label>
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
  return <article className="space-y-3 rounded-lg border p-4"><div className={styles.memoryMeta} data-status={memory.status}><span>{memory.scope === 'personal' ? '个人偏好' : `项目：${projectName ?? memory.projectId}`}</span><span>{{ active: '已生效', pending: '待确认', expired: '已停用', deleted: '已删除' }[memory.status]}</span></div>
    <textarea aria-label="记忆内容" className="min-h-20 w-full resize-y rounded border bg-background p-2 text-sm" maxLength={2000} value={content} onChange={(e) => setContent(e.target.value)} />
    <div className="flex flex-wrap gap-2"><Button size="sm" variant="outline" disabled={busy || !content.trim() || content === memory.content} onClick={() => void onUpdate({ content })}>保存修改</Button>{memory.status !== 'active' && <Button size="sm" disabled={busy} onClick={() => void onUpdate({ status: 'active' })}>确认生效</Button>}{memory.status === 'active' && <Button size="sm" variant="outline" disabled={busy} onClick={() => void onUpdate({ status: 'expired' })}>停用</Button>}<Button size="sm" variant="outline" disabled={busy} onClick={() => setDeleting(!deleting)}>删除</Button></div>
    {deleting && <div className="flex flex-wrap items-center gap-3 rounded bg-muted p-3 text-sm"><span>删除内容并阻止同一来源重新生成？原对话会保留。</span><Button size="sm" variant="destructive" disabled={busy} onClick={() => void onUpdate({ status: 'deleted' })}>确认删除</Button><Button size="sm" variant="ghost" onClick={() => setDeleting(false)}>取消</Button></div>}
    <details><summary className="cursor-pointer text-xs text-muted-foreground">查看来源</summary><blockquote className="my-2 border-l-2 pl-3 text-sm">{memory.evidence}</blockquote><Button size="sm" variant="outline" onClick={() => void loadSources()}>加载原始消息</Button>{sources && <pre className="mt-2 max-h-64 overflow-auto whitespace-pre-wrap break-words rounded bg-muted p-3 text-xs">{sources}</pre>}</details>
  </article>
}
