'use client'

import { useState } from 'react'
import { ArrowRight, Layers3, ShieldCheck, Terminal } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'

/** Pairing stays local; the visual shell never exposes or retrieves signing material. */
export default function PairPage() {
  const [code, setCode] = useState('')
  const [error, setError] = useState('')
  const [busy, setBusy] = useState(false)
  return <main className="pair-page"><section className="pair-card">
    <div className="pair-brand"><Layers3 className="size-6" strokeWidth={1.5} />AgentHub<span className="ml-auto flex items-center gap-1 text-[10px] font-normal text-muted-foreground"><ShieldCheck className="size-3" />本机连接</span></div>
    <h1>连接你的工作空间</h1>
    <p>完成一次配对，便可在这个浏览器中访问本机的对话、项目与记忆。</p>
    <div className="pair-command"><Terminal className="size-4 text-muted-foreground" /><code>pnpm local:pair</code></div>
    <p className="mb-5">在运行 AgentHub 的项目目录执行上方命令，将显示的配对码填入下方。</p>
    <form onSubmit={async (event) => {
      event.preventDefault(); setBusy(true); setError('')
      try {
        const result = await fetch('/api/auth/pair', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ code }) })
        if (!result.ok) { setError('配对失败，请核对配对码，稍后重试'); return }
        window.location.assign('/')
      } catch { setError('无法连接本机服务') } finally { setBusy(false) }
    }}>
      <label htmlFor="pair-code" className="text-xs font-medium">配对码</label>
      <Input id="pair-code" aria-label="配对码" placeholder="输入本机配对码" autoComplete="off" type="password" value={code} onChange={(event) => setCode(event.target.value)} />
      <Button type="submit" disabled={busy || !code.trim()}>{busy ? '正在连接…' : '连接工作空间'}<ArrowRight className="size-4" /></Button>
      {error && <p role="alert" className="!text-destructive">{error}</p>}
    </form>
    <details><summary>桌面版与配对说明</summary><p>桌面版需将 AGENTHUB_DATA_DIR 指向应用数据目录。配对码仅用于本机连接，请勿分享。</p></details>
  </section></main>
}
