import { expect, test } from '@playwright/test'
import Database from 'better-sqlite3'
import path from 'node:path'

test('运行中可输入并排队，刷新后保留，前序结束后按序执行', async ({ page, request }) => {
  const { conversation } = await (await request.post('/api/conversations', { data: { title: '消息队列验收', mode: 'single', agentIds: ['ag_e2e_mock'] } })).json()
  const sqlite = new Database(path.resolve('.agenthub-data-e2e/agenthub.db'))
  try {
    // Hold the preceding turn without depending on model speed or charging a provider.
    sqlite.prepare("INSERT INTO agent_runs(id,conversation_id,agent_id,status,started_at) VALUES (?,?,?,'running',?)").run('queue-held', conversation.id, 'ag_e2e_mock', Date.now())
    await page.goto('/')
    await page.getByRole('complementary').getByText('消息队列验收', { exact: true }).click()
    const input = page.getByTestId('composer-input')
    await expect(page.getByTestId('composer-abort')).toBeVisible()
    await expect(input).toBeEnabled()
    for (const content of ['你好，第一条排队消息', '你好，第二条排队消息']) {
      await input.fill(content)
      await page.getByTestId('composer-send').click()
      await expect(input).toHaveValue('')
    }
    await expect(page.locator('[data-role="user"][data-status="queued"]')).toHaveCount(2)
    await page.reload()
    await page.getByRole('complementary').getByText('消息队列验收', { exact: true }).click()
    await expect(page.locator('[data-role="user"][data-status="queued"]')).toHaveCount(2)
    sqlite.prepare("UPDATE agent_runs SET status='complete',finished_at=? WHERE id='queue-held'").run(Date.now())
    await expect(page.locator('[data-role="agent"][data-status="complete"]')).toHaveCount(2, { timeout: 45_000 })
    await expect(page.locator('[data-role="user"][data-status="queued"]')).toHaveCount(0)
    const runs = sqlite.prepare("SELECT started_at,finished_at FROM agent_runs WHERE conversation_id=? AND id!='queue-held' ORDER BY started_at").all(conversation.id) as { started_at: number; finished_at: number }[]
    expect(runs).toHaveLength(2)
    expect(runs[1].started_at).toBeGreaterThanOrEqual(runs[0].finished_at)
  } finally { sqlite.close() }
})

test('发送遇到认证失败时保留输入，不弹未处理异常', async ({ page, request }) => {
  const { conversation } = await (await request.post('/api/conversations', { data: { title: '发送失败保留', mode: 'single', agentIds: ['ag_e2e_mock'] } })).json()
  await page.goto('/')
  await page.getByRole('complementary').getByText('发送失败保留', { exact: true }).click()
  await page.route(`**/api/conversations/${conversation.id}/messages`, (route) => route.request().method() === 'POST'
    ? route.fulfill({ status: 401, body: '{"error":"Pair this browser"}' }) : route.continue())
  const input = page.getByTestId('composer-input')
  await input.fill('这条输入不能丢失')
  await input.press('Enter')
  await expect(page.getByRole('alert').filter({ hasText: '配对已失效' })).toBeVisible()
  await expect(input).toHaveValue('这条输入不能丢失')
})
