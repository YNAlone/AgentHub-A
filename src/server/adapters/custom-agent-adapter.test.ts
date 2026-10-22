import { afterEach, beforeEach, expect, it, vi } from 'vitest'

const model = vi.hoisted(() => ({ create: vi.fn() }))
vi.mock('openai', () => ({ default: class { chat = { completions: { create: model.create } } } }))

import { CustomAgentAdapter } from './custom-agent-adapter'
import type { AdapterInput } from './types'
import { estimateRequestTokens, toApiTool } from '@/server/context-budget'
import { toolRegistry } from '@/server/tools/registry'
import type { StreamEvent } from '@/shared/types'

const baseInput: AdapterInput = {
  agentId: 'agent', conversationId: 'conversation', runId: 'run', prompt: 'read it',
  workspacePath: 'F:/project', systemPrompt: 'You can read files.', apiKey: 'test-only',
  apiBaseUrl: 'https://example.invalid', modelId: 'test-model', toolNames: ['fs_read'],
  customConfig: { modelProvider: 'openai-compatible' },
}

async function consume(input: AdapterInput) {
  const events: StreamEvent[] = []
  for await (const event of new CustomAgentAdapter().stream(input, new AbortController().signal)) events.push(event)
  return events
}

beforeEach(() => model.create.mockReset())
afterEach(() => vi.restoreAllMocks())

it('checks the next complete request after a large tool result without replaying the tool', async () => {
  const execute = vi.spyOn(toolRegistry, 'execute').mockResolvedValue({ ok: true, value: { text: '中'.repeat(10_000) } })
  const tools = toolRegistry.resolve(baseInput.toolNames).map(toApiTool)
  const firstRequest = estimateRequestTokens([
    { role: 'system', content: baseInput.systemPrompt },
    { role: 'user', content: baseInput.prompt },
  ], tools)
  const onContextUsage = vi.fn()
  const input = { ...baseInput, onContextUsage, contextBudget: { contextWindow: 100_000, maxOutputTokens: 1024, maxInputTokens: firstRequest + 1000, safetyTokens: 8192, plainFactor: 1, toolFactor: 1 } }
  model.create.mockResolvedValueOnce((async function* () {
    yield { choices: [{ delta: { tool_calls: [{ index: 0, id: 'call-1', function: { name: 'fs_read', arguments: '{"path":"x"}' } }] }, finish_reason: 'tool_calls' }] }
    yield { choices: [], usage: { prompt_tokens: 100, completion_tokens: 20 } }
  })())

  const events: StreamEvent[] = []
  await expect((async () => {
    for await (const event of new CustomAgentAdapter().stream(input, new AbortController().signal)) events.push(event)
  })()).rejects.toThrow('上下文超出输入预算')

  expect(model.create).toHaveBeenCalledTimes(1)
  expect(model.create.mock.calls[0][0].max_tokens).toBe(1024)
  expect(execute).toHaveBeenCalledTimes(1)
  expect(onContextUsage).toHaveBeenCalledWith(firstRequest, 100, false)
  expect(events.some((event) => event.type === 'tool.result')).toBe(true)
  expect(events.some((event) => event.type === 'run.usage')).toBe(true)
})

it('reports length-limited model output as incomplete', async () => {
  model.create.mockResolvedValueOnce((async function* () {
    yield { choices: [{ delta: { content: 'partial' }, finish_reason: 'length' }] }
  })())
  await expect(consume({ ...baseInput, toolNames: [], contextBudget: { contextWindow: 100_000, maxOutputTokens: 1024, maxInputTokens: 10_000, safetyTokens: 8192, plainFactor: 1, toolFactor: 1 } })).rejects.toThrow('回答不完整')
  expect(model.create.mock.calls[0][0].max_tokens).toBe(1024)
})
