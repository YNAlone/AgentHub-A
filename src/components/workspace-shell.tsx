'use client'

import { useCallback, useEffect, useState } from 'react'
import { BarChart3, Bot, ChevronRight, Layers, Menu, ShieldCheck } from 'lucide-react'
import { Sidebar } from './sidebar'
import { ChatPanel } from './chat-panel'
import { AgentLibrary } from './agent-library'
import { ArtifactLibrary } from './artifact-library'
import { UsageDashboard } from './usage-dashboard'
import { ArtifactPreviewPanel } from './artifact-preview-panel'
import { FileExplorerPanel } from './file-explorer-panel'
import { SelectionPopover } from './selection-popover'
import { MessageHighlightLayer } from './message-highlight-layer'
import { Button } from './ui/button'
import { useSearchStore } from '@/stores/search-store'
import { useAppStore } from '@/stores/app-store'

type View = 'conversations' | 'agents' | 'artifacts' | 'analytics'
const PAGES = {
  agents: { title: 'Agents', description: '为不同的工作，找到合适的协作者。管理模型、能力与工作方式。', icon: Bot },
  artifacts: { title: '产物库', description: '对话中产生的代码、文档与设计，都收在这里。', icon: Layers },
  analytics: { title: '用量分析', description: '了解每一次协作的消耗，合理安排模型与任务。', icon: BarChart3 },
}

/** Navigation changes the surface while conversation state and previews stay owned by the store. */
export function WorkspaceShell() {
  const [view, setView] = useState<View>('conversations')
  const navigate = useCallback((next: View) => {
    setView(next)
    useAppStore.getState().setMobileSidebarOpen(false)
  }, [])
  // Search can target the current conversation while a library occupies the main region.
  useEffect(() => useSearchStore.subscribe((state) => {
    if (state.pendingJumpConversationId) navigate('conversations')
  }), [navigate])
  const page = view === 'conversations' ? null : PAGES[view]
  return <div className="workspace-shell flex h-dvh overflow-hidden bg-background">
    <Sidebar mode={view} onModeChange={navigate} />
    {page ? <main className="workspace-page">
      <div className="workspace-topbar"><Button size="icon-sm" variant="ghost" className="md:hidden" aria-label="打开导航" onClick={() => useAppStore.getState().setMobileSidebarOpen(true)}><Menu /></Button><span>工作空间</span><ChevronRight className="size-3" /><span>{page.title}</span><span className="ml-auto flex items-center gap-1.5 text-[11px]"><ShieldCheck className="size-3" />仅本机访问</span></div>
      <div className="workspace-page-body"><header className="workspace-page-heading"><p>工作空间</p><h1>{page.title}</h1><div>{page.description}</div></header>
        <div className="workspace-library" data-view={view}>
          {view === 'agents' && <AgentLibrary />}
          {view === 'artifacts' && <ArtifactLibrary />}
          {view === 'analytics' && <UsageDashboard onOpenConversation={() => navigate('conversations')} />}
        </div>
      </div>
    </main> : <ChatPanel />}
    {view === 'conversations' && <FileExplorerPanel />}
    <ArtifactPreviewPanel />
    <SelectionPopover /><MessageHighlightLayer />
  </div>
}
