import { z } from 'zod'
import { saveWebToolKey, webToolStatus } from '@/server/web-tool-settings'

const Patch = z.object({ apiKey: z.string().trim().max(512).nullable().optional() }).strict()

/** Local authentication is enforced by proxy.ts; secrets never enter the response DTO. */
export async function GET() {
  return Response.json(webToolStatus(), { headers: { 'Cache-Control': 'no-store' } })
}
export async function PATCH(request: Request) {
  const parsed = Patch.safeParse(await request.json().catch(() => null))
  if (!parsed.success) return Response.json({ error: 'Invalid web settings.' }, { status: 400 })
  return Response.json(saveWebToolKey(parsed.data.apiKey), { headers: { 'Cache-Control': 'no-store' } })
}
