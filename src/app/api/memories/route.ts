import { NextResponse } from 'next/server'
import { z } from 'zod'
import { and, eq, inArray } from 'drizzle-orm'
import { db, schema } from '@/db/client'
import { memories } from '@/server/personal-runtime'

export function GET(req: Request) {
  const id = new URL(req.url).searchParams.get('source')
  if (!id) return NextResponse.json({ memories: memories.list() })
  const memory = memories.list().find((item) => item.id === id)
  if (!memory) return NextResponse.json({ error: '记忆不存在' }, { status: 404 })
  const messages = db.select().from(schema.messages).where(and(eq(schema.messages.conversationId, memory.sourceConversationId), inArray(schema.messages.id, memory.sourceMessageIds))).all()
  return NextResponse.json({ messages, missing: memory.sourceMessageIds.filter((source) => !messages.some((m) => m.id === source)) })
}

/** Explicit confirmation, expiry and deletion all invalidate future SDK memory context. */
export async function PATCH(req: Request) {
  const body = z.object({ id: z.string(), content: z.string().trim().min(1).max(2000).optional(), status: z.enum(['active', 'pending', 'expired', 'deleted']).optional() }).strict().safeParse(await req.json().catch(() => null))
  if (!body.success) return NextResponse.json({ error: '记忆参数无效' }, { status: 400 })
  try {
    const { id, ...patch } = body.data
    return NextResponse.json({ memory: memories.update(id, patch) })
  } catch (error) {
    return NextResponse.json({ error: error instanceof Error ? error.message : '修改失败' }, { status: 400 })
  }
}
