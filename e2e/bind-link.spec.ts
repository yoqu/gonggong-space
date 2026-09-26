import { expect, type Page, test } from '@playwright/test'
import { adminSession, bindManaged, buildDaemon, memberWithMachine } from './helpers'

test.beforeAll(buildDaemon)

const composer = '输入消息，@ 触发 Bot 或引用文件，/ 查看命令'

async function say(page: Page, text: string) {
  await page.getByPlaceholder(composer).fill(text)
  await page.getByRole('button', { name: '发送' }).click()
}

test('bind via 接入链接; the owner sets the allowlist on the web and the daemon applies it', async ({
  page,
}) => {
  test.setTimeout(10 * 60_000)
  const { m, api } = await memberWithMachine(page, 'link1', 'link')
  const me = await api.me()
  const bot = await api.call<{ id: string }>('post', '/api/bots', {
    name: '白名单',
    ownerId: me.id,
    agentKind: 'claude',
    machineId: await api.machineId(),
    systemPrompt: '',
  })

  // Only the owner may change command approval, not even a sysadmin.
  const ctx = await page.context().browser()!.newContext({ baseURL: 'http://127.0.0.1:5190' })
  await adminSession(ctx.request)
  const denied = await ctx.request.patch(`/api/bots/${bot.id}`, { data: { approval: 'all' } })
  expect(denied.status()).toBe(403)
  await ctx.close()

  const saved = await api.call<{ approval: string; allowlist: string[] }>('patch', `/api/bots/${bot.id}`, {
    approval: 'allowlist',
    allowlist: ['node  -e', 'node -e'],
  })
  expect(saved).toMatchObject({ approval: 'allowlist', allowlist: ['node -e'] })

  const group = await api.call<{ id: string }>('post', '/api/groups', {
    name: '接入链接',
    kind: 'group',
    memberIds: [],
    botIds: [bot.id],
  })
  m.start()
  try {
    await bindManaged(page.request, group.id, [bot.id])
    await page.goto(`/g/${group.id}`)
    await say(
      page,
      "@白名单 请用 Bash 工具执行命令 `node -e \"console.log('allow-' + 'listed')\"`，然后只回复命令的输出。",
    )
    const card = page.getByTestId('run-card').filter({ hasText: '白名单' })
    await expect(card).toHaveAttribute('data-status', 'completed', { timeout: 3 * 60_000 })
    await expect(card).not.toContainText('等待审批')
    await expect(page.getByTestId('bot-reply').filter({ hasText: 'allow-listed' })).toHaveCount(1)
  } finally {
    m.stop()
  }
})
