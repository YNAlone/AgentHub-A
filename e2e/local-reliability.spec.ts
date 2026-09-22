import { expect, test } from '@playwright/test'

test('本机认证保护业务 API，已配对请求只收到凭据标记', async ({ browser, request }) => {
  const anonymous = await browser.newContext({ storageState: { cookies: [], origins: [] } })
  try {
    expect((await anonymous.request.get('http://127.0.0.1:3130/api/settings')).status()).toBe(401)
    expect((await request.patch('/api/settings', { data: { openaiApiKey: 'e2e-fake-key' } })).ok()).toBe(true)
    const settings = await (await request.get('/api/settings')).json()
    expect(settings.settings.openaiApiKey).toBe('__AGENTHUB_CONFIGURED__')
    expect(JSON.stringify(settings)).not.toContain('e2e-fake-key')
    expect((await request.patch('/api/settings', { headers: { Origin: 'https://evil.invalid' }, data: {} })).status()).toBe(403)
  } finally { await anonymous.close() }
})

test('创建项目后可维护多段对话并查看长期记忆开关', async ({ page, request }) => {
  const { project } = await (await request.post('/api/projects', { data: { action: 'create', name: 'E2E 本机项目' } })).json()
  for (const title of ['项目对话一', '项目对话二']) {
    const result = await request.post('/api/conversations', { data: { title, mode: 'single', agentIds: ['ag_e2e_mock'], projectId: project.id } })
    expect(result.status()).toBe(201)
  }
  await page.goto('/personal')
  await expect(page.getByRole('heading', { name: '项目', exact: true })).toBeVisible()
  await expect(page.getByRole('link', { name: '项目对话一' })).toBeVisible()
  await expect(page.getByRole('link', { name: '项目对话二' })).toBeVisible()
  await page.getByRole('button', { name: '长期记忆', exact: true }).click()
  await expect(page.getByRole('heading', { name: '长期记忆', exact: true })).toBeVisible()
  await page.getByRole('button', { name: '上下文', exact: true }).click()
  await expect(page.getByRole('checkbox', { name: '允许后台提取记忆' })).not.toBeChecked()
  await expect(page.getByRole('button', { name: '保存设置', exact: true })).toBeVisible()
})

test('统一工作空间导航可打开主页面并返回对话', async ({ page }) => {
  await page.goto('/')
  await page.getByRole('button', { name: 'Agents', exact: true }).click()
  await expect(page.getByRole('heading', { name: 'Agents', exact: true })).toBeVisible()
  await page.getByRole('button', { name: '创建 Agent', exact: true }).click()
  await expect(page.getByRole('dialog')).toBeVisible()
  await page.keyboard.press('Escape')
  await page.getByRole('button', { name: '产物库', exact: true }).click()
  await expect(page.getByRole('heading', { name: '产物库', exact: true })).toBeVisible()
  await page.getByRole('button', { name: '分析', exact: true }).click()
  await expect(page.getByRole('heading', { name: '用量分析', exact: true })).toBeVisible()
  await page.getByRole('button', { name: '对话', exact: true }).click()
  await expect(page.getByRole('heading', { name: '用量分析', exact: true })).toHaveCount(0)
  await expect(page.getByRole('button', { name: '新建对话', exact: true })).toBeVisible()
})

test('从 Agent 库和个人设置搜索消息可以返回目标对话', async ({ page, request }) => {
  const created = await request.post('/api/conversations', { data: { title: '搜索导航验收', mode: 'single', agentIds: ['ag_e2e_mock'] } })
  expect(created.status()).toBe(201)
  const { conversation } = await created.json()
  const sent = await request.post(`/api/conversations/${conversation.id}/messages`, { data: { content: '界面导航验收' } })
  expect(sent.ok()).toBe(true)
  await page.goto('/')
  await page.getByRole('button', { name: 'Agents', exact: true }).click()
  for (const location of ['library', 'personal']) {
    if (location === 'personal') await page.goto('/personal')
    await page.keyboard.press('Control+k')
    const dialog = page.getByRole('dialog')
    await dialog.locator('input').fill('界面导航验收')
    await dialog.getByRole('option').first().click()
    await expect(page.getByTestId('composer-input')).toBeVisible()
    await expect(page.locator('[data-surface="chat"] header')).toContainText('搜索导航验收')
  }
})
