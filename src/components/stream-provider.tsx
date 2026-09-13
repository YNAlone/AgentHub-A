'use client'

import { useEffect } from 'react'

import type { StreamSnapshot } from '@/shared/stream-snapshot'
import type { StreamEvent } from '@/shared/types'
import { useAppStore } from '@/stores/app-store'

/**
 * StreamProvider — 全局唯一 SSE 连接，把 /api/stream 推过来的事件
 * 转发到 Zustand store。详见 specs/02-stream-events.md §SSE 编码。
 *
 * 在 layout.tsx 中挂载一次。React StrictMode 在 dev 下会双 mount，
 * 这里用 module 级 ref 防止重复连接。
 */

let activeSource: EventSource | null = null
let refCount = 0
let lastCursor = 0
let restoredUi = false

export function StreamProvider({ children }: { children: React.ReactNode }) {
  const applyEvent = useAppStore((s) => s.applyEvent)
  const setStreamConnected = useAppStore((s) => s.setStreamConnected)

  useEffect(() => {
    if (window.location.pathname === '/pair') return
    refCount++

    if (!activeSource) {
      lastCursor = 0
      activeSource = new EventSource('/api/stream')

      activeSource.onopen = () => {
        setStreamConnected(true)
      }

      activeSource.onerror = () => {
        // EventSource 会自动重连，无需我们做事
        setStreamConnected(false)
      }

      activeSource.onmessage = (e) => {
        let parsed: unknown
        try {
          parsed = JSON.parse(e.data)
        } catch {
          return
        }
        if (!parsed || typeof parsed !== 'object') return

        const obj = parsed as { type?: string }
        if (obj.type === 'snapshot') {
          const snapshot = parsed as StreamSnapshot
          if (!restoredUi && snapshot.uiState) {
            const ui = snapshot.uiState
            const ids = new Set(snapshot.conversations.map((c) => c.id))
            ui.openFilesByConv = Object.fromEntries(Object.entries(ui.openFilesByConv).filter(([id]) => ids.has(id)).map(([id, files]) => [id, files.filter((file) => !file.startsWith('diff:'))]))
            ui.activeTabByConv = Object.fromEntries(Object.entries(ui.activeTabByConv).filter(([id]) => ids.has(id)).map(([id, tab]) => [id, tab.startsWith('diff:') ? 'chat' : tab]))
            useAppStore.setState(ui)
          }
          restoredUi = true
          useAppStore.getState().applySnapshot(snapshot)
          lastCursor = snapshot.cursor
          setStreamConnected(true)
          return
        }
        const cursor = Number(e.lastEventId)
        if (cursor && cursor <= lastCursor) return
        if (cursor) lastCursor = cursor
        if (obj.type === 'connected') {
          setStreamConnected(true)
          return
        }

        applyEvent(parsed as StreamEvent)
      }
    }

    let saveTimer: ReturnType<typeof setTimeout> | undefined
    let previousUi = ''
    const unsubscribeUi = useAppStore.subscribe((state) => {
      if (!restoredUi) return
      const json = JSON.stringify({ activeConversationId: state.activeConversationId, previewArtifactId: state.previewArtifactId, fileExplorerOpen: state.fileExplorerOpen, openFilesByConv: state.openFilesByConv, activeTabByConv: state.activeTabByConv })
      if (json === previousUi) return
      previousUi = json
      clearTimeout(saveTimer)
      saveTimer = setTimeout(() => { void fetch('/api/personal/ui-state', { method: 'PUT', headers: { 'Content-Type': 'application/json' }, body: json, keepalive: true }).catch(() => {}) }, 300)
    })
    return () => {
      unsubscribeUi()
      clearTimeout(saveTimer)
      refCount--
      // 全部组件都卸载时关闭，避免 dev 模式 StrictMode 双 mount 反复断开
      if (refCount <= 0) {
        activeSource?.close()
        activeSource = null
        refCount = 0
        setStreamConnected(false)
      }
    }
  }, [applyEvent, setStreamConnected])

  return <>{children}</>
}
