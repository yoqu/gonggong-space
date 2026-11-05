import { execFileSync } from 'node:child_process'
import { mkdirSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { expect, test } from '@playwright/test'
import { buildDaemon, memberWithMachine } from './helpers'

test.beforeAll(buildDaemon)

test('机器详情: the daemon log and its workspaces, read and cleaned through the real daemon', async ({
  page,
}) => {
  test.setTimeout(3 * 60_000)
  const { m, api } = await memberWithMachine(page, `madm${Date.now().toString(36)}`)
  // A leftover managed clone of a group the server never heard of: removed, so it can be slimmed and deleted.
  const leftover = join(m.home, 'workspaces', 'gone-group', 'gone-bot', 'r1')
  const clone = join(leftover, 'app')
  mkdirSync(clone, { recursive: true })
  writeFileSync(join(clone, 'a.txt'), 'a')
  const git = (...args: string[]) => execFileSync('git', ['-C', clone, ...args])
  git('init', '-q')
  git('add', '.')
  git('-c', 'user.name=t', '-c', 'user.email=t@t', 'commit', '-qm', 'one')
  m.start()
  try {
    const id = await api.machineId()
    await page.goto(`/machine/${id}`)
    const details = page.getByRole('region', { name: '机器详情' })
    await expect(details.locator('.machine__status[data-online="true"]')).toBeVisible({ timeout: 30_000 })

    await details.getByRole('tab', { name: '诊断' }).click()
    await expect(details.locator('.machine-logs')).toContainText('INFO', { timeout: 15_000 })

    await details.getByRole('tab', { name: '工作区' }).click()
    const list = details.getByRole('region', { name: '工作区' })
    await expect(list).toContainText(leftover)
    await expect(list).toContainText('已移出')
    await expect(list).toContainText('1 个未推送')
    await list.getByRole('button', { name: '瘦身' }).click()
    await expect(page.getByText(/已释放/)).toBeVisible({ timeout: 30_000 })
    await list.getByRole('checkbox', { name: 'gone-bot' }).locator('..').locator('.ui-check__box').click()
    await list.getByRole('button', { name: '删除所选' }).click()
    const confirm = page.getByRole('alertdialog', { name: '删除所选的 1 个工作区？' })
    await expect(confirm).toContainText('没推送的改动')
    await confirm.getByRole('button', { name: '删除' }).click()
    await expect(list).toContainText('这台机器上还没有工作区')
  } finally {
    m.stop()
  }
})
