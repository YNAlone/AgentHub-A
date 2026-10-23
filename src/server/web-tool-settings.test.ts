import { afterEach, expect, it, vi } from 'vitest'
import { getWebToolKey, saveWebToolKey, webToolStatus } from './web-tool-settings'
import { GET, PATCH } from '@/app/api/settings/web-tools/route'
import { webSearchTool } from './tools/web-tools'

afterEach(() => { saveWebToolKey(null); vi.unstubAllEnvs(); vi.unstubAllGlobals() })
it('preserves blank edits, masks status, and falls back after clearing', async () => {
  vi.stubEnv('TAVILY_API_KEY', 'environment-secret')
  saveWebToolKey('saved-secret')
  saveWebToolKey('')
  expect(getWebToolKey()).toBe('saved-secret')
  const response = await GET()
  expect(JSON.stringify(await response.json())).not.toContain('secret')
  expect(webToolStatus()).toMatchObject({ configured: true, source: 'settings', stored: true })
  saveWebToolKey(null)
  expect(getWebToolKey()).toBe('environment-secret')
  expect(webToolStatus().source).toBe('environment')
})
it('rejects invalid settings without persisting them', async () => {
  const request = new Request('http://localhost/api/settings/web-tools', { method: 'PATCH', body: JSON.stringify({ apiKey: 123 }) })
  expect((await PATCH(request)).status).toBe(400)
})
it('reports missing configuration and redacts transport failures', async () => {
  vi.stubEnv('TAVILY_API_KEY', '')
  const ctx = { conversationId: 'c', agentId: 'a', runId: 'r', workspacePath: '.', abortSignal: new AbortController().signal }
  expect(await webSearchTool.handler({ query: 'news' }, ctx)).toMatchObject({ ok: false, error: expect.stringContaining('尚未配置') })
  saveWebToolKey('saved-secret')
  vi.stubGlobal('fetch', vi.fn().mockRejectedValue(new Error('saved-secret in transport')))
  const result = await webSearchTool.handler({ query: 'news' }, ctx)
  expect(result.ok).toBe(false)
  expect(JSON.stringify(result)).not.toContain('saved-secret')
  expect(await webSearchTool.handler({ query: '' }, ctx)).toMatchObject({ ok: false })
})
