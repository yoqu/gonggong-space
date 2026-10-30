import { mkdirSync } from 'node:fs'
import { join } from 'node:path'
import type { ArtifactDto, MessageDto, PluginDto, TimelineDto } from '@gonggong/protocol'
import { expect, type Page, test } from '@playwright/test'
import { adminSession, bindManaged, buildDaemon, call, memberWithMachine, ROOT } from './helpers'

test.beforeAll(buildDaemon)

const composer = '输入消息，@ 触发 Bot 或引用文件，/ 查看命令'
const MOCK = `${process.execPath} ${join(ROOT, 'tools/mock-agent/agent.js')}`
// Prints the home heading the folder holds when the turn starts, then writes the two-screen L1 artifact.
const WRITE = `sh ${join(ROOT, 'e2e/fixtures/l1-artifact.sh')}`
const SHOTS = '/tmp/art-shots'

/** The frame of a screen node on the artifact canvas. */
const screen = (page: Page, id: string) => page.getByTestId(`art-node-${id}`).frameLocator('iframe')

test('a creation is hosted as versions: the canvas shows its screens from the server, undo checks the old head out', async ({
  page,
  request,
}) => {
  test.setTimeout(6 * 60_000)
  await adminSession(request)
  await call(request, 'put', '/api/admin/params', { pluginsEnabled: true })
  try {
    const builtins = await call<PluginDto[]>(request, 'get', '/api/admin/plugins')
    const plugin = builtins.find((p) => p.builtin && p.manifest.name === 'web-prototype')!
    const tag = Date.now().toString(36)
    const { m, api } = await memberWithMachine(page, `ar${tag}`, { env: { GONGGONG_ADAPTER_CMD: MOCK } })
    const me = await api.me()
    const botName = `${tag} 原型师`
    const bot = await api.call<{ id: string }>('post', '/api/bots', {
      name: botName,
      ownerId: me.id,
      agentKind: 'claude',
      machineId: await api.machineId(),
      systemPrompt: '',
    })
    m.start()
    let online = true
    try {
      const group = await api.call<{ id: string }>('post', '/api/groups', {
        name: '产物托管',
        kind: 'group',
        botIds: [bot.id],
      })
      await bindManaged(page.request, group.id, [bot.id])
      await call(page.request, 'put', `/api/groups/${group.id}/plugins/${plugin.id}`, { enabled: true })

      const replies = async () =>
        (await api.call<TimelineDto>('get', `/api/groups/${group.id}/timeline`)).messages
          .filter((x: MessageDto) => x.kind === 'bot')
          .map((x) => x.body)
      const say = async (text: string) => {
        await page.getByPlaceholder(composer).fill(`@${botName} ${text}`)
        await page.getByRole('button', { name: '发送' }).click()
      }

      await page.goto(`/g/${group.id}`)
      const card = page.getByTestId('artifact-card')

      await test.step('the creation turn writes the L1 folder and it goes up as v1', async () => {
        // The creation prompt goes on after the inputs, naming the artifact folder: the heredoc hands it to the script.
        await api.call('post', `/api/groups/${group.id}/creations`, {
          pluginId: plugin.id,
          templateId: 'app-screens',
          designSystemId: 'luke-plus',
          inputs: { title: 'e2e 原型', points: `mock:sh ${WRITE} 首页第一版 <<'EOF'` },
          directions: false,
          botId: bot.id,
        })
        await expect(card).toContainText('e2e 原型')
        await expect(card.getByText('v1')).toBeVisible({ timeout: 90_000 })
        await expect(card).toContainText('就绪')
        await expect(card).not.toContainText('规范问题')
        // The version can land before the turn's reply does.
        await expect.poll(async () => (await replies()).at(-1), { timeout: 30_000 }).toContain('before: none')
        // The daemon screenshots the shell after the upload; the card shows it once it lands.
        const shot = card.getByRole('img', { name: 'e2e 原型 缩略图' })
        await expect(shot).toBeVisible({ timeout: 60_000 })
        await expect
          .poll(() => shot.evaluate((img: HTMLImageElement) => img.naturalWidth), { timeout: 30_000 })
          .toBeGreaterThan(0)
      })

      const artifact = (await api.call<ArtifactDto[]>('get', `/api/groups/${group.id}/artifacts`))[0]!
      expect(artifact.dir).toMatch(/^design\/app-screens-[a-z0-9]{4}$/)

      await test.step('打开 shows both screens on the canvas, rendered from the server', async () => {
        await card.getByRole('button', { name: '打开' }).click()
        await expect(page.getByTestId('art-node-home')).toBeVisible()
        await expect(page.getByTestId('art-node-detail')).toBeVisible()
        await expect(screen(page, 'home').getByRole('heading', { name: '首页第一版' })).toBeVisible({
          timeout: 30_000,
        })
        await expect(screen(page, 'detail').getByRole('heading', { name: '活动详情' })).toBeVisible()
        mkdirSync(SHOTS, { recursive: true })
        await page.screenshot({ path: join(SHOTS, 'e2e-canvas.png') })
      })

      await test.step('a second turn starts from v1 and its change becomes v2', async () => {
        await say(`mock:sh ${WRITE} 首页第二版`)
        await expect(card.getByText('v2')).toBeVisible({ timeout: 90_000 })
        await expect
          .poll(async () => (await replies()).at(-1), { timeout: 30_000 })
          .toContain('before: 首页第一版')
        await expect(screen(page, 'home').getByRole('heading', { name: '首页第二版' })).toBeVisible({
          timeout: 30_000,
        })
      })

      await test.step('undo makes v1 the head again, and the canvas follows', async () => {
        await page.getByRole('button', { name: '撤销' }).click()
        await expect(card.getByText('v1')).toBeVisible()
        await expect(screen(page, 'home').getByRole('heading', { name: '首页第一版' })).toBeVisible({
          timeout: 30_000,
        })
      })

      await test.step('the next turn finds the head (v1) checked out over the folder still holding v2', async () => {
        const before = (await replies()).length
        await say(`mock:sh ${WRITE} -`)
        await expect.poll(async () => (await replies()).length, { timeout: 90_000 }).toBe(before + 1)
        expect((await replies()).at(-1)).toContain('before: 首页第一版')
        // Nothing changed: no new version.
        await expect(card.getByText('v1')).toBeVisible()
        const versions = await api.call<unknown[]>('get', `/api/artifacts/${artifact.id}/versions`)
        expect(versions).toHaveLength(2)
      })

      await test.step('direct edit: a heading’s new text is saved as the next version, on the card and the canvas', async () => {
        await page
          .getByRole('toolbar', { name: '画布工具' })
          .getByRole('button', { name: '直接编辑' })
          .click()
        await screen(page, 'home').getByRole('heading', { name: '首页第一版' }).click()
        const pop = page.getByRole('dialog', { name: '编辑元素' })
        await pop.getByRole('button', { name: '编辑文字' }).click()
        await pop.getByRole('textbox', { name: '文字' }).fill('首页直接改')
        await pop.getByRole('button', { name: '保存' }).click()
        await expect(pop).toBeHidden()
        await expect(card.getByText('v3')).toBeVisible({ timeout: 30_000 })
        await expect(page.getByRole('button', { name: '版本', exact: true })).toHaveText(/v3/)
        await expect(screen(page, 'home').getByRole('heading', { name: '首页直接改' })).toBeVisible({
          timeout: 30_000,
        })
        const versions = await api.call<{ source: string }[]>('get', `/api/artifacts/${artifact.id}/versions`)
        expect(versions.map((v) => v.source).sort()).toEqual(['edit', 'run', 'run'])
      })

      await test.step('with the bot offline the canvas still opens: the server hosts it', async () => {
        m.stop()
        online = false
        await expect
          .poll(
            async () =>
              (await api.call<{ online: boolean }[]>('get', '/api/machines')).every((x) => !x.online),
            { timeout: 30_000 },
          )
          .toBe(true)
        await page.reload()
        await card.getByRole('button', { name: '打开' }).click()
        await expect(screen(page, 'home').getByRole('heading', { name: '首页直接改' })).toBeVisible({
          timeout: 30_000,
        })
        await expect(screen(page, 'detail').getByRole('heading', { name: '活动详情' })).toBeVisible()
      })
    } finally {
      if (online) m.stop()
    }
  } finally {
    await call(request, 'put', '/api/admin/params', { pluginsEnabled: false })
  }
})
