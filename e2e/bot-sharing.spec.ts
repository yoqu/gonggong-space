import { expect, type Page, test } from '@playwright/test'
import { adminSession, buildDaemon, call, memberWithMachine } from './helpers'

test.beforeAll(buildDaemon)

const composer = '输入消息，@ 触发 Bot 或引用文件，/ 查看命令'

/** A member without a machine, logged into `page`. */
async function member(page: Page, account: string) {
  const api = page.request
  await adminSession(api)
  await call(api, 'post', '/api/admin/users', {
    account,
    name: account,
    role: 'member',
    password: 'init-pass-1',
  })
  await call(api, 'post', '/api/auth/logout')
  await api.post('/api/auth/login', { data: { account, password: 'init-pass-1' } })
  await call(api, 'post', '/api/auth/password', { oldPassword: 'init-pass-1', newPassword: 'member-pass' })
}

test('a shared bot: DM in its own workspace, the owner approves from the notification, unsharing closes the DM', async ({
  page,
  browser,
}) => {
  test.setTimeout(10 * 60_000)
  const { m, api } = await memberWithMachine(page, 'sharer1')
  const bot = await api.call<{ id: string }>('post', '/api/bots', {
    name: '共享 Bot',
    ownerId: (await api.me()).id,
    agentKind: 'claude',
    avatar: 'role-no',
    machineId: await api.machineId(),
    systemPrompt: '',
  })
  // Only its owner may trigger it in groups: the share alone lets the other member use it.
  await api.call('patch', `/api/bots/${bot.id}`, { triggerScope: 'self' })
  const other = await (await browser.newContext()).newPage()
  await member(other, 'sharee1')
  m.start()
  try {
    // 1. The owner shares it from the bot editor.
    await page.goto(`/bot/${bot.id}`)
    await page.getByRole('button', { name: '编辑 Bot' }).click()
    const dialog = page.getByRole('dialog', { name: 'Bot 详情' })
    await dialog.getByRole('tab', { name: '共享' }).click()
    await dialog.getByRole('button', { name: '添加成员…' }).click()
    const picker = page.getByRole('dialog', { name: '添加成员' })
    await picker.getByRole('menuitemcheckbox', { name: /sharee1/ }).click()
    await picker.getByRole('button', { name: '添加 1 人' }).click()
    await expect(dialog.getByRole('list', { name: '共享对象' })).toContainText('sharee1')
    await page.keyboard.press('Escape')

    // 2. The member finds it under 共享给我 and starts a DM from its page.
    await other.goto('/')
    const shared = other.getByRole('region', { name: '共享给我' })
    await shared.getByRole('link', { name: /共享 Bot/ }).click()
    await expect(other.getByText('sharer1 共享给你')).toBeVisible()
    await other.getByRole('button', { name: '私聊' }).click()
    await expect(other.getByRole('heading', { name: '共享 Bot · sharer1' })).toBeVisible()
    await expect(other.getByText('共享 Bot 加入 · 使用独立的托管工作区')).toBeVisible()

    // 3. A floor command still asks the owner, who decides right from the notification.
    await other
      .getByPlaceholder(composer)
      .fill('请用 Bash 工具执行命令 `sudo -n true`，然后只回复「已处理」。')
    await other.getByRole('button', { name: '发送' }).click()
    const card = other.getByTestId('run-card').last()
    await expect(card).toContainText('等待审批', { timeout: 3 * 60_000 })
    await page.goto('/')
    await page.getByRole('button', { name: /^通知/ }).click()
    await page.getByTestId('notification-list').getByRole('button', { name: '拒绝' }).click()
    await expect(card).toContainText('sharer1 已拒绝')
    await expect(card).toHaveAttribute('data-status', 'completed', { timeout: 3 * 60_000 })

    // 4. Unsharing turns the DM read-only.
    await page.goto(`/bot/${bot.id}`)
    await page.getByRole('button', { name: '管理共享' }).click()
    await dialog.getByRole('button', { name: '移除 sharee1' }).click()
    await expect(dialog.getByText('还没有共享给任何人')).toBeVisible()
    await expect(other.getByText('Bot 已取消共享或已删除，只能查看历史消息。')).toBeVisible()
    await expect(other.getByPlaceholder(composer)).toHaveCount(0)
  } finally {
    m.stop()
  }
})
