import { existsSync, mkdtempSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import path from 'node:path'

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import { localAuth } from '../src/server/local-auth'

const desktop = vi.hoisted(() => ({
  userData: '',
  startup: undefined,
  loadURL: vi.fn(),
  setCookie: vi.fn(),
  startServer: vi.fn(),
}))

vi.mock('electron', () => ({
  app: {
    isPackaged: true,
    setName: vi.fn(),
    getPath: () => desktop.userData,
    requestSingleInstanceLock: () => true,
    on: vi.fn(),
    whenReady: () => ({ then: (start) => {
      desktop.startup = start()
      // Retain the rejection for the assertion without an unhandled startup promise.
      desktop.startup.catch(() => {})
    } }),
    quit: vi.fn(),
  },
  BrowserWindow: class {
    webContents = { setWindowOpenHandler: vi.fn(), on: vi.fn() }
    loadURL = desktop.loadURL
  },
  session: { defaultSession: {
    setProxy: vi.fn().mockResolvedValue(undefined),
    cookies: { set: desktop.setCookie },
  } },
  shell: { openExternal: vi.fn() },
}))

vi.mock('./server-bootstrap', () => ({ startEmbeddedServer: desktop.startServer }))

beforeEach(() => {
  vi.resetModules()
  vi.clearAllMocks()
  desktop.userData = mkdtempSync(path.join(tmpdir(), 'agenthub-desktop-auth-'))
  desktop.startup = undefined
  vi.stubEnv('AGENTHUB_DEV', '')
  vi.stubEnv('AGENTHUB_DATA_DIR', '')
  desktop.startServer.mockImplementation(async () => {
    // Use the real server-side file creation to detect divergence from the desktop reader.
    localAuth()
    return 3131
  })
})

afterEach(() => vi.unstubAllEnvs())

describe('packaged desktop authentication', () => {
  it.each(['default', 'custom', 'stale-parent'])('loads the application with %s data directory credentials', async (mode) => {
    if (mode === 'custom') {
      vi.stubEnv('AGENTHUB_DATA_DIR', path.join(desktop.userData, 'custom-data'))
    }
    if (mode === 'stale-parent') {
      writeFileSync(path.join(desktop.userData, 'local-auth.json'), JSON.stringify({ key: 'old-key'.repeat(8) }))
    }

    await import('./main')
    await desktop.startup

    const dataDir = mode === 'custom' ? 'custom-data' : 'data'
    expect(existsSync(path.join(desktop.userData, dataDir, 'local-auth.json'))).toBe(true)
    expect(desktop.setCookie).toHaveBeenCalledOnce()
    const cookie = desktop.setCookie.mock.calls[0][0]
    expect(localAuth().authorize(new Request('http://127.0.0.1:3131', {
      headers: { cookie: `${cookie.name}=${cookie.value}` },
    }))).toBe(true)
    expect(desktop.loadURL).toHaveBeenCalledWith('http://127.0.0.1:3131')
  })
})
