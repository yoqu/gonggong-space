import { execFileSync } from 'node:child_process'
import { existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import type { GitOperationsDto, GitStashesDto } from '@gonggong/protocol'
import { expect, type Locator, type Page, test } from '@playwright/test'
import { bindManaged, buildDaemon, memberWithMachine, remoteRepo } from './helpers'

test.beforeAll(buildDaemon)
test.use({ viewport: { width: 1600, height: 1000 } })

const MOCK = `${process.execPath} ${join(import.meta.dirname, '../tools/mock-agent/agent.js')}`
const SHOTS = process.env.GONGGONG_R5_SHOTS

async function shot(page: Page, name: string) {
  if (!SHOTS) return
  mkdirSync(SHOTS, { recursive: true })
  await page.screenshot({ path: join(SHOTS, `${name}.png`), fullPage: true })
}

function git(cwd: string, ...args: string[]) {
  return execFileSync('git', args, { cwd, encoding: 'utf8' }).trim()
}

async function openGit(page: Page, botId: string, botName: string) {
  const item = page.getByTestId('git-bar').getByTestId(`git-${botId}`)
  await expect(item).toContainText('main', { timeout: 60_000 })
  await item.getByRole('button', { name: `打开 ${botName} 的 Git` }).click()
  return page.getByTestId('git-tab')
}

async function stash(gitTab: Locator, message: string) {
  await gitTab.getByRole('tab', { name: /^贮藏/ }).click()
  await gitTab.getByRole('button', { name: '贮藏改动…' }).click()
  const dialog = gitTab.page().getByRole('dialog', { name: '贮藏改动' })
  await dialog.getByLabel('说明（可选）').fill(message)
  await dialog.getByRole('button', { name: '贮藏', exact: true }).click()
  await expect(gitTab.getByRole('button', { name: new RegExp(message) })).toBeVisible({ timeout: 30_000 })
}

test('R5 real daemon: structured console, annotate previous revision, and stash apply/pop', async ({
  page,
}) => {
  test.setTimeout(6 * 60_000)
  const tag = Date.now().toString(36)
  const repo = remoteRepo()
  const seed = join(repo.root, 'seed')
  writeFileSync(join(seed, 'annotate.ts'), 'const first = 1\n')
  repo.git(seed, 'add', 'annotate.ts')
  repo.git(seed, 'commit', '--amend', '--no-edit')
  repo.git(seed, 'push', '--force', 'origin', 'main')
  const oldCommit = repo.git(seed, 'log', '-1', '--format=%H', 'main')
  await new Promise((resolve) => setTimeout(resolve, 1100))
  repo.commit('annotate.ts', 'const first = 1\nconst second = 2\n')
  const newCommit = repo.git(seed, 'log', '-1', '--format=%H', 'main')
  expect(newCommit).not.toBe(oldCommit)

  const { m, api } = await memberWithMachine(page, `r5${tag}`, {
    env: { GONGGONG_ADAPTER_CMD: MOCK },
  })
  const me = await api.me()
  const botName = `R5 ${tag}`
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
      name: `R5 ${tag}`,
      kind: 'group',
      memberIds: [],
      botIds: [bot.id],
      repo: { url: repo.url, branch: 'main' },
    })
    await bindManaged(page.request, group.id, [bot.id])
    const base = `/api/groups/${group.id}/bots/${bot.id}`
    await page.goto(`/g/${group.id}`)
    const gitTab = await openGit(page, bot.id, botName)
    const dir = dirname(m.find('annotate.ts')!)

    await test.step('file annotations use a time gradient and open the previous revision read-only', async () => {
      await page.getByRole('button', { name: '新建标签页', exact: true }).click()
      await page
        .getByRole('menuitem', { name: botName, exact: true })
        .and(page.locator('[data-value^="files:"]'))
        .click()
      await page.getByRole('treeitem', { name: 'annotate.ts' }).click()
      const viewer = page.locator('.wt-files__view')
      await viewer.getByRole('button', { name: '注解（Git Blame）' }).click()
      const oldCell = viewer.locator('.pv-line').nth(0).locator('.pv-line__blame')
      const newCell = viewer.locator('.pv-line').nth(1).locator('.pv-line__blame')
      await expect(oldCell).toBeVisible({ timeout: 30_000 })
      await expect(newCell).toBeVisible()
      await expect(oldCell).toHaveAttribute('title', /init/)
      await expect(newCell).toHaveAttribute('title', /add annotate\.ts/)
      await expect(oldCell).toHaveAttribute('title', /<[^>]+>/)
      const oldTitle = await oldCell.getAttribute('title')
      const oldHash = oldTitle?.split('\n').at(-1)
      expect(oldHash).toMatch(/^[0-9a-f]{40}$/)
      const newHash = (await newCell.getAttribute('title'))?.split('\n').at(-1)
      expect(newHash).toMatch(/^[0-9a-f]{40}$/)
      expect(newHash).not.toBe(oldHash)
      const newShort = newHash!.slice(0, 7)
      const oldShort = oldHash!.slice(0, 7)
      const oldColor = await oldCell.evaluate((el) => getComputedStyle(el).backgroundColor)
      const newColor = await newCell.evaluate((el) => getComputedStyle(el).backgroundColor)
      expect(oldColor).not.toBe(newColor)
      expect(oldColor).not.toBe('rgba(0, 0, 0, 0)')
      expect(newColor).not.toBe('rgba(0, 0, 0, 0)')
      await shot(page, '02-file-annotations')

      await newCell.getByRole('button', { name: `注解上一修订：${newShort}` }).click()
      const previous = page.locator('.fv').filter({ visible: true }).last()
      await expect(page.getByRole('tab', { name: `annotate.ts @ ${oldShort}` })).toHaveAttribute(
        'aria-selected',
        'true',
      )
      await expect(previous.getByRole('button', { name: '注解（Git Blame）' })).toHaveAttribute(
        'aria-pressed',
        'true',
      )
      await expect(previous.locator('.pv-line__blame').filter({ hasText: oldShort }).first()).toBeVisible({
        timeout: 30_000,
      })
      await expect(previous.getByRole('button', { name: `注解上一修订：${oldShort}` })).toBeDisabled()
      expect(readFileSync(join(dir, 'annotate.ts'), 'utf8')).toBe('const first = 1\nconst second = 2\n')
      expect(git(dir, 'status', '--porcelain')).toBe('')
    })

    await test.step('an empty stash failure stays in the console with structured commands and exit codes', async () => {
      await page
        .getByTestId('git-bar')
        .getByTestId(`git-${bot.id}`)
        .getByRole('button', { name: `打开 ${botName} 的 Git` })
        .click()
      await gitTab.getByRole('tab', { name: /^贮藏/ }).click()
      await gitTab.getByRole('button', { name: '贮藏改动…' }).click()
      const empty = page.getByRole('dialog', { name: '贮藏改动' })
      await empty.getByLabel('说明（可选）').fill('expected empty failure')
      await empty.getByRole('button', { name: '贮藏', exact: true }).click()
      await expect
        .poll(async () => {
          const { operations: ops } = await api.call<GitOperationsDto>(
            'get',
            `/api/groups/${group.id}/git/operations`,
          )
          return ops.some((op) => op.action === 'stash' && op.status === 'failed')
        })
        .toBe(true)
      await empty.press('Escape')
      await expect(empty).toBeHidden()
      await gitTab.getByRole('tab', { name: '控制台', exact: true }).click()
      const failed = gitTab
        .locator('.git-console__op[data-status="failed"]')
        .filter({ hasText: '贮藏' })
        .first()
      await expect(failed).toContainText('失败', { timeout: 30_000 })
      const stashCommand = failed.locator('.git-console__command-line').filter({ hasText: 'stash push' })
      await expect(stashCommand.locator('code')).toContainText(/git -C .*stash push/)
      await expect(stashCommand).toContainText(/退出码 \d+/)
      await gitTab.getByRole('button', { name: '仅失败' }).click()
      await expect(gitTab.locator('.git-console__op[data-status="succeeded"]')).toHaveCount(0)
      await shot(page, '01-console')
      await gitTab.getByRole('button', { name: '仅失败' }).click()
    })

    await test.step('stash context apply preserves the stash and pop removes it', async () => {
      writeFileSync(join(dir, 'apply.txt'), 'apply me\n')
      await gitTab.getByRole('tab', { name: /^提交/ }).click()
      await gitTab.getByRole('button', { name: '获取远程更新' }).click()
      await expect(gitTab.getByRole('button', { name: '未跟踪：apply.txt' })).toBeVisible({ timeout: 30_000 })
      expect(readFileSync(join(dir, 'annotate.ts'), 'utf8')).toBe('const first = 1\nconst second = 2\n')
      await stash(gitTab, 'apply shortcut')
      await shot(page, '03-stash')
      const stashes = () => api.call<GitStashesDto>('get', `${base}/git/stashes`)
      await expect.poll(async () => (await stashes()).stashes.length).toBe(1)

      await gitTab.getByRole('button', { name: /apply shortcut/ }).click({ button: 'right' })
      await page.getByRole('menuitem', { name: '应用', exact: true }).click()
      await page
        .getByRole('dialog', { name: /恢复贮藏/ })
        .getByRole('button', { name: '应用', exact: true })
        .click()
      const lastUnstashStatus = async () => {
        const { operations } = await api.call<GitOperationsDto>(
          'get',
          `/api/groups/${group.id}/git/operations`,
        )
        return operations.find((op) => op.action === 'unstash')?.status
      }
      await expect.poll(lastUnstashStatus).toBe('succeeded')
      await expect.poll(async () => (await stashes()).stashes.length).toBe(1)
      await expect
        .poll(() =>
          existsSync(join(dir, 'apply.txt')) ? readFileSync(join(dir, 'apply.txt'), 'utf8') : null,
        )
        .toBe('apply me\n')

      rmSync(join(dir, 'apply.txt'))
      writeFileSync(join(dir, 'apply.txt'), 'apply me\n')
      await gitTab.getByRole('tab', { name: /^提交/ }).click()
      await gitTab.getByRole('button', { name: '获取远程更新' }).click()
      await expect(gitTab.getByRole('button', { name: '未跟踪：apply.txt' })).toBeVisible({ timeout: 30_000 })
      await stash(gitTab, 'pop shortcut')
      await gitTab.getByRole('button', { name: /pop shortcut/ }).click({ button: 'right' })
      await page.getByRole('menuitem', { name: '弹出', exact: true }).click()
      await page
        .getByRole('dialog', { name: /恢复贮藏/ })
        .getByRole('button', { name: '弹出', exact: true })
        .click()
      await expect.poll(lastUnstashStatus).toBe('succeeded')
      await expect.poll(async () => (await stashes()).stashes.length).toBe(1)
      await expect.poll(() => readFileSync(join(dir, 'apply.txt'), 'utf8')).toBe('apply me\n')
    })
  } finally {
    m.stop()
  }
})
