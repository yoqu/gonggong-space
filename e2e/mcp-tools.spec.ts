import { join } from 'node:path'
import type { MessageDto, TimelineDto } from '@gonggong/protocol'
import { expect, test } from '@playwright/test'
import { bindManaged, buildDaemon, memberWithMachine, ROOT } from './helpers'

test.beforeAll(buildDaemon)

const composer = '输入消息，@ 触发 Bot 或引用文件，/ 查看命令'
// Scripted agent: `mock:tool` calls a gonggong tool, `mock:echo` replies with the MCP servers its session got.
const MOCK = `${process.execPath} ${join(ROOT, 'tools/mock-agent/agent.js')}`

test('a group admin has a bot add a group MCP, fills its secret on the card, and the next turn gets it resolved', async ({
  page,
}) => {
  test.setTimeout(4 * 60_000)
  const tag = Date.now().toString(36)
  const { m, api } = await memberWithMachine(page, `mcp${tag}`, { env: { GONGGONG_ADAPTER_CMD: MOCK } })
  const me = await api.me()
  const botName = `${tag} Bot`
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
      name: 'MCP 自助',
      kind: 'group',
      botIds: [bot.id],
      repo: null,
    })
    await bindManaged(page.request, group.id, [bot.id])
    await page.goto(`/g/${group.id}`)
    const box = page.getByPlaceholder(composer)
    const runs = page.getByTestId('run-card')
    const turn = async (text: string, nth: number) => {
      await box.fill(text)
      await page.getByRole('button', { name: '发送' }).click()
      await expect(runs).toHaveCount(nth, { timeout: 60_000 })
      await expect(runs.nth(nth - 1)).toHaveAttribute('data-status', 'completed', { timeout: 60_000 })
    }
    const tool = (name: string, args: unknown) => `@${botName} mock:tool ${name} ${JSON.stringify(args)}`

    const config = {
      transport: 'stdio',
      name: 'wiki',
      command: 'npx',
      args: ['-y', 'wiki-mcp'],
      env: { WIKI_TOKEN: '${secret:WIKI_TOKEN}' },
    }
    await turn(tool('mcp_create', { config }), 1)
    await turn(tool('secret_request', { names: ['WIKI_TOKEN'], forceNewSession: true }), 2)

    await test.step('the group admin fills the shared secret on the card', async () => {
      const card = page.getByTestId('secret-card')
      await expect(card).toContainText('WIKI_TOKEN')
      await card.getByRole('button', { name: '填写密钥' }).click()
      const dialog = page.getByRole('dialog', { name: '填写密钥' })
      await dialog.getByLabel('WIKI_TOKEN').fill('wk-secret-42')
      await dialog.getByRole('button', { name: '保存' }).click()
      await expect(dialog).toBeHidden()
      await expect(card.getByText('已填写')).toBeVisible()
    })

    await test.step('the next turn gets the MCP server with the secret resolved; the chat only ever shows it masked', async () => {
      // Filling the secret already started a turn that picks the request back up: the echo is the one after it.
      await box.fill(`@${botName} mock:echo`)
      await page.getByRole('button', { name: '发送' }).click()
      let timeline: TimelineDto | undefined
      let reply: MessageDto | undefined
      await expect
        .poll(
          async () => {
            timeline = await api.call<TimelineDto>('get', `/api/groups/${group.id}/timeline`)
            reply = timeline.messages.find(
              (x: MessageDto) => x.kind === 'bot' && x.body.includes('"mcpServers"'),
            )
            return !!reply
          },
          { timeout: 60_000 },
        )
        .toBe(true)
      if (!reply || !timeline) throw new Error('no echo')
      const got = JSON.parse(reply.body) as {
        mcpServers: { name: string; env?: { name: string; value: string }[] }[]
      }
      const wiki = got.mcpServers.find((s) => s.name === 'wiki')
      expect(wiki?.env).toEqual([{ name: 'WIKI_TOKEN', value: '[已脱敏]' }])
      expect(JSON.stringify(timeline.messages)).not.toContain('wk-secret-42')
    })
  } finally {
    m.stop()
  }
})
