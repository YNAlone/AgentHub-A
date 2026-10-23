import { z } from 'zod'
import { getWebToolKey, saveWebToolKey, webToolStatus } from '@/server/web-tool-settings'
import { runWebTool } from '@/server/web-tools-service'

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

/** Validate the effective saved credential through the same bounded request path used by Agents. */
export async function POST(request: Request) {
  const reply = (ok: boolean, message: string, status = 200) => Response.json({ ok, message }, { status, headers: { 'Cache-Control': 'no-store' } })
  const key = getWebToolKey()
  if (!key) return reply(false, '尚未配置 Tavily API Key，请先保存。', 400)
  try {
    await runWebTool('search', { query: 'Tavily', maxResults: 1 }, key, request.signal)
    return reply(true, '校验成功：当前配置已完成一次搜索请求。网页提取未单独校验。')
  } catch (error) {
    // Translate only known status codes; never return provider bodies or transport error details.
    const code = error instanceof Error ? /^Web provider returned HTTP (\d+);/.exec(error.message)?.[1] : undefined
    const message = code === '401' || code === '403' ? '校验失败：Key 无效或没有访问权限，请检查后重新保存。'
      : code === '429' ? '校验失败：请求过于频繁或额度受限，请稍后重试并检查服务商额度。'
      : code === '432' || code === '433' ? '校验失败：服务商额度受限，请检查账户额度。'
      : code ? `校验失败：服务商返回 HTTP ${code}，请检查账户状态或稍后重试。`
      : '校验失败：网络连接、超时或响应异常，请检查服务器网络后重试。'
    return reply(false, message, 502)
  }
}
