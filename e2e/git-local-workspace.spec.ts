import { mkdtempSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { expect, test } from '@playwright/test'
import { buildDaemon, memberWithMachine, remoteRepo } from './helpers'

test.use({ actionTimeout: 10_000 })

test.beforeAll(buildDaemon)

test('detects and operates on a local Git workspace without a group repository', async ({ page }) => {
  test.setTimeout(180_000)
  const tag = Date.now().toString(36)
  const repo = remoteRepo()
  const local = repo.cloneTo('local')
  repo.git(local, 'remote', 'remove', 'origin')
  const plain = mkdtempSync(join(tmpdir(), 'gonggong-plain-'))
  const { m, api } = await memberWithMachine(page, `localgit${tag}`, {
    env: {
      GONGGONG_NO_AUTO_UPGRADE: '1',
      GIT_AUTHOR_NAME: 'e2e',
      GIT_AUTHOR_EMAIL: 'e2e@gonggong',
      GIT_COMMITTER_NAME: 'e2e',
      GIT_COMMITTER_EMAIL: 'e2e@gonggong',
    },
  })
  const name = `本地 Git ${tag}`
  const bot = await api.call<{ id: string }>('post', '/api/bots', {
    name,
    ownerId: (await api.me()).id,
    agentKind: 'claude',
    machineId: await api.machineId(),
    systemPrompt: '',
  })
  m.start()
  try {
    await expect
      .poll(async () => (await api.call<{ online: boolean }[]>('get', '/api/machines'))[0]?.online, {
        timeout: 60_000,
      })
      .toBe(true)
    const group = await api.call<{ id: string }>('post', '/api/groups', {
      name: `本地工作区 ${tag}`,
      kind: 'group',
      botIds: [bot.id],
    })
    const bind = (path: string) =>
      page.request.put(`/api/groups/${group.id}/bots/${bot.id}/workspace`, { data: { path } })
    expect((await bind(local)).status()).toBe(204)
    await page.goto(`/g/${group.id}`)
    const item = page.getByTestId('git-bar').getByTestId(`git-${bot.id}`)
    const openGit = item.getByRole('button', { name: `打开 ${name} 的 Git` })
    await expect(openGit).toBeVisible({ timeout: 60_000 })
    await expect(openGit).toContainText('main')
    await openGit.click()
    const git = page.getByTestId('git-tab')
    writeFileSync(join(local, 'new.txt'), 'local Git works\n')
    await git.getByRole('button', { name: '获取远程更新' }).click()
    await expect(git.getByRole('button', { name: '未跟踪：new.txt' })).toBeVisible({ timeout: 30_000 })
    await git.getByRole('checkbox', { name: '选择 new.txt' }).locator('..').locator('.ui-check__box').click()
    await git.getByRole('textbox', { name: '提交说明' }).fill('local workspace change')
    await git.getByRole('button', { name: '提交', exact: true }).click()
    await expect(git).toContainText('没有未提交的改动', { timeout: 30_000 })
    expect(repo.git(local, 'log', '-1', '--format=%s').trim()).toBe('local workspace change')
    expect((await bind(plain)).status()).toBe(204)
    await expect(openGit).toHaveCount(0, { timeout: 30_000 })
  } finally {
    m.stop()
  }
})
