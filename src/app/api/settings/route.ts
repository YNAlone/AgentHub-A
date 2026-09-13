import { NextRequest, NextResponse } from 'next/server'
import { z } from 'zod'
import { publicSettings, CONFIGURED_SECRET } from '@/server/public-credentials'

import { getAppSettings, updateAppSettings } from '@/server/settings-service'

/** Browser responses contain credential configuration markers only. */
export async function GET() {
  const settings = await getAppSettings()
  return NextResponse.json({ settings: publicSettings(settings) })
}

const PatchBody = z.object({
  // 显式 null 表示清空；undefined 表示不改
  anthropicApiKey: z.string().nullable().optional(),
  anthropicBaseUrl: z.string().nullable().optional(),
  openaiApiKey: z.string().nullable().optional(),
  deepseekApiKey: z.string().nullable().optional(),
  arkApiKey: z.string().nullable().optional(),
  companionMode: z.literal('off').optional(),
  mobileDeviceToken: z.string().nullable().optional(),
  deploymentPublishEnabled: z.boolean().optional(),
  deploymentPublishDir: z.string().nullable().optional(),
  deploymentPublicBaseUrl: z.string().nullable().optional(),
})

/** PATCH /api/settings —— upsert 部分字段 */
export async function PATCH(req: NextRequest) {
  const raw = await req.json().catch(() => null)
  const parsed = PatchBody.safeParse(raw)
  if (!parsed.success) {
    return NextResponse.json(
      { error: 'Invalid body', issues: parsed.error.issues },
      { status: 400 },
    )
  }
  const patch = Object.fromEntries(Object.entries(parsed.data).filter(([key, value]) => value !== CONFIGURED_SECRET && !(key.endsWith('ApiKey') && typeof value === 'string' && !value.trim())))
  const settings = await updateAppSettings({ ...patch, companionMode: 'off', mobileDeviceToken: null })
  return NextResponse.json({ settings: publicSettings(settings) })
}
