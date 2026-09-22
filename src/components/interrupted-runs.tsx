'use client'

import { useState } from 'react'
import { useAppStore } from '@/stores/app-store'
import { Button } from '@/components/ui/button'

/** Continuation is an explicit request; restarting or reconnecting never clicks this action. */
export function InterruptedRuns({ conversationId }: { conversationId: string }) {
  const runs = useAppStore((s) => s.runsByConv[conversationId])
  const [busy, setBusy] = useState<string | null>(null)
  const [error, setError] = useState('')
  const interrupted = Object.values(runs ?? {}).filter((run) => run.status === 'interrupted' && !run.parentRunId)
  if (!interrupted.length) return null
  const resume = async (id: string) => {
    setBusy(id); setError('')
    try {
      const response = await fetch(`/api/runs/${encodeURIComponent(id)}/continue`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ confirm: true }) })
      if (!response.ok) throw new Error((await response.json()).error ?? '继续失败')
      useAppStore.setState((s) => { const run = s.runsByConv[conversationId]?.[id]; if (run) run.status = 'aborted' })
    } catch (e) { setError(e instanceof Error ? e.message : '继续失败') } finally { setBusy(null) }
  }
  return <div className="border-b bg-amber-50 p-3 text-sm text-amber-950 dark:bg-amber-950 dark:text-amber-100">
    <p>服务重启前有 {interrupted.length} 个任务未完成。点击继续后，Agent 会先核对已完成步骤；旧审批已失效。</p>
    <div className="mt-2 flex flex-wrap gap-2">{interrupted.map((run) => <Button key={run.id} size="sm" variant="outline" disabled={busy !== null} onClick={() => void resume(run.id)}>{busy === run.id ? '正在恢复…' : `继续 ${run.agentId}`}</Button>)}</div>
    {error && <p role="alert">{error}</p>}
  </div>
}
