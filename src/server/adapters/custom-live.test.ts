import { expect, it } from 'vitest'
import OpenAI from 'openai'
import { CustomAgentAdapter } from './custom-agent-adapter'
import type { AdapterInput } from './types'
import { createContextBudget } from '@/server/context-budget'

// Replay completed search results against a real model, without issuing new paid web searches.
it.skipIf(process.env.AGENTHUB_LIVE_CUSTOM !== '1')('answers after five large search results and compacts with the same real provider', async () => {
  const model = process.env.AGENTHUB_LIVE_MODEL ?? 'deepseek-v4-flash'
  const apiKey = process.env.DEEPSEEK_API_KEY!
  const baseURL = 'https://api.deepseek.com/v1'
  const client = new OpenAI({ apiKey, baseURL, maxRetries: 0 })
  const history: NonNullable<AdapterInput['history']> = []
  for (let i = 0; i < 5; i++) {
    history.push({ role: 'assistant', content: null, tool_calls: [{ id: `done-${i}`, type: 'function', function: { name: 'web_search', arguments: '{}' } }] })
    history.push({ role: 'tool', tool_call_id: `done-${i}`, content: JSON.stringify({ url: `https://example.com/source-${i}`, text: '已完成的搜索证据，保存来源用于后续答复。'.repeat(600) }) })
  }
  let summaries = 0
  const input: AdapterInput = { agentId: 'smoke', conversationId: 'smoke', runId: 'smoke', prompt: '这些是测试数据。不要调用任何工具，只确认收到五份检索结果，并列出来源 URL。',
    workspacePath: process.env.AGENTHUB_DATA_DIR!, systemPrompt: 'Reply briefly. Do not use tools.', apiKey, apiBaseUrl: baseURL, modelId: model,
    customConfig: { modelProvider: 'deepseek' }, toolNames: [], history,
    contextControl: { restored: null, save: () => {}, progress: () => {}, summaryChunkTokens: 12000,
      summarize: async (text, signal) => {
        summaries++
        const response = await client.chat.completions.create({ model, max_tokens: 1600, messages: [{ role: 'system', content: 'Summarize in under 60 words, retaining every source URL.' }, { role: 'user', content: text }] }, { signal })
        if (response.choices[0]?.finish_reason !== 'stop') throw new Error('Incomplete live summary')
        return response.choices[0].message.content ?? ''
      },
    },
  }
  for (const contextWindow of [1_000_000, 32_000]) {
    input.contextBudget = createContextBudget({ contextWindow, outputReserve: 8192, maxOutputTokens: 8192 })
    let answer = ''
    for await (const event of new CustomAgentAdapter().stream(input, AbortSignal.timeout(180_000))) {
      if (event.type === 'part.delta' && event.delta.type === 'text.append') answer += event.delta.text
      if (event.type === 'tool.call') throw new Error('Completed search must not run again')
    }
    expect(answer).toContain('https://example.com/source-')
    if (contextWindow === 1_000_000) expect(summaries).toBe(0)
  }
  expect(summaries).toBeGreaterThan(0)
}, 240_000)
