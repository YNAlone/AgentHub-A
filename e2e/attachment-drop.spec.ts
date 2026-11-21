import { expect, test } from '@playwright/test'

test('拖入多个文件可预览、移除并作为附件发送', async ({ page, request }) => {
  const { conversation } = await (await request.post('/api/conversations', { data: { title: '拖放附件验收', mode: 'single', agentIds: ['ag_e2e_mock'] } })).json()
  await page.goto('/')
  await page.getByRole('complementary').getByText('拖放附件验收', { exact: true }).click()
  const composer = page.locator('[data-surface="composer"]')
  const input = page.getByTestId('composer-input')
  await input.fill('请读取附件')
  const dataTransfer = await page.evaluateHandle(() => {
    const transfer = new DataTransfer()
    transfer.items.add(new File(['first document'], 'first.txt', { type: 'text/plain' }))
    transfer.items.add(new File(['second document'], 'second.txt', { type: 'text/plain' }))
    return transfer
  })
  await composer.dispatchEvent('dragenter', { dataTransfer })
  await expect(composer.getByRole('status')).toHaveText('松开即可添加文件或图片')
  await input.dispatchEvent('dragenter', { dataTransfer })
  await input.dispatchEvent('dragleave', { dataTransfer })
  await expect(composer.getByRole('status')).toBeVisible()
  await input.dispatchEvent('drop', { dataTransfer })
  await expect(composer.getByRole('status')).toHaveCount(0)
  await expect(composer.getByRole('link', { name: /first.txt/ })).toBeVisible()
  await expect(composer.getByRole('link', { name: /second.txt/ })).toBeVisible()
  await composer.getByRole('button', { name: '移除' }).first().click()
  await expect(composer.getByRole('button', { name: '移除' })).toHaveCount(1)
  const response = page.waitForResponse((res) => res.url().endsWith(`/api/conversations/${conversation.id}/messages`) && res.request().method() === 'POST')
  await page.getByTestId('composer-send').click()
  const sent = await response
  expect(sent.request().postDataJSON().attachmentIds).toHaveLength(1)
  expect(sent.ok()).toBe(true)
  await expect(input).toHaveValue('')
  await dataTransfer.dispose()
})

test('上传中禁止发送，失败保留草稿并显示原因', async ({ page, request }) => {
  const { conversation } = await (await request.post('/api/conversations', { data: { title: '拖放上传失败', mode: 'single', agentIds: ['ag_e2e_mock'] } })).json()
  await page.goto('/')
  await page.getByRole('complementary').getByText('拖放上传失败', { exact: true }).click()
  let release!: () => void
  const gate = new Promise<void>((resolve) => { release = resolve })
  await page.route(`**/api/conversations/${conversation.id}/attachments`, async (route) => {
    await gate
    await route.fulfill({ status: 400, json: { error: 'File too large (max 20MB)' } })
  })
  const input = page.getByTestId('composer-input')
  await input.fill('保留这段草稿')
  const dataTransfer = await page.evaluateHandle(() => {
    const transfer = new DataTransfer()
    transfer.items.add(new File(['content'], 'failed.txt', { type: 'text/plain' }))
    return transfer
  })
  try {
    await input.dispatchEvent('drop', { dataTransfer })
    await expect(page.getByTestId('composer-send')).toBeDisabled()
    await input.press('Enter')
    await expect(input).toHaveValue('保留这段草稿')
    release()
    await expect(page.getByRole('alert').filter({ hasText: 'failed.txt' })).toContainText('max 20MB')
    await expect(input).toHaveValue('保留这段草稿')
    await expect(page.getByTestId('composer-send')).toBeEnabled()
  } finally { release(); await dataTransfer.dispose() }
})
