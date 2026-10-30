import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import type { MessageDto, PluginDto, TimelineDto } from '@gonggong/protocol'
import { expect, test } from '@playwright/test'
import { adminSession, bindManaged, buildDaemon, call, memberWithMachine, ROOT } from './helpers'

test.beforeAll(buildDaemon)

const composer = '输入消息，@ 触发 Bot 或引用文件，/ 查看命令'
// Scripted agent: `mock:echo` replies with the plugins it was started with.
const MOCK = `${process.execPath} ${join(ROOT, 'tools/mock-agent/agent.js')}`

test('the built-in plugin is installed at startup; a group turns it on, creates through the panel, and the bot gets the plugin', async ({
  page,
  request,
}) => {
  test.setTimeout(5 * 60_000)
  await adminSession(request)
  await call(request, 'put', '/api/admin/params', { pluginsEnabled: true })
  try {
    const builtins = await call<PluginDto[]>(request, 'get', '/api/admin/plugins')
    const plugin = builtins.find((p) => p.builtin && p.manifest.name === 'web-prototype')!
    const tag = Date.now().toString(36)
    const { m, api } = await memberWithMachine(page, `pl${tag}`, {
      env: { GONGGONG_ADAPTER_CMD: MOCK },
    })
    const me = await api.me()
    const botName = `${tag} 设计助手`
    const bot = await api.call<{ id: string }>('post', '/api/bots', {
      name: botName,
      ownerId: me.id,
      agentKind: 'claude',
      machineId: await api.machineId(),
      systemPrompt: '',
    })
    m.start()
    try {
      const group = await api.call<{ id: string }>('post', '/api/groups', {
        name: '插件创作',
        kind: 'group',
        botIds: [bot.id],
      })
      await bindManaged(page.request, group.id, [bot.id])
      await page.goto(`/g/${group.id}`)
      // Not enabled in the group yet: the composer looks as before.
      await expect(page.getByPlaceholder(composer)).toBeVisible()
      await expect(page.getByRole('button', { name: '创作' })).toHaveCount(0)

      await api.call('put', `/api/groups/${group.id}/plugins/${plugin.id}`, { enabled: true })
      await page.reload()

      await test.step('the creation panel posts a creation card @-ing the bot', async () => {
        await page.getByRole('button', { name: '创作' }).click()
        const sheet = page.getByRole('dialog', { name: '创作' })
        await expect(sheet.getByText('选一个模板')).toBeVisible()
        await sheet.getByRole('button', { name: '下一步' }).click()
        await sheet.getByRole('button', { name: '下一步' }).click()
        await sheet.getByLabel('主题').fill('mock:echo 共工落地页')
        // The group's only bot: 交给谁 folds into this last step.
        await expect(sheet.getByText(`交给：${botName}`)).toBeVisible()
        await sheet.getByRole('button', { name: `交给 ${botName}` }).click()
        await expect(sheet).toBeHidden()
        await expect(page.getByText('创作请求 · 产品原型')).toBeVisible()
        await expect(page.getByText(`已交给 @${botName}`)).toBeVisible()
      })

      await test.step('the bot runs the creation with the plugin folder loaded', async () => {
        // The title carries `mock:echo`, so the creation turn itself reports what the agent was started with.
        let reply: MessageDto | undefined
        await expect
          .poll(
            async () => {
              const { messages } = await api.call<TimelineDto>('get', `/api/groups/${group.id}/timeline`)
              reply = messages.find((x) => x.kind === 'bot')
              return reply?.body
            },
            { timeout: 60_000 },
          )
          .toBeTruthy()
        const got = JSON.parse(reply!.body) as { plugins: { path: string }[] | null; prompt: string }
        expect(got.prompt).toContain('Claude 用 web-prototype:web-prototype')
        const dir = got.plugins?.map((p) => p.path).find((p) => p.includes('plugin-sets'))
        expect(dir).toBeTruthy()
        expect(readFileSync(join(dir!, '.claude-plugin/plugin.json'), 'utf8')).toContain('"web-prototype"')
        expect(readFileSync(join(dir!, 'skills/web-prototype/SKILL.md'), 'utf8')).toContain(
          'name: web-prototype',
        )
      })

      await test.step('a bot proposes a creation from the chat and a member starts it', async () => {
        const args = { plugin: 'web-prototype', template: 'app-screens', inputs: { title: '共工二版' } }
        await page
          .getByPlaceholder(composer)
          .fill(`@${botName} mock:tool creation_propose ${JSON.stringify(args)}`)
        await page.getByRole('button', { name: '发送' }).click()
        const draft = page.getByTestId('creation-draft')
        await expect(draft).toContainText('创作确认 · 产品原型', { timeout: 60_000 })
        await draft.getByRole('button', { name: '开始' }).click()
        await expect(draft).toContainText('已开始创作')
        await expect(page.getByText('创作请求 · 产品原型')).toHaveCount(2)
      })
    } finally {
      m.stop()
    }
  } finally {
    await call(request, 'put', '/api/admin/params', { pluginsEnabled: false })
  }
})
