import { join } from 'node:path'
import { expect, test } from '@playwright/test'
import { bindManaged, buildDaemon, memberWithMachine, ROOT } from './helpers'

test.beforeAll(buildDaemon)

// Scripted agent: `mock:plan <ms>` reports a plan three times (made, advanced, all done) <ms> apart; no model.
const MOCK = `node ${join(ROOT, 'tools/mock-agent/agent.js')}`

test("the agent's plan follows each update on its run card and task chip, without a reload", async ({
  page,
}) => {
  test.setTimeout(4 * 60_000)
  const { m, api } = await memberWithMachine(page, 'plan1', { env: { GONGGONG_ADAPTER_CMD: MOCK } })
  const me = await api.me()
  const bot = await api.call<{ id: string }>('post', '/api/bots', {
    name: 'plan1 Bot',
    ownerId: me.id,
    agentKind: 'claude',
    machineId: await api.machineId(),
    systemPrompt: '',
  })
  m.start()
  try {
    const group = await api.call<{ id: string }>('post', '/api/groups', {
      name: '计划',
      kind: 'group',
      botIds: [bot.id],
      repo: null,
    })
    await bindManaged(page.request, group.id, [bot.id])
    await page.goto(`/g/${group.id}`)
    await page
      .getByPlaceholder('输入消息，@ 触发 Bot 或引用文件，/ 查看命令')
      .fill('@plan1 Bot mock:plan 6000')
    await page.getByRole('button', { name: '发送' }).click()
    const card = page.getByTestId('run-card').last()
    const plan = card.getByTestId('run-plan')
    const chip = page.getByTestId('task-dock-row')

    await expect(plan).toContainText('0/3', { timeout: 60_000 })
    await expect(chip).toContainText('0/3')
    await expect(plan.getByTestId('plan-item')).toHaveText(['读代码', '写测试', '提交'])
    await expect(plan.getByTestId('plan-item').first()).toHaveAttribute('data-status', 'in_progress')
    await page.screenshot({ path: 'test-results/agent-plan-1.png' })

    await expect(plan).toContainText('2/3', { timeout: 15_000 })
    await expect(chip).toContainText('2/3')
    await expect(plan.getByTestId('plan-item').last()).toHaveAttribute('data-status', 'in_progress')

    await expect(plan).toContainText('3/3', { timeout: 15_000 })
    await expect(chip).toContainText('3/3')
    await page.screenshot({ path: 'test-results/agent-plan-2.png' })

    await expect(card).toHaveAttribute('data-status', 'completed', { timeout: 30_000 })
    await expect(plan.getByRole('button', { name: /计划/ })).toHaveAttribute('aria-expanded', 'false')
    await card.hover()
    await card.getByRole('button', { name: '查看过程' }).click()
    await expect(page.getByTestId('run-tab').getByTestId('plan-item')).toHaveCount(3)
    await page.screenshot({ path: 'test-results/agent-plan-3.png' })
  } finally {
    m.stop()
  }
})
