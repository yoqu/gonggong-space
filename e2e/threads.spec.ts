import { join } from 'node:path'
import { expect, type Page, test } from '@playwright/test'
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

type Setup = Awaited<ReturnType<typeof memberWithMachine>>

async function groupWithBot(page: Page, { api }: Setup, account: string, name: string) {
  const bot = await api.call<{ id: string }>('post', '/api/bots', {
    name: `${account} Bot`,
    ownerId: (await api.me()).id,
    agentKind: 'claude',
    machineId: await api.machineId(),
    systemPrompt: '',
  })
  const group = await api.call<{ id: string }>('post', '/api/groups', {
    name,
    kind: 'group',
    botIds: [bot.id],
    repo: null,
  })
  await bindManaged(page.request, group.id, [bot.id])
  return group.id
}

/** Sends `body` to the main channel and opens the thread of the sent message. */
async function openThreadOf(page: Page, body: string) {
  await page.getByPlaceholder(composer).fill(body)
  await page.getByRole('button', { name: '发送' }).click()
  const root = page.getByRole('main').locator('.pn-msg', { hasText: body })
  await root.hover()
  await root.getByRole('button', { name: '回复话题' }).click()
  return page.getByRole('complementary', { name: '话题' })
}

test('an open thread sits beside the workbench without overlapping it', async ({ page }) => {
  test.setTimeout(3 * 60_000)
  const setup = await memberWithMachine(page, 'th2', { env: { GONGGONG_ADAPTER_CMD: MOCK } })
  setup.m.start()
  try {
    await page.goto(`/g/${await groupWithBot(page, setup, 'th2', '话题工作台')}`)
    const rail = await openThreadOf(page, '看一下运行过程')
    await rail.getByPlaceholder(threadComposer).fill('@th2 Bot mock:say 好的')
    await rail.getByRole('button', { name: '发送' }).click()
    const reply = rail.getByTestId('bot-reply').filter({ hasText: '好的' })
    await expect(reply).toBeVisible({ timeout: 60_000 })
    await reply.hover()
    await reply.getByRole('button', { name: '查看过程' }).click()

    const bench = page.getByRole('region', { name: '工作台' })
    await expect(bench).toBeVisible()
    await expect(rail).toBeVisible()
    await expect(async () => {
      const [a, b] = [(await rail.boundingBox())!, (await bench.boundingBox())!]
      expect(a.x + a.width <= b.x + 1 || b.x + b.width <= a.x + 1).toBe(true)
    }).toPass()
  } finally {
    setup.m.stop()
  }
})

test('a bot answering in a closed thread is listed, then marks the sidebar until the thread is read', async ({
  page,
}) => {
  test.setTimeout(3 * 60_000)
  const setup = await memberWithMachine(page, 'th3', { env: { GONGGONG_ADAPTER_CMD: MOCK } })
  setup.m.start()
  try {
    await page.goto(`/g/${await groupWithBot(page, setup, 'th3', '话题列表')}`)
    const rail = await openThreadOf(page, '稍后回复我')
    await rail.getByPlaceholder(threadComposer).fill('@th3 Bot mock:delay 20000 mock:say 想好了')
    await rail.getByRole('button', { name: '发送' }).click()
    await expect(rail.locator('.pn-msg', { hasText: 'mock:delay' })).toBeVisible()
    await rail.getByRole('button', { name: '关闭话题' }).click()
    await expect(rail).toHaveCount(0)

    await page.getByRole('button', { name: '话题', exact: true }).click()
    const list = page.getByRole('complementary', { name: '本群话题' })
    await expect(list.getByTestId('group-thread')).toContainText('Bot 回复中', { timeout: 30_000 })

    const sidebar = page.getByTestId('threads-item')
    await expect(sidebar.locator('.ui-badge')).toHaveText('1', { timeout: 60_000 })
    await sidebar.click()
    await page.getByRole('article').filter({ hasText: '稍后回复我' }).getByRole('button').first().click()
    await expect(
      page.getByRole('complementary', { name: '话题' }).getByText('想好了', { exact: true }),
    ).toBeVisible()
    await expect(sidebar.locator('.ui-badge')).toHaveCount(0)
  } finally {
    setup.m.stop()
  }
})

test.describe('on a phone', () => {
  test.use({ viewport: { width: 390, height: 844 }, hasTouch: true })

  test('the thread and the group thread list open full screen, close, and keep the composer in view', async ({
    page,
  }) => {
    test.setTimeout(3 * 60_000)
    const setup = await memberWithMachine(page, 'th4', { env: { GONGGONG_ADAPTER_CMD: MOCK } })
    setup.m.start()
    try {
      const groupId = await groupWithBot(page, setup, 'th4', '手机话题')
      const root = await setup.api.call<{ id: string }>('post', `/api/groups/${groupId}/messages`, {
        body: '手机上的话题',
        clientId: 'th4-root-0001',
      })
      await setup.api.call('post', `/api/groups/${groupId}/messages`, {
        body: '一条回复',
        clientId: 'th4-reply-0001',
        threadRootId: root.id,
      })
      // Polled: the panels slide in.
      const inView = (el: ReturnType<Page['locator']>) =>
        expect(async () => {
          const box = (await el.boundingBox())!
          expect(box.x).toBeGreaterThanOrEqual(0)
          expect(box.x + box.width).toBeLessThanOrEqual(390.5)
          expect(box.y + box.height).toBeLessThanOrEqual(844.5)
        }).toPass()
      const fullWidth = (el: ReturnType<Page['locator']>) =>
        expect.poll(async () => (await el.boundingBox())?.width ?? 0).toBeGreaterThanOrEqual(389)

      await page.goto(`/g/${groupId}?thread=${root.id}`)
      const rail = page.getByRole('complementary', { name: '话题' })
      await expect(rail.getByText('一条回复')).toBeVisible()
      await fullWidth(rail)
      await inView(rail.getByPlaceholder(threadComposer))
      await rail.getByRole('button', { name: '关闭话题' }).click()
      await expect(rail).toHaveCount(0)

      await page.getByRole('button', { name: '话题', exact: true }).click()
      const list = page.getByRole('complementary', { name: '本群话题' })
      await fullWidth(list)
      await list.getByTestId('group-thread').click()
      await expect(rail.getByText('一条回复')).toBeVisible()
      await inView(rail.getByPlaceholder(threadComposer))
      await rail.getByRole('button', { name: '返回' }).click()
      await expect(list).toBeVisible()
      await list.getByRole('button', { name: '关闭话题' }).click()
      await expect(list).toHaveCount(0)
    } finally {
      setup.m.stop()
    }
  })
})
