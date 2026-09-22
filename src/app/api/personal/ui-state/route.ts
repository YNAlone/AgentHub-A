import { NextResponse } from 'next/server'
import { sqlite } from '@/db/client'
import { PersonalUiState } from '@/shared/personal-ui-state'
import '@/server/personal-settings'

/** Server-side UI persistence survives Electron's changing loopback port. */
export async function PUT(req: Request) {
  const body = PersonalUiState.safeParse(await req.json().catch(() => null))
  if (!body.success) return NextResponse.json({ error: '界面状态无效' }, { status: 400 })
  sqlite.prepare("INSERT INTO personal_settings VALUES ('ui', ?) ON CONFLICT(id) DO UPDATE SET value = excluded.value").run(JSON.stringify(body.data))
  return NextResponse.json({ ok: true })
}
