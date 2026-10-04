import { existsSync, readdirSync, readFileSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { expect, type Page, test } from '@playwright/test'
import { bindManaged, buildDaemon, memberWithMachine, ROOT, remoteRepo } from './helpers'

test.beforeAll(buildDaemon)

const composer = '输入消息，@ 触发 Bot 或引用文件，/ 查看命令'
// Scripted agent: `mock:sh` runs a command in the workspace; no model.
const MOCK = `node ${join(ROOT, 'tools/mock-agent/agent.js')}`

async function say(page: Page, text: string) {
  await page.getByPlaceholder(composer).fill(text)
  await page.getByRole('button', { name: '发送' }).click()
}

/** The run cards of `bot` that finished, newest last. */
const doneCards = (page: Page, bot: string) =>
  page.getByTestId('run-card').filter({ hasText: bot }).and(page.locator('[data-status="completed"]'))

/**
 * Two bots on one machine are two replicas of a repo group (docs/plan/强制同步-开发计划.md S9): the admin switches
 * the group to force sync, edits go out to the other replica, concurrent edits of different files both go in, an
 * overlapping edit is held and settled with 采用最新, and the group switches back.
 */
test('force sync: switch, distribute, concurrent edits, a held conflict, switch back', async ({ page }) => {
  test.setTimeout(6 * 60_000)
  const repo = remoteRepo()
  const tag = Date.now().toString(36)
  const { m, api } = await memberWithMachine(page, `fs${tag}`, { env: { GONGGONG_ADAPTER_CMD: MOCK } })
  const me = await api.me()
  const machineId = await api.machineId()
  const bot = (name: string) =>
    api.call<{ id: string }>('post', '/api/bots', {
      name,
      ownerId: me.id,
      agentKind: 'claude',
      machineId,
      systemPrompt: '',
    })
  const [A, B] = [`甲 ${tag}`, `乙 ${tag}`]
  const a = await bot(A)
  const b = await bot(B)
  m.start()
  try {
    const group = await api.call<{ id: string }>('post', '/api/groups', {
      name: '强制同步',
      kind: 'group',
      botIds: [a.id, b.id],
      repo: { url: repo.url, branch: 'main' },
    })
    await bindManaged(page.request, group.id, [a.id, b.id])
    /** A file in the bot's managed clone. */
    const file = (botId: string, name: string) => {
      const dir = join(m.home, 'workspaces', group.id, botId)
      return join(dir, readdirSync(dir)[0] ?? '', name)
    }
    const read = (botId: string, name: string) =>
      existsSync(file(botId, name)) ? readFileSync(file(botId, name), 'utf8') : null
    await page.goto(`/g/${group.id}`)
    const main = page.getByRole('main')
    const bar = page.locator('.sync-bar')

    await test.step('the admin switches to force sync with a base bot', async () => {
      await main.getByRole('button', { name: '群设置' }).click()
      await page
        .getByRole('complementary', { name: '群设置' })
        .getByRole('button', { name: /同步模式/ })
        .click()
      const dialog = page.getByRole('dialog', { name: /群设置|同步模式/ })
      await dialog.getByRole('button', { name: '切换为强制同步' }).click()
      await expect(dialog.getByTestId(`plan-${b.id}`)).toContainText('对齐')
      await dialog.getByRole('button', { name: '基准 Bot' }).click()
      await page.getByRole('menuitemcheckbox', { name: A }).click()
      await expect(dialog.getByTestId(`plan-${a.id}`)).toContainText('基准')
      await dialog.getByRole('button', { name: '确认切换' }).click()
      await expect(bar).toContainText('强制同步 · v1 · 2/2 一致', { timeout: 60_000 })
      await page.keyboard.press('Escape')
    })

    await test.step("a bot's edit becomes v2 and reaches the other replica", async () => {
      await say(page, `@${A} mock:sh printf 'a\\n' > a.txt`)
      await expect(doneCards(page, A).last().getByTestId('run-sync')).toHaveText('提交为 v2', {
        timeout: 60_000,
      })
      await expect(bar).toContainText('v2 · 2/2 一致', { timeout: 30_000 })
      expect(read(b.id, 'a.txt')).toBe('a\n')
    })

    await test.step('concurrent edits of different files both go in', async () => {
      await say(page, `@${A} mock:sh sleep 2 && printf 'x\\n' > x.txt`)
      await say(page, `@${B} mock:sh sleep 2 && printf 'y\\n' > y.txt`)
      await expect(doneCards(page, A)).toHaveCount(2, { timeout: 60_000 })
      await expect(doneCards(page, B)).toHaveCount(1, { timeout: 60_000 })
      await expect(bar).toContainText('v4 · 2/2 一致', { timeout: 30_000 })
      for (const id of [a.id, b.id]) expect([read(id, 'x.txt'), read(id, 'y.txt')]).toEqual(['x\n', 'y\n'])
    })

    await test.step('an overlapping edit is held; 采用最新 settles it', async () => {
      await say(page, `@${A} mock:sh sleep 2 && printf 'from A\\n' > a.txt`)
      await say(page, `@${B} mock:sh sleep 2 && printf 'from B\\n' > a.txt`)
      const card = main.getByTestId('sync-conflict-card')
      await expect(card).toContainText('冲突：1 个文件', { timeout: 60_000 })
      await expect(bar).toContainText('1 冲突')
      await card.getByRole('button', { name: '处理' }).click()
      const dialog = page.getByRole('dialog', { name: /的同步冲突/ })
      await dialog.getByTestId('conflict-a.txt').getByRole('radio', { name: '采用最新' }).click()
      await dialog.getByRole('button', { name: '提交' }).click()
      await expect(bar).toContainText('v5 · 2/2 一致', { timeout: 60_000 })
      await expect(bar).not.toContainText('冲突')
      expect(read(a.id, 'a.txt')).toBe(read(b.id, 'a.txt'))
    })

    await test.step('a hand edit pauses its replica until it is submitted from the panel', async () => {
      writeFileSync(file(b.id, 'hand.txt'), 'hand\n')
      await say(page, `@${A} mock:sh printf 'z\\n' > z.txt`)
      await expect(bar).toContainText('v6', { timeout: 60_000 })
      await expect(bar).toContainText('1 本地有改动', { timeout: 30_000 })
      expect(read(b.id, 'z.txt')).toBeNull()
      await bar.getByRole('button').click()
      const panel = page.getByRole('dialog', { name: '同步状态' })
      await panel.getByTestId(`replica-${b.id}`).getByRole('button', { name: '提交本地改动' }).click()
      await expect(bar).toContainText('v7 · 2/2 一致', { timeout: 60_000 })
      expect([read(a.id, 'hand.txt'), read(b.id, 'z.txt')]).toEqual(['hand\n', 'z\n'])
      await page.keyboard.press('Escape')
    })

    await test.step('switching back to partition mode removes the status bar', async () => {
      await bar.getByRole('button').click()
      await page
        .getByRole('dialog', { name: '同步状态' })
        .getByRole('button', { name: '同步模式设置' })
        .click()
      await page.getByRole('button', { name: '切回分区模式' }).click()
      // The confirmation's own button.
      await page.getByRole('button', { name: '切回分区模式' }).last().click()
      await expect(bar).toBeHidden({ timeout: 30_000 })
    })
  } finally {
    m.stop()
  }
})
