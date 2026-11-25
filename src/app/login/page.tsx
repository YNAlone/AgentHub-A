'use client'

import { useRouter, useSearchParams } from 'next/navigation'
import { Suspense, useState } from 'react'

import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'

function LoginForm() {
  const router = useRouter()
  const searchParams = useSearchParams()
  const inviteCode = searchParams.get('invite') ?? ''

  const [mode, setMode] = useState<'login' | 'register'>('login')
  const [email, setEmail] = useState('')
  const [displayName, setDisplayName] = useState('')
  const [teamName, setTeamName] = useState('')
  const [password, setPassword] = useState('')
  const [error, setError] = useState<string | null>(null)
  const [loading, setLoading] = useState(false)

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault()
    if (loading) return
    setError(null)
    setLoading(true)

    try {
      const endpoint = mode === 'login' ? '/api/auth/login' : '/api/auth/register'
      const body =
        mode === 'login'
          ? { email, password, inviteCode: inviteCode || undefined }
          : {
              email,
              displayName,
              password,
              teamName: teamName || undefined,
              inviteCode: inviteCode || undefined,
            }

      const res = await fetch(endpoint, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
      })
      const data = (await res.json().catch(() => ({}))) as { error?: string }
      if (!res.ok) {
        setError(data.error ?? '操作失败，请检查输入信息')
        return
      }
      router.replace('/')
      router.refresh()
    } catch (err) {
      setError(err instanceof Error ? err.message : '网络异常')
    } finally {
      setLoading(false)
    }
  }

  return (
    <div className="flex min-h-screen items-center justify-center bg-background p-4">
      <div className="w-full max-w-md rounded-xl border bg-card p-6 shadow-sm">
        <div className="mb-6 space-y-1">
          <h1 className="text-xl font-semibold tracking-tight">
            {mode === 'login' ? '登录 AgentHub 团队空间' : '注册并创建团队空间'}
          </h1>
          <p className="text-sm text-muted-foreground">
            {inviteCode
              ? `检测到团队邀请码（${inviteCode}），完成后将自动加入团队`
              : 'M+N 研发团队人机协同工作台'}
          </p>
        </div>

        <form onSubmit={handleSubmit} className="space-y-4">
          <div className="space-y-1.5">
            <label className="text-sm font-medium" htmlFor="auth-email">
              邮箱
            </label>
            <Input
              id="auth-email"
              type="email"
              required
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              placeholder="name@company.com"
            />
          </div>

          {mode === 'register' && (
            <>
              <div className="space-y-1.5">
                <label className="text-sm font-medium" htmlFor="auth-name">
                  昵称（群聊中展示给队友和 Agent）
                </label>
                <Input
                  id="auth-name"
                  required
                  value={displayName}
                  onChange={(e) => setDisplayName(e.target.value)}
                  placeholder="例如：PM 张三"
                />
              </div>
              {!inviteCode && (
                <div className="space-y-1.5">
                  <label className="text-sm font-medium" htmlFor="auth-team">
                    团队名称（可选）
                  </label>
                  <Input
                    id="auth-team"
                    value={teamName}
                    onChange={(e) => setTeamName(e.target.value)}
                    placeholder="例如：核心研发小队"
                  />
                </div>
              )}
            </>
          )}

          <div className="space-y-1.5">
            <label className="text-sm font-medium" htmlFor="auth-password">
              密码
            </label>
            <Input
              id="auth-password"
              type="password"
              required
              minLength={8}
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              placeholder="至少 8 位"
            />
          </div>

          {error && <p className="text-sm text-destructive">{error}</p>}

          <Button type="submit" className="w-full" disabled={loading}>
            {loading ? '处理中…' : mode === 'login' ? '登录' : '注册并进入'}
          </Button>
        </form>

        <div className="mt-4 text-center text-sm text-muted-foreground">
          {mode === 'login' ? (
            <button
              type="button"
              className="underline hover:text-foreground"
              onClick={() => {
                setMode('register')
                setError(null)
              }}
            >
              没有账号？立即注册
            </button>
          ) : (
            <button
              type="button"
              className="underline hover:text-foreground"
              onClick={() => {
                setMode('login')
                setError(null)
              }}
            >
              已有账号？返回登录
            </button>
          )}
        </div>
      </div>
    </div>
  )
}

export default function LoginPage() {
  return (
    <Suspense fallback={<div className="flex min-h-screen items-center justify-center text-sm text-muted-foreground">加载中…</div>}>
      <LoginForm />
    </Suspense>
  )
}
