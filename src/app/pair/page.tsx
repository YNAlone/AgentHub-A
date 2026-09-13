'use client'

import { useState } from 'react'

/** Pairing never fetches a secret from an unauthenticated HTTP endpoint. */
export default function PairPage() {
  const [code, setCode] = useState('')
  const [error, setError] = useState('')
  return <main className="mx-auto mt-24 max-w-lg space-y-5 p-6">
    <h1 className="text-2xl font-semibold">连接本机 AgentHub</h1>
    <p>在运行 AgentHub 的本机项目目录执行 <code>pnpm local:pair</code>，输入显示的配对码。桌面版需将 AGENTHUB_DATA_DIR 指向应用数据目录。配对码仅用于本机连接，请勿分享。</p>
    <form className="space-y-4" onSubmit={async (event) => {
      event.preventDefault()
      try {
        const result = await fetch('/api/auth/pair', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ code }) })
        if (!result.ok) { setError('配对失败，请核对配对码，稍后重试'); return }
        window.location.assign('/')
      } catch { setError('无法连接本机服务') }
    }}>
      <input aria-label="配对码" autoComplete="off" type="password" className="w-full rounded border p-2" value={code} onChange={(event) => setCode(event.target.value)} />
      <button className="rounded bg-primary px-4 py-2 text-primary-foreground" type="submit">连接</button>
      {error && <p role="alert">{error}</p>}
    </form>
  </main>
}
