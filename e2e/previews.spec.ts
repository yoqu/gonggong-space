import { join } from 'node:path'
import { expect, type Page, test } from '@playwright/test'
import { bindManaged, buildDaemon, memberWithMachine, ROOT } from './helpers'

test.beforeAll(buildDaemon)

const composer = '输入消息，@ 触发 Bot 或引用文件，/ 查看命令'
// Scripted agent: `mock:tool <name> <json>` calls the built-in gonggong tool; no model involved.
const MOCK = `node ${join(ROOT, 'tools/mock-agent/agent.js')}`
const PORT = 18765

async function say(page: Page, text: string) {
  await page.getByPlaceholder(composer).fill(text)
  await page.getByRole('button', { name: '发送' }).click()
}

test('a bot hosts a dev server and publishes it; members open it, embed a static site and close it', async ({
  page,
  context,
}) => {
  test.setTimeout(5 * 60_000)
  const { m, api } = await memberWithMachine(page, 'pv1', { env: { GONGGONG_ADAPTER_CMD: MOCK } })
  const me = await api.me()
  const bot = await api.call<{ id: string }>('post', '/api/bots', {
    name: 'pv1 Bot',
    ownerId: me.id,
    agentKind: 'claude',
    machineId: await api.machineId(),
    systemPrompt: '',
  })
  // Full tier: service_start (an arbitrary command) needs no owner call in this scenario.
  await page.request.patch(`/api/bots/${bot.id}`, {
    data: { tier: 'full', triggerScope: 'list', triggerList: [me.id] },
  })
  m.start()
  try {
    const group = await api.call<{ id: string }>('post', '/api/groups', {
      name: '预览',
      kind: 'group',
      botIds: [bot.id],
      repo: null,
    })
    await bindManaged(page.request, group.id, [bot.id])
    await page.goto(`/g/${group.id}`)
    const main = page.getByRole('main')

    const serve = `mkdir -p site && printf '<meta charset=utf-8><h1>Hello 预览</h1>' > site/index.html && cd site && exec python3 -m http.server ${PORT} --bind 127.0.0.1`
    await say(
      page,
      `@pv1 Bot mock:tool service_start ${JSON.stringify({ name: 'web', command: serve, port: PORT })}`,
    )
    await expect(main.getByText(/服务 web 已启动，端口 18765 已就绪/)).toBeVisible({ timeout: 60_000 })

    await say(page, `@pv1 Bot mock:tool preview_expose ${JSON.stringify({ service: 'web', title: '首页' })}`)
    const card = main.locator('.pv-card', { hasText: '首页' })
    await expect(card.getByText('在线')).toBeVisible({ timeout: 30_000 })
    const href = await card.getByRole('link', { name: '打开' }).getAttribute('href')
    const tab = await context.newPage()
    await tab.goto(href!)
    await expect(tab.getByRole('heading', { name: 'Hello 预览' })).toBeVisible()
    expect(new URL(tab.url()).port).not.toBe(new URL(page.url()).port)
    await tab.close()

    await say(page, `@pv1 Bot mock:tool preview_static ${JSON.stringify({ dir: 'site', title: '静态报告' })}`)
    const report = main.locator('.pv-card', { hasText: '静态报告' })
    await report.getByRole('button', { name: '在工作台打开' }).click()
    const report$ = page.frameLocator('iframe[title="静态报告"]')
    await expect(report$.getByRole('heading', { name: 'Hello 预览' })).toBeVisible({ timeout: 30_000 })
    await page.getByRole('button', { name: '刷新' }).click()
    await expect(report$.getByRole('heading', { name: 'Hello 预览' })).toBeVisible({ timeout: 30_000 })
    const path = page.getByRole('textbox', { name: '进入路径' })
    await path.fill('/index.html')
    await path.press('Enter')
    await expect(report$.getByRole('heading', { name: 'Hello 预览' })).toBeVisible({ timeout: 30_000 })
    await expect(page.locator('iframe[title="静态报告"]')).toHaveAttribute('src', /path=%2Findex\.html/)

    await main.getByRole('button', { name: '群设置' }).click()
    const drawer = page.getByRole('complementary', { name: '群设置' })
    await drawer.getByText('预览与服务').click()
    await expect(drawer.getByText(/静态站点 site/)).toBeVisible()
    await drawer.locator('.pv-row', { hasText: '首页' }).getByRole('button', { name: '关闭' }).click()
    await expect(card.getByText('已关闭')).toBeVisible()
  } finally {
    m.stop()
  }
})
