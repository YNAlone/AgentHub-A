import { z } from 'zod'
import { sqlite } from '@/db/client'

export const PersonalSettings = z.object({
  automaticCompaction: z.boolean().default(true),
  memoryEnabled: z.boolean().default(true),
  memoryUseEnabled: z.boolean().default(true),
  auxiliaryAgentId: z.string().nullable().default(null),
  memoryInputChars: z.number().int().min(4000).max(60000).default(12000),
  memoryConcurrency: z.number().int().min(1).max(2).default(1),
})
export type PersonalSettingsValue = z.infer<typeof PersonalSettings>

sqlite.exec(`CREATE TABLE IF NOT EXISTS personal_settings (id TEXT PRIMARY KEY, value TEXT NOT NULL);
  CREATE TABLE IF NOT EXISTS auxiliary_usage (id INTEGER PRIMARY KEY AUTOINCREMENT, model TEXT NOT NULL, input_tokens INTEGER NOT NULL, output_tokens INTEGER NOT NULL, created_at INTEGER NOT NULL);`)

/** Store independent capabilities separately from provider secrets and legacy companion settings. */
export function getPersonalSettings(): PersonalSettingsValue {
  const row = sqlite.prepare("SELECT value FROM personal_settings WHERE id = 'singleton'").get() as { value: string } | undefined
  return PersonalSettings.parse(row ? JSON.parse(row.value) : {})
}
export function updatePersonalSettings(patch: Partial<PersonalSettingsValue>): PersonalSettingsValue {
  const next = PersonalSettings.parse({ ...getPersonalSettings(), ...patch })
  sqlite.prepare("INSERT INTO personal_settings VALUES ('singleton', ?) ON CONFLICT(id) DO UPDATE SET value = excluded.value").run(JSON.stringify(next))
  return next
}
export function recordAuxiliaryUsage(model: string, inputTokens: number, outputTokens: number): void {
  sqlite.prepare('INSERT INTO auxiliary_usage(model, input_tokens, output_tokens, created_at) VALUES (?, ?, ?, ?)').run(model, inputTokens, outputTokens, Date.now())
}
