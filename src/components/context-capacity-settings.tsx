'use client'

import { useEffect, useState } from 'react'
import { Button } from './ui/button'
import { Input } from './ui/input'

type Capacity = { adapter: string; provider: string | null; endpoint: string; model: string; contextWindow: number; outputReserve: number }
type Profile = Capacity & { agentId: string; name: string }
const identity = (row: Capacity) => JSON.stringify([row.adapter, row.provider, row.endpoint, row.model])

/** Edit the effective endpoint/model identity rather than silently changing an Agent's request routing. */
export function ContextCapacitySettings({ triggerRatio = 0.6, outputLimitTokens }: { triggerRatio?: number; outputLimitTokens?: number | null }) {
  const [profiles, setProfiles] = useState<Profile[]>([])
  const [overrides, setOverrides] = useState<Capacity[]>([])
  const [selected, setSelected] = useState('')
  const [window, setWindow] = useState(1_000_000)
  const [output, setOutput] = useState(8192)
  const [busy, setBusy] = useState(false)
  const [message, setMessage] = useState('')
  useEffect(() => {
    const controller = new AbortController()
    fetch('/api/settings/context-capacity', { signal: controller.signal }).then(async (response) => {
      if (!response.ok) throw new Error('读取模型容量失败')
      const data = await response.json()
      setProfiles(data.profiles.filter((profile: Profile) => !!profile.model))
      setOverrides(data.overrides)
    }).catch(() => { if (!controller.signal.aborted) setMessage('读取模型容量失败，请刷新重试。') })
    return () => controller.abort()
  }, [])
  const profile = profiles.find((row) => row.agentId === selected)
  const usable = Math.max(0, window - Math.min(output, outputLimitTokens ?? output) - Math.ceil(window * 0.02))
  const select = (agentId: string) => {
    setSelected(agentId); setMessage('')
    const row = profiles.find((item) => item.agentId === agentId)
    if (row) {
      const value = overrides.find((item) => identity(item) === identity(row)) ?? row
      setWindow(value.contextWindow); setOutput(value.outputReserve)
    }
  }
  const save = async () => {
    if (!profile) return
    setBusy(true); setMessage('')
    const { adapter, provider, endpoint, model } = profile
    const next = [...overrides.filter((row) => identity(row) !== identity(profile)), { adapter, provider, endpoint, model, contextWindow: window, outputReserve: output }]
    try {
      const response = await fetch('/api/settings/context-capacity', { method: 'PATCH', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(next) })
      const data = await response.json()
      if (!response.ok) throw new Error(data.error ?? '保存失败')
      setOverrides(data.overrides); setMessage('模型容量已保存，新任务和暂停任务恢复时生效。')
    } catch (error) { setMessage(error instanceof Error ? error.message : '保存失败') } finally { setBusy(false) }
  }
  return <section className="space-y-3 rounded-lg border p-4" aria-label="模型上下文容量">
    <h3 className="font-medium">模型上下文容量</h3>
    <p className="text-sm text-muted-foreground">配置只对所选适配器、实际请求地址和模型组合生效。请填写服务商支持的总窗口；不会更改模型请求地址。</p>
    <label className="block text-sm">Agent<select className="ml-3 rounded border p-2" aria-label="容量配置 Agent" value={selected} onChange={(e) => select(e.target.value)} disabled={busy}><option value="">选择 Agent</option>{profiles.map((row) => <option key={row.agentId} value={row.agentId}>{row.name} · {row.model}</option>)}</select></label>
    {profile && <><p className="break-all text-xs text-muted-foreground">{profile.adapter} · {profile.endpoint || '供应商默认地址'} · {profile.model}</p>
      <label className="block text-sm">模型总窗口（tokens）<Input aria-label="模型总窗口" type="number" min={16000} max={10000000} value={window} disabled={busy} onChange={(e) => setWindow(Number(e.target.value))} /></label>
      <label className="block text-sm">默认输出预留（tokens）<Input aria-label="默认输出预留" type="number" min={1024} max={393216} value={output} disabled={busy} onChange={(e) => setOutput(Number(e.target.value))} /></label>
      <p className="text-xs text-muted-foreground">单独设置的输出上限仍优先，但不会超过本配置的输出预留。旧版输入上限不再阻止任务。</p>
      <p className="text-xs text-muted-foreground">可用输入约 {usable.toLocaleString()} tokens；达到 {Math.floor(usable * triggerRatio).toLocaleString()} 时自动压缩，目标低于 {Math.floor(usable * 0.35).toLocaleString()}。</p>
      <Button type="button" disabled={busy} onClick={() => void save()}>保存模型容量</Button></>}
    {message && <p role="status" className="text-sm">{message}</p>}
  </section>
}
