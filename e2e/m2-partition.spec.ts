import { expect, type Page, test } from '@playwright/test'
import { buildDaemon, memberWithMachine, remoteRepo } from './helpers'

test.beforeAll(buildDaemon)

const composer = '输入消息，@ 触发 bot 或引用文件，/ 查看命令'

async function say(page: Page, text: string) {
  const before = await page.getByTestId('run-card').count()
  await page.getByPlaceholder(composer).fill(text)
  await page.getByRole('button', { name: '发送' }).click()
  return before
}

/** Sends a message that triggers one run and waits for that run's card to finish. */
async function runTo(page: Page, text: string, status = '已完成') {
  const before = await say(page, text)
  await expect(page.getByTestId('run-card')).toHaveCount(before + 1)
  const card = page.getByTestId('run-card').nth(before)
  await expect(card).toContainText(status, { timeout: 5 * 60_000 })
  return card
}

test('partition mode: managed clones, git default actions, status bar, /cd and /new with real Claude + Codex', async ({
  page,
}) => {
  test.setTimeout(20 * 60_000)
  const repo = remoteRepo()
  const { m, api } = await memberWithMachine(page, 'git1')
  const me = await api.me()
  const machineId = await api.machineId()
  const bot = async (name: string, agentKind: 'claude' | 'codex') => {
    const b = await api.call<{ id: string }>('post', '/api/bots', {
      name,
      ownerId: me.id,
      agentKind,
      machineId,
      systemPrompt: '',
    })
    // git push needs shell + network outside the workspace: full tier (requires an explicit trigger list).
    await page.request.patch(`/api/bots/${b.id}`, {
      data: { tier: 'full', triggerScope: 'list', triggerList: [me.id] },
    })
    return b
  }
  const claude = await bot('仓库 Claude', 'claude')
  const codex = await bot('仓库 Codex', 'codex')
  m.start()
  try {
    const group = await api.call<{ id: string }>('post', '/api/groups', {
      name: '仓库协作',
      kind: 'group',
      botIds: [claude.id, codex.id],
      repo: { url: repo.url, branch: 'main' },
    })
    await page.goto(`/g/${group.id}`)

    // Both bots get a managed clone on main; the status bar shows it.
    const bar = page.getByTestId('git-bar')
    await expect(bar).toContainText('仓库 Claude')
    await expect(bar.getByTestId(`git-${claude.id}`)).toContainText('main', { timeout: 60_000 })
    await expect(bar.getByTestId(`git-${codex.id}`)).toContainText('main', { timeout: 60_000 })
    await expect(bar.getByTestId(`git-${claude.id}`)).toContainText('托管')
    expect(m.find('README.md')).toBeTruthy()

    // Claude branches, commits and pushes; its status moves to the new branch.
    await runTo(
      page,
      '@仓库 Claude 新建分支 feat/hello，创建 hello.txt 内容为 hi，提交后 git push -u origin feat/hello。完成后只回复 done。',
    )
    await expect(bar.getByTestId(`git-${claude.id}`)).toContainText('feat/hello')
    expect(
      repo.git(repo.root, '--git-dir', `${repo.root}/remote.git`, 'branch', '--list', 'feat/hello'),
    ).toContain('feat/hello')

    // Someone pushes to main; Codex's clean main fast-forwards before its turn.
    repo.commit('from-main.txt', 'x\n')
    await runTo(page, '@仓库 Codex 列出当前目录下的文件名（不含隐藏文件），每行一个，不要做其他事。')
    await expect(page.getByTestId('bot-reply').last()).toContainText('from-main.txt')
    await expect(bar.getByTestId(`git-${codex.id}`)).toContainText('↓0')

    // /cd to a matching local clone → status shows /cd 绑定; a clone of another repo is refused.
    const local = repo.cloneTo('local-clone')
    await say(page, `/cd @仓库 Claude ${local}`)
    await expect(bar.getByTestId(`git-${claude.id}`)).toContainText('/cd 绑定', { timeout: 30_000 })
    const foreign = remoteRepo().cloneTo('foreign')
    await say(page, `/cd @仓库 Codex ${foreign}`)
    await expect(page.getByRole('main').getByText(/remote 与群仓库不一致/)).toBeVisible({ timeout: 30_000 })
    await expect(bar.getByTestId(`git-${codex.id}`)).toContainText('托管')

    // /new → the next run opens a fresh session and says so.
    await say(page, '/new @仓库 Codex')
    // Scoped to the timeline: the sidebar previews the same line as the group's last message.
    await expect(page.getByRole('main').getByText('仓库 Codex 下一轮将开新会话')).toBeVisible()
    const fresh = await runTo(page, '@仓库 Codex 只回复 ok')
    await expect(fresh).toContainText('已按要求开启新会话')
  } finally {
    m.stop()
  }
})
