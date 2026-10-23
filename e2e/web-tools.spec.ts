import { expect, test } from '@playwright/test'

// Exercise the actual settings flow without consuming paid search-provider credits.
test('所有 Agent 的联网配置可保存、保留和清除，浏览器不收到密钥', async ({ page, request, browser }) => {
  const anonymous = await browser.newContext({ storageState: { cookies: [], origins: [] } })
  try {
    expect((await anonymous.request.get('http://127.0.0.1:3130/api/settings/web-tools')).status()).toBe(401)
    await page.goto('/')
    await page.getByRole('button', { name: 'API 设置', exact: true }).click()
    await page.getByRole('tab', { name: '联网工具' }).click()
    const input = page.getByLabel('Tavily API Key')
    await input.fill('e2e-fake-tavily-key')
    await page.getByRole('button', { name: '保存联网配置' }).click()
    await expect(page.getByText('已配置 · 应用设置', { exact: true })).toBeVisible()
    await expect(input).toHaveValue('')
    const status = await (await request.get('/api/settings/web-tools')).json()
    expect(status.stored).toBe(true)
    expect(JSON.stringify(status)).not.toContain('e2e-fake-tavily-key')
    await page.getByRole('button', { name: '保存联网配置' }).click()
    await expect(page.getByRole('button', { name: '保存联网配置' })).toBeEnabled()
    expect((await (await request.get('/api/settings/web-tools')).json()).stored).toBe(true)
    await page.getByRole('button', { name: '清除已保存 Key' }).click()
    await expect(page.getByRole('button', { name: '清除已保存 Key' })).toBeDisabled()
    expect((await (await request.get('/api/settings/web-tools')).json()).stored).toBe(false)
  } finally {
    await request.patch('/api/settings/web-tools', { data: { apiKey: null } })
    await anonymous.close()
  }
})
