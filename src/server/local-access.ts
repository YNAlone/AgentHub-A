import { createHmac, timingSafeEqual } from 'node:crypto'

export const LOCAL_SESSION_COOKIE = 'agenthub_session'
export const SESSION_SECONDS = 24 * 60 * 60

function equal(a: string, b: string): boolean {
  const left = Buffer.from(a)
  const right = Buffer.from(b)
  return left.length === right.length && timingSafeEqual(left, right)
}

/** Host and Origin checks supplement authentication; loopback alone never grants access. */
export function isLocalRequest(req: Request): boolean {
  const url = new URL(req.url)
  const host = req.headers.get('host') ?? url.host
  const loopback = ['localhost', '127.0.0.1', '[::1]']
  let browserUrl: URL
  try { browserUrl = new URL(`${url.protocol}//${host}`) } catch { return false }
  // Next canonicalizes URL hosts; the real Host must still be an exact loopback authority on this port.
  if (browserUrl.host !== host || browserUrl.port !== url.port) return false
  if (!loopback.includes(url.hostname) || !loopback.includes(browserUrl.hostname)) return false
  const origin = req.headers.get('origin')
  if (origin && origin !== browserUrl.origin) return false
  if (req.headers.get('sec-fetch-site') === 'cross-site') return false
  return true
}

export function createLocalAccess(key: string, pairingCode: string, now = Date.now) {
  const sign = (value: string) => createHmac('sha256', key).update(value).digest('hex')
  const session = () => {
    const expiry = String(now() + SESSION_SECONDS * 1000)
    return `${expiry}.${sign(expiry)}`
  }
  return {
    session,
    pair(code: string): string | null {
      return equal(code, pairingCode) ? session() : null
    },
    authorize(req: Request): boolean {
      if (!isLocalRequest(req)) return false
      const cookie = req.headers.get('cookie')?.split(';').map((v) => v.trim())
        .find((v) => v.startsWith(`${LOCAL_SESSION_COOKIE}=`))?.slice(LOCAL_SESSION_COOKIE.length + 1)
      if (!cookie) return false
      const [expiry, signature, extra] = cookie.split('.')
      return !extra && !!signature && Number(expiry) > now()
        && Number(expiry) <= now() + SESSION_SECONDS * 1000
        && equal(signature, sign(expiry))
    },
  }
}
