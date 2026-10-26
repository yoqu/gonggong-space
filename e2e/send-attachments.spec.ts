import { copyFileSync, mkdirSync } from 'node:fs'
import { join } from 'node:path'
import type { MessageDto, TimelineDto } from '@gonggong/protocol'
import { expect, test } from '@playwright/test'
import { bindManaged, buildDaemon, memberWithMachine, ROOT } from './helpers'

test.beforeAll(buildDaemon)

const MOCK = `${process.execPath} ${join(ROOT, 'tools/mock-agent/agent.js')}`
const composer = '输入消息，@ 触发 Bot 或引用文件，/ 查看命令'
const PNG = join(ROOT, 'docs/原型UI-AI 对话 agent系统界面设计方案/assets/chat/shot-4.png')

test('workspace media opens in the file manager and reaches the chat, where it plays', async ({
  page,
}, testInfo) => {
  test.setTimeout(4 * 60_000)
  const tag = Date.now().toString(36)
  const { m, api } = await memberWithMachine(page, `media${tag}`, { env: { GONGGONG_ADAPTER_CMD: MOCK } })
  const me = await api.me()
  const bot = await api.call<{ id: string }>('post', '/api/bots', {
    name: `${tag} Bot`,
    ownerId: me.id,
    agentKind: 'claude',
    machineId: await api.machineId(),
    systemPrompt: '',
  })
  m.start()
  try {
    const group = await api.call<{ id: string }>('post', '/api/groups', {
      name: '媒体附件',
      kind: 'group',
      botIds: [bot.id],
      repo: null,
    })
    await bindManaged(page.request, group.id, [bot.id])
    const workspace = join(m.home, 'workspaces', group.id, bot.id, '_empty')
    mkdirSync(workspace, { recursive: true })
    copyFileSync(PNG, join(workspace, 'shot.png'))
    copyFileSync(join(ROOT, 'e2e/fixtures/demo.mp4'), join(workspace, 'demo.mp4'))

    await page.goto(`/g/${group.id}`)
    await page
      .getByPlaceholder(composer)
      .fill(
        `@${tag} Bot mock:tool send_attachments ${JSON.stringify({ paths: ['shot.png', 'demo.mp4'], text: '生成的媒体' })}`,
      )
    await page.getByRole('button', { name: '发送' }).click()
    await expect(page.getByTestId('run-card')).toHaveAttribute('data-status', 'completed', {
      timeout: 60_000,
    })

    const timeline = await api.call<TimelineDto>('get', `/api/groups/${group.id}/timeline`)
    const sent = timeline.messages.find((x: MessageDto) => x.body === '生成的媒体')!
    expect(sent.attachments.map((a) => a.name)).toEqual(['shot.png', 'demo.mp4'])
    const video = sent.attachments.find((a) => a.name === 'demo.mp4')!
    const main = page.getByRole('main')
    const image = main.getByRole('img', { name: 'shot.png' })
    await expect(image).toBeVisible()
    await expect.poll(() => image.evaluate((img: HTMLImageElement) => img.naturalWidth)).toBe(2200)

    const range = await page.request.get(`/api/attachments/${video.id}`, { headers: { range: 'bytes=2-5' } })
    expect(range.status()).toBe(206)
    expect(range.headers()['content-range']).toBe(`bytes 2-5/${video.size}`)
    expect(await range.body()).toHaveLength(4)

    await main.getByRole('button', { name: '在工作台查看 demo.mp4' }).click()
    const player = page.getByRole('region', { name: '工作台' }).locator('video')
    await expect(player).toHaveAttribute('src', `/api/attachments/${video.id}`)
    await expect.poll(() => player.evaluate((v: HTMLVideoElement) => v.readyState)).toBeGreaterThan(0)
    await player.evaluate((v: HTMLVideoElement) => v.play())
    await expect.poll(() => player.evaluate((v: HTMLVideoElement) => v.currentTime)).toBeGreaterThan(0)
    const res = await page.request.get((await player.getAttribute('src'))!)
    expect(res.status()).toBe(200)
    expect(res.headers()['content-type']).toBe('video/mp4')
    expect((await res.body()).length).toBe(video.size)

    await page.getByRole('button', { name: `${tag} Bot 的工作区` }).click()
    await page.getByRole('button', { name: `浏览 ${tag} Bot 的文件` }).click()
    const workbench = page.getByRole('region', { name: '工作台' })
    const active = workbench.locator('.bench__pane:not([hidden])')
    await active.getByRole('treeitem', { name: 'shot.png', exact: true }).click()
    const fileImage = active.getByRole('img', { name: 'shot.png' })
    await expect(fileImage).toBeVisible()
    await expect.poll(() => fileImage.evaluate((img: HTMLImageElement) => img.naturalWidth)).toBe(2200)
    await active.getByRole('button', { name: '目录' }).click()
    await active.getByRole('treeitem', { name: 'demo.mp4', exact: true }).click()
    const filePlayer = active.locator('video')
    await expect.poll(() => filePlayer.evaluate((v: HTMLVideoElement) => v.readyState)).toBeGreaterThan(0)
    await filePlayer.evaluate((v: HTMLVideoElement) => v.play())
    await expect.poll(() => filePlayer.evaluate((v: HTMLVideoElement) => v.currentTime)).toBeGreaterThan(0)
    await page.screenshot({ path: testInfo.outputPath('workspace-media.png'), fullPage: true })
  } finally {
    m.stop()
  }
})
