import { join } from 'node:path'
import { expect, type Page, test } from '@playwright/test'
import { bindManaged, buildDaemon, memberWithMachine, ROOT } from './helpers'

test.beforeAll(buildDaemon)

const composer = '输入消息，@ 触发 Bot 或引用文件，/ 查看命令'
// Scripted agent: `mock:tool <name> <json>` calls the built-in gonggong tool, `mock:sh` runs a command; no model.
const MOCK = `node ${join(ROOT, 'tools/mock-agent/agent.js')}`

async function say(page: Page, text: string) {
  await page.getByPlaceholder(composer).fill(text)
  await page.getByRole('button', { name: '发送' }).click()
}

/** A `datetime-local` value one to two minutes ahead, in the browser's (this machine's) time zone. */
function soon() {
  const d = new Date(Date.now() + 120_000)
  const p = (n: number) => String(n).padStart(2, '0')
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}T${p(d.getHours())}:${p(d.getMinutes())}`
}

test('a bot schedules a task through gonggong; a member schedules one in the panel and it fires on time', async ({
  page,
}) => {
  test.setTimeout(6 * 60_000)
  const { m, api } = await memberWithMachine(page, 'sc1', { env: { GONGGONG_ADAPTER_CMD: MOCK } })
  const me = await api.me()
  const bot = await api.call<{ id: string }>('post', '/api/bots', {
    name: 'sc1 Bot',
    ownerId: me.id,
    agentKind: 'claude',
    machineId: await api.machineId(),
    systemPrompt: '',
  })
  m.start()
  try {
    const group = await api.call<{ id: string }>('post', '/api/groups', {
      name: '定时',
      kind: 'group',
      botIds: [bot.id],
      repo: null,
    })
    await bindManaged(page.request, group.id, [bot.id])
    await page.goto(`/g/${group.id}`)
    const main = page.getByRole('main')

    const daily = { name: '日报', prompt: '汇总昨天合并的 PR', cron: '0 9 * * 1-5' }
    await say(page, `@sc1 Bot mock:tool schedule_create ${JSON.stringify(daily)}`)
    const dailyCard = main.locator('.sc-card', { hasText: '日报' })
    await expect(dailyCard.getByText('启用中')).toBeVisible({ timeout: 60_000 })
    await expect(main.getByText(/已创建定时任务「日报」/)).toBeVisible()

    await main.getByRole('button', { name: '群设置' }).click()
    const drawer = page.getByRole('complementary', { name: '群设置' })
    await drawer.getByText('定时任务', { exact: true }).click()
    await expect(drawer.locator('.sc-row', { hasText: '日报' })).toBeVisible()
    await drawer.getByRole('button', { name: '新建定时任务' }).click()
    const dialog = page.getByRole('dialog', { name: '新建定时任务' })
    await dialog.getByLabel('名称').fill('巡检')
    await dialog.getByLabel('指令').fill('mock:sh echo 定时巡检完成')
    await dialog.getByRole('button', { name: '添加 sc1 Bot' }).click()
    await dialog.getByRole('radio', { name: '仅一次' }).click()
    await dialog.getByLabel('执行时刻').fill(soon())
    await expect(dialog.getByText(/接下来：/)).toBeVisible()
    await dialog.getByRole('button', { name: '创建' }).click()
    await page.keyboard.press('Escape')

    const patrol = main.locator('.sc-card', { hasText: '巡检' })
    await expect(patrol.getByText('启用中')).toBeVisible()
    // Fired in the member's name: the @ carries the 定时任务 tag and the bot's turn runs the command.
    const fired = main.locator('.tl-item', { hasText: '@sc1 Bot mock:sh echo 定时巡检完成' })
    await expect(fired.getByText('定时任务', { exact: true })).toBeVisible({ timeout: 4 * 60_000 })
    await expect(page.getByTestId('run-card').last()).toHaveAttribute('data-status', 'completed', {
      timeout: 60_000,
    })
    await expect(page.getByTestId('run-card').last()).toContainText('定时巡检完成')
    await expect(patrol.getByText('已停用', { exact: true })).toBeVisible()

    await dailyCard.getByRole('button', { name: '暂停' }).click()
    await expect(dailyCard.getByText('已停用', { exact: true })).toBeVisible()
  } finally {
    m.stop()
  }
})
