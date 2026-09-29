import { mkdtempSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { expect, test } from '@playwright/test'
import { buildDaemon, memberWithMachine, setDefaultWorkspace } from './helpers'

test.beforeAll(buildDaemon)

const composer = '输入消息，@ 触发 Bot 或引用文件，/ 查看命令'

test('offline bot waits, runs when its machine comes online, and resumes the session after a daemon restart', async ({
  page,
}) => {
  test.setTimeout(6 * 60_000)
  const { m, api } = await memberWithMachine(page, 'offline1')
  const me = await api.me()
  const bot = await api.call<{ id: string }>('post', '/api/bots', {
    name: '离线测试 Claude',
    ownerId: me.id,
    agentKind: 'claude',
    avatar: 'role-no',
    machineId: await api.machineId(),
    systemPrompt: '',
  })
  // The default workspace is checked while the machine is online; the group then joins while it is offline.
  m.start()
  await setDefaultWorkspace(page.request, bot.id, mkdtempSync(join(tmpdir(), 'gonggong-offline-')))
  m.stop()
  const online = async () => (await api.call<{ online: boolean }[]>('get', '/api/machines'))[0]?.online
  await expect.poll(online, { timeout: 30_000 }).toBe(false)
  const group = await api.call<{ id: string }>('post', '/api/groups', {
    name: '离线',
    kind: 'dm',
    botIds: [bot.id],
  })
  await page.goto(`/g/${group.id}`)

  await page.getByPlaceholder(composer).fill('@离线测试 Claude 记住暗号是 42，只回复 记住了')
  await page.getByRole('button', { name: '发送' }).click()
  const first = page.getByTestId('run-card').last()
  await expect(first).toContainText('离线等待')

  m.start()
  try {
    await expect(first).toContainText('已完成', { timeout: 4 * 60_000 })

    // Restart the daemon: the next turn must resume the ACP session and still know the secret.
    m.stop()
    await expect(page.getByText('离线测试 Claude').first()).toBeVisible()
    m.start()
    await page.getByPlaceholder(composer).fill('@离线测试 Claude 暗号是多少？只回复数字')
    await page.getByRole('button', { name: '发送' }).click()
    await expect(page.getByTestId('run-card')).toHaveCount(2)
    const second = page.getByTestId('run-card').nth(1)
    await expect(second).toContainText('已完成', { timeout: 4 * 60_000 })
    await expect(second).not.toContainText('会话恢复失败')
    await expect(page.getByTestId('bot-reply')).toHaveCount(2)
    await expect(page.getByTestId('bot-reply').nth(1)).toContainText('42')
  } finally {
    m.stop()
  }
})

test('a bot waiting for its owner to confirm cannot be triggered', async ({ page }) => {
  const { api } = await memberWithMachine(page, 'pending1')
  const me = await api.me()
  const machineId = await api.machineId()
  // Log in as admin and create a bot for the member → pending_confirm.
  const member = page.request
  await member.post('/api/auth/logout')
  await member.post('/api/auth/login', { data: { account: 'admin', password: 'admin-pass-2' } })
  const bot = await api.call<{ id: string; binding: string }>('post', '/api/bots', {
    name: '待确认 Codex',
    ownerId: me.id,
    agentKind: 'codex',
    avatar: 'role-no',
    machineId,
    systemPrompt: '',
  })
  expect(bot.binding).toBe('pending_confirm')
  await member.post('/api/auth/logout')
  await member.post('/api/auth/login', { data: { account: 'pending1', password: 'member-pass' } })
  const group = await api.call<{ id: string }>('post', '/api/groups', {
    name: '确认',
    kind: 'dm',
    botIds: [bot.id],
  })
  await page.goto(`/g/${group.id}`)
  await page.getByPlaceholder(composer).fill('@待确认 Codex 你好')
  await page.getByRole('button', { name: '发送' }).click()
  await expect(page.getByTestId('run-card').last()).toContainText('无权触发')
})
