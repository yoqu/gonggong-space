import { expect, test } from '@playwright/test'
import { bindManaged, buildDaemon, memberWithMachine, remoteRepo } from './helpers'

test.beforeAll(buildDaemon)

/**
 * The repo is picked from 「最近」 (the team history only keeps remote URLs, so the daemon's git maps a fake https
 * host to the local bare repo), checked automatically, and the owner later moves their bot from the managed clone
 * to a local checkout in 「仓库与工作区」.
 */
test('picks a recent repo and moves my bot to a local checkout', async ({ page }) => {
  test.setTimeout(5 * 60_000)
  const repo = remoteRepo()
  const url = 'https://git.e2e/team/remote.git'
  // Unique per attempt: a retry runs against the same database.
  const tag = Date.now().toString(36)
  const botName = `工作区 Claude ${tag}`
  const me = await memberWithMachine(page, `rw${tag}`, {
    env: {
      GIT_CONFIG_COUNT: '1',
      GIT_CONFIG_KEY_0: `url.file://${repo.root}/.insteadOf`,
      GIT_CONFIG_VALUE_0: 'https://git.e2e/team/',
    },
  })
  const bot = await me.api.call<{ id: string }>('post', '/api/bots', {
    name: botName,
    ownerId: (await me.api.me()).id,
    agentKind: 'claude',
    machineId: await me.api.machineId(),
    systemPrompt: '',
  })
  // Puts the repo into the team history.
  await me.api.call('post', '/api/groups', {
    name: '历史',
    kind: 'group',
    memberIds: [],
    botIds: [],
    repo: { url, branch: 'main' },
  })
  const local = repo.cloneTo('local')
  repo.git(local, 'remote', 'set-url', 'origin', url)
  me.m.start()
  try {
    await expect
      .poll(
        async () => {
          const bots: { id: string; presence: string }[] = await (await page.request.get('/api/bots')).json()
          return bots.find((b) => b.id === bot.id)?.presence
        },
        { timeout: 60_000 },
      )
      .not.toBe('offline')

    await page.goto('/')
    await page.getByRole('button', { name: '新建群' }).first().click()
    const dialog = page.getByRole('dialog', { name: '新建群' })
    await dialog.getByRole('button', { name: '添加 Bot…' }).click()
    await page
      .getByRole('dialog', { name: '添加 Bot' })
      .getByRole('menuitemcheckbox', { name: new RegExp(botName) })
      .click()
    await dialog.getByRole('button', { name: '添加 Bot…' }).click()
    await dialog.getByRole('button', { name: '仓库', exact: true }).click()
    const panel = page.getByRole('dialog', { name: '选择仓库' })
    await panel.getByRole('option', { name: /team\/remote/ }).click()
    await expect(dialog.getByLabel('名称')).toHaveValue('remote')
    await expect(dialog.locator('.ng-botrow', { hasText: botName })).toContainText('可访问', {
      timeout: 60_000,
    })
    const created = page.waitForResponse(
      (r) => r.url().endsWith('/api/groups') && r.request().method() === 'POST',
    )
    await dialog.getByRole('button', { name: '创建' }).click()
    const groupId: string = (await (await created).json()).id
    await bindManaged(page.request, groupId, [bot.id])

    const main = page.getByRole('main')
    await main.getByRole('button', { name: '群设置' }).click()
    const drawer = page.getByRole('complementary', { name: '群设置' })
    await drawer.getByRole('button', { name: /仓库与工作区/ }).click()
    const row = drawer.getByTestId(`rw-bot-${bot.id}`)
    await expect(row).toContainText('托管克隆 · 就绪')
    await row.getByRole('button', { name: '更改…' }).click()
    const picker = page.getByRole('dialog', { name: `为 ${botName} 选择工作区` })
    await expect(picker.getByLabel('目录路径')).not.toHaveValue('')
    await picker.getByLabel('目录路径').fill(local)
    await picker.getByLabel('目录路径').press('Enter')
    await picker.getByRole('button', { name: '选择此目录' }).click()
    await expect(main.getByText(/已绑定到 .+（本机目录）/)).toBeVisible({ timeout: 60_000 })
    await expect(row).toContainText(local.slice(-10), { timeout: 30_000 })
  } finally {
    me.m.stop()
  }
})
