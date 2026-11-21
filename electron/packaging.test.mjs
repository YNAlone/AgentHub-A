import { afterEach, expect, test } from 'vitest'
import { createRequire } from 'node:module'
import fs from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'

const require = createRequire(import.meta.url)
const builderRequire = createRequire(require.resolve('electron-builder'))
const { FileMatcher, copyFiles } = builderRequire('app-builder-lib/out/fileMatcher.js')
const { build } = require('../package.json')
const temporaryRoots = []

afterEach(async () => {
  await Promise.all(temporaryRoots.splice(0).map(root => fs.rm(root, { recursive: true, force: true })))
})

test('desktop resources retain standalone dependencies and exclude adjacent build files', async () => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'agenthub-packaging-'))
  temporaryRoots.push(root)
  const resources = path.join(root, 'resources')
  const files = [
    'server.js',
    'node_modules/next/package.json',
    'node_modules/.pnpm/runtime/node_modules/runtime/index.js',
    '.next/node_modules/runtime-hash/index.js',
    '.next/static/main.js',
    'scripts/agenthub-codex-mcp.mjs',
  ]
  for (const file of [...files.map(file => `standalone/${file}`), 'cache/private-build-file']) {
    const target = path.join(root, '.next', file)
    await fs.mkdir(path.dirname(target), { recursive: true })
    await fs.writeFile(target, file)
  }
  // Use the actual builder filter: it rejects a node_modules directory at the copy root.
  const matchers = build.extraResources.map(({ from, to, filter }) =>
    new FileMatcher(path.join(root, from), path.join(resources, to), value => value, filter),
  )
  await copyFiles(matchers)
  for (const file of files) {
    const target = path.join(resources, 'app.asar.unpacked/.next/standalone', file)
    expect(await fs.readFile(target, 'utf8')).toBe(`standalone/${file}`)
  }
  expect(await fs.stat(path.join(resources, 'app.asar.unpacked/.next/cache')).catch(() => null)).toBeNull()
})
