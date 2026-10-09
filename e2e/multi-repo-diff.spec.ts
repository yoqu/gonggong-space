import { execFileSync } from 'node:child_process'
import { mkdirSync, mkdtempSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { expect, type Locator, type Page, test } from '@playwright/test'
import { bindManaged, buildDaemon, memberWithMachine, remoteRepo } from './helpers'

test.beforeAll(buildDaemon)
test.use({ viewport: { width: 1920, height: 1080 } })

const git = (cwd: string, ...args: string[]) =>
  execFileSync(
    'git',
    ['-c', 'user.name=e2e', '-c', 'user.email=e2e@gonggong', '-c', 'commit.gpgsign=false', ...args],
    { cwd, encoding: 'utf8' },
  )

/** A repo at `dir` with one commit of README.md on `main`. */
function repoAt(dir: string) {
  mkdirSync(dir, { recursive: true })
  git(dir, 'init', '-q', '-b', 'main')
  writeFileSync(join(dir, 'README.md'), '# repo\n')
  git(dir, 'add', '.')
  git(dir, 'commit', '-qm', 'init')
}

function commit(dir: string, file: string, body: string) {
  writeFileSync(join(dir, file), body)
  git(dir, 'add', '.')
  git(dir, 'commit', '-qm', `add ${file}`)
}

/**
 * Not a repo itself: `app` on feat/a (one commit + one uncommitted edit against main), `libs/core` on main with an
 * untracked file, and a repo under node_modules that must stay out.
 */
function multiRepoDir() {
  const root = mkdtempSync(join(tmpdir(), 'gonggong-multi-'))
  const app = join(root, 'app')
  repoAt(app)
  git(app, 'checkout', '-qb', 'feat/a')
  commit(app, 'feature.ts', 'export const a = 1\n')
  writeFileSync(join(app, 'README.md'), '# repo\nwip\n')
  const core = join(root, 'libs/core')
  repoAt(core)
  writeFileSync(join(core, 'todo.md'), 'core\n')
  const dep = join(root, 'node_modules/x')
  repoAt(dep)
  writeFileSync(join(dep, 'dirty.js'), 'x\n')
  return root
}

/** A repo on main whose submodule `sub` sits on feat/s, one commit ahead of the submodule's main. */
function rootWithSubmodule() {
  const base = mkdtempSync(join(tmpdir(), 'gonggong-sub-'))
  const src = join(base, 'sub-src')
  repoAt(src)
  const root = join(base, 'root')
  repoAt(root)
  git(root, '-c', 'protocol.file.allow=always', 'submodule', 'add', '-q', src, 'sub')
  git(root, 'commit', '-qm', 'add sub')
  const sub = join(root, 'sub')
  git(sub, 'checkout', '-qb', 'feat/s')
  commit(sub, 'lib.ts', 'export const s = 1\n')
  return root
}

/** The diff tab's changed-file list (unfolded when the workbench is too narrow to show it beside the diff). */
async function fileList(pane: Locator) {
  await expect(pane.locator('.diff__file').first()).toBeAttached({ timeout: 30_000 })
  if ((await pane.getAttribute('data-layout')) === 'narrow') {
    const pick = pane.locator('.diff-pane__pick')
    if ((await pick.getAttribute('aria-expanded')) !== 'true') await pick.click()
  }
  return pane.locator('.diff__files')
}

const header = (list: Locator, name: string) =>
  list.locator('.diff__repo', {
    has: list.page().locator('.diff__repo-name', { hasText: new RegExp(`^${name}$`) }),
  })

/** The diff tab in front (others stay mounted, hidden). */
const diffPane = (page: Page) => page.getByTestId('diff-pane').filter({ visible: true })

/**
 * No agent turn needed: a bot /cd'd into a non-git dir reports the repos below it, and a second bot into a repo on
 * main whose submodule is on a feature branch. The GitBar summarizes them, its list opens a repo's diff, and the diff
 * tab groups files under a header per repo, each compared with its own main.
 */
test('multi-repo workspace: GitBar sub repos and diff grouped per repo', async ({ page }) => {
  test.setTimeout(6 * 60_000)
  const repo = remoteRepo()
  const tag = Date.now().toString(36)
  const { m, api } = await memberWithMachine(page, `mr${tag}`)
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
  const multiName = `多仓 Claude ${tag}`
  const subName = `子模块 Claude ${tag}`
  const multi = await bot(multiName)
  const subBot = await bot(subName)
  const multiDir = multiRepoDir()
  const subDir = rootWithSubmodule()
  m.start()
  try {
    const group = await api.call<{ id: string }>('post', '/api/groups', {
      name: `多仓库 ${tag}`,
      kind: 'group',
      botIds: [multi.id, subBot.id],
      repo: { url: repo.url, branch: 'main' },
    })
    await bindManaged(page.request, group.id, [multi.id, subBot.id])
    // Neither dir is a clone of the group repo: forced past the remote check.
    for (const [id, path] of [
      [multi.id, multiDir],
      [subBot.id, subDir],
    ] as const) {
      const res = await page.request.put(`/api/groups/${group.id}/bots/${id}/workspace`, {
        data: { path, force: true },
      })
      expect(res.status()).toBe(204)
    }
    await page.goto(`/g/${group.id}`)
    const bar = page.getByTestId('git-bar')
    const multiItem = bar.getByTestId(`git-${multi.id}`)
    const subItem = bar.getByTestId(`git-${subBot.id}`)
    await expect(multiItem).toContainText('本机目录', { timeout: 60_000 })
    await expect(subItem).toContainText('本机目录', { timeout: 60_000 })

    await test.step('GitBar lists the nested repos, not node_modules', async () => {
      // No root repo: no branch of its own, just the sub repo summary.
      await expect(multiItem.locator('.git-bar__branch')).toHaveCount(0)
      await multiItem.getByRole('button', { name: '+2 个子仓库有改动' }).click()
      const pop = page.getByRole('dialog', { name: `${multiName} 的子仓库` })
      await expect(pop.locator('.git-subs__path')).toHaveText(['app', 'libs/core'])
      await expect(pop).not.toContainText('node_modules')
      await expect(pop.locator('.git-subs__item', { hasText: 'app' })).toContainText('feat/a')
      await pop.locator('.git-subs__item', { hasText: 'app' }).click()
      await expect(pop).toBeHidden()
    })

    await test.step('the diff tab groups files per repo, paths relative to it', async () => {
      const pane = diffPane(page)
      // app has uncommitted work: the tab opens on 未提交.
      await expect(pane.getByRole('radio', { name: '未提交' })).toBeChecked()
      await expect(pane.locator('.diff-pane__branch')).toHaveText('2 个仓库')
      const list = await fileList(pane)
      await expect(list.locator('.diff__repo-name')).toHaveText(['app', 'libs/core'])
      const app = header(list, 'app')
      await expect(app.locator('.diff__repo-branch')).toHaveText('feat/a')
      await expect(app.locator('.diff__repo-count')).toHaveText('1 个文件')
      await expect(header(list, 'libs/core').locator('.diff__repo-branch')).toHaveText('main')
      await expect(list.locator('.diff__file[title="app/README.md"] .diff__base')).toHaveText('README.md')
      await expect(list.locator('.diff__file[title="app/README.md"] .diff__dir')).toHaveText('')
      await expect(list.locator('.diff__file[title="libs/core/todo.md"] .diff__base')).toHaveText('todo.md')
      // Opened on app: its file is the one shown.
      await expect(pane.locator('.diff__name')).toHaveText('app/README.md')
      await expect(list).not.toContainText('node_modules')
      await expect(list).not.toContainText('dirty.js')

      // 对比主分支: app's commit and edit against its own main; libs/core is on main, so it drops out.
      await pane.getByRole('radio', { name: '对比主分支' }).click()
      await expect(header(list, 'app').locator('.diff__repo-branch')).toHaveText('feat/a → main', {
        timeout: 30_000,
      })
      await expect(header(list, 'app').locator('.diff__repo-count')).toHaveText('2 个文件')
      await expect(list.locator('.diff__repo-name')).toHaveText(['app'])
      await expect(list.locator('.diff__file[title="app/feature.ts"]')).toBeVisible()

      // Collapsing a repo hides its files.
      await header(list, 'app').click()
      await expect(header(list, 'app')).toHaveAttribute('aria-expanded', 'false')
      await expect(list.locator('.diff__file[title="app/feature.ts"]')).toHaveCount(0)
      await header(list, 'app').click()
      await expect(list.locator('.diff__file[title="app/feature.ts"]')).toBeVisible()
    })

    await test.step('a root on main still shows its submodule’s branch against the submodule’s main', async () => {
      await expect(subItem.locator('.git-bar__branch')).toHaveText('main')
      await subItem.getByRole('button', { name: '1 个子仓库' }).click()
      const pop = page.getByRole('dialog', { name: `${subName} 的子仓库` })
      await expect(pop.locator('.git-subs__path')).toHaveText(['sub'])
      await pop.locator('.git-subs__item', { hasText: 'sub' }).click()
      const pane = diffPane(page)
      await expect(pane.getByRole('radio', { name: '对比主分支' })).toBeChecked()
      const list = await fileList(pane)
      await expect(list.locator('.diff__repo-name')).toHaveText(['sub'])
      await expect(header(list, 'sub').locator('.diff__repo-branch')).toHaveText(
        /^feat\/s → (origin\/)?main$/,
      )
      await expect(list.locator('.diff__file[title="sub/lib.ts"] .diff__base')).toHaveText('lib.ts')
    })
  } finally {
    m.stop()
  }
})
