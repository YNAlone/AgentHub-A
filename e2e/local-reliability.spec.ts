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
  await expect(page.getByRole('heading', { name: '上下文与后台提取', exact: true })).toBeVisible()
  await expect(page.getByRole('link', { name: '项目对话一' })).toBeVisible()
  await expect(page.getByRole('link', { name: '项目对话二' })).toBeVisible()
  await expect(page.getByRole('checkbox', { name: '允许后台提取记忆' })).not.toBeChecked()
})
