import { writeFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import type { FilesTreeDto, GitCompareDto, GitOperationDto } from '@gonggong/protocol'
import { expect, type Page, test } from '@playwright/test'
import { bindManaged, buildDaemon, memberWithMachine, ROOT, remoteRepo } from './helpers'

test.beforeAll(buildDaemon)

const composer = '输入消息，@ 触发 Bot 或引用文件，/ 查看命令'
// Scripted agent: `mock:slow` keeps the turn busy for seconds.
const MOCK = `${process.execPath} ${join(ROOT, 'tools/mock-agent/agent.js')}`

async function say(page: Page, text: string) {
  await page.getByPlaceholder(composer).fill(text)
  await page.getByRole('button', { name: '发送' }).click()
}

/** Creates a member account via the admin API without logging `page` out of its session. */
async function extraMember(page: Page, account: string) {
  const ctx = await page
    .context()
    .browser()!
    .newContext({ baseURL: test.info().project.use.baseURL, locale: 'zh-CN' })
  const other = await ctx.newPage()
  const r = other.request
  await r.post('/api/auth/login', { data: { account: 'admin', password: 'admin-pass-2' } })
  const u = await (
    await r.post('/api/admin/users', {
      data: { account, name: account, role: 'member', password: 'init-pass-1' },
    })
  ).json()
  await r.post('/api/auth/logout')
  await r.post('/api/auth/login', { data: { account, password: 'init-pass-1' } })
  await r.post('/api/auth/password', { data: { oldPassword: 'init-pass-1', newPassword: 'member-pass' } })
  return { page: other, id: u.id as string, close: () => ctx.close() }
}

test('manual git: the owner switches branch, sees its tree, commits and pushes; a member asks and the owner approves; a live run blocks writes', async ({
  page,
}) => {
  test.setTimeout(6 * 60_000)
  const tag = Date.now().toString(36)
  const repo = remoteRepo()
  const seed = join(repo.root, 'seed')
  repo.git(seed, 'checkout', '-qb', 'feat/x')
  repo.git(seed, 'commit', '-q', '--allow-empty', '-m', 'start feat')
  repo.git(seed, 'push', '-q', 'origin', 'feat/x')
  repo.git(seed, 'checkout', '-q', 'main')

  const { m, api } = await memberWithMachine(page, `git${tag}`, { env: { GONGGONG_ADAPTER_CMD: MOCK } })
  const me = await api.me()
  const botName = `Git ${tag}`
  const bot = await api.call<{ id: string }>('post', '/api/bots', {
    name: botName,
    ownerId: me.id,
    agentKind: 'claude',
    avatar: 'role-no',
    machineId: await api.machineId(),
    systemPrompt: '',
  })
  const viewer = await extraMember(page, `gitv${tag}`)
  m.start()
  try {
    const group = await api.call<{ id: string }>('post', '/api/groups', {
      name: 'Git 操作',
      kind: 'group',
      memberIds: [viewer.id],
      botIds: [bot.id],
      repo: { url: repo.url, branch: 'main' },
    })
    await bindManaged(page.request, group.id, [bot.id])
    const base = `/api/groups/${group.id}/bots/${bot.id}`
    const bar = page.getByTestId('git-bar')
    const item = bar.getByTestId(`git-${bot.id}`)
    await page.goto(`/g/${group.id}`)
    await expect(item).toContainText('main', { timeout: 60_000 })

    const git = page.getByTestId('git-tab')
    await test.step('the owner switches to a remote branch from the Git tab', async () => {
      await item.getByRole('button', { name: `打开 ${botName} 的 Git` }).click()
      await git.getByRole('button', { name: `切换 ${botName} 的分支` }).click()
      // The branch popup lists a branch's actions; a clean work tree checks out without asking.
      await page.getByTitle('origin/feat/x').click()
      await page.getByRole('menuitem', { name: '检出', exact: true }).click()
      await expect(item).toContainText('feat/x', { timeout: 30_000 })
    })

    await test.step('another branch is readable without switching', async () => {
      repo.commit('main-only.txt', 'main\n')
      const tree = await api.call<FilesTreeDto>('get', `${base}/git/tree?ref=main&path=`)
      expect(tree.entries.map((e) => e.name)).toContain('README.md')
    })

    await test.step('the owner commits the bot’s change and pushes it', async () => {
      const dir = dirname(m.find('README.md')!)
      writeFileSync(join(dir, 'hello.txt'), 'hi\n')
      writeFileSync(join(dir, 'later.txt'), 'not yet\n')
      // Fetching re-reads the status, so files written outside a turn show up.
      await git.getByRole('button', { name: '获取远程更新' }).click()
      // New files start unpicked, as IDEA's unversioned files.
      await expect(git.getByRole('button', { name: '未跟踪：later.txt' })).toBeVisible({ timeout: 30_000 })
      await git.locator('label', { hasText: 'hello.txt' }).click()
      await expect(git.getByRole('checkbox', { name: '选择 hello.txt' })).toBeChecked()
      await git.getByRole('textbox', { name: '提交说明' }).fill('add hello')
      await git.getByRole('button', { name: '提交', exact: true }).click()
      // What was left out stays, unpicked.
      await expect(git.getByRole('button', { name: '未跟踪：hello.txt' })).toBeHidden({ timeout: 30_000 })
      await expect(git.getByRole('checkbox', { name: '选择 later.txt' })).not.toBeChecked()
      const left = await api.call<GitCompareDto>('get', `${base}/git/compare?from=HEAD`)
      expect(left.changes.map((c) => c.path)).toEqual(['later.txt'])
      await expect(page.getByText(/提交了 .* 的改动：add hello/).first()).toBeAttached({ timeout: 30_000 })

      await git.getByRole('tab', { name: '日志' }).click()
      await page.locator('.glog-row', { hasText: 'add hello' }).click()
      await page.getByRole('button', { name: '新增：hello.txt' }).click()
      await expect(page.locator('.diff__line').filter({ hasText: 'hi' }).first()).toBeVisible({
        timeout: 30_000,
      })
      await item.getByRole('button', { name: `打开 ${botName} 的 Git` }).click()
      await git.getByRole('button', { name: /^推送…/ }).click()
      const push = page.getByRole('dialog', { name: '推送' })
      await push.getByRole('button', { name: '推送' }).click()
      await expect(push).toBeHidden({ timeout: 30_000 })
      await expect
        .poll(() =>
          repo.git(
            repo.root,
            '--git-dir',
            join(repo.root, 'remote.git'),
            'log',
            '-1',
            '--format=%s',
            'feat/x',
          ),
        )
        .toContain('add hello')
    })

    await test.step('a live run refuses writes', async () => {
      await say(page, `@${botName} mock:slow`)
      await expect(page.getByTestId('run-card').last()).toHaveAttribute('data-status', 'running', {
        timeout: 30_000,
      })
      const res = await page.request.post(`${base}/git/actions`, { data: { action: 'pull' } })
      expect(res.status()).toBe(409)
      expect(await res.text()).toContain('正在运行')
      await expect(page.getByTestId('run-card').last()).toHaveAttribute('data-status', 'completed', {
        timeout: 60_000,
      })
    })

    await test.step('a member’s request waits for the owner, who approves it', async () => {
      const res = await viewer.page.request.post(`${base}/git/actions`, {
        data: { action: 'checkout', branch: 'main' },
      })
      expect(res.ok()).toBe(true)
      const op: GitOperationDto = await res.json()
      expect(op.status).toBe('pending_approval')
      await item.getByRole('button', { name: '待审批 1' }).click()
      const row = page.getByTestId(`git-op-${op.id}`)
      await row.getByRole('button', { name: '批准' }).click()
      // Settled requests leave the pending strip.
      await expect(row).toBeHidden({ timeout: 30_000 })
      await expect(item).toContainText('main', { timeout: 30_000 })
    })
  } finally {
    m.stop()
    await viewer.close()
  }
})
