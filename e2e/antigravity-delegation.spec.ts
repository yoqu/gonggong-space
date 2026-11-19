import { execFileSync } from 'node:child_process'
import { expect, test } from '@playwright/test'
import { bindManaged, buildDaemon, memberWithMachine } from './helpers'

test.beforeAll(buildDaemon)

// The real Antigravity CLI, logged in on this machine; skipped where it is not installed.
const agy = (() => {
  try {
    execFileSync('agy', ['--version'], { stdio: 'ignore' })
    return true
  } catch {
    return false
  }
})()

test("an Antigravity bot's subagent and background command show on its run, with how they ended", async ({
  page,
}) => {
  test.skip(!agy, 'Antigravity CLI (agy) is not installed')
  test.setTimeout(10 * 60_000)
  const { m, api } = await memberWithMachine(page, 'agy1')
  const me = await api.me()
  const bot = await api.call<{ id: string }>('post', '/api/bots', {
    name: 'agy1 Antigravity',
    ownerId: me.id,
    agentKind: 'antigravity',
    machineId: await api.machineId(),
    systemPrompt: '',
  })
  await page.request.patch(`/api/bots/${bot.id}`, {
    data: { tier: 'full', triggerScope: 'list', triggerList: [me.id] },
  })
  m.start()
  try {
    const group = await api.call<{ id: string }>('post', '/api/groups', {
      name: '反重力',
      kind: 'group',
      botIds: [bot.id],
      repo: null,
    })
    await bindManaged(page.request, group.id, [bot.id])
    await page.goto(`/g/${group.id}`)
    await page
      .getByPlaceholder('输入消息，@ 触发 Bot 或引用文件，/ 查看命令')
      .fill(
        '@agy1 Antigravity 同时做两件事，派发后不要等待，直接回复「已派发」：' +
          '1) 用 invoke_subagent 派一个 TypeName 为 research、Role 为「E2E Lister」的子 agent，' +
          '让它查看当前工作目录有哪些文件，并用 send_message 回报给你；' +
          '2) 用 run_command 在后台运行 `sleep 15; echo bg-e2e-done`，WaitMsBeforeAsync 设为 500。',
      )
    await page.getByRole('button', { name: '发送' }).click()
    const first = page.getByTestId('run-card').first()
    await expect(first).toBeVisible({ timeout: 60_000 })
    const card = page.locator(`[data-run-id="${await first.getAttribute('data-run-id')}"]`)

    await test.step('the run card counts the subagent and the background task while they work', async () => {
      await expect(card).toContainText('子 agent 1 个', { timeout: 4 * 60_000 })
      await page.screenshot({ path: 'test-results/agy-delegation-1.png' })
    })

    await test.step('both end after the turn that started them, which the agent goes on from by itself', async () => {
      await expect(card).toHaveAttribute('data-status', 'completed', { timeout: 4 * 60_000 })
      await expect(card).not.toContainText('运行中', { timeout: 4 * 60_000 })
      await expect(card).toContainText('子 agent 1 个')
      const goneOn = page.getByTestId('run-card').filter({ hasText: '后台任务完成后继续' })
      await expect(goneOn.first()).toBeVisible({ timeout: 4 * 60_000 })
      // It ends once the agent waits again, not after minutes of silence.
      for (const c of await goneOn.all())
        await expect(c).toHaveAttribute('data-status', 'completed', { timeout: 90_000 })
    })

    await test.step("the process shows the subagent's own work and the task's output", async () => {
      await card.hover()
      await card.getByRole('button', { name: '查看过程' }).click()
      const tab = page.getByTestId('run-tab')
      await expect(tab).toContainText('E2E Lister', { timeout: 30_000 })
      await expect(tab).toContainText('sleep 15; echo bg-e2e-done')
      await expect(tab).not.toContainText('运行中')
      await expect(card).not.toContainText('运行中')
      await page.screenshot({ path: 'test-results/agy-delegation-2.png' })
    })
  } finally {
    m.stop()
  }
})
