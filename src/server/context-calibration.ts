import { createHash } from 'node:crypto'
import { sqlite } from '@/db/client'
import type { ModelProvider } from '@/shared/types'

interface SampleGroup { samples: number; longSamples: number; maxRatio: number }
interface CalibrationRecord { plain: SampleGroup; tool: SampleGroup; updatedAt: number }

const EMPTY_GROUP = (): SampleGroup => ({ samples: 0, longSamples: 0, maxRatio: 0 })
const MIN_SAMPLES = 30
const MIN_LONG_SAMPLES = 5
const MAX_SAMPLE_AGE_MS = 7 * 24 * 60 * 60 * 1000

sqlite.exec('CREATE TABLE IF NOT EXISTS personal_settings (id TEXT PRIMARY KEY, value TEXT NOT NULL)')

/** Hash endpoint identity so calibration rows never persist URL credentials or API keys. */
function rowId(provider: ModelProvider, modelId: string, apiBaseUrl: string | null): string {
  const fingerprint = createHash('sha256').update(JSON.stringify([provider, modelId, apiBaseUrl])).digest('hex')
  // Byte-based observations cannot calibrate the new language-aware estimator.
  return `context-calibration:v2:${fingerprint}`
}

function readRecord(id: string): CalibrationRecord {
  const row = sqlite.prepare('SELECT value FROM personal_settings WHERE id = ?').get(id) as { value: string } | undefined
  if (!row) return { plain: EMPTY_GROUP(), tool: EMPTY_GROUP(), updatedAt: 0 }
  try {
    const parsed: unknown = JSON.parse(row.value)
    if (!parsed || typeof parsed !== 'object') throw new Error('invalid calibration row')
    const value = parsed as Record<string, unknown>
    const readGroup = (name: 'plain' | 'tool'): SampleGroup => {
      const group = value[name]
      if (!group || typeof group !== 'object') return EMPTY_GROUP()
      const fields = group as Record<string, unknown>
      if (typeof fields.samples !== 'number' || typeof fields.longSamples !== 'number' || typeof fields.maxRatio !== 'number') return EMPTY_GROUP()
      if (![fields.samples, fields.longSamples, fields.maxRatio].every((number) => Number.isFinite(number) && number >= 0)) return EMPTY_GROUP()
      return { samples: fields.samples, longSamples: fields.longSamples, maxRatio: fields.maxRatio }
    }
    return { plain: readGroup('plain'), tool: readGroup('tool'), updatedAt: typeof value.updatedAt === 'number' ? value.updatedAt : 0 }
  } catch {
    return { plain: EMPTY_GROUP(), tool: EMPTY_GROUP(), updatedAt: 0 }
  }
}

/** No relaxation until both sample count and long-request evidence are available for that request class. */
export function getContextCalibration(provider: ModelProvider, modelId: string, apiBaseUrl: string | null): { plainFactor: number; toolFactor: number } {
  const record = readRecord(rowId(provider, modelId, apiBaseUrl))
  const fresh = Date.now() - record.updatedAt <= MAX_SAMPLE_AGE_MS
  const factor = (group: SampleGroup) => fresh && group.samples >= MIN_SAMPLES && group.longSamples >= MIN_LONG_SAMPLES
    ? Math.min(1, Math.max(0.2, Math.ceil(group.maxRatio * 1.25 * 1000) / 1000))
    : 1
  return { plainFactor: factor(record.plain), toolFactor: factor(record.tool) }
}

/** Persist numeric usage only; text, prompts, endpoint URL and credentials never enter the calibration row. */
export function recordContextSample(
  provider: ModelProvider,
  modelId: string,
  apiBaseUrl: string | null,
  rawEstimate: number,
  actualInputTokens: number,
  hasToolResult: boolean,
): void {
  if (!Number.isSafeInteger(rawEstimate) || rawEstimate <= 0 || !Number.isSafeInteger(actualInputTokens) || actualInputTokens <= 0) return
  const id = rowId(provider, modelId, apiBaseUrl)
  const saved = readRecord(id)
  const record = Date.now() - saved.updatedAt <= MAX_SAMPLE_AGE_MS
    ? saved
    : { plain: EMPTY_GROUP(), tool: EMPTY_GROUP(), updatedAt: 0 }
  const group = hasToolResult ? record.tool : record.plain
  group.samples++
  if (rawEstimate >= 4096) group.longSamples++
  group.maxRatio = Math.max(group.maxRatio, actualInputTokens / rawEstimate)
  record.updatedAt = Date.now()
  sqlite.prepare("INSERT INTO personal_settings (id, value) VALUES (?, ?) ON CONFLICT(id) DO UPDATE SET value = excluded.value").run(id, JSON.stringify(record))
}
