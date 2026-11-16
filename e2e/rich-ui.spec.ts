import { join } from 'node:path'
import { expect, test } from '@playwright/test'
import { bindManaged, buildDaemon, memberWithMachine, ROOT } from './helpers'

test.beforeAll(buildDaemon)

// Scripted agent: `mock:say <text>` replies with the text verbatim.
const MOCK = `${process.execPath} ${join(ROOT, 'tools/mock-agent/agent.js')}`

const REPLY = [
  'CPU 持续升高，建议扩容。',
  '',
  '```mermaid',
  'flowchart LR',
  '  A[告警] --> B[扩容]',
  '```',
  '',
  '```actions',
  '{"id":"scale","prompt":"要扩容吗？","options":[{"label":"扩容到 4 台","value":"scale-4","style":"primary"},{"label":"再观察"}]}',
  '```',
].join('\n')

test('a bot reply renders a diagram and buttons; a click answers the bot as the clicker', async ({
  page,
}) => {
  test.setTimeout(4 * 60_000)
  const tag = Date.now().toString(36)
  const { m, api } = await memberWithMachine(page, `rich${tag}`, { env: { GONGGONG_ADAPTER_CMD: MOCK } })
  const me = await api.me()
  const botName = `图表 ${tag}`
  const bot = await api.call<{ id: string }>('post', '/api/bots', {
    name: botName,
    ownerId: me.id,
    agentKind: 'claude',
    avatar: 'role-no',
    machineId: await api.machineId(),
    systemPrompt: '',
  })
  m.start()
  try {
    const group = await api.call<{ id: string }>('post', '/api/groups', {
      name: '富交互',
      kind: 'group',
      botIds: [bot.id],
      repo: null,
    })
    await bindManaged(page.request, group.id, [bot.id])
    await page.goto(`/g/${group.id}`)
    // Sent from the composer once the chat is live: posted over the API right after loading, a run done within
    // the page's first moments can leave its card showing 运行中 (see the report).
    await page
      .getByPlaceholder('输入消息，@ 触发 Bot 或引用文件，/ 查看命令')
      .fill(`@${botName} mock:say ${REPLY}`)
    await page.getByRole('button', { name: '发送' }).click()
    const runs = page.getByTestId('run-card')
    await expect(runs).toHaveCount(1, { timeout: 60_000 })
    await expect(runs.first()).toHaveAttribute('data-status', 'completed', { timeout: 60_000 })

    const main = page.getByRole('main')
    await expect(main.locator('.rich-mermaid svg').first()).toBeVisible({ timeout: 30_000 })
    await expect(main.locator('.rich-mermaid')).toContainText('扩容')

    await main.getByRole('button', { name: '扩容到 4 台' }).click()
    await expect(main.getByText(`rich${tag} 已选择 扩容到 4 台`)).toBeVisible({ timeout: 30_000 })
    await expect(main.getByRole('button', { name: '扩容到 4 台', exact: true })).toBeDisabled()
    // The click comes back to the bot as a message from the clicker, starting its next turn.
    await expect(main.getByText(`@${botName} 选择了「scale-4」`)).toBeVisible()
    await expect(runs).toHaveCount(2, { timeout: 60_000 })
  } finally {
    m.stop()
  }
})
