'use client'

import { useState } from 'react'
import { useAppStore } from '@/stores/app-store'
import { Button } from '@/components/ui/button'

/** Continuation is an explicit request; restarting or reconnecting never clicks this action. */
export function InterruptedRuns({ conversationId }: { conversationId: string }) {
  const runs = useAppStore((s) => s.runsByConv[conversationId])
  const [busy, setBusy] = useState<string | null>(null)
  const [error, setError] = useState('')
  const interrupted = Object.values(runs ?? {}).filter((run) => ['interrupted', 'paused', 'compacting'].includes(run.status) && !run.parentRunId)
  if (!interrupted.length) return null
  const resume = async (id: string) => {
    setBusy(id); setError('')
    try {
      const response = await fetch(`/api/runs/${encodeURIComponent(id)}/resume`, { method: 'POST' })
      if (!response.ok) throw new Error((await response.json()).error ?? '继续失败')
      // SSE owns state transitions; an immediate second pause must not be overwritten by this HTTP response.
    } catch (e) { setError(e instanceof Error ? e.message : '继续失败') } finally { setBusy(null) }
  }
  const cancel = async (id: string) => {
    setBusy(id); setError('')
    try {
      const response = await fetch(`/api/runs/${encodeURIComponent(id)}/abort`, { method: 'POST' })
      if (!response.ok) throw new Error('取消失败，请刷新任务状态后重试。')
      useAppStore.setState((s) => { const run = s.runsByConv[conversationId]?.[id]; if (run) run.status = 'aborted' })
    } catch (e) { setError(e instanceof Error ? e.message : '取消失败') } finally { setBusy(null) }
  }
  return <div className="border-b bg-amber-50 p-3 text-sm text-amber-950 dark:bg-amber-950 dark:text-amber-100">
    <p>上下文整理与任务恢复：原始历史和已完成工具结果始终保留。</p>
    <div className="mt-2 space-y-2">{interrupted.map((run) => <div key={run.id}><p role="status">{run.error ?? '已暂停，现场已保存'}</p><Button size="sm" variant="outline" disabled={busy !== null || run.status === 'compacting'} onClick={() => void resume(run.id)}>{run.status === 'compacting' ? '正在压缩…' : busy === run.id ? '正在处理…' : '重试并继续'}</Button><Button size="sm" variant="ghost" disabled={busy !== null} onClick={() => void cancel(run.id)}>取消任务</Button></div>)}</div>
    {error && <p role="alert">{error}</p>}
  </div>
}
