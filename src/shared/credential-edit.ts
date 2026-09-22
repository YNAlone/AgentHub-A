export const CONFIGURED_SECRET = '__AGENTHUB_CONFIGURED__'
export const CLEAR_SECRET = '__AGENTHUB_CLEAR__'

/** Blank edits preserve stored credentials; only the explicit clear action emits null. */
export function credentialEdit(value: string): string | null | undefined {
  if (value === CLEAR_SECRET) return null
  if (!value.trim() || value === CONFIGURED_SECRET) return undefined
  return value.trim()
}
