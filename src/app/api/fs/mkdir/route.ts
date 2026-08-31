import { mkdirSync, statSync } from 'node:fs'
import { homedir } from 'node:os'
import path from 'node:path'

import { NextRequest, NextResponse } from 'next/server'
import { z } from 'zod'

import { isPathSafe } from '@/server/workspace-utils'

/**
 * POST /api/fs/mkdir
 *
 * 在指定父目录下新建子文件夹（用于 DirPickerDialog 的「新建文件夹」）。
 * - parentPath 安全校验与 /api/fs/listdir 完全一致（home 自身可作起点，系统/敏感目录 403）
 * - name 只允许「单个可见目录名」：拒绝分隔符、dotfile、Windows 非法字符 ——
 *   dotdir 会被 listdir 过滤，创建后不可见，等于「创建失败」的错觉，故直接拒绝
 * - 目标路径再过一次 isPathSafe（纵深防御）
 */

const MkdirBody = z.object({
  parentPath: z.string().min(1),
  name: z.string().min(1).max(255),
})

// Windows 非法文件名字符 + 控制字符。POSIX 上这些字符部分合法，但拒绝可避免
// 目录在双平台间 round-trip（打包/同步）时出问题。
const INVALID_NAME_CHARS = /[:*?"<>|\u0000-\u001f]/

function invalidNameReason(name: string): string | null {
  if (name === '.' || name === '..') return 'cannot be "." or ".."'
  if (name.includes('/') || name.includes('\\')) return 'cannot contain path separators'
  if (name.startsWith('.')) return 'cannot start with "." (hidden directories are not shown in the picker)'
  if (INVALID_NAME_CHARS.test(name)) return 'cannot contain : * ? " < > | or control characters'
  return null
}

export async function POST(req: NextRequest) {
  const raw = await req.json().catch(() => null)
  const parsed = MkdirBody.safeParse(raw)
  if (!parsed.success) {
    return NextResponse.json({ error: 'Invalid body', issues: parsed.error.issues }, { status: 400 })
  }

  const name = parsed.data.name.trim()
  const reason = invalidNameReason(name)
  if (!name || reason) {
    return NextResponse.json(
      { error: reason ? `Invalid folder name: ${reason}` : 'Invalid folder name: empty' },
      { status: 400 },
    )
  }

  if (!path.isAbsolute(parsed.data.parentPath)) {
    return NextResponse.json({ error: 'parentPath must be absolute' }, { status: 400 })
  }
  const resolvedParent = path.resolve(parsed.data.parentPath)

  // 与 listdir 一致：允许 home 自身作起点，其余走 isPathSafe
  if (resolvedParent !== path.resolve(homedir()) && !isPathSafe(resolvedParent)) {
    return NextResponse.json({ error: 'Path not allowed' }, { status: 403 })
  }

  let stat
  try {
    stat = statSync(resolvedParent)
  } catch {
    return NextResponse.json({ error: 'Parent path does not exist' }, { status: 404 })
  }
  if (!stat.isDirectory()) {
    return NextResponse.json({ error: 'Parent path is not a directory' }, { status: 400 })
  }

  const target = path.join(resolvedParent, name)
  if (!isPathSafe(target)) {
    return NextResponse.json({ error: 'Path not allowed' }, { status: 403 })
  }

  try {
    mkdirSync(target, { recursive: false })
  } catch (err) {
    const e = err as NodeJS.ErrnoException
    if (e.code === 'EEXIST') {
      return NextResponse.json({ error: 'Folder already exists' }, { status: 409 })
    }
    if (e.code === 'EACCES' || e.code === 'EPERM') {
      const msg = err instanceof Error ? err.message : String(err)
      return NextResponse.json({ error: `Cannot create folder: ${msg}` }, { status: 403 })
    }
    const msg = err instanceof Error ? err.message : String(err)
    return NextResponse.json({ error: `Cannot create folder: ${msg}` }, { status: 500 })
  }

  return NextResponse.json({ path: target }, { status: 201 })
}
