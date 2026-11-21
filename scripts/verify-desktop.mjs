import assert from 'node:assert/strict'
import fs from 'node:fs'
import path from 'node:path'
import os from 'node:os'
import http from 'node:http'
import { _electron, expect } from '@playwright/test'

async function main() {
  assert(process.argv[2], 'Usage: node scripts/verify-desktop.mjs <packaged executable>')
  const executablePath = path.resolve(process.argv[2])
  assert(fs.existsSync(executablePath), 'Packaged executable is missing')
  const temporaryRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'agenthub-release-check-'))
  let fixtureRequestCount = 0
  const fixtureServer = http.createServer(async (request, response) => {
    for await (const chunk of request) {
      void chunk
    }
    if (request.url !== '/v1/chat/completions') {
      response.writeHead(404).end()
      return
    }

    fixtureRequestCount++
    response.writeHead(200, { 'Content-Type': 'text/event-stream' })
    const completionBase = {
      id: 'release-fixture',
      object: 'chat.completion.chunk',
      created: 1,
      model: 'release-test',
    }
    response.write(`data: ${JSON.stringify({
      ...completionBase,
      choices: [{
        index: 0,
        delta: { role: 'assistant', content: 'release-smoke-ok' },
        finish_reason: null,
      }],
    })}\n\n`)
    response.write(`data: ${JSON.stringify({
      ...completionBase,
      choices: [{ index: 0, delta: {}, finish_reason: 'stop' }],
      usage: { prompt_tokens: 30, completion_tokens: 5, total_tokens: 35 },
    })}\n\n`)
    response.end('data: [DONE]\n\n')
  })
  await new Promise(resolve => fixtureServer.listen(0, '127.0.0.1', resolve))

  // An isolated profile exercises the default data path without reading personal model credentials.
  const profilePath = path.join(temporaryRoot, 'profile')
  const environment = { ...process.env, NEXT_TELEMETRY_DISABLED: '1' }
  delete environment.AGENTHUB_DATA_DIR
  for (const name of Object.keys(environment)) {
    if (/API_KEY|TOKEN|SECRET|ELECTRON_RUN_AS_NODE|AGENTHUB_DEV|NODE_OPTIONS|NODE_PATH/i.test(name)) {
      delete environment[name]
    }
    if (name.toLowerCase() === 'path') {
      delete environment[name]
    }
  }
  environment.PATH = `${process.env.SystemRoot}\\System32;${process.env.SystemRoot};${process.env.SystemRoot}\\System32\\WindowsPowerShell\\v1.0`

  let application
  const launchApplication = async () => {
    application = await _electron.launch({
      executablePath,
      args: [`--user-data-dir=${profilePath}`],
      cwd: path.dirname(executablePath),
      env: environment,
      timeout: 45000,
    })
    assert.equal(await application.evaluate(({ app }) => app.isPackaged), true)
    assert.equal(
      await application.evaluate(() => process.env.AGENTHUB_DATA_DIR),
      path.join(profilePath, 'data'),
    )
    const page = await application.firstWindow({ timeout: 45000 })
    // Hidden acceptance windows still need animation frames for real UI interactions.
    await application.evaluate(({ BrowserWindow }) => {
      BrowserWindow.getAllWindows().forEach(window => {
        window.webContents.setBackgroundThrottling(false)
        window.hide()
      })
    })
    await page.waitForURL(
      url => url.hostname === '127.0.0.1' && url.pathname === '/',
      { timeout: 45000 },
    )
    await page.waitForLoadState('domcontentloaded')
    return page
  }

  const callApi = (page, url, data, method = 'POST') => page.evaluate(
    async ({ url, data, method }) => {
      const response = await fetch(url, {
        method,
        headers: { 'Content-Type': 'application/json' },
        ...(data === undefined ? {} : { body: JSON.stringify(data) }),
      })
      if (!response.ok) {
        throw new Error(`API ${url}: ${response.status}`)
      }
      return response.json()
    },
    { url, data, method },
  )

  let passed = false
  try {
    let page = await launchApplication()
    console.log('Packaged window loaded')
    assert.equal((await fetch(new URL('/api/agents', page.url()))).status, 401)
    await callApi(page, '/api/personal/settings', { memoryEnabled: false }, 'PATCH')
    await callApi(page, '/api/agents', {
      name: 'Release Acceptance',
      description: 'Local deterministic fixture',
      systemPrompt: 'Reply briefly.',
      adapterName: 'custom',
      modelProvider: 'openai-compatible',
      modelId: 'release-test',
      toolNames: [],
      apiKey: 'local-fixture-only',
      apiBaseUrl: `http://127.0.0.1:${fixtureServer.address().port}/v1`,
    })
    await page.reload()
    console.log('Fixture configured')
    await page.getByRole('button', { name: '新建对话' }).click()
    const dialog = page.getByRole('dialog')
    await dialog.getByRole('button').filter({ hasText: 'Release Acceptance' }).first().click()
    await dialog.getByRole('button', { name: '创建', exact: true }).click()
    await expect(dialog).toBeHidden()
    console.log('Conversation created')
    const input = page.getByTestId('composer-input')
    await input.fill('release acceptance test')
    await input.press('Enter')
    await expect(page.locator('[data-role="agent"][data-status="complete"]').last()).toContainText(
      'release-smoke-ok',
      { timeout: 45000 },
    )
    assert(fixtureRequestCount > 0, 'Custom adapter did not contact the local fixture')
    console.log('Reply received')
    const conversations = await callApi(page, '/api/conversations', undefined, 'GET')
    const conversationId = conversations.conversations[0].id
    await application.close()
    application = undefined
    page = await launchApplication()
    const messages = await callApi(page, `/api/conversations/${conversationId}/messages`, undefined, 'GET')
    assert(JSON.stringify(messages).includes('release-smoke-ok'), 'Chat was not persisted across restart')
    console.log(JSON.stringify({
      result: 'PASS',
      version: await application.evaluate(({ app }) => app.getVersion()),
      packaged: true,
      defaultDataDirectory: true,
      externalNodeOrGitOnPath: false,
      unauthenticatedDenied: true,
      customAdapter: 'local fixture passed',
      chatPersistedAfterRestart: true,
      requests: fixtureRequestCount,
    }, null, 2))
    passed = true
  } finally {
    if (application) {
      await application.close()
    }
    await new Promise(resolve => fixtureServer.close(resolve))
    if (passed) {
      fs.rmSync(temporaryRoot, { recursive: true, force: true })
    } else {
      console.error(`Acceptance profile retained for diagnosis: ${temporaryRoot}`)
    }
  }
}

main().catch(error => {
  console.error(error.stack)
  process.exitCode = 1
})
