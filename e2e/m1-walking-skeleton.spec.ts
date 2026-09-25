import { existsSync, mkdtempSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { expect, test } from '@playwright/test'
import { buildDaemon, changePassword, login, logout, machine } from './helpers'

test.beforeAll(buildDaemon)

test('admin creates a member → member binds a machine, creates a bot and gets a real run', async ({
  page,
}) => {
  test.setTimeout(5 * 60_000)

  // Bootstrap admin must change the initial password, then creates a member account.
  await login(page, 'admin', 'admin-init-pass')
  await changePassword(page, 'admin-init-pass', 'admin-pass-2')
  await page.goto('/admin/users')
  await page.getByRole('button', { name: '新建账号' }).click()
  await page.getByLabel('账号').fill('wanglei')
  await page.getByLabel('姓名').fill('王磊')
  await page.getByLabel('初始密码').fill('wanglei-init')
  await page.getByRole('button', { name: '创建' }).click()
  await expect(page.getByRole('cell', { name: 'wanglei' })).toBeVisible()
  await logout(page)

  // Member first login.
  await login(page, 'wanglei', 'wanglei-init')
  await changePassword(page, 'wanglei-init', 'wanglei-pass')

  // Bind this machine with a one-time code.
  await page.getByRole('button', { name: '账户菜单' }).click()
  await page.getByTestId('account-menu').getByRole('button', { name: '绑定新机器' }).click()
  const code = (await page.getByTestId('bind-code').textContent())?.trim() ?? ''
  expect(code).toMatch(/^[A-Z0-9]{4}-[A-Z0-9]{4}$/)
  const m = machine()
  expect(m.login(code)).toContain('绑定成功')
  await expect(page.getByText('绑定成功')).toBeVisible()
  await page.keyboard.press('Escape')
  m.start()

  try {
    // Create a bot for myself from the sidebar: bound directly to the machine.
    await page.getByRole('button', { name: '新建 Bot', exact: true }).click()
    await page.getByRole('button', { name: /Claude Code/ }).click()
    await page.getByLabel('名称').fill('小王的 Claude')
    await page.getByRole('button', { name: '创建并绑定' }).click()
    await expect(page.getByText('小王的 Claude').first()).toBeVisible()

    // Private chat without a repo, with that bot.
    await page.getByRole('button', { name: '新建私聊' }).click()
    await page.getByLabel('名称').fill('脚本实验')
    await page.getByRole('tab', { name: '暂不绑定' }).click()
    await page.getByRole('button', { name: /小王的 Claude/ }).click()
    await page.getByRole('button', { name: '创建' }).click()

    // The bot joins unbound; its owner picks a local directory through the daemon-backed picker.
    const dir = mkdtempSync(join(tmpdir(), 'gonggong-dm-'))
    await page.getByRole('button', { name: '绑定工作区' }).click()
    const picker = page.getByRole('dialog', { name: '小王的 Claude 的工作目录' })
    // Starts at the machine's home dir once the daemon answers.
    await expect(picker.getByLabel('目录路径')).not.toHaveValue('')
    await picker.getByLabel('目录路径').fill(dir)
    await picker.getByLabel('目录路径').press('Enter')
    await expect(picker.getByText('没有子目录')).toBeVisible()
    await picker.getByRole('button', { name: '选择此目录' }).click()
    await expect(page.getByRole('main').getByText(/已绑定到 .+（本机目录）/)).toBeVisible({ timeout: 30_000 })

    // @ the bot → run card goes running → completed, final reply shows up, file lands in the chosen directory.
    const box = page.getByPlaceholder('输入消息，@ 触发 Bot 或引用文件，/ 查看命令')
    await box.fill('@小王的 Claude 请在当前工作目录创建文件 hello.txt，内容只有 hi。完成后只回复 done。')
    await page.getByRole('button', { name: '发送' }).click()
    const card = page.getByTestId('run-card').last()
    await expect(card).toContainText(/运行中|已完成/, { timeout: 60_000 })
    await expect(card).toContainText('已完成', { timeout: 4 * 60_000 })
    await expect(page.getByTestId('bot-reply').last()).toBeVisible()
    expect(existsSync(join(dir, 'hello.txt'))).toBe(true)
  } finally {
    m.stop()
  }
})
