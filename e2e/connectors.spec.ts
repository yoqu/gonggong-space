import { join } from 'node:path'
import type { MessageDto, PluginDto, TimelineDto } from '@gonggong/protocol'
import { expect, test } from '@playwright/test'
import { adminSession, bindManaged, buildDaemon, call, memberWithMachine, ROOT } from './helpers'

test.beforeAll(buildDaemon)

const composer = '输入消息，@ 触发 Bot 或引用文件，/ 查看命令'
// Scripted agent: `mock:tool` calls a gonggong tool, `mock:echo` replies with what its session got.
const MOCK = `${process.execPath} ${join(ROOT, 'tools/mock-agent/agent.js')}`

/** A skill-based connector with a personal key, like the built-in 数仓 one. */
const connector = (name: string) => [
  {
    path: 'gonggong-plugin.json',
    content: JSON.stringify({
      name,
      version: '1.0.0',
      title: '数仓测试',
      description: '按你本人的 Key 查询数仓',
      category: 'connector',
      agents: ['claude'],
      minDaemon: '0.1.0',
      entry: 'dwq',
      connector: { examples: ['列出我有权限的数据源'] },
      secrets: [{ name: 'DWQ_KEY', title: '数仓 Key', mode: 'personal', required: true }],
    }),
  },
  { path: 'skills/dwq/SKILL.md', content: '---\nname: dwq\ndescription: 数仓取数\n---\nGo.\n' },
]

test('a member meets a connector in the composer, the bot asks them to connect it, and they try it then unbind', async ({
  page,
  request,
}) => {
  test.setTimeout(5 * 60_000)
  const tag = Date.now().toString(36)
  await adminSession(request)
  await call(request, 'put', '/api/admin/params', { pluginsEnabled: true })
  const plugin = await call<PluginDto>(request, 'post', '/api/admin/plugins', {
    files: connector(`dwq${tag}`),
  })
  const { m, api } = await memberWithMachine(page, `cn${tag}`, { env: { GONGGONG_ADAPTER_CMD: MOCK } })
  const me = await api.me()
  const botName = `${tag} 取数助手`
  const bot = await api.call<{ id: string }>('post', '/api/bots', {
    name: botName,
    ownerId: me.id,
    agentKind: 'claude',
    machineId: await api.machineId(),
    systemPrompt: '',
  })
  await page.request.patch(`/api/bots/${bot.id}`, { data: { tier: 'full' } })
  m.start()
  try {
    const group = await api.call<{ id: string }>('post', '/api/groups', {
      name: '取数',
      kind: 'group',
      botIds: [bot.id],
      repo: null,
    })
    await bindManaged(page.request, group.id, [bot.id])
    await call(page.request, 'put', `/api/groups/${group.id}/plugins/${plugin.id}`, { enabled: true })
    await page.goto(`/g/${group.id}`)
    const box = page.getByPlaceholder(composer)
    const runs = page.getByTestId('run-card')
    const turn = async (text: string, nth: number) => {
      await box.fill(text)
      await page.getByRole('button', { name: '发送' }).click()
      await expect(runs).toHaveCount(nth, { timeout: 60_000 })
      await expect(runs.nth(nth - 1)).toHaveAttribute('data-status', 'completed', { timeout: 60_000 })
    }
    const replies = async () =>
      (await api.call<TimelineDto>('get', `/api/groups/${group.id}/timeline`)).messages.filter(
        (x: MessageDto) => x.kind === 'bot',
      )

    await test.step('the composer lists the connector as not connected yet', async () => {
      await page.getByRole('button', { name: '连接器' }).click()
      const menu = page.getByRole('dialog', { name: '连接器' })
      await expect(menu.getByRole('button', { name: '数仓测试' })).toBeVisible()
      await expect(menu.getByRole('button', { name: '连接', exact: true })).toBeVisible()
      await page.keyboard.press('Escape')
    })

    await test.step('the bot learns it is not connected and sends the connect card', async () => {
      await turn(`@${botName} mock:echo`, 1)
      await expect.poll(async () => (await replies()).at(-1)?.body ?? '').toContain('未连接的连接器')
      await turn(`@${botName} mock:tool secret_request ${JSON.stringify({ names: ['DWQ_KEY'] })}`, 2)
      const card = page.getByTestId('secret-card')
      await expect(card).toContainText('DWQ_KEY')
      await card.getByRole('button', { name: '填写密钥' }).click()
      const dialog = page.getByRole('dialog', { name: '填写密钥' })
      await dialog.getByLabel('DWQ_KEY').fill('dwq-secret-42')
      await dialog.getByRole('button', { name: '保存' }).click()
      await expect(dialog).toBeHidden()
    })

    await test.step('connected: the next turn gets the plugin, and 去试试 fills an example @-ing the bot', async () => {
      await box.fill(`@${botName} mock:echo`)
      await page.getByRole('button', { name: '发送' }).click()
      await expect
        .poll(
          async () =>
            (await replies()).some(
              (r) =>
                r.body.includes('"mcpServers"') &&
                r.body.includes(`dwq${tag}`) &&
                !r.body.includes('未连接的连接器'),
            ),
          { timeout: 60_000 },
        )
        .toBe(true)
      await page.getByRole('button', { name: '连接器' }).click()
      const menu = page.getByRole('dialog', { name: '连接器' })
      await expect(menu.getByText('已连接')).toBeVisible()
      await menu.getByRole('button', { name: '数仓测试' }).click()
      const detail = page.getByRole('dialog', { name: '数仓测试' })
      await detail.getByRole('button', { name: '去试试' }).click()
      await expect(detail).toBeHidden()
      await expect(box).toHaveValue(`@${botName} 列出我有权限的数据源`)
      await box.fill('')
    })

    await test.step('解绑 cuts the connection', async () => {
      await page.getByRole('button', { name: '连接器' }).click()
      await page.getByRole('dialog', { name: '连接器' }).getByRole('button', { name: '数仓测试' }).click()
      const detail = page.getByRole('dialog', { name: '数仓测试' })
      await detail.getByRole('button', { name: '解绑' }).click()
      await page.getByRole('alertdialog').getByRole('button', { name: '解绑' }).click()
      await expect(detail.getByRole('button', { name: '连接', exact: true })).toBeVisible()
    })
  } finally {
    m.stop()
  }
})
