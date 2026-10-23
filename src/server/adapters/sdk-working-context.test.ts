import { beforeEach, expect, it, vi } from 'vitest'
import { sdkWorkingContext } from './sdk-working-context'
import { codexSessions } from './session-store'
import type { AdapterInput, AgentPlatformAdapter } from './types'
import type { ContextCheckpoint } from '@/server/context-checkpoints'
import type { StreamEvent } from '@/shared/types'

const usage = { inputTokens: 0, outputTokens: 0, cacheCreationTokens: 0, cacheReadTokens: 0, lastInputTokens: 0 }
function input(restored: ContextCheckpoint | null = null): AdapterInput {
  return { agentId: 'agent', conversationId: 'conversation', runId: 'run', prompt: 'finish task', systemPrompt: 'keep files',
    workspacePath: 'unused', apiKey: null, apiBaseUrl: null, modelId: 'test', toolNames: [],
    contextBudget: { contextWindow: 20000, maxInputTokens: 15000, maxOutputTokens: 4000, safetyTokens: 1000, plainFactor: 1, toolFactor: 1 },
    contextControl: { restored, save: vi.fn(), progress: vi.fn(), summarize: vi.fn(async () => '已完成搜索，来源 https://example.com；只需答复。') },
  }
}
async function consume(adapter: AgentPlatformAdapter, args: AdapterInput) {
  for await (const event of sdkWorkingContext(adapter, args, new AbortController().signal)) void event
}
beforeEach(() => codexSessions.clear())

it('invalidates the old SDK handle after compaction and rebuilds from the summary', async () => {
  codexSessions.set('conversation:agent', 'old-session')
  const args = input({ messages: [{ role: 'system', content: 'keep files' }, { role: 'user', content: 'finish task' },
    { role: 'assistant', content: '中'.repeat(20000) }], currentUserIndex: 1, turn: 1, providerRecoveries: 0, usage })
  const stream = vi.fn(async function* (next: AdapterInput): AsyncIterable<StreamEvent> {
    expect(codexSessions.get('conversation:agent')).toBeUndefined()
    expect(JSON.stringify(next.history)).toContain('working_context_summary')
    yield { type: 'run.usage', runId: 'run', conversationId: 'conversation', timestamp: 1, usage }
  })
  await consume({ name: 'codex', stream }, args)
  expect(stream).toHaveBeenCalledTimes(1)
})

it('does not replay a completed SDK turn when resuming its failed end-of-turn summary', async () => {
  const args = input({ messages: [{ role: 'user', content: 'finish task' }, { role: 'assistant', content: '中'.repeat(20000) }],
    currentUserIndex: 0, turn: 1, providerRecoveries: 0, usage, completed: true, progress: { state: 'paused', message: 'retry summary' } })
  const stream = vi.fn(async function* (): AsyncIterable<StreamEvent> { throw new Error('must not replay') })
  await consume({ name: 'codex', stream }, args)
  expect(stream).not.toHaveBeenCalled()
  expect(args.contextControl!.summarize).toHaveBeenCalled()
})

it('pauses unknown tool side effects without entering the SDK', async () => {
  const args = input({ messages: [], currentUserIndex: 0, turn: 1, providerRecoveries: 0, usage, pendingTool: 'write-file' })
  const stream = vi.fn(async function* (): AsyncIterable<StreamEvent> { throw new Error('must not replay') })
  await expect(consume({ name: 'codex', stream }, args)).rejects.toThrow('副作用')
  expect(stream).not.toHaveBeenCalled()
})
