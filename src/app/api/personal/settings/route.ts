import { NextResponse } from 'next/server'
import { sqlite } from '@/db/client'
import { PersonalSettings, getPersonalSettings, updatePersonalSettings } from '@/server/personal-settings'
import { stopMemoryGeneration } from '@/server/memory-extraction'

export function GET() {
  const usage = sqlite.prepare('SELECT model, SUM(input_tokens) AS inputTokens, SUM(output_tokens) AS outputTokens, COUNT(*) AS requests FROM auxiliary_usage GROUP BY model').all()
  const jobs = sqlite.prepare('SELECT conversation_id AS conversationId, status, error, updated_at AS updatedAt FROM memory_jobs ORDER BY updated_at DESC LIMIT 30').all()
  return NextResponse.json({ settings: getPersonalSettings(), usage, jobs })
}

/** Disabling background extraction aborts pending requests without touching retained memories. */
export async function PATCH(req: Request) {
  const body = PersonalSettings.partial().strict().safeParse(await req.json().catch(() => null))
  if (!body.success) return NextResponse.json({ error: '能力设置参数无效' }, { status: 400 })
  const previous = getPersonalSettings()
  const settings = updatePersonalSettings(body.data)
  if (previous.memoryUseEnabled !== settings.memoryUseEnabled) sqlite.prepare('DELETE FROM sdk_sessions').run()
  if (!settings.memoryEnabled) stopMemoryGeneration()
  sqlite.prepare("UPDATE memory_jobs SET status = 'pending', error = NULL, updated_at = 0 WHERE status = 'failed'").run()
  return NextResponse.json({ settings })
}
