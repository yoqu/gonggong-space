import { mkdirSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import type { ArtifactDto, ArtifactShareDto } from '@gonggong/protocol'
import { expect, type Page, test } from '@playwright/test'
import { bindManaged, buildDaemon, memberWithMachine, ROOT, SERVER } from './helpers'

test.beforeAll(buildDaemon)

const composer = '输入消息，@ 触发 Bot 或引用文件，/ 查看命令'
const MOCK = `${process.execPath} ${join(ROOT, 'tools/mock-agent/agent.js')}`

async function say(page: Page, text: string) {
  await page.getByPlaceholder(composer).fill(text)
  await page.getByRole('button', { name: '发送' }).click()
}

test('S0 artifact shell: hosted site from works -> coordinate comment -> bot v2 -> history rollback -> read-only share', async ({
  page,
  browser,
}) => {
  test.setTimeout(5 * 60_000)
  const tag = Date.now().toString(36)
  const { m, api } = await memberWithMachine(page, `s0${tag}`, { env: { GONGGONG_ADAPTER_CMD: MOCK } })
  const me = await api.me()
  const botName = `s0${tag} 网页助手`
  const bot = await api.call<{ id: string }>('post', '/api/bots', {
    name: botName,
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
      name: 'S0 产物容器',
      kind: 'group',
      botIds: [bot.id],
      repo: null,
    })
    await bindManaged(page.request, group.id, [bot.id])
    await page.goto(`/g/${group.id}`)

    await test.step('bot builds and hosts v1 static site via preview_host', async () => {
      await say(
        page,
        `@${botName} mock:sh mkdir -p site && printf '<meta charset=utf-8><h1>官网第一版</h1><p>初始内容</p>' > site/index.html && echo built-v1`,
      )
      await expect(page.getByText('built-v1')).toBeVisible({ timeout: 60_000 })

      await say(
        page,
        `@${botName} mock:tool preview_host ${JSON.stringify({ dir: 'site', title: 'S0 官网' })}`,
      )
      const card = page.getByTestId('artifact-card')
      await expect(card).toContainText('S0 官网', { timeout: 60_000 })
      await expect(card.getByText('v1')).toBeVisible({ timeout: 60_000 })
    })

    const site = (await api.call<ArtifactDto[]>('get', `/api/groups/${group.id}/artifacts`)).find(
      (a) => a.title === 'S0 官网',
    )!
    expect(site.kind).toBe('site')

    const siteFrame = () => page.getByTestId('shell-site-stage').frameLocator('iframe')

    await test.step('open hosted site from 作品库 into unified ArtifactShell', async () => {
      await page.goto('/works')
      await page.getByRole('button', { name: '打开 S0 官网' }).click()
      await expect(page.getByTestId('artifact-shell')).toBeVisible({ timeout: 30_000 })
      await expect(page.getByTestId('artifact-shell')).toHaveAttribute('data-kind', 'site')
      await expect(siteFrame().getByRole('heading', { name: '官网第一版' })).toBeVisible({ timeout: 30_000 })
    })

    await test.step('add coordinate annotation on site stage and send it to bot for v2', async () => {
      await page.getByTestId('shell-annotate-btn').click()
      const overlay = page.getByTestId('shell-site-overlay')
      await expect(overlay).toBeVisible()
      await overlay.click({ position: { x: 120, y: 80 } })

      const pop = page.getByTestId('shell-site-pin-popover')
      await expect(pop).toBeVisible()
      await pop.getByPlaceholder('写下对这处页面的修改意见…').fill('把主标题改成官网第二版')
      await pop.getByRole('button', { name: '提交批注' }).click()

      await expect(page.getByTestId('shell-pin-1')).toBeVisible()
      await expect(page.getByTestId('shell-thread-1')).toContainText('把主标题改成官网第二版')

      // Update the built site in the bot's workspace so preview_host publishes v2 when triggered by the annotation.
      const ws = m.workspace(group.id, bot.id)
      expect(ws).toBeTruthy()
      mkdirSync(join(ws!, 'site'), { recursive: true })
      writeFileSync(join(ws!, 'site/index.html'), '<meta charset=utf-8><h1>官网第二版</h1><p>按批注更新</p>')

      await page
        .getByLabel('补充说明')
        .fill(`mock:tool preview_host ${JSON.stringify({ dir: 'site', title: 'S0 官网' })}`)
      await page.getByRole('button', { name: new RegExp(`发给 @${botName}`) }).click()

      // Bot replies in AI chat and publishes v2; Shell updates to v2 automatically.
      await expect(page.getByRole('button', { name: '版本', exact: true })).toHaveText(/v2/, {
        timeout: 90_000,
      })
      await expect(siteFrame().getByRole('heading', { name: '官网第二版' })).toBeVisible({ timeout: 30_000 })
    })

    await test.step('version history previews v1 and rolls back to v1', async () => {
      await page.getByTestId('shell-history-btn').click()
      const history = page.getByTestId('shell-history')
      await expect(history).toBeVisible()
      await history.getByTestId('shell-version-v1').getByRole('button', { name: /v1/ }).click()
      await expect(page.getByTestId('shell-past-banner')).toContainText('正在查看 v1（只读）')
      await expect(siteFrame().getByRole('heading', { name: '官网第一版' })).toBeVisible({ timeout: 30_000 })

      await page.getByTestId('shell-past-banner').getByRole('button', { name: '设为当前版本' }).click()
      await expect(page.getByTestId('shell-past-banner')).toBeHidden({ timeout: 30_000 })
      await expect(page.getByRole('button', { name: '版本', exact: true })).toHaveText(/v1/)
      await expect(siteFrame().getByRole('heading', { name: '官网第一版' })).toBeVisible({ timeout: 30_000 })
    })

    await test.step('public share page is read-only and guest cannot write', async () => {
      const share = await api.call<ArtifactShareDto>('post', `/api/artifacts/${site.id}/share`, {
        enabled: true,
        follow: false,
      })
      expect(share.enabled).toBe(true)
      expect(share.url).toBeTruthy()

      const guestCtx = await browser.newContext()
      try {
        const guestPage = await guestCtx.newPage()
        await guestPage.goto(share.url!)
        await expect(guestPage.getByRole('heading', { name: '官网第一版' })).toBeVisible({ timeout: 30_000 })

        // No bridge injected for share visitors
        const previewOrigin = new URL(guestPage.url()).origin
        const bridgeRes = await guestCtx.request.get(`${previewOrigin}/__gg/bridge.js`)
        expect(bridgeRes.status()).toBe(404)

        // Guest gets 401 on every write endpoint on the main server
        for (const [path, data] of [
          [`/api/artifacts/${site.id}/publish`, { batch: { 'index.html': { content: 'hacked' } } }],
          [
            `/api/artifacts/${site.id}/threads`,
            { anchor: { kind: 'site', path: '/', point: { x: 1, y: 1 } }, text: 'hi' },
          ],
          [`/api/artifacts/${site.id}/edits`, { baseVersionId: site.headVersionId, ops: [] }],
        ] as const) {
          const r = await guestCtx.request.post(`${SERVER}${path}`, { data })
          expect(r.status()).toBe(401)
        }
      } finally {
        await guestCtx.close()
      }
    })
  } finally {
    m.stop()
  }
})
