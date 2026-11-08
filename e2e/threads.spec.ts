import { join } from 'node:path'
import { expect, test } from '@playwright/test'
import { bindManaged, buildDaemon, memberWithMachine, ROOT } from './helpers'

test.beforeAll(buildDaemon)

const composer = '输入消息，@ 触发 Bot 或引用文件，/ 查看命令'
const threadComposer = '回复话题，@ 触发 Bot'
const MOCK = `node ${join(ROOT, 'tools/mock-agent/agent.js')}`

test('a bot asked in a thread answers there; the main timeline only shows the reply bar', async ({
  page,
}) => {
  test.setTimeout(3 * 60_000)
  const { m, api } = await memberWithMachine(page, 'th1', { env: { GONGGONG_ADAPTER_CMD: MOCK } })
  const me = await api.me()
  const bot = await api.call<{ id: string }>('post', '/api/bots', {
    name: 'th1 Bot',
    ownerId: me.id,
    agentKind: 'claude',
    machineId: await api.machineId(),
    systemPrompt: '',
  })
  m.start()
  try {
    const group = await api.call<{ id: string }>('post', '/api/groups', {
      name: '话题',
      kind: 'group',
      botIds: [bot.id],
      repo: null,
    })
    await bindManaged(page.request, group.id, [bot.id])
    await page.goto(`/g/${group.id}`)
    const main = page.getByRole('main')

    await page.getByPlaceholder(composer).fill('退款接口要不要拆？')
    await page.getByRole('button', { name: '发送' }).click()
    const root = main.locator('.pn-msg', { hasText: '退款接口要不要拆？' })
    await root.hover()
    await root.getByRole('button', { name: '回复话题' }).click()

    const rail = page.getByRole('complementary', { name: '话题' })
    await rail.getByPlaceholder(threadComposer).fill('@th1 Bot mock:say 建议拆')
    await rail.getByRole('button', { name: '发送' }).click()
    await expect(rail.getByText('建议拆', { exact: true })).toBeVisible({ timeout: 60_000 })

    await expect(main.getByRole('button', { name: /2 条回复/ })).toBeVisible()
    await expect(main.getByText('建议拆', { exact: true })).toHaveCount(0)

    // Followed by taking part: the inbox lists it and opens it again.
    await page.goto('/threads')
    const card = page.getByRole('button', { name: /退款接口要不要拆？/ })
    await expect(card).toContainText('建议拆')
    await card.click()
    await expect(
      page.getByRole('complementary', { name: '话题' }).getByText('建议拆', { exact: true }),
    ).toBeVisible()
  } finally {
    m.stop()
  }
})
