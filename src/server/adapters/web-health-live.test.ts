import { expect, it } from 'vitest'
import { CustomAgentAdapter } from './custom-agent-adapter'
import { recheckHistoricalWebFailure, webToolRuntimeGuidance } from '@/server/web-tool-health'
import type { AdapterInput } from './types'

// Opt-in live acceptance uses an isolated database and never creates production conversations.
it.skipIf(process.env.AGENTHUB_LIVE_WEB_HEALTH !== '1')('searches with the real model despite a historical missing-key error', async () => {
  const signal = AbortSignal.timeout(120_000)
  const history: NonNullable<AdapterInput['history']> = [
    { role: 'user', content: '请联网查 Tavily 是什么。' },
    { role: 'assistant', content: null, tool_calls: [{ id: 'old-failure', type: 'function', function: { name: 'web_search', arguments: '{"query":"Tavily"}' } }] },
    { role: 'tool', tool_call_id: 'old-failure', content: '{"error":"联网工具尚未配置：Tavily API Key"}' },
    { role: 'assistant', content: 'Tavily 未配置，请配置好再来。' },
  ]
  const fresh = await recheckHistoricalWebFailure(history, signal)
  expect(fresh).toContain('"available":true')
  const input: AdapterInput = { agentId: 'web-health-live', conversationId: 'web-health-live', runId: 'web-health-live',
    workspacePath: process.env.AGENTHUB_DATA_DIR!, apiKey: process.env.DEEPSEEK_API_KEY!, apiBaseUrl: 'https://api.deepseek.com/v1',
    modelId: 'deepseek-v4-flash', customConfig: { modelProvider: 'deepseek' }, toolNames: ['ask_user'], history,
    systemPrompt: 'Use tools for current information. Reply in one sentence with a source URL.\n' + webToolRuntimeGuidance() + fresh,
    prompt: '继续完成刚才的任务。' }
  let searched = false
  let answer = ''
  for await (const event of new CustomAgentAdapter().stream(input, signal)) {
    if (event.type === 'tool.call' && event.toolName === 'ask_user') throw new Error('Model repeated a stale configuration question')
    if (event.type === 'tool.call' && event.toolName === 'web_search') searched = true
    if (event.type === 'part.delta' && event.delta.type === 'text.append') answer += event.delta.text
  }
  expect(searched).toBe(true)
  expect(answer).toContain('http')
}, 130_000)
