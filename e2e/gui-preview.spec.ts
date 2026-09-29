import { join } from 'node:path'
import { expect, type Page, test } from '@playwright/test'
import { bindManaged, buildDaemon, memberWithMachine, ROOT } from './helpers'

// Plan 结果预览 B5, run on Linux by scripts/gui-e2e.sh (Xvfb, gg-cast, the server's own LiveKit).
test.skip(process.platform !== 'linux', 'desktop previews on a virtual display need Linux')
test.beforeAll(buildDaemon)

const composer = '输入消息，@ 触发 Bot 或引用文件，/ 查看命令'
const MOCK = `node ${join(ROOT, 'tools/mock-agent/agent.js')}`
const APP = join(ROOT, 'e2e/gui-app.py')

async function say(page: Page, text: string) {
  await page.getByPlaceholder(composer).fill(text)
  await page.getByRole('button', { name: '发送' }).click()
}

/** The colour in the middle of the decoded video, or null before the first frame. */
function centre(page: Page) {
  return page.getByLabel('桌面 实时画面').evaluate((v: HTMLVideoElement) => {
    if (!v.videoWidth) return null
    const canvas = document.createElement('canvas')
    canvas.width = v.videoWidth
    canvas.height = v.videoHeight
    const g = canvas.getContext('2d')!
    g.drawImage(v, 0, 0)
    const [r, gr, b] = g.getImageData(canvas.width / 2, canvas.height / 2, 1, 1).data
    if (r! > 180 && gr! < 90 && b! < 90) return 'red'
    if (gr! > 180 && r! < 90 && b! < 90) return 'green'
    return `rgb(${r},${gr},${b})`
  })
}

test('a desktop app on a virtual display is watched live and the controller clicks it', async ({ page }) => {
  test.setTimeout(5 * 60_000)
  const castBin = process.env.GG_CAST_BIN
  expect(castBin, 'GG_CAST_BIN: a gg-cast build for this machine').toBeTruthy()
  const { m, api } = await memberWithMachine(page, 'gui1', {
    env: { GONGGONG_ADAPTER_CMD: MOCK, GG_CAST_BIN: castBin! },
  })
  const me = await api.me()
  const bot = await api.call<{ id: string }>('post', '/api/bots', {
    name: 'gui1 Bot',
    ownerId: me.id,
    agentKind: 'claude',
    machineId: await api.machineId(),
    systemPrompt: '',
  })
  await page.request.patch(`/api/bots/${bot.id}`, {
    data: { tier: 'full', triggerScope: 'list', triggerList: [me.id] },
  })
  m.start()
  try {
    const group = await api.call<{ id: string }>('post', '/api/groups', {
      name: '桌面预览',
      kind: 'group',
      botIds: [bot.id],
      repo: null,
    })
    await bindManaged(page.request, group.id, [bot.id])
    await page.goto(`/g/${group.id}`)
    const main = page.getByRole('main')

    const app = { name: 'app', command: `exec python3 ${APP}`, display: 'virtual' }
    await say(page, `@gui1 Bot mock:tool service_start ${JSON.stringify(app)}`)
    await expect(main.getByText(/服务 app 已启动/)).toBeVisible({ timeout: 60_000 })
    await say(page, `@gui1 Bot mock:tool preview_gui ${JSON.stringify({ service: 'app', title: '桌面' })}`)
    const card = main.locator('.pv-card', { hasText: '桌面' })
    await card.getByRole('button', { name: '在工作台打开' }).click()

    // Frames arrive: the app's red screen, decoded by the browser.
    await expect.poll(() => centre(page), { timeout: 90_000, intervals: [1000] }).toBe('red')
    // The bot's owner takes control; the click lands in the app on the virtual display.
    await page.getByRole('button', { name: '开始控制' }).click()
    await expect(page.getByText('你正在控制')).toBeVisible({ timeout: 15_000 })
    await page.getByLabel('桌面 实时画面').click()
    await expect.poll(() => centre(page), { timeout: 30_000, intervals: [500] }).toBe('green')
  } finally {
    m.stop()
  }
})
