import { NextResponse } from 'next/server'
import { z } from 'zod'
import { projects } from '@/server/personal-runtime'

export function GET() {
  return NextResponse.json({ projects: projects.list(), memberships: projects.memberships(), suggestions: projects.suggestions() })
}

const Body = z.discriminatedUnion('action', [
  z.object({ action: z.literal('create'), name: z.string().trim().min(1).max(100) }),
  z.object({ action: z.literal('assign'), conversationId: z.string().min(1), projectId: z.string().min(1).nullable() }),
])

/** Migration suggestions use the same explicit assignment command as ordinary membership changes. */
export async function POST(req: Request) {
  const parsed = Body.safeParse(await req.json().catch(() => null))
  if (!parsed.success) return NextResponse.json({ error: '项目参数无效' }, { status: 400 })
  try {
    const body = parsed.data
    if (body.action === 'create') return NextResponse.json({ project: projects.create(body.name) }, { status: 201 })
    projects.assign(body.conversationId, body.projectId)
    return NextResponse.json({ ok: true })
  } catch (error) {
    return NextResponse.json({ error: error instanceof Error ? error.message : '项目操作失败' }, { status: 400 })
  }
}
