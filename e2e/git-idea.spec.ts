import { readFileSync, writeFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import type { GitChangesDto, GitStashesDto } from '@gonggong/protocol'
import { expect, test } from '@playwright/test'
import { bindManaged, buildDaemon, memberWithMachine, ROOT, remoteRepo } from './helpers'

test.beforeAll(buildDaemon)

const MOCK = `${process.execPath} ${join(ROOT, 'tools/mock-agent/agent.js')}`

test('IDEA-style git: a new branch, a merge that conflicts resolved in the merge tool, and a stash round trip', async ({
  page,
}) => {
  test.setTimeout(6 * 60_000)
  const tag = Date.now().toString(36)
  const repo = remoteRepo()
  const { m, api } = await memberWithMachine(page, `gidea${tag}`, { env: { GONGGONG_ADAPTER_CMD: MOCK } })
  const me = await api.me()
  const botName = `Idea ${tag}`
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
      name: 'IDEA Git',
      kind: 'group',
      memberIds: [],
      botIds: [bot.id],
      repo: { url: repo.url, branch: 'main' },
    })
    await bindManaged(page.request, group.id, [bot.id])
    const base = `/api/groups/${group.id}/bots/${bot.id}`
    const item = page.getByTestId('git-bar').getByTestId(`git-${bot.id}`)
    const git = page.getByTestId('git-tab')
    await page.goto(`/g/${group.id}`)
    await expect(item).toContainText('main', { timeout: 60_000 })
    await item.getByRole('button', { name: `打开 ${botName} 的 Git` }).click()
    const dir = dirname(m.find('README.md')!)

    await test.step('creates and checks out a branch from the branch popup', async () => {
      await git.getByRole('button', { name: `切换 ${botName} 的分支` }).click()
      await page.getByRole('button', { name: '新建分支…' }).click()
      const d = page.getByRole('dialog', { name: '新建分支' })
      await d.getByLabel('新分支名称').fill('feat/fee')
      await d.getByRole('button', { name: '创建' }).click()
      await expect(item).toContainText('feat/fee', { timeout: 30_000 })
    })

    await test.step('commits a change that main changes too', async () => {
      writeFileSync(join(dir, 'README.md'), '# demo\nfee = 2\n')
      await git.getByRole('button', { name: '获取远程更新' }).click()
      await expect(git).toContainText('已选 1 / 1 个文件', { timeout: 30_000 })
      await git.getByRole('textbox', { name: '提交说明' }).fill('fee 2')
      await git.getByRole('button', { name: '提交', exact: true }).click()
      await expect(git).toContainText('没有未提交的改动', { timeout: 30_000 })
      repo.commit('README.md', '# demo\nfee = 3\n')
      await git.getByRole('button', { name: '获取远程更新' }).click()
    })

    await test.step('merging origin/main stops on the conflict, resolved in the merge tool, then committed', async () => {
      await git.getByRole('button', { name: `切换 ${botName} 的分支` }).click()
      await page.getByTitle('origin/main').click()
      // The owner's merge from a branch's actions runs at once, as IDEA's.
      await page.getByRole('menuitem', { name: '将 origin/main 合并到 feat/fee' }).click()
      const banner = git.getByRole('status')
      await expect(banner).toContainText('正在合并', { timeout: 30_000 })
      await expect(banner).toContainText('1 个文件有冲突')
      await banner.getByRole('button', { name: '解决冲突' }).click()
      await page.getByRole('button', { name: '接受他们的' }).click()
      await page.getByRole('button', { name: '应用' }).click()
      await expect(banner).toContainText('冲突已全部解决', { timeout: 30_000 })
      expect(readFileSync(join(dir, 'README.md'), 'utf8')).toBe('# demo\nfee = 3\n')
      await banner.getByRole('button', { name: '提交合并…' }).click()
      await page.getByRole('dialog', { name: '完成合并' }).getByRole('button', { name: '提交' }).click()
      await expect(banner).toBeHidden({ timeout: 30_000 })
      const changes = await api.call<GitChangesDto>('get', `${base}/git/changes`)
      expect(changes).toMatchObject({ conflicts: [], ongoing: null })
      expect(changes.head?.message).toContain('Merge')
      await expect(page.getByText(/执行了 continue/).first()).toBeAttached({ timeout: 30_000 })
    })

    await test.step('stashes work in progress and pops it back', async () => {
      writeFileSync(join(dir, 'wip.txt'), 'half done\n')
      await git.getByRole('button', { name: '获取远程更新' }).click()
      await expect(git.getByRole('button', { name: '未跟踪：wip.txt' })).toBeVisible({ timeout: 30_000 })
      await git.getByRole('tab', { name: /^贮藏/ }).click()
      await git.getByRole('button', { name: '贮藏改动…' }).click()
      const s = page.getByRole('dialog', { name: '贮藏改动' })
      await s.getByLabel('说明（可选）').fill('wip')
      await s.getByRole('button', { name: '贮藏' }).click()
      await expect(git.getByRole('button', { name: /wip/ })).toBeVisible({ timeout: 30_000 })
      await expect
        .poll(async () => (await api.call<GitStashesDto>('get', `${base}/git/stashes`)).stashes.length)
        .toBe(1)
      await git.getByRole('button', { name: '恢复…' }).click()
      await page
        .getByRole('dialog', { name: /恢复贮藏/ })
        .getByRole('button', { name: '弹出' })
        .click()
      await expect
        .poll(async () => (await api.call<GitStashesDto>('get', `${base}/git/stashes`)).stashes.length)
        .toBe(0)
      expect(readFileSync(join(dir, 'wip.txt'), 'utf8')).toBe('half done\n')
    })
  } finally {
    m.stop()
  }
})
