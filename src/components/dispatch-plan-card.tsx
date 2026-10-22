'use client'

import {
  Ban,
  Check,
  CheckCircle2,
  ChevronRight,
  Circle,
  Loader2,
  Network,
  Pencil,
  Plus,
  Trash2,
  X,
  XCircle,
} from 'lucide-react'
import { useMemo, useState } from 'react'
import ReactMarkdown from 'react-markdown'
import remarkGfm from 'remark-gfm'

import { AgentAvatar } from '@/components/agent-avatar'
import { Button } from '@/components/ui/button'
import { Card } from '@/components/ui/card'
import { Textarea } from '@/components/ui/textarea'
import {
  approvePendingDispatchPlan,
  rejectPendingDispatchPlan,
  updatePendingDispatchPlan,
} from '@/lib/api'
import { cn } from '@/lib/utils'
import type { DispatchState } from '@/stores/app-store'
import { useAppStore } from '@/stores/app-store'
import type { DispatchPlanItem, DispatchTaskStatus } from '@/shared/types'

interface DispatchPlanCardProps {
  conversationId: string
  dispatch: DispatchState
}

export function DispatchPlanCard({ conversationId, dispatch }: DispatchPlanCardProps) {
  // Pending plans retain editing controls while completed plans remain read-only.
  if (dispatch.reviewStatus === 'pending' && dispatch.pendingPlanId) {
    return (
      <DispatchPlanReviewCard
        conversationId={conversationId}
        dispatch={dispatch}
        pendingPlanId={dispatch.pendingPlanId}
      />
    )
  }

  return <DispatchPlanReadOnlyCard dispatch={dispatch} />
}

/** 会话成员里可被派发的 agent（排除 Orchestrator 自身，派给自己会无限递归）。 */
function useDispatchableAgents(conversationId: string, orchestratorAgentId: string | undefined) {
  const agents = useAppStore((s) => s.agents)
  const memberIds = useAppStore((s) => s.conversations[conversationId]?.agentIds)
  return useMemo(() => {
    const ids = memberIds && memberIds.length > 0 ? memberIds : Object.keys(agents)
    return ids
      .filter((id) => id !== orchestratorAgentId)
      .map((id) => agents[id])
      .filter((a): a is NonNullable<(typeof agents)[string]> => !!a)
  }, [memberIds, agents, orchestratorAgentId])
}

function DispatchPlanReviewCard({
  conversationId,
  dispatch,
  pendingPlanId,
}: {
  conversationId: string
  dispatch: DispatchState
  pendingPlanId: string
}) {
  const [busy, setBusy] = useState<null | 'approve' | 'reject'>(null)
  const [error, setError] = useState<string | null>(null)
  const [expandedIds, setExpandedIds] = useState<Record<string, boolean>>({})
  const [drafts, setDrafts] = useState<DispatchPlanItem[] | null>(null)
  const [criteriaText, setCriteriaText] = useState<Record<string, string>>({})
  const [saving, setSaving] = useState(false)
  const dispatchableAgents = useDispatchableAgents(conversationId, dispatch.orchestratorAgentId)
  const editing = drafts !== null

  const toggleExpand = (taskId: string) =>
    setExpandedIds((prev) => ({ ...prev, [taskId]: !prev[taskId] }))

  const handleApprove = async () => {
    if (busy) return
    setBusy('approve')
    setError(null)
    try {
      await approvePendingDispatchPlan(conversationId, pendingPlanId)
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err))
      setBusy(null)
    }
  }

  const handleReject = async () => {
    if (busy) return
    setBusy('reject')
    setError(null)
    try {
      await rejectPendingDispatchPlan(conversationId, pendingPlanId)
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err))
      setBusy(null)
    }
  }

  const startEdit = () => {
    setDrafts(dispatch.plan.map((task) => ({ ...task })))
    setCriteriaText(
      Object.fromEntries(dispatch.plan.map((t) => [t.id, (t.acceptanceCriteria ?? []).join('\n')])),
    )
    setError(null)
    setExpandedIds({})
  }

  const cancelEdit = () => {
    setDrafts(null)
    setCriteriaText({})
    setError(null)
  }

  const updateDraft = (taskId: string, patch: Partial<DispatchPlanItem>) =>
    setDrafts((prev) => prev!.map((t) => (t.id === taskId ? { ...t, ...patch } : t)))

  const toggleDep = (taskId: string, dep: string) =>
    setDrafts((prev) =>
      prev!.map((t) => {
        if (t.id !== taskId) return t
        const deps = t.dependsOn ?? []
        return {
          ...t,
          dependsOn: deps.includes(dep) ? deps.filter((d) => d !== dep) : [...deps, dep],
        }
      }),
    )

  const removeTask = (taskId: string) => {
    setDrafts((prev) =>
      prev!
        .filter((t) => t.id !== taskId)
        .map((t) => ({
          ...t,
          dependsOn: t.dependsOn?.filter((d) => d !== taskId),
          inputs: t.inputs?.filter((i) => i.fromTaskId !== taskId),
        })),
    )
    setCriteriaText((prev) => {
      const rest = { ...prev }
      delete rest[taskId]
      return rest
    })
  }

  const addTask = () => {
    setDrafts((prev) => {
      const next = [...(prev ?? [])]
      const fallbackAgentId =
        dispatchableAgents[0]?.id ?? next[next.length - 1]?.agentId ?? ''
      next.push({ id: nextTaskId(next), agentId: fallbackAgentId, task: '' })
      return next
    })
  }

  const handleSave = async () => {
    if (!drafts || saving) return
    if (drafts.length === 0) {
      setError('计划至少要保留一个任务')
      return
    }
    const emptyTask = drafts.find((t) => t.task.trim() === '')
    if (emptyTask) {
      setError(`任务 ${emptyTask.id} 的描述不能为空`)
      return
    }
    const noAgent = drafts.find((t) => !t.agentId)
    if (noAgent) {
      setError(`任务 ${noAgent.id} 未指定执行 agent`)
      return
    }

    const plan = drafts.map((d) => {
      const criteria = (criteriaText[d.id] ?? '')
        .split('\n')
        .map((line) => line.trim())
        .filter(Boolean)
      const item: DispatchPlanItem = { id: d.id, agentId: d.agentId, task: d.task.trim() }
      if (d.taskKind) item.taskKind = d.taskKind
      if (d.dependsOn && d.dependsOn.length > 0) item.dependsOn = d.dependsOn
      if (d.expectedOutputs && d.expectedOutputs.length > 0) item.expectedOutputs = d.expectedOutputs
      if (d.inputs && d.inputs.length > 0) item.inputs = d.inputs
      if (criteria.length > 0) item.acceptanceCriteria = criteria
      if (d.targetPaths && d.targetPaths.length > 0) item.targetPaths = d.targetPaths
      if (d.expectedWorkspaceChanges && d.expectedWorkspaceChanges.length > 0) {
        item.expectedWorkspaceChanges = d.expectedWorkspaceChanges
      }
      if (d.requiredCommands && d.requiredCommands.length > 0) {
        item.requiredCommands = d.requiredCommands
      }
      if (d.requiredEvidence && d.requiredEvidence.length > 0) {
        item.requiredEvidence = d.requiredEvidence
      }
      return item
    })

    setSaving(true)
    setError(null)
    try {
      const compiledPlan = await updatePendingDispatchPlan(conversationId, pendingPlanId, plan)
      // 乐观更新（API 已带回编译后的计划）；SSE dispatch.plan.updated 稍后会以相同数据再覆盖一次
      useAppStore.getState().updatePendingPlan(dispatch.runId, pendingPlanId, compiledPlan)
      setDrafts(null)
      setCriteriaText({})
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err))
    } finally {
      setSaving(false)
    }
  }

  return (
    <Card className="overflow-hidden border-amber-300/70 bg-amber-50/50 animate-in fade-in slide-in-from-top-2 duration-300 dark:border-amber-900/50 dark:bg-amber-950/15">
      <div className="space-y-3 p-3">
        <div className="flex items-center gap-2">
          <Network className="size-4 text-amber-600" />
          <div className="text-sm font-medium">
            {editing ? '正在编辑计划' : '计划待确认'} · {(drafts ?? dispatch.plan).length} 项
          </div>
          <div className="ml-auto flex items-center gap-1.5">
            {editing ? (
              <>
                <Button
                  size="sm"
                  variant="ghost"
                  onClick={cancelEdit}
                  disabled={saving}
                  className="h-7 px-2 text-muted-foreground"
                >
                  取消
                </Button>
                <Button
                  size="sm"
                  onClick={() => void handleSave()}
                  disabled={saving}
                  className="h-7 bg-primary px-2 text-primary-foreground hover:bg-primary/85"
                >
                  {saving ? (
                    <Loader2 className="size-3.5 animate-spin" />
                  ) : (
                    <Check className="size-3.5" />
                  )}
                  保存修改
                </Button>
              </>
            ) : (
              <>
                <Button
                  size="sm"
                  variant="ghost"
                  onClick={startEdit}
                  disabled={!!busy}
                  className="h-7 gap-1 px-2 text-amber-700 hover:bg-amber-100/60 hover:text-amber-800 dark:text-amber-400 dark:hover:bg-amber-900/30"
                >
                  <Pencil className="size-3.5" />
                  编辑
                </Button>
                <Button
                  size="sm"
                  variant="ghost"
                  onClick={() => void handleReject()}
                  disabled={!!busy}
                  className="h-7 px-2 text-rose-600 hover:bg-rose-50 hover:text-rose-700 dark:hover:bg-rose-950/30"
                >
                  {busy === 'reject' ? (
                    <Loader2 className="size-3.5 animate-spin" />
                  ) : (
                    <X className="size-3.5" />
                  )}
                  拒绝
                </Button>
                <Button
                  size="sm"
                  onClick={() => void handleApprove()}
                  disabled={!!busy}
                  className="h-7 bg-primary px-2 text-primary-foreground hover:bg-primary/85"
                >
                  {busy === 'approve' ? (
                    <Loader2 className="size-3.5 animate-spin" />
                  ) : (
                    <Check className="size-3.5" />
                  )}
                  执行计划
                </Button>
              </>
            )}
          </div>
        </div>

        {error && (
          <div className="rounded-md border border-destructive/30 bg-destructive/10 px-2 py-1.5 text-xs text-destructive">
            {error}
          </div>
        )}

        {editing ? (
          <PlanTaskEditList
            drafts={drafts!}
            agents={dispatchableAgents}
            criteriaText={criteriaText}
            onCriteriaChange={(taskId, text) =>
              setCriteriaText((prev) => ({ ...prev, [taskId]: text }))
            }
            onUpdate={updateDraft}
            onToggleDep={toggleDep}
            onRemove={removeTask}
            onAdd={addTask}
          />
        ) : (
          <PlanTaskList
            dispatch={dispatch}
            expandedIds={expandedIds}
            onToggleExpand={toggleExpand}
          />
        )}

        <div className="text-[11px] leading-5 text-muted-foreground">
          {editing ? (
            <>保存时会重新校验依赖与执行者；校验通过后「执行计划」即按修改后的内容派发。</>
          ) : (
            <>
              点任务行可展开完整详情；想改计划可以点「编辑」直接改，或在下方对话框描述（例如「把 t2
              改成依赖 t1」）让 Orchestrator 重排。
            </>
          )}
        </div>
      </div>
    </Card>
  )
}

/** 新增任务的默认 id：沿用 t1/t2 风格，跳过已占用的编号。 */
function nextTaskId(plan: DispatchPlanItem[]): string {
  const used = new Set(plan.map((t) => t.id))
  for (let i = plan.length + 1; ; i++) {
    const candidate = `t${i}`
    if (!used.has(candidate)) return candidate
  }
}

/** 计划任务行列表（只读展示，审批卡与执行卡共用；行可展开查看完整详情）。 */
function PlanTaskList({
  dispatch,
  expandedIds,
  onToggleExpand,
}: {
  dispatch: DispatchState
  expandedIds: Record<string, boolean>
  onToggleExpand: (taskId: string) => void
}) {
  const agents = useAppStore((s) => s.agents)
  return (
    <div className="space-y-1.5">
      {dispatch.plan.map((task, idx) => {
        const status =
          dispatch.reviewStatus === 'rejected'
            ? 'skipped'
            : (dispatch.taskStatus[task.id] ?? 'pending')
        const agent = agents[task.agentId]
        const expanded = !!expandedIds[task.id]
        const inputRefs = task.inputs?.map((input) => `${input.fromTaskId}.${input.outputId}`) ?? []
        const outputRefs =
          task.expectedOutputs?.map((output) => `${output.id}:${output.type}`) ?? []
        const criteriaCount = task.acceptanceCriteria?.length ?? 0
        return (
          <div
            key={task.id}
            style={{ animationDelay: `${idx * 60}ms` }}
            className={cn(
              'rounded-md border bg-card px-2 py-1.5 text-xs',
              'animate-in fade-in slide-in-from-left-2 fill-mode-both duration-300',
              'transition-[border-color,box-shadow,background-color] duration-300',
              status === 'running' &&
                'border-amber-300 bg-amber-50/40 ring-2 ring-amber-200/60 dark:bg-amber-950/20',
              status === 'complete' && 'border-emerald-200 dark:border-emerald-900/40',
              status === 'failed' && 'border-red-300',
              status === 'aborted' && 'border-zinc-300 bg-zinc-50/50 dark:border-zinc-700',
              status === 'skipped' && 'border-zinc-200 bg-muted/40 dark:border-zinc-800',
            )}
          >
            <button
              type="button"
              onClick={() => onToggleExpand(task.id)}
              aria-expanded={expanded}
              className="flex w-full items-start gap-2 text-left"
            >
              <StatusIcon status={status} />
              {agent ? (
                <AgentAvatar
                  agent={agent}
                  size="xs"
                  className={cn(
                    'transition-transform',
                    status === 'running' && 'scale-110 ring-2 ring-amber-300 ring-offset-1',
                  )}
                />
              ) : (
                <div className="size-5 shrink-0 rounded-full bg-muted" />
              )}
              <div className="min-w-0 flex-1">
                <div className="flex items-center gap-1.5">
                  <span className="font-medium">{agent?.name ?? task.agentId}</span>
                  <span className="font-mono text-[10px] text-muted-foreground">{task.id}</span>
                  {task.taskKind && (
                    <span className="rounded border bg-muted/40 px-1 py-0.5 text-[10px] text-muted-foreground">
                      {task.taskKind}
                    </span>
                  )}
                  {task.dependsOn && task.dependsOn.length > 0 && (
                    <span className="text-[10px] text-muted-foreground">
                      → {task.dependsOn.join(', ')}
                    </span>
                  )}
                  {status === 'running' && <TypingDots />}
                </div>
                <PlanTaskMarkdown clamp={!expanded}>{task.task}</PlanTaskMarkdown>
                {!expanded && (inputRefs.length > 0 || outputRefs.length > 0 || criteriaCount > 0) && (
                  <div className="mt-1 flex flex-wrap gap-1 text-[10px] text-muted-foreground">
                    {inputRefs.length > 0 && (
                      <span className="rounded border bg-muted/40 px-1 py-0.5">
                        in {inputRefs.join(', ')}
                      </span>
                    )}
                    {outputRefs.length > 0 && (
                      <span className="rounded border bg-muted/40 px-1 py-0.5">
                        out {outputRefs.join(', ')}
                      </span>
                    )}
                    {criteriaCount > 0 && (
                      <span className="rounded border bg-muted/40 px-1 py-0.5">
                        checks {criteriaCount}
                      </span>
                    )}
                  </div>
                )}
              </div>
              <ChevronRight
                className={cn(
                  'mt-0.5 size-3.5 shrink-0 text-muted-foreground/60 transition-transform duration-200',
                  expanded && 'rotate-90',
                )}
              />
            </button>
            {expanded && <TaskDetail task={task} />}
          </div>
        )
      })}
    </div>
  )
}

/** 展开后的完整任务详情：输入/交付物/验收标准/目标路径/命令等全部字段。 */
function TaskDetail({ task }: { task: DispatchPlanItem }) {
  return (
    <div className="mt-2 space-y-1.5 border-t pt-2 text-[11px] leading-5">
      {task.inputs && task.inputs.length > 0 && (
        <DetailSection label="输入">
          {task.inputs.map((input) => (
            <div key={`${input.fromTaskId}.${input.outputId}`} className="flex flex-wrap gap-1">
              <span className="rounded border bg-muted/40 px-1 py-0.5 font-mono text-[10px]">
                {input.fromTaskId}.{input.outputId}
              </span>
              {input.required && <span className="text-muted-foreground">必填</span>}
              {input.description && (
                <span className="text-muted-foreground">{input.description}</span>
              )}
            </div>
          ))}
        </DetailSection>
      )}
      {task.expectedOutputs && task.expectedOutputs.length > 0 && (
        <DetailSection label="交付物">
          {task.expectedOutputs.map((output) => (
            <div key={output.id} className="flex flex-wrap gap-1">
              <span className="rounded border bg-muted/40 px-1 py-0.5 font-mono text-[10px]">
                {output.id}:{output.type}
              </span>
              {output.required && <span className="text-muted-foreground">必需</span>}
              {output.description && (
                <span className="text-muted-foreground">{output.description}</span>
              )}
            </div>
          ))}
        </DetailSection>
      )}
      {task.acceptanceCriteria && task.acceptanceCriteria.length > 0 && (
        <DetailSection label="验收标准">
          <ol className="list-decimal space-y-0.5 pl-4">
            {task.acceptanceCriteria.map((criterion, i) => (
              <li key={i}>{criterion}</li>
            ))}
          </ol>
        </DetailSection>
      )}
      {task.targetPaths && task.targetPaths.length > 0 && (
        <DetailSection label="目标路径">
          {task.targetPaths.map((path) => (
            <code key={path} className="rounded bg-muted px-1 py-0.5 font-mono text-[10px]">
              {path}
            </code>
          ))}
        </DetailSection>
      )}
      {task.expectedWorkspaceChanges && task.expectedWorkspaceChanges.length > 0 && (
        <DetailSection label="工作区变更">
          <ul className="list-disc space-y-0.5 pl-4">
            {task.expectedWorkspaceChanges.map((change, i) => (
              <li key={i}>{change}</li>
            ))}
          </ul>
        </DetailSection>
      )}
      {task.requiredCommands && task.requiredCommands.length > 0 && (
        <DetailSection label="需执行命令">
          {task.requiredCommands.map((cmd, i) => (
            <div key={i} className="flex flex-wrap items-center gap-1">
              <code className="rounded bg-muted px-1 py-0.5 font-mono text-[10px]">
                {cmd.command}
              </code>
              {cmd.cwd && <span className="text-muted-foreground">@ {cmd.cwd}</span>}
              {cmd.description && <span className="text-muted-foreground">{cmd.description}</span>}
            </div>
          ))}
        </DetailSection>
      )}
      {task.requiredEvidence && task.requiredEvidence.length > 0 && (
        <DetailSection label="需提供证据">
          <ul className="list-disc space-y-0.5 pl-4">
            {task.requiredEvidence.map((evidence, i) => (
              <li key={i}>{evidence}</li>
            ))}
          </ul>
        </DetailSection>
      )}
    </div>
  )
}

function DetailSection({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="flex gap-2">
      <span className="w-14 shrink-0 text-muted-foreground">{label}</span>
      <div className="min-w-0 flex-1 space-y-0.5">{children}</div>
    </div>
  )
}

/** 编辑态的任务列表：改任务描述 / 换执行 agent / 勾依赖 / 改验收标准，可增删任务。 */
function PlanTaskEditList({
  drafts,
  agents,
  criteriaText,
  onCriteriaChange,
  onUpdate,
  onToggleDep,
  onRemove,
  onAdd,
}: {
  drafts: DispatchPlanItem[]
  agents: Array<{ id: string; name: string }>
  criteriaText: Record<string, string>
  onCriteriaChange: (taskId: string, text: string) => void
  onUpdate: (taskId: string, patch: Partial<DispatchPlanItem>) => void
  onToggleDep: (taskId: string, dep: string) => void
  onRemove: (taskId: string) => void
  onAdd: () => void
}) {
  return (
    <div className="space-y-1.5">
      {drafts.map((draft) => (
        <div
          key={draft.id}
          className="space-y-1.5 rounded-md border border-amber-300/60 bg-card px-2 py-2 text-xs dark:border-amber-900/40"
        >
          <div className="flex items-center gap-1.5">
            <span className="font-mono text-[10px] text-muted-foreground">{draft.id}</span>
            <select
              value={draft.agentId}
              onChange={(e) => onUpdate(draft.id, { agentId: e.target.value })}
              className="ml-auto rounded-md border bg-background px-1.5 py-1 text-xs"
              aria-label={`任务 ${draft.id} 的执行 agent`}
            >
              {agents.map((a) => (
                <option key={a.id} value={a.id}>
                  {a.name}
                </option>
              ))}
            </select>
            <Button
              size="sm"
              variant="ghost"
              onClick={() => onRemove(draft.id)}
              className="h-6 w-6 p-0 text-muted-foreground hover:bg-rose-50 hover:text-rose-600 dark:hover:bg-rose-950/30"
              aria-label={`删除任务 ${draft.id}`}
            >
              <Trash2 className="size-3.5" />
            </Button>
          </div>
          <Textarea
            value={draft.task}
            onChange={(e) => onUpdate(draft.id, { task: e.target.value })}
            placeholder="任务描述（支持 Markdown）"
            className="min-h-16 rounded-md text-xs"
          />
          {drafts.length > 1 && (
            <div className="flex flex-wrap items-center gap-1">
              <span className="text-[10px] text-muted-foreground">依赖</span>
              {drafts
                .filter((t) => t.id !== draft.id)
                .map((t) => {
                  const active = draft.dependsOn?.includes(t.id) ?? false
                  return (
                    <button
                      key={t.id}
                      type="button"
                      onClick={() => onToggleDep(draft.id, t.id)}
                      className={cn(
                        'rounded-full border px-1.5 py-0.5 font-mono text-[10px] transition-colors',
                        active
                          ? 'border-primary bg-primary/10 text-primary'
                          : 'border-border text-muted-foreground hover:bg-muted',
                      )}
                    >
                      {t.id}
                    </button>
                  )
                })}
            </div>
          )}
          <Textarea
            value={criteriaText[draft.id] ?? ''}
            onChange={(e) => onCriteriaChange(draft.id, e.target.value)}
            placeholder={'验收标准（每行一条，可留空）'}
            className="min-h-12 rounded-md text-[11px] text-muted-foreground"
          />
        </div>
      ))}
      <button
        type="button"
        onClick={onAdd}
        className="flex w-full items-center justify-center gap-1 rounded-md border border-dashed border-amber-300/70 py-1.5 text-[11px] text-muted-foreground transition-colors hover:bg-amber-100/40 dark:border-amber-900/40 dark:hover:bg-amber-950/20"
      >
        <Plus className="size-3.5" />
        添加任务
      </button>
    </div>
  )
}

function PlanTaskMarkdown({ clamp, children }: { clamp: boolean; children: string }) {
  return (
    <div className={cn('mt-0.5 text-muted-foreground', clamp && 'line-clamp-2')}>
      <ReactMarkdown
        remarkPlugins={[remarkGfm]}
        components={{
          p: ({ children: node }) => <span>{node}</span>,
          strong: ({ children: node }) => (
            <strong className="font-semibold text-foreground/90">{node}</strong>
          ),
          em: ({ children: node }) => <em className="italic">{node}</em>,
          code: ({ children: node }) => (
            <code className="rounded bg-muted px-1 py-0.5 font-mono text-[10px] text-foreground/80">
              {node}
            </code>
          ),
          a: ({ href, children: node }) => (
            <a
              href={href}
              target="_blank"
              rel="noopener noreferrer"
              className="text-primary underline-offset-2 hover:underline"
            >
              {node}
            </a>
          ),
          ul: ({ children: node }) => <span>{node}</span>,
          ol: ({ children: node }) => <span>{node}</span>,
          li: ({ children: node }) => <span>{node} </span>,
          br: () => <span> </span>,
        }}
      >
        {children}
      </ReactMarkdown>
    </div>
  )
}

function DispatchPlanReadOnlyCard({ dispatch }: { dispatch: DispatchState }) {
  const [expandedIds, setExpandedIds] = useState<Record<string, boolean>>({})
  const toggleExpand = (taskId: string) =>
    setExpandedIds((prev) => ({ ...prev, [taskId]: !prev[taskId] }))

  const total = dispatch.plan.length
  const displayStatuses = dispatch.plan.map((task) =>
    dispatch.reviewStatus === 'rejected' ? 'skipped' : (dispatch.taskStatus[task.id] ?? 'pending'),
  )
  const done = displayStatuses.filter(isTerminalStatus).length
  const allDone = total > 0 && done === total
  const hasFailed = displayStatuses.some((s) => s === 'failed' || s === 'aborted')
  const hasSkipped = displayStatuses.some((s) => s === 'skipped')
  const progress = total > 0 ? Math.round((done / total) * 100) : 0
  const rejected = dispatch.reviewStatus === 'rejected'

  return (
    <Card
      className={cn(
        'overflow-hidden border-primary/20 bg-primary/5 animate-in fade-in slide-in-from-top-2 duration-300',
        rejected && 'border-zinc-300 bg-muted/40 dark:border-zinc-800',
      )}
    >
      <div className="space-y-3 p-3">
        <div className="flex items-center gap-2">
          {rejected ? (
            <Ban className="size-4 text-zinc-500" />
          ) : (
            <Network className={cn('size-4 text-primary', !allDone && 'animate-pulse')} />
          )}
          <div className="text-sm font-medium">
            {rejected ? '计划已取消' : '任务拆解'} · {total} 项
          </div>
          <div className="ml-auto text-xs text-muted-foreground">
            {done} / {total}
          </div>
        </div>

        <div className="h-1 overflow-hidden rounded-full bg-primary/10">
          <div
            className={cn(
              'h-full rounded-full transition-all duration-500 ease-out',
              allDone && hasFailed && 'bg-red-500',
              allDone && !hasFailed && hasSkipped && 'bg-zinc-400',
              allDone && !hasFailed && !hasSkipped && 'bg-emerald-500',
              !allDone && !rejected && 'bg-primary',
              rejected && 'bg-zinc-400',
            )}
            style={{ width: `${progress}%` }}
          />
        </div>

        <PlanTaskList dispatch={dispatch} expandedIds={expandedIds} onToggleExpand={toggleExpand} />
      </div>
    </Card>
  )
}

function isTerminalStatus(status: DispatchTaskStatus): boolean {
  return status === 'complete' || status === 'failed' || status === 'aborted' || status === 'skipped'
}

function StatusIcon({ status }: { status: DispatchTaskStatus }) {
  const base = 'mt-0.5 size-3.5 shrink-0 transition-colors'
  if (status === 'pending') {
    return <Circle className={cn(base, 'text-muted-foreground/40')} />
  }
  if (status === 'running') {
    return <Loader2 className={cn(base, 'animate-spin text-amber-600')} />
  }
  if (status === 'complete') {
    return (
      <CheckCircle2
        className={cn(base, 'text-emerald-600 animate-in zoom-in-50 duration-300')}
      />
    )
  }
  if (status === 'aborted' || status === 'skipped') {
    return <Ban className={cn(base, 'text-zinc-500 animate-in zoom-in-50 duration-300')} />
  }
  return <XCircle className={cn(base, 'text-red-600 animate-in zoom-in-50 duration-300')} />
}

function TypingDots() {
  return (
    <span className="ml-0.5 inline-flex items-center gap-0.5">
      <span className="size-1 animate-bounce rounded-full bg-amber-500 [animation-delay:-0.3s]" />
      <span className="size-1 animate-bounce rounded-full bg-amber-500 [animation-delay:-0.15s]" />
      <span className="size-1 animate-bounce rounded-full bg-amber-500" />
    </span>
  )
}
