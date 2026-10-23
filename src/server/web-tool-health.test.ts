import { afterEach, expect, it, vi } from 'vitest'
import { saveWebToolKey } from './web-tool-settings'
import { probeWebTool, questionsClaimWebUnavailable, recheckHistoricalWebFailure, webToolRuntimeGuidance } from './web-tool-health'
import { askUserTool } from './tools/ask-user'
import { pendingQuestions } from './pending-questions'
vi.mock('node:dns/promises', () => ({ lookup: vi.fn().mockResolvedValue([{ address: '93.184.216.34' }]) }))

const ctx = { conversationId: 'health-c', agentId: 'health-a', runId: 'health-r', workspacePath: '.', abortSignal: new AbortController().signal }
afterEach(() => { saveWebToolKey(null); vi.restoreAllMocks(); vi.unstubAllGlobals(); vi.unstubAllEnvs() })

it('rechecks credentials and provider after an old missing-key result', async () => {
  vi.stubEnv('TAVILY_API_KEY', '')
  saveWebToolKey(null)
  expect(await probeWebTool('web_search', ctx.abortSignal)).toMatchObject({ available: false, reason: 'missing_configuration' })
  saveWebToolKey('health-secret')
  const fetcher = vi.fn().mockResolvedValue(Response.json({ results: [] }))
  vi.stubGlobal('fetch', fetcher)
  expect(await probeWebTool('web_search', ctx.abortSignal)).toMatchObject({ available: true })
  expect(fetcher).toHaveBeenCalledOnce()
  expect(webToolRuntimeGuidance()).toContain('"configured":true')
  expect(webToolRuntimeGuidance()).not.toContain('health-secret')
})

it('blocks the actual stale availability question before it reaches the user', async () => {
  saveWebToolKey('health-secret')
  vi.stubGlobal('fetch', vi.fn().mockResolvedValue(Response.json({ results: [] })))
  const register = vi.spyOn(pendingQuestions, 'register')
  const result = await askUserTool.handler({ questions: [{ header: '联网受限', question: '联网工具（Tavily）未配置，怎么继续？', options: [{ label: '配好再来' }, { label: '知识版' }] }] }, ctx)
  expect(result).toMatchObject({ ok: false, error: expect.stringContaining('请调用 web_search') })
  expect(register).not.toHaveBeenCalled()
  expect(JSON.stringify(result)).not.toContain('health-secret')
})

it.each([401, 429, 500])('distinguishes HTTP %s from missing configuration and permits recovery', async (status) => {
  saveWebToolKey('health-secret')
  const fetcher = vi.fn().mockResolvedValueOnce(new Response('health-secret', { status })).mockResolvedValueOnce(Response.json({ results: [] }))
  vi.stubGlobal('fetch', fetcher)
  const failed = await probeWebTool('web_search', ctx.abortSignal)
  expect(failed).toMatchObject({ available: false, reason: `http_${status}` })
  expect(JSON.stringify(failed)).not.toContain('health-secret')
  expect(await probeWebTool('web_search', ctx.abortSignal)).toMatchObject({ available: true })
})

it('does not classify ordinary choices as availability failures', () => {
  expect(questionsClaimWebUnavailable([{ question: '联网研究重点是产品还是技术？' }])).toBe(false)
  expect(questionsClaimWebUnavailable([{ question: '不能确定配色，选蓝色还是红色？' }])).toBe(false)
})

it('forces a real preflight for historical tool failures without model cooperation', async () => {
  saveWebToolKey('health-secret')
  const fetcher = vi.fn().mockResolvedValue(Response.json({ results: [] }))
  vi.stubGlobal('fetch', fetcher)
  expect(await recheckHistoricalWebFailure([{ role: 'tool', content: '联网工具尚未配置：Tavily API Key' }], ctx.abortSignal)).toContain('"available":true')
  expect(fetcher).toHaveBeenCalledOnce()
  expect(await recheckHistoricalWebFailure([{ role: 'user', content: '你好' }], ctx.abortSignal)).toBe('')
  expect(fetcher).toHaveBeenCalledOnce()
})

it('honors cancellation instead of showing a question or diagnosing a network failure', async () => {
  saveWebToolKey('health-secret')
  const signal = AbortSignal.abort()
  const fetcher = vi.fn()
  vi.stubGlobal('fetch', fetcher)
  await expect(probeWebTool('web_search', signal)).rejects.toThrow()
  expect(fetcher).not.toHaveBeenCalled()
})

it('probes extraction separately instead of claiming search success proves fetch availability', async () => {
  saveWebToolKey('health-secret')
  const fetcher = vi.fn().mockResolvedValue(Response.json({ results: [{ url: 'https://example.com/', raw_content: 'Example page' }] }))
  vi.stubGlobal('fetch', fetcher)
  expect(await recheckHistoricalWebFailure('web_fetch 网页读取不可用', ctx.abortSignal)).toContain('"available":true')
  expect(fetcher.mock.calls[0][0]).toBe('https://api.tavily.com/extract')
})
