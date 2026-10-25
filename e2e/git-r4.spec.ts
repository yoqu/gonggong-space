import { execFileSync } from 'node:child_process'
import { readFileSync, writeFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { expect, type Page, test } from '@playwright/test'
import { bindManaged, buildDaemon, memberWithMachine, ROOT, remoteRepo } from './helpers'

test.beforeAll(buildDaemon)
test.use({ actionTimeout: 15_000, viewport: { width: 1680, height: 1000 } })

const MOCK = `${process.execPath} ${join(ROOT, 'tools/mock-agent/agent.js')}`

async function workspace(page: Page, account: string) {
  const tag = `${account}${Date.now().toString(36)}`
  const repo = remoteRepo()
  const { m, api } = await memberWithMachine(page, tag, { env: { GONGGONG_ADAPTER_CMD: MOCK } })
  const me = await api.me()
  const botName = `R4 ${tag}`
  const bot = await api.call<{ id: string }>('post', '/api/bots', {
    name: botName,
    ownerId: me.id,
    agentKind: 'claude',
    avatar: 'role-no',
    machineId: await api.machineId(),
    systemPrompt: '',
  })
  m.start()
  const group = await api.call<{ id: string }>('post', '/api/groups', {
    name: `R4 ${tag}`,
    kind: 'group',
    memberIds: [],
    botIds: [bot.id],
    repo: { url: repo.url, branch: 'main' },
  })
  await bindManaged(page.request, group.id, [bot.id])
  const item = page.getByTestId('git-bar').getByTestId(`git-${bot.id}`)
  await page.goto(`/g/${group.id}`)
  await expect(item).toContainText('main', { timeout: 60_000 })
  await item.getByRole('button', { name: `打开 ${botName} 的 Git` }).click()
  return {
    m,
    repo,
    dir: dirname(m.find('README.md')!),
    git: page.getByTestId('git-tab'),
    botName,
  }
}

function git(dir: string, ...args: string[]) {
  return execFileSync('git', ['-c', 'user.name=e2e', '-c', 'user.email=e2e@gonggong', ...args], {
    cwd: dir,
    encoding: 'utf8',
  }).trim()
}

async function history(page: Page) {
  await page.getByTestId('git-tab').getByRole('button', { name: '提交历史' }).click()
  const log = page.locator('.glog').last()
  await log.getByRole('button', { name: '刷新', exact: true }).click()
  await expect(log.locator('.glog-row').first()).toBeVisible({ timeout: 30_000 })
  return log
}

async function selectCommit(page: Page, subject: string) {
  const log = await history(page)
  await log.locator('.glog-row', { hasText: subject }).click()
  return page.getByRole('region', { name: '变更文件' })
}

test('R4 interactive rebase rewords one commit and drops another in the real branch history', async ({
  page,
}) => {
  test.setTimeout(6 * 60_000)
  const w = await workspace(page, 'r4rebase')
  try {
    git(w.dir, 'checkout', '-qb', 'rebase-demo')
    writeFileSync(join(w.dir, 'base.txt'), 'base\n')
    git(w.dir, 'add', 'base.txt')
    git(w.dir, 'commit', '-qm', 'base for interactive rebase')
    for (const [file, subject] of [
      ['keep.txt', 'keep this commit'],
      ['drop.txt', 'drop this commit'],
      ['reword.txt', 'old commit message'],
    ] as const) {
      writeFileSync(join(w.dir, file), `${file}\n`)
      git(w.dir, 'add', file)
      git(w.dir, 'commit', '-qm', subject)
    }
    const log = await history(page)
    await expect(log.locator('.glog-row', { hasText: 'old commit message' })).toBeVisible({ timeout: 30_000 })
    const base = log.locator('.glog-row', { hasText: 'base for interactive rebase' })
    await base.focus()
    await page.keyboard.press('Shift+F10')
    await expect(page.getByRole('menuitem', { name: '从此提交之后交互式变基…' })).toBeVisible()
    await page.getByRole('menuitem', { name: '从此提交之后交互式变基…' }).click()
    const dialog = page.getByRole('dialog', { name: '交互式变基 rebase-demo' })
    const list = dialog.getByRole('listbox', { name: '变基提交，按执行顺序排列' })
    await expect(list.getByRole('option')).toHaveCount(3, { timeout: 30_000 })

    await dialog.getByRole('button', { name: '提交 drop this commit 的动作' }).click()
    await page.getByRole('menuitemcheckbox', { name: 'Drop', exact: true }).last().click()
    await dialog.getByRole('button', { name: '提交 old commit message 的动作' }).click()
    await page.getByRole('menuitemcheckbox', { name: 'Reword', exact: true }).last().click()
    await dialog
      .getByRole('textbox', { name: '提交 old commit message 的提交说明' })
      .fill('rewritten commit message')
    await dialog.getByRole('button', { name: '开始变基' }).click()
    await expect(dialog).toBeHidden({ timeout: 30_000 })

    await expect
      .poll(() => git(w.dir, 'log', '-4', '--format=%s'), { timeout: 30_000 })
      .toBe('rewritten commit message\nkeep this commit\nbase for interactive rebase\ninit')
    expect(readFileSync(join(w.dir, 'keep.txt'), 'utf8')).toBe('keep.txt\n')
    expect(readFileSync(join(w.dir, 'reword.txt'), 'utf8')).toBe('reword.txt\n')
    expect(() => readFileSync(join(w.dir, 'drop.txt'))).toThrow()
    expect(git(w.dir, 'status', '--porcelain')).toBe('')
  } finally {
    w.m.stop()
  }
})

test('R4 three-way merge applies the edited result to the conflicted work-tree file', async ({ page }) => {
  test.setTimeout(6 * 60_000)
  const w = await workspace(page, 'r4merge')
  try {
    git(w.dir, 'checkout', '-qb', 'feature')
    writeFileSync(join(w.dir, 'README.md'), '# demo\nours\n')
    git(w.dir, 'commit', '-qam', 'ours')
    w.repo.commit('README.md', '# demo\ntheirs\n')
    await w.git.getByRole('button', { name: '获取远程更新' }).click()
    await w.git.getByRole('button', { name: `切换 ${w.botName} 的分支` }).click()
    await page.getByTitle('origin/main').click()
    await page.getByRole('menuitem', { name: '将 origin/main 合并到 feature' }).click()

    const banner = w.git.locator('.gc-ongoing')
    await expect(banner).toContainText('正在合并', { timeout: 30_000 })
    await banner.getByRole('button', { name: '解决冲突' }).click()
    const merge = page.getByRole('region', { name: '合并工具' })
    const conflict = merge.getByRole('group', { name: '冲突 1' })
    await expect(conflict).toBeVisible({ timeout: 30_000 })
    await conflict.getByRole('button', { name: '接受你的', exact: true }).click()
    await conflict.getByRole('button', { name: '接受他们的', exact: true }).click()
    await conflict.getByRole('textbox', { name: '冲突 1 的合并结果' }).fill('resolved by R4')
    await merge.getByRole('button', { name: '应用', exact: true }).click()

    await expect(banner).toContainText('冲突已全部解决', { timeout: 30_000 })
    expect(readFileSync(join(w.dir, 'README.md'), 'utf8')).toBe('# demo\nresolved by R4\n')
    expect(git(w.dir, 'diff', '--name-only', '--diff-filter=U')).toBe('')
    expect(git(w.dir, 'diff', '--cached', '--name-only')).toBe('README.md')
  } finally {
    w.m.stop()
  }
})

test('R4 commit file menu applies only the chosen file change without committing it', async ({ page }) => {
  test.setTimeout(6 * 60_000)
  const w = await workspace(page, 'r4apply')
  try {
    writeFileSync(join(w.dir, 'picked.txt'), 'before\n')
    writeFileSync(join(w.dir, 'untouched.txt'), 'before\n')
    git(w.dir, 'add', '.')
    git(w.dir, 'commit', '-qm', 'add source files')
    writeFileSync(join(w.dir, 'picked.txt'), 'before\npicked change\n')
    writeFileSync(join(w.dir, 'untouched.txt'), 'before\nother change\n')
    git(w.dir, 'commit', '-qam', 'change two files')
    writeFileSync(join(w.dir, 'picked.txt'), 'before\npicked change\nchosen commit addition\n')
    writeFileSync(join(w.dir, 'untouched.txt'), 'before\nother change\nother commit addition\n')
    git(w.dir, 'commit', '-qam', 'change both files again')
    git(w.dir, 'branch', 'source-changes')
    git(w.dir, 'push', '-q', 'origin', 'source-changes')
    git(w.dir, 'reset', '--hard', 'HEAD^')

    const files = await selectCommit(page, 'change both files again')
    const picked = files.getByRole('button', { name: '修改：picked.txt' })
    await expect(picked).toBeVisible({ timeout: 30_000 })
    await picked.click({ button: 'right' })
    await expect(page.getByRole('menuitem', { name: '优选所选改动' })).toBeVisible()
    await page.getByRole('menuitem', { name: '优选所选改动' }).click()
    const dialog = page.getByRole('dialog', { name: '优选所选改动' })
    const applied = page.waitForResponse(
      (r) => r.url().endsWith('/git/actions') && r.request().method() === 'POST',
    )
    await dialog.getByRole('button', { name: '优选', exact: true }).click()
    const operation = await (await applied).json()
    const patch = operation.detail?.commands?.find((c: { command: string }) =>
      c.command.includes('diff-tree'),
    )
    const apply = operation.detail?.commands?.find((c: { command: string }) =>
      c.command.includes('apply --3way'),
    )
    expect(operation.paths).toEqual(['picked.txt'])
    expect(patch?.stdout).toContain('diff --git a/picked.txt b/picked.txt')
    expect(patch?.stdout).not.toContain('untouched.txt')
    expect(apply?.stderr).not.toContain('untouched.txt')
    await expect(dialog).toBeHidden({ timeout: 30_000 })

    await expect
      .poll(() => readFileSync(join(w.dir, 'picked.txt'), 'utf8'), { timeout: 30_000 })
      .toBe('before\npicked change\nchosen commit addition\n')
    expect(readFileSync(join(w.dir, 'untouched.txt'), 'utf8')).toBe('before\nother change\n')
    expect(git(w.dir, 'log', '-1', '--format=%s')).toBe('change two files')
    expect(git(w.dir, 'status', '--porcelain')).toBe('M  picked.txt')
  } finally {
    w.m.stop()
  }
})

test('R4 commit file menu restores a file from an older revision over local edits', async ({ page }) => {
  test.setTimeout(6 * 60_000)
  const w = await workspace(page, 'r4restore')
  try {
    writeFileSync(join(w.dir, 'README.md'), '# old revision\n')
    git(w.dir, 'commit', '-qam', 'old file contents')
    writeFileSync(join(w.dir, 'README.md'), '# current revision\n')
    git(w.dir, 'commit', '-qam', 'current file contents')
    writeFileSync(join(w.dir, 'README.md'), '# unsaved local edit\n')

    const files = await selectCommit(page, 'old file contents')
    const file = files.getByRole('button', { name: '修改：README.md' })
    await expect(file).toBeVisible({ timeout: 30_000 })
    await file.focus()
    await page.keyboard.press('Shift+F10')
    await expect(page.getByRole('menuitem', { name: '从该版本取回文件…' })).toBeVisible()
    await page.getByRole('menuitem', { name: '从该版本取回文件…' }).click()
    const dialog = page.getByRole('dialog', { name: '从该版本取回文件' })
    await expect(dialog).toContainText('这些文件中未提交的改动会被覆盖')
    await dialog.getByRole('button', { name: '取回文件' }).click()
    await expect(dialog).toBeHidden({ timeout: 30_000 })

    await expect
      .poll(() => readFileSync(join(w.dir, 'README.md'), 'utf8'), { timeout: 30_000 })
      .toBe('# old revision\n')
    expect(git(w.dir, 'log', '-1', '--format=%s')).toBe('current file contents')
    expect(git(w.dir, 'status', '--porcelain')).toBe('M  README.md')
  } finally {
    w.m.stop()
  }
})
