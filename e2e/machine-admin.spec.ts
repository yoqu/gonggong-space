import { mkdirSync } from 'node:fs'
import { join } from 'node:path'
import { expect, test } from '@playwright/test'
import { buildDaemon, memberWithMachine } from './helpers'

test.beforeAll(buildDaemon)

test('我的机器管理: the daemon log and its workspaces, read and cleaned through the real daemon', async ({
  page,
}) => {
  test.setTimeout(3 * 60_000)
  const { m, api } = await memberWithMachine(page, `madm${Date.now().toString(36)}`)
  // A leftover managed workspace of a group the server never heard of: removed, so it can be cleaned.
  const leftover = join(m.home, 'workspaces', 'gone-group', 'gone-bot', '_empty')
  mkdirSync(leftover, { recursive: true })
  m.start()
  try {
    const id = await api.machineId()
    await page.goto(`/machine/${id}`)
    const details = page.getByRole('region', { name: '机器详情' })
    await expect(details.getByRole('tab', { name: '日志' })).toBeEnabled({ timeout: 30_000 })

    await details.getByRole('tab', { name: '日志' }).click()
    await expect(details.locator('.machine-logs')).toContainText('INFO', { timeout: 15_000 })

    await details.getByRole('tab', { name: '工作区' }).click()
    const list = details.getByRole('region', { name: '工作区' })
    await expect(list).toContainText(leftover)
    await expect(list).toContainText('已移出')
    await list.getByRole('button', { name: '删除' }).click()
    await page
      .getByRole('alertdialog', { name: '删除这个工作区？' })
      .getByRole('button', { name: '删除' })
      .click()
    await expect(list).toContainText('这台机器上还没有工作区')
  } finally {
    m.stop()
  }
})
