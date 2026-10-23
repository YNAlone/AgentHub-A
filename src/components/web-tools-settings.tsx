'use client'

import { useEffect, useState } from 'react'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'

/** Show configuration flags only; replacing a key never reveals the stored credential. */
export function WebToolsSettings() {
  const [status, setStatus] = useState<{ configured: boolean; source: string; stored: boolean } | null>(null)
  const [key, setKey] = useState('')
  const [busy, setBusy] = useState(false)
  const [message, setMessage] = useState('')
  useEffect(() => {
    let active = true
    fetch('/api/settings/web-tools').then(async (r) => {
      if (!r.ok) throw new Error('读取联网配置失败')
      const value = await r.json()
      if (active) setStatus(value)
    }).catch(() => { if (active) setMessage('读取联网配置失败，请重试。') })
    return () => { active = false }
  }, [])
  const save = async (apiKey: string | null) => {
    setBusy(true)
    setMessage('')
    try {
      const response = await fetch('/api/settings/web-tools', { method: 'PATCH', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ apiKey }) })
      if (!response.ok) throw new Error('保存失败')
      setStatus(await response.json())
      setKey('')
      setMessage('已保存。配置状态不代表凭据已通过服务商验证。')
    } catch { setMessage('保存失败，请重试。') } finally { setBusy(false) }
  }
  return <section className="space-y-4">
    <div><h3 className="font-medium">联网搜索与网页读取</h3><p className="mt-2 text-sm text-muted-foreground">所有 Agent 共用 Tavily 搜索和正文提取。查询词与网页地址会发送给 Tavily，可能产生服务商费用；不支持登录页面或内网地址。</p></div>
    <p className="text-sm" role="status">{status ? status.configured ? '已配置 · ' + (status.source === 'settings' ? '应用设置' : '服务器环境变量') : '尚未配置' : '加载配置中…'}</p>
    <label className="block space-y-2"><span className="text-sm">Tavily API Key</span><Input type="password" autoComplete="new-password" value={key} onChange={(e) => setKey(e.target.value)} placeholder="输入新 Key；留空保留已有配置" /></label>
    <div className="flex gap-2"><Button disabled={busy || !status} onClick={() => void save(key)}>保存联网配置</Button><Button variant="outline" disabled={busy || !status?.stored} onClick={() => void save(null)}>清除已保存 Key</Button></div>
    <p className="text-xs text-muted-foreground">也可通过服务器 TAVILY_API_KEY 配置。清除已保存 Key 后，仍会使用环境变量中的 Key。</p>
    {message && <p className="text-sm" role="status">{message}</p>}
  </section>
}
