import { afterEach, beforeEach, expect, it, vi } from 'vitest'

const model = vi.hoisted(() => ({ create: vi.fn() }))
vi.mock('openai', () => ({ default: class { chat = { completions: { create: model.create } } } }))

import { CustomAgentAdapter } from './custom-agent-adapter'
import type { AdapterInput } from './types'
import { estimateRequestTokens, toApiTool } from '@/server/context-budget'
import { toolRegistry } from '@/server/tools/registry'
import { withWebTools } from '@/shared/web-tools'
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
  const tools = toolRegistry.resolve(withWebTools(baseInput.toolNames)).map(toApiTool)
  const firstRequest = estimateRequestTokens([
    { role: 'system', content: baseInput.systemPrompt },
    { role: 'user', content: baseInput.prompt },
  ], tools)
  const onContextUsage = vi.fn()
  const summarize = vi.fn(async () => '已读取文件 x；原文保存在工具结果中。')
  const input = { ...baseInput, onContextUsage, contextControl: { restored: null, save: vi.fn(), progress: vi.fn(), summarize },
    contextBudget: { contextWindow: 100_000, maxOutputTokens: 1024, maxInputTokens: firstRequest * 4 + 1000, safetyTokens: 8192, plainFactor: 1, toolFactor: 1 } }
  model.create.mockResolvedValueOnce((async function* () {
    yield { choices: [{ delta: { tool_calls: [{ index: 0, id: 'call-1', function: { name: 'fs_read', arguments: '{"path":"x"}' } }] }, finish_reason: 'tool_calls' }] }
    yield { choices: [], usage: { prompt_tokens: 100, completion_tokens: 20 } }
  })())

  model.create.mockResolvedValueOnce((async function* () {
    yield { choices: [{ delta: { content: '完成' }, finish_reason: 'stop' }] }
  })())
  const events = await consume(input)

  expect(model.create).toHaveBeenCalledTimes(2)
  expect(summarize).toHaveBeenCalled()
  expect(JSON.stringify(model.create.mock.calls[1][0].messages)).toContain('working_context_summary')
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
  // Even legacy empty tool lists must advertise both defaults to the actual model request.
  expect(model.create.mock.calls[0][0].tools).toEqual(expect.arrayContaining([
    expect.objectContaining({ function: expect.objectContaining({ name: 'web_search' }) }),
    expect.objectContaining({ function: expect.objectContaining({ name: 'web_fetch' }) }),
  ]))
})

it('recovers a real provider overflow by compacting and retrying the same request', async () => {
  const summarize = vi.fn(async () => '历史已检索，继续回答。')
  model.create.mockRejectedValueOnce({ status: 400, code: 'context_length_exceeded' })
  model.create.mockResolvedValueOnce((async function* () {
    yield { choices: [{ delta: { content: 'recovered' }, finish_reason: 'stop' }] }
  })())
  const result = await consume({ ...baseInput, history: [{ role: 'assistant', content: 'historical evidence '.repeat(150) }],
    contextBudget: { contextWindow: 100000, maxInputTokens: 80000, maxOutputTokens: 8192, safetyTokens: 2000, plainFactor: 1, toolFactor: 1 },
    contextControl: { restored: null, save: vi.fn(), progress: vi.fn(), summarize, summaryChunkTokens: 12000 } })
  expect(summarize).toHaveBeenCalledTimes(1)
  expect(model.create).toHaveBeenCalledTimes(2)
  expect(result.some((event) => event.type === 'part.delta' && event.delta.type === 'text.append' && event.delta.text === 'recovered')).toBe(true)
})

it('does not classify authentication failures as context overflow', async () => {
  const summarize = vi.fn(async () => 'must not run')
  model.create.mockRejectedValueOnce(Object.assign(new Error('invalid API key'), { status: 401 }))
  await expect(consume({ ...baseInput, contextControl: { restored: null, save: vi.fn(), progress: vi.fn(), summarize } })).rejects.toThrow('invalid API key')
  expect(summarize).not.toHaveBeenCalled()
  expect(model.create).toHaveBeenCalledTimes(1)
})
