import { expect, test } from '@playwright/test'
import Database from 'better-sqlite3'
import path from 'node:path'

test('模型容量按实际端点保存，并显示压缩阈值', async ({ page, request }) => {
  await page.goto('/personal')
  await page.getByRole('button', { name: '上下文', exact: true }).click()
  await page.getByRole('combobox', { name: '容量配置 Agent' }).selectOption({ index: 1 })
  await page.getByRole('spinbutton', { name: '模型总窗口', exact: true }).fill('1000000')
  await page.getByRole('spinbutton', { name: '默认输出预留', exact: true }).fill('8192')
  await page.getByRole('button', { name: '保存模型容量' }).click()
  await expect(page.getByRole('status').filter({ hasText: '模型容量已保存' })).toBeVisible()
  await expect(page.getByText(/可用输入约 971,808/)).toBeVisible()
  const saved = await (await request.get('/api/settings/context-capacity')).json()
  expect(saved.overrides).toEqual(expect.arrayContaining([expect.objectContaining({ contextWindow: 1000000, outputReserve: 8192 })]))
  expect(JSON.stringify(saved)).not.toContain('apiKey')
})

test('暂停现场刷新后可见，恢复保持原 run，取消任务不启动模型', async ({ page, request }) => {
  const { conversation } = await (await request.post('/api/conversations', { data: { title: '上下文恢复验收', mode: 'single', agentIds: ['ag_e2e_mock'] } })).json()
  const sqlite = new Database(path.resolve('.agenthub-data-e2e/agenthub.db'))
  const runId = 'e2e-paused-context'
  try {
    const now = Date.now()
    sqlite.prepare('INSERT INTO messages(id,conversation_id,role,parts,status,mentioned_agent_ids,created_at) VALUES (?,?,?,?,?,?,?)').run('e2e-context-user', conversation.id, 'user', JSON.stringify([{ type: 'text', content: '你好' }]), 'complete', '[]', now)
    sqlite.prepare('INSERT INTO agent_runs(id,conversation_id,agent_id,trigger_message_id,status,error,started_at) VALUES (?,?,?,?,?,?,?)').run(runId, conversation.id, 'ag_e2e_mock', 'e2e-context-user', 'paused', '已暂停，现场已保存', now)
    sqlite.prepare('INSERT INTO run_workflow_journal(run_id,step,value) VALUES (?,?,?)').run(runId, 'args', JSON.stringify({ agentId: 'ag_e2e_mock', conversationId: conversation.id, triggerMessageId: 'e2e-context-user' }))
    await page.goto('/')
    await page.getByRole('complementary').getByText('上下文恢复验收', { exact: true }).click()
    await expect(page.getByRole('status').filter({ hasText: '已暂停，现场已保存' })).toBeVisible()
    await page.reload()
    await page.getByRole('complementary').getByText('上下文恢复验收', { exact: true }).click()
    await expect(page.getByRole('button', { name: '重试并继续' })).toBeVisible()
    await page.getByRole('button', { name: '重试并继续' }).click()
    await expect.poll(() => (sqlite.prepare('SELECT status FROM agent_runs WHERE id=?').get(runId) as { status: string }).status).toBe('complete')
    expect(sqlite.prepare('SELECT count(*) AS n FROM agent_runs WHERE conversation_id=?').get(conversation.id)).toEqual({ n: 1 })
    sqlite.prepare("UPDATE agent_runs SET status='paused',error='已暂停，现场已保存' WHERE id=?").run(runId)
    await page.reload()
    await page.getByRole('complementary').getByText('上下文恢复验收', { exact: true }).click()
    await page.getByRole('button', { name: '取消任务', exact: true }).click()
    await expect.poll(() => (sqlite.prepare('SELECT status FROM agent_runs WHERE id=?').get(runId) as { status: string }).status).toBe('aborted')
  } finally { sqlite.close() }
})
