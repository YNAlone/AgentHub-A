import { afterEach, beforeEach, expect, it, vi } from 'vitest'
const dns = vi.hoisted(() => ({ lookup: vi.fn() }))
vi.mock('node:dns/promises', () => dns)
import { publicAddress, runWebTool, validateWebUrl } from './web-tools-service'

beforeEach(() => { dns.lookup.mockResolvedValue([{ address: '93.184.216.34', family: 4 }]) })
afterEach(() => vi.unstubAllGlobals())
it.each(['127.0.0.1', '10.1.1.1', '169.254.169.254', '100.64.0.1', '172.16.1.1', '192.168.1.1', '::1', '::ffff:127.0.0.1', 'fc00::1', '2002:7f00:1::'])('blocks special address %s', (address) => expect(publicAddress(address)).toBe(false))
it.each(['http://127.1/', 'http://0x7f000001/', 'http://[::1]/', 'file:///etc/passwd', 'https://user:pass@public.org/', 'https://public.org:8443/'])('rejects unsafe URL %s', async (url) => { await expect(validateWebUrl(url)).rejects.toThrow() })
it('rejects mixed public/private DNS results', async () => {
  dns.lookup.mockResolvedValue([{ address: '93.184.216.34' }, { address: '10.0.0.1' }])
  await expect(validateWebUrl('https://public.org')).rejects.toThrow('Private')
})
it('cancels waiting on DNS before contacting the provider', async () => {
  dns.lookup.mockReturnValue(new Promise(() => {}))
  const controller = new AbortController()
  const promise = runWebTool('fetch', { url: 'https://public.org' }, 'secret', controller.signal)
  controller.abort()
  await expect(promise).rejects.toThrow('cancelled')
})
it('uses the fixed search endpoint, bounds excerpts and retains citations', async () => {
  const fetcher = vi.fn().mockResolvedValue(Response.json({ results: [{ url: 'https://public.org/a', title: 'Source', content: 'x'.repeat(4000) }, { url: 'javascript:alert(1)', content: 'bad' }] }))
  vi.stubGlobal('fetch', fetcher)
  const result = await runWebTool('search', { query: 'news', maxResults: 2 }, 'secret', new AbortController().signal)
  expect(fetcher.mock.calls[0][0]).toBe('https://api.tavily.com/search')
  expect(fetcher.mock.calls[0][1].redirect).toBe('error')
  expect(JSON.parse(fetcher.mock.calls[0][1].body)).toMatchObject({ query: 'news', max_results: 2 })
  expect(result.results).toHaveLength(1)
  expect(result.results[0]).toMatchObject({ url: 'https://public.org/a', truncated: true })
  expect(result.results[0].text).toHaveLength(3000)
  expect(result.untrusted).toBe(true)
})
it('accepts nullable optional fields in actual Tavily search responses', async () => {
  vi.stubGlobal('fetch', vi.fn().mockResolvedValue(Response.json({ results: [
    { url: 'https://public.org/', title: 'Source', content: 'Search excerpt', raw_content: null, published_date: null },
  ] })))
  const result = await runWebTool('search', { query: 'Tavily', maxResults: 1 }, 'secret', new AbortController().signal)
  expect(result.results[0]).toMatchObject({ text: 'Search excerpt', publishedAt: null })
})
it('extracts text using the provider and reports unreadable pages', async () => {
  const fetcher = vi.fn().mockResolvedValueOnce(Response.json({ results: [{ url: 'https://public.org/', raw_content: 'body' }] }))
    .mockResolvedValueOnce(Response.json({ results: [], failed_results: [{}] }))
  vi.stubGlobal('fetch', fetcher)
  const result = await runWebTool('fetch', { url: 'https://public.org/' }, 'secret', new AbortController().signal)
  expect(result.results[0].text).toBe('body')
  expect(fetcher.mock.calls[0][0]).toBe('https://api.tavily.com/extract')
  await expect(runWebTool('fetch', { url: 'https://public.org/' }, 'secret', new AbortController().signal)).rejects.toThrow('extraction failed')
})
it('rejects oversized responses and does not expose HTTP error bodies', async () => {
  vi.stubGlobal('fetch', vi.fn().mockResolvedValueOnce(new Response('x'.repeat(2_000_001)))
    .mockResolvedValueOnce(new Response('secret-provider-body', { status: 401 })))
  await expect(runWebTool('search', { query: 'news' }, 'secret', new AbortController().signal)).rejects.toThrow('size limit')
  await expect(runWebTool('search', { query: 'news' }, 'secret', new AbortController().signal)).rejects.toThrow('HTTP 401')
})
it('does not send requests after cancellation', async () => {
  const fetcher = vi.fn()
  vi.stubGlobal('fetch', fetcher)
  await expect(runWebTool('search', { query: 'news' }, 'secret', AbortSignal.abort())).rejects.toThrow()
  expect(fetcher).not.toHaveBeenCalled()
})
