import { expect, request, test } from '@playwright/test'
import { bindManaged, buildDaemon, memberWithMachine, remoteRepo } from './helpers'

test.beforeAll(buildDaemon)

/**
 * Two members' machines, one repo: Bob's git rewrites the URL to a path that does not exist (as a machine without
 * credentials would fail). The group binds anyway; Bob's bot is paused and not run, Alice's works.
 */
test('bots whose machine cannot read the group repo are shown, paused and not run', async ({
  page,
  baseURL,
}) => {
  test.setTimeout(5 * 60_000)
  const repo = remoteRepo()
  // Unique per attempt: a retry runs against the same database.
  const bobAccount = `noaccess${Date.now().toString(36)}`
  const root = repo.url.replace(/remote\.git$/, '')

  const bobSession = await request.newContext({ baseURL })
  const bob = await memberWithMachine({ request: bobSession }, bobAccount, {
    env: {
      GIT_CONFIG_COUNT: '1',
      GIT_CONFIG_KEY_0: 'url.file:///nonexistent-gonggong/.insteadOf',
      GIT_CONFIG_VALUE_0: root,
    },
  })
  const bobMe = await bob.api.me()
  const bobBot = await bob.api.call<{ id: string }>('post', '/api/bots', {
    name: '无权限 Codex',
    ownerId: bobMe.id,
    agentKind: 'codex',
    machineId: await bob.api.machineId(),
    systemPrompt: '',
  })

  const alice = await memberWithMachine(page, `access${Date.now().toString(36)}`)
  const aliceMe = await alice.api.me()
  const aliceBot = await alice.api.call<{ id: string }>('post', '/api/bots', {
    name: '有权限 Claude',
    ownerId: aliceMe.id,
    agentKind: 'claude',
    machineId: await alice.api.machineId(),
    systemPrompt: '',
  })
  alice.m.start()
  bob.m.start()
  try {
    // Both machines must be online before the check means anything.
    await expect
      .poll(
        async () => {
          const bots: { id: string; presence: string }[] = await (await page.request.get('/api/bots')).json()
          return [aliceBot.id, bobBot.id].every(
            (id) => !['offline', undefined].includes(bots.find((b) => b.id === id)?.presence),
          )
        },
        { timeout: 60_000 },
      )
      .toBe(true)

    // New group dialog: each bot's machine checks the repo with its own git, as soon as a repo is picked.
    await page.goto('/')
    await page.getByRole('button', { name: '新建群' }).first().click()
    const dialog = page.getByRole('dialog', { name: '新建群' })
    await dialog.getByLabel('名称').fill('权限校验')
    await dialog.getByRole('button', { name: '添加 Bot…' }).click()
    const pick = page.getByRole('dialog', { name: '添加 Bot' })
    await pick.getByRole('menuitemcheckbox', { name: /有权限 Claude/ }).click()
    await pick.getByRole('menuitemcheckbox', { name: /无权限 Codex/ }).click()
    // With two rows the open picker covers its trigger: dismiss it with Escape (closes only the topmost layer).
    await page.keyboard.press('Escape')
    await expect(pick).toBeHidden()
    await dialog.getByRole('button', { name: '仓库', exact: true }).click()
    const panel = page.getByRole('dialog', { name: '选择仓库' })
    await panel.getByLabel('搜索仓库').fill(repo.url)
    await panel.getByRole('option', { name: /使用地址/ }).click()
    const row = (name: string) => dialog.locator('.ng-botrow', { hasText: name })
    await expect(row('有权限 Claude')).toContainText('可访问', { timeout: 60_000 })
    await expect(row('无权限 Codex')).toContainText('无权限 · 进群后暂停')
    await expect(row('无权限 Codex').locator('.repo-access')).toHaveAttribute(
      'title',
      /does not appear to be a git repository/,
    )
    await expect(dialog.getByText('1 个 Bot 进群后暂停，主人配置凭据后可重新检查')).toBeVisible()
    await dialog.getByRole('button', { name: '创建' }).click()
    await expect(page).toHaveURL(/\/g\//)
    const groupId = page.url().split('/g/')[1]!.split(/[?#]/)[0]!

    // Repo groups start every bot on a managed clone: Alice's is ready, Bob's clone fails on access and pauses the bot.
    await bindManaged(page.request, groupId, [aliceBot.id])
    const bobState = async () => {
      const states: { botId: string; state: string; reason: string | null }[] = await (
        await page.request.get(`/api/groups/${groupId}/bot-states`)
      ).json()
      return states.find((s) => s.botId === bobBot.id)
    }
    await expect.poll(bobState, { timeout: 60_000 }).toMatchObject({ state: 'failed', reason: 'denied' })
    await expect(page.getByTestId(`ws-paused-${bobBot.id}`)).toContainText(
      `无权限 Codex 已暂停：所在机器无法访问仓库（无权限或仓库不存在），等待 ${bobAccount} 处理`,
    )

    // @-ing the paused bot explains why nothing runs.
    const before = await page.getByTestId('run-card').count()
    await page.getByPlaceholder('输入消息，@ 触发 Bot 或引用文件，/ 查看命令').fill('@无权限 Codex 看下')
    await page.getByRole('button', { name: '发送' }).click()
    await expect(
      page
        .getByRole('main')
        .getByText(
          `无权限 Codex 所在机器无法访问仓库（无权限或仓库不存在），本次未执行；${bobAccount} 配置后点「重新检查」`,
        ),
    ).toBeVisible()
    await expect(page.getByTestId('run-card')).toHaveCount(before)
  } finally {
    alice.m.stop()
    bob.m.stop()
    await bobSession.dispose()
  }
})
