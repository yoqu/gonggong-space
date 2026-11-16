import { join } from 'node:path'
import { expect, test } from '@playwright/test'
import { bindManaged, buildDaemon, memberWithMachine, ROOT } from './helpers'

test.beforeAll(buildDaemon)

// Scripted agent: `mock:live <ms>` reports an occupancy, then reads two files <ms> apart; no model.
const MOCK = `node ${join(ROOT, 'tools/mock-agent/agent.js')}`

test("the run tab's context grows with each tool call while the run goes on, without a reload", async ({
  page,
}) => {
  test.setTimeout(4 * 60_000)
  const { m, api } = await memberWithMachine(page, 'ctx1', { env: { GONGGONG_ADAPTER_CMD: MOCK } })
  const me = await api.me()
  const bot = await api.call<{ id: string }>('post', '/api/bots', {
    name: 'ctx1 Bot',
    ownerId: me.id,
    agentKind: 'claude',
    machineId: await api.machineId(),
    systemPrompt: '',
  })
  m.start()
  try {
    const group = await api.call<{ id: string }>('post', '/api/groups', {
      name: '上下文',
      kind: 'group',
      botIds: [bot.id],
      repo: null,
    })
    await bindManaged(page.request, group.id, [bot.id])
    await page.goto(`/g/${group.id}`)
    await page
      .getByPlaceholder('输入消息，@ 触发 Bot 或引用文件，/ 查看命令')
      .fill('@ctx1 Bot mock:live 8000')
    await page.getByRole('button', { name: '发送' }).click()
    const card = page.getByTestId('run-card').last()
    await expect(card).toHaveAttribute('data-status', 'running', { timeout: 60_000 })
    await card.hover()
    await card.getByRole('button', { name: '查看过程' }).click()
    const runTab = page.getByTestId('run-tab')
    await runTab.getByRole('tab', { name: '上下文' }).click()
    const ctx = runTab.getByRole('region', { name: '上下文窗口' })

    await expect(ctx).toContainText('实时', { timeout: 30_000 })
    await expect(ctx).toContainText('≈2k')
    await expect(ctx).toContainText('含估算增量 1k')
    await page.waitForTimeout(800)
    await page.screenshot({ path: 'test-results/context-live-1.png' })
    await expect(ctx).toContainText('≈4k', { timeout: 15_000 })
    await expect(ctx).toContainText('含估算增量 3k')
    await expect(ctx.locator('.ctxw__list')).toContainText('读取文件')
    await expect(ctx.locator('.ctxw__list')).toContainText('×2')
    await page.waitForTimeout(800)
    await page.screenshot({ path: 'test-results/context-live-2.png' })

    await expect(card).toHaveAttribute('data-status', 'completed', { timeout: 30_000 })
    await expect(ctx).toContainText('已统计')
    await expect(ctx).not.toContainText('≈')
    await expect(ctx).toContainText('4k / 200k')
    await page.screenshot({ path: 'test-results/context-live-3.png' })
  } finally {
    m.stop()
  }
})
