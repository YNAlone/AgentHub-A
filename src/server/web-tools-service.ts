import { lookup } from 'node:dns/promises'
import { isIP } from 'node:net'
import { z } from 'zod'

const MAX_BYTES = 2_000_000
const PublicUrl = z.string().url().max(2048)
const Result = z.object({ url: z.string(), title: z.string().optional(), content: z.string().optional(), raw_content: z.string().optional(), published_date: z.string().optional() })
const Reply = z.object({ results: z.array(Result), failed_results: z.array(z.unknown()).optional() })

/** Conservative public-unicast policy rejects special ranges, including IPv4 mapped IPv6. */
export function publicAddress(address: string): boolean {
  if (isIP(address) === 6) {
    const a = address.toLowerCase()
    return /^[23][0-9a-f]{3}:/.test(a) && !a.startsWith('2001:') && !a.startsWith('2002:')
  }
  if (isIP(address) !== 4) return false
  const [a, b] = address.split('.').map(Number)
  return !(a === 0 || a === 10 || a === 127 || a >= 224 || (a === 100 && b >= 64 && b <= 127)
    || (a === 169 && b === 254) || (a === 172 && b >= 16 && b <= 31)
    || (a === 192 && (b === 168 || b === 0 || b === 2)) || (a === 198 && (b === 18 || b === 19 || b === 51))
    || (a === 203 && b === 0))
}

/** Extraction is delegated to a fixed provider, never fetched from the AgentHub host itself. */
export async function validateWebUrl(value: string, signal?: AbortSignal): Promise<string> {
  const url = new URL(PublicUrl.parse(value))
  if (!['http:', 'https:'].includes(url.protocol) || url.username || url.password || url.port) {
    throw new Error('Only public HTTP(S) URLs without credentials or custom ports are supported.')
  }
  const host = url.hostname.replace(/^\[|\]$/g, '').toLowerCase()
  if (!host.includes('.') && !isIP(host)) throw new Error('A public hostname is required.')
  if (/(^|\.)(localhost|local|internal|test|invalid|example)$/.test(host)) throw new Error('Private or reserved hostnames are not allowed.')
  signal?.throwIfAborted()
  // DNS promises cannot be cancelled, but callers must still observe their request deadline.
  const addresses = isIP(host) ? [{ address: host }] : await new Promise<{ address: string }[]>((resolve, reject) => {
    const abort = () => reject(new Error('Web request cancelled or timed out.'))
    signal?.addEventListener('abort', abort, { once: true })
    lookup(host, { all: true }).then(resolve, reject).finally(() => signal?.removeEventListener('abort', abort))
  })
  if (!addresses.length || addresses.some(({ address }) => !publicAddress(address))) throw new Error('Private or reserved network addresses are not allowed.')
  return url.href
}

/** Bound the streamed response before parsing; abort and deadlines cover network and body reads. */
async function providerCall(endpoint: 'search' | 'extract', body: object, key: string, signal: AbortSignal) {
  const response = await fetch('https://api.tavily.com/' + endpoint, {
    method: 'POST', redirect: 'error', signal,
    headers: { Authorization: 'Bearer ' + key, 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  })
  if (!response.ok) {
    await response.body?.cancel()
    throw new Error('Web provider returned HTTP ' + response.status + '; check credentials, quota and connectivity.')
  }
  const reader = response.body?.getReader()
  if (!reader) throw new Error('Web provider returned no body.')
  const chunks: Uint8Array[] = []
  let size = 0
  try {
    for (;;) {
      const { done, value } = await reader.read()
      if (done) break
      size += value.byteLength
      if (size > MAX_BYTES) throw new Error('Web provider response exceeded the size limit.')
      chunks.push(value)
    }
  } finally { await reader.cancel().catch(() => {}); reader.releaseLock() }
  return Reply.parse(JSON.parse(Buffer.concat(chunks).toString('utf8')))
}

export async function runWebTool(kind: 'search' | 'fetch', args: { query?: string; url?: string; maxResults?: number }, key: string, abortSignal: AbortSignal) {
  const signal = AbortSignal.any([abortSignal, AbortSignal.timeout(20_000)])
  signal.throwIfAborted()
  const url = kind === 'fetch' ? await validateWebUrl(args.url!, signal) : undefined
  signal.throwIfAborted()
  const reply = await providerCall(kind === 'search' ? 'search' : 'extract', kind === 'search'
    ? { query: args.query, max_results: args.maxResults ?? 5, search_depth: 'basic', include_raw_content: false }
    : { urls: [url], extract_depth: 'basic', format: 'text' }, key, signal)
  const results = reply.results.slice(0, kind === 'fetch' ? 1 : args.maxResults ?? 5).flatMap((r) => {
    // Do not turn provider-supplied javascript/data links into clickable citations.
    try { if (!['http:', 'https:'].includes(new URL(r.url).protocol)) return [] } catch { return [] }
    const raw = kind === 'fetch' ? r.raw_content ?? r.content ?? '' : r.content ?? ''
    const limit = kind === 'fetch' ? 24000 : 3000
    return [{ url: r.url.slice(0, 2048), title: r.title?.slice(0, 500) ?? '', text: raw.slice(0, limit), truncated: raw.length > limit, publishedAt: r.published_date?.slice(0, 100) ?? null }]
  })
  if (kind === 'fetch' && !results.some((r) => r.text)) throw new Error('Web page extraction failed or returned no readable text.')
  return { provider: 'tavily', retrievedAt: new Date().toISOString(), untrusted: true, results }
}
