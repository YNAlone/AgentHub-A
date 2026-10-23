import { sqlite } from '@/db/client'

const ID = 'web-tools'

/** Credentials stay in the existing server-owned settings store, never in browser DTOs. */
export function getWebToolKey(): string | null {
  return storedKey() || process.env.TAVILY_API_KEY?.trim() || null
}
function storedKey(): string | null {
  const row = sqlite.prepare('SELECT value FROM personal_settings WHERE id = ?').get(ID) as { value: string } | undefined
  return row ? (JSON.parse(row.value) as { apiKey: string | null }).apiKey : null
}
export function webToolStatus() {
  const saved = !!storedKey()
  return { provider: 'tavily', configured: !!getWebToolKey(), source: saved ? 'settings' : getWebToolKey() ? 'environment' : 'none', stored: saved }
}
export function saveWebToolKey(key: string | null | undefined) {
  // Empty edits preserve the secret; null removes the saved override but not environment fallback.
  if (key === null || key?.trim()) {
    sqlite.prepare('INSERT INTO personal_settings(id, value) VALUES (?, ?) ON CONFLICT(id) DO UPDATE SET value = excluded.value')
      .run(ID, JSON.stringify({ apiKey: key?.trim() ?? null }))
  }
  return webToolStatus()
}
