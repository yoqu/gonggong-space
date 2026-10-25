import type { GroupDto } from '@gonggong/protocol'
import { act, fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import { MemoryRouter } from 'react-router'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { useWorkbench } from '../src/app/workbench'
import { useWorkspace } from '../src/app/workspace'
import { GitBar } from '../src/features/chat/GitBar'
import { GitDialogHost } from '../src/features/git/dialogs/GitDialogHost'
import { LinkedGitOperation } from '../src/features/git/GitOperations'
import { GitTab } from '../src/features/workbench/tabs/GitTab'
import { useToasts } from '../src/ui'
import {
  actionsCalled,
  BASE,
  benchTabs,
  branch,
  done,
  group,
  HEAD_COMMIT,
  op,
  REFS,
  refreshes,
  resetStores,
  routes,
  setMe,
  state,
  status,
  toasts,
} from './gitFixtures'
import { apiError, mockApi } from './mockApi'

beforeEach(resetStores)
afterEach(() => vi.unstubAllGlobals())

/** The bar plus the bot's Git tab once opened and the git dialogs, as the chat page and its workbench show them. */
function Page({ g = group() }: { g?: GroupDto }) {
  const tab = useWorkbench((s) => s.benches.g1?.tabs.find((t) => t.kind === 'git'))
  return (
    <>
      <GitBar group={g} />
      {tab?.kind === 'git' ? <GitTab tab={tab} tabKey={`git:${tab.botId}`} active /> : null}
      <GitDialogHost />
    </>
  )
}

const openGit = async () => {
  fireEvent.click(await screen.findByRole('button', { name: '打开 小王的 Claude 的 Git' }))
  return within(await screen.findByTestId('git-tab'))
}
const dialog = async (name: string | RegExp) => within(await screen.findByRole('dialog', { name }))
/** The Git tab's branch popup. */
const popup = async () => {
  const tab = await openGit()
  fireEvent.click(await tab.findByRole('button', { name: '切换 小王的 Claude 的分支' }))
  return dialog('小王的 Claude 的分支')
}
/** The merge dialog from ⋯ (the popup's merge runs at once for the owner), main picked. */
const mergeDialog = async () => {
  const tab = await openGit()
  fireEvent.click(tab.getByRole('button', { name: '更多 Git 操作' }))
  fireEvent.click(await screen.findByRole('menuitem', { name: '合并…' }))
  const d = await dialog('合并到 feat/refund-v2')
  fireEvent.change(d.getByRole('combobox'), { target: { value: 'main' } })
  return d
}

describe('git status bar', () => {
  it('opens the Git tab from the branch or the workspace menu; git actions live there only', async () => {
    mockApi(routes())
    render(<Page />)
    const trigger = await screen.findByRole('button', { name: '打开 小王的 Claude 的 Git' })
    expect(trigger.textContent).toBe('feat/refund-v2')
    fireEvent.click(await screen.findByRole('button', { name: '小王的 Claude 的工作区' }))
    const menu = await dialog('小王的 Claude 的工作区')
    expect(menu.queryByRole('button', { name: /拉取|推送|提交/ })).toBeNull()
    fireEvent.click(menu.getByRole('button', { name: '打开 小王的 Claude 的 Git' }))
    expect(benchTabs()).toEqual([{ kind: 'git', botId: 'b1' }])
    expect(await screen.findByTestId('git-tab')).toBeTruthy()
  })

  it('stays hidden outside partition groups with a repo', async () => {
    mockApi(routes())
    render(<Page g={group({ mode: 'force' })} />)
    fireEvent.click(await screen.findByRole('button', { name: '小王的 Claude 的工作区' }))
    const menu = await dialog('小王的 Claude 的工作区')
    expect(menu.queryByRole('button', { name: /Git/ })).toBeNull()
    expect(screen.queryByRole('button', { name: '打开 小王的 Claude 的 Git' })).toBeNull()
  })
})

describe('Git tab toolbar', () => {
  it('refreshes the status when shown and shows the branch with how far it is from its upstream', async () => {
    const calls = mockApi(
      routes({ 'GET /groups/g1/bot-states': [state({ git: status({ behind: 2, ahead: 3 }) })] }),
    )
    render(<Page />)
    const tab = await openGit()
    await waitFor(() => expect(refreshes(calls)).toEqual([{ fetch: false }]))
    const bar = within(tab.getByRole('toolbar', { name: 'Git 工具栏' }))
    expect(bar.getByRole('button', { name: '切换 小王的 Claude 的分支' }).textContent).toBe('feat/refund-v2')
    expect(bar.getByRole('img', { name: '落后 2 个提交' }).textContent).toBe('↓2')
    expect(bar.getByRole('img', { name: '领先 3 个提交' }).textContent).toBe('↑3')
    expect(bar.getByRole('button', { name: /^推送…/ }).textContent).toBe('推送…↑3')
  })

  it('names a detached HEAD by its commit and an unpublished branch as such', async () => {
    mockApi(routes({ 'GET /groups/g1/bot-states': [state({ git: status({ branch: null, ahead: null }) })] }))
    const { unmount } = render(<Page />)
    let tab = await openGit()
    expect(tab.getByRole('button', { name: '切换 小王的 Claude 的分支' }).textContent).toBe('a1b2c3d（游离）')
    unmount()
    useWorkbench.setState({ benches: {} })
    mockApi(routes({ 'GET /groups/g1/bot-states': [state({ git: status({ ahead: null, behind: null }) })] }))
    render(<Page />)
    tab = await openGit()
    expect(tab.getByRole('button', { name: /^推送…/ }).textContent).toBe('推送…未发布')
  })

  it('fetches the remotes on demand, showing progress and the failure reason', async () => {
    let finish: (r: Response) => void = () => {}
    const calls = mockApi(
      routes({
        [`POST ${BASE}/refresh`]: (b: { fetch: boolean }) =>
          b.fetch ? new Promise<Response>((r) => (finish = r)) : undefined,
      }),
    )
    render(<Page />)
    const tab = await openGit()
    await waitFor(() => expect(refreshes(calls)).toHaveLength(1))
    fireEvent.click(tab.getByRole('button', { name: '获取远程更新' }))
    expect(refreshes(calls).at(-1)).toEqual({ fetch: true })
    const busy = await tab.findByRole('button', { name: '正在获取远程更新…' })
    expect((busy as HTMLButtonElement).disabled).toBe(true)
    finish(apiError(502, 'git_failed', 'fatal: could not read from remote repository'))
    await waitFor(() => expect(toasts()).toContain('fatal: could not read from remote repository'))
    expect(tab.getByRole('button', { name: '获取远程更新' })).toBeTruthy()
  })

  it('updates by merge, rebase or fast-forward only, remembering the choice', async () => {
    const calls = mockApi(routes({ [`POST ${BASE}/actions`]: done }))
    render(<Page />)
    fireEvent.click((await openGit()).getByRole('button', { name: '更新…' }))
    let d = await dialog('更新 feat/refund-v2')
    expect(d.getByText('从 origin/feat/refund-v2 获取')).toBeTruthy()
    expect((d.getByRole('radio', { name: /^合并/ }) as HTMLInputElement).checked).toBe(true)
    fireEvent.click(d.getByRole('radio', { name: /^变基/ }))
    expect(d.getByText('本地改动会先贮藏，更新后自动恢复')).toBeTruthy()
    fireEvent.click(d.getByRole('button', { name: '更新' }))
    await waitFor(() => expect(actionsCalled(calls)).toEqual([{ action: 'pull', mode: 'rebase' }]))
    await waitFor(() => expect(screen.queryByRole('dialog', { name: '更新 feat/refund-v2' })).toBeNull())
    fireEvent.click(screen.getByRole('button', { name: '更新…' }))
    d = await dialog('更新 feat/refund-v2')
    expect((d.getByRole('radio', { name: /^变基/ }) as HTMLInputElement).checked).toBe(true)
  })

  it("words a non-owner's actions as requests", async () => {
    setMe('u2')
    const calls = mockApi(
      routes({ [`POST ${BASE}/actions`]: op({ action: 'pull', status: 'pending_approval' }) }),
    )
    render(<Page />)
    const tab = await openGit()
    expect(tab.getByRole('button', { name: '提交申请' })).toBeTruthy()
    fireEvent.click(tab.getByRole('button', { name: '更新…' }))
    const d = await dialog('更新 feat/refund-v2')
    expect(d.getByText('需要 Bot 主人 小王 批准后才会执行')).toBeTruthy()
    fireEvent.click(d.getByRole('button', { name: '提交申请' }))
    await waitFor(() => expect(actionsCalled(calls)).toEqual([{ action: 'pull', mode: 'merge' }]))
    await waitFor(() => expect(toasts()).toContain('已提交申请，等待 Bot 主人 小王 审批'))
  })

  it('shows the server message when the bot is busy, keeping the dialog open', async () => {
    mockApi(
      routes({
        [`POST ${BASE}/actions`]: apiError(409, 'conflict', '小王的 Claude 正在运行，等运行结束后再操作'),
      }),
    )
    render(<Page />)
    fireEvent.click((await openGit()).getByRole('button', { name: '更新…' }))
    fireEvent.click((await dialog('更新 feat/refund-v2')).getByRole('button', { name: '更新' }))
    await waitFor(() => expect(toasts()).toContain('小王的 Claude 正在运行，等运行结束后再操作'))
    expect(screen.getByRole('dialog', { name: '更新 feat/refund-v2' })).toBeTruthy()
  })

  it('opens the commit history and the rest of the commands from ⋯', async () => {
    const calls = mockApi(routes({ [`POST ${BASE}/actions`]: done }))
    render(<Page />)
    const tab = await openGit()
    fireEvent.click(tab.getByRole('button', { name: '提交历史' }))
    expect(benchTabs().at(-1)).toMatchObject({
      kind: 'git-log',
      botId: 'b1',
      ref: null,
      commit: null,
      path: null,
    })

    fireEvent.click(tab.getByRole('button', { name: '更多 Git 操作' }))
    fireEvent.click(await screen.findByRole('menuitem', { name: '编辑上一次提交说明…' }))
    const reword = await dialog('编辑提交说明')
    const text = reword.getByRole('textbox', { name: '提交说明' }) as HTMLTextAreaElement
    expect(text.value).toBe('修复退款金额\n\n按原路退回。')
    fireEvent.change(text, { target: { value: '修复退款金额的计算' } })
    fireEvent.click(reword.getByRole('button', { name: '保存' }))
    await waitFor(() =>
      expect(actionsCalled(calls)).toEqual([
        {
          action: 'commit',
          message: '修复退款金额的计算',
          paths: [],
          amend: true,
          expectHead: HEAD_COMMIT.hash,
        },
      ]),
    )
    await waitFor(() => expect(screen.queryByRole('dialog', { name: '编辑提交说明' })).toBeNull())

    fireEvent.click(tab.getByRole('button', { name: '更多 Git 操作' }))
    fireEvent.click(await screen.findByRole('menuitem', { name: '撤销上一次提交…' }))
    const undo = await dialog('撤销提交')
    expect(undo.getByText('撤销 a1b2c3d，它的改动回到未提交的更改')).toBeTruthy()
    fireEvent.click(undo.getByRole('button', { name: '撤销提交' }))
    await waitFor(() =>
      expect(actionsCalled(calls).at(-1)).toEqual({
        action: 'reset',
        commit: 'HEAD~1',
        mode: 'soft',
        expectHead: HEAD_COMMIT.hash,
      }),
    )
  })

  it('switches between the repos of a workspace with sub-repos, each read and acted on by its path', async () => {
    const calls = mockApi(
      routes({
        'GET /groups/g1/bot-states': [
          state({
            git: status({
              repos: [
                { path: 'libs/core', kind: 'submodule', branch: 'dev', ahead: 0, behind: 1, dirty: false },
              ],
            }),
          }),
        ],
        [`GET ${BASE}/changes?repo=libs%2Fcore`]: { ...CHANGES_EMPTY },
        [`GET ${BASE}/refs?repo=libs%2Fcore`]: {
          ...REFS,
          branches: [branch('dev', { current: true, upstream: 'origin/dev', behind: 1 })],
        },
        [`POST ${BASE}/actions`]: done,
      }),
    )
    render(<Page />)
    const tab = await openGit()
    fireEvent.click(tab.getByRole('button', { name: '仓库' }))
    fireEvent.click(await screen.findByRole('menuitemcheckbox', { name: 'libs/core' }))
    await waitFor(() =>
      expect(benchTabs()).toEqual([{ kind: 'git', botId: 'b1', repo: 'libs/core', file: null }]),
    )
    expect(await tab.findByText('没有未提交的改动')).toBeTruthy()
    expect(tab.getByRole('button', { name: '切换 小王的 Claude 的分支' }).textContent).toBe('dev')
    fireEvent.click(tab.getByRole('button', { name: '更新…' }))
    fireEvent.click((await dialog('更新 dev')).getByRole('button', { name: '更新' }))
    await waitFor(() =>
      expect(actionsCalled(calls)).toEqual([{ action: 'pull', mode: 'merge', repo: 'libs/core' }]),
    )
  })
})

const CHANGES_EMPTY = { changes: [], conflicts: [], ongoing: null, head: null, limited: false }

describe('branch popup', () => {
  it('lists recent, local, remote branches and tags, favourites first, with incoming and outgoing counts', async () => {
    mockApi(routes())
    render(<Page />)
    const pop = await popup()
    const heads = [...document.querySelectorAll('.gb__head')].map((h) => h.textContent)
    expect(heads).toEqual(['最近', '本地', '远程 · origin', '标签'])
    const rows = [...document.querySelectorAll('.gb__item .gb__row')].map((r) => r.getAttribute('title'))
    // main is the group's base branch: a favourite until unstarred; the current branch comes first too.
    expect(rows).toEqual([
      'feat/fee',
      'main',
      'feat/refund-v2',
      'feat/fee',
      'origin/main',
      'origin/feat/pay',
      'v1.2',
    ])
    expect(pop.getByRole('button', { name: '取消收藏 main' })).toBeTruthy()
    const main = pop.getAllByRole('button', { name: /^main/ })[0] as HTMLElement
    expect(within(main).getByRole('img', { name: '落后 2 个提交' }).textContent).toBe('↓2')
    // feat/… folders under 本地 and 远程, unfolded while there are few branches; folding hides their branches.
    const [localFeat] = pop.getAllByRole('button', { name: 'feat' })
    expect(localFeat?.getAttribute('aria-expanded')).toBe('true')
    fireEvent.click(localFeat as HTMLElement)
    expect(pop.getAllByTitle('feat/fee')).toHaveLength(1)
  })

  it('searches branches and tags flat, then lists a branch’s actions', async () => {
    mockApi(routes())
    render(<Page />)
    const pop = await popup()
    fireEvent.change(pop.getByRole('searchbox', { name: '搜索分支和标签' }), { target: { value: 'pay' } })
    expect(pop.queryByText('最近')).toBeNull()
    fireEvent.click(pop.getByTitle('origin/feat/pay'))
    const menu = within(await pop.findByRole('menu', { name: 'origin/feat/pay' }))
    expect(menu.getAllByRole('menuitem')[0]?.textContent).toBe('检出')
    expect(pop.getByRole('searchbox', { name: '搜索分支和标签' })).toBeTruthy()
  })

  it('checks a branch out at once, uncommitted changes or not (git says when they are in the way)', async () => {
    const calls = mockApi(routes({ [`POST ${BASE}/actions`]: done }))
    render(<Page />)
    const pop = await popup()
    fireEvent.click(pop.getAllByRole('button', { name: /^main/ })[0] as HTMLElement)
    fireEvent.click(await pop.findByRole('menuitem', { name: '检出' }))
    await waitFor(() => expect(actionsCalled(calls)).toEqual([{ action: 'checkout', branch: 'main' }]))
    expect(screen.queryByRole('dialog', { name: '检出 main' })).toBeNull()
  })

  it('checks a tag out detached, after saying what that means', async () => {
    const calls = mockApi(
      routes({
        'GET /groups/g1/bot-states': [state({ git: status({ dirty: false }) })],
        [`POST ${BASE}/actions`]: done,
      }),
    )
    render(<Page />)
    const pop = await popup()
    fireEvent.click(await pop.findByTitle('v1.2'))
    fireEvent.click(await pop.findByRole('menuitem', { name: '检出' }))
    const d = await dialog('检出 v1.2')
    expect(d.getByText(/游离 HEAD/)).toBeTruthy()
    fireEvent.click(d.getByRole('button', { name: '检出' }))
    await waitFor(() =>
      expect(actionsCalled(calls)).toEqual([{ action: 'checkout', branch: 'v1.2', detach: true }]),
    )
  })

  it('creates a branch from the current HEAD or a picked ref, refusing names git would', async () => {
    const calls = mockApi(routes({ [`POST ${BASE}/actions`]: done }))
    render(<Page />)
    const pop = await popup()
    fireEvent.click(pop.getByRole('button', { name: '新建分支…' }))
    const d = await dialog('新建分支')
    const name = d.getByRole('textbox', { name: '新分支名称' })
    const create = d.getByRole('button', { name: '创建' }) as HTMLButtonElement
    fireEvent.change(name, { target: { value: 'feat/fee' } })
    expect(d.getByText('分支 feat/fee 已存在')).toBeTruthy()
    expect(create.disabled).toBe(true)
    fireEvent.change(name, { target: { value: 'feat/my fee' } })
    expect(d.getByText('无效的分支名')).toBeTruthy()
    fireEvent.change(name, { target: { value: 'feat/..x' } })
    expect(d.getByText('无效的分支名')).toBeTruthy()
    fireEvent.change(name, { target: { value: 'feat/refund-fee' } })
    fireEvent.change(d.getByRole('combobox'), { target: { value: 'origin/main' } })
    fireEvent.click(d.getByRole('checkbox', { name: '创建后检出' }))
    fireEvent.click(create)
    await waitFor(() =>
      expect(actionsCalled(calls)).toEqual([
        { action: 'branch-create', name: 'feat/refund-fee', checkout: false, from: 'origin/main' },
      ]),
    )
  })

  it('merges a branch into the current one with the chosen strategy', async () => {
    const calls = mockApi(routes({ [`POST ${BASE}/actions`]: done }))
    render(<Page />)
    const d = await mergeDialog()
    fireEvent.click(d.getByRole('radio', { name: /^总是生成合并提交/ }))
    fireEvent.change(d.getByRole('textbox', { name: '合并提交说明（可选）' }), {
      target: { value: '合并主干' },
    })
    fireEvent.click(d.getByRole('button', { name: '合并' }))
    await waitFor(() =>
      expect(actionsCalled(calls)).toEqual([
        { action: 'merge', branch: 'main', mode: 'no-ff', noCommit: false, message: '合并主干' },
      ]),
    )
  })

  it('closes the merge dialog when the merge stops on conflicts, leaving them to the banner', async () => {
    mockApi(
      routes({
        [`POST ${BASE}/actions`]: op({
          id: 'op-conflict',
          action: 'merge',
          status: 'failed',
          error: '有 1 个冲突待解决：README.md',
          requestedBy: { id: 'u1', name: '小王' },
        }),
        [`GET ${BASE}/changes`]: {
          ...CHANGES_EMPTY,
          conflicts: [{ path: 'README.md', ours: 'modified', theirs: 'modified' }],
          ongoing: { kind: 'merge', subject: 'main', step: null, total: null, message: null },
        },
      }),
    )
    render(<Page />)
    fireEvent.click((await mergeDialog()).getByRole('button', { name: '合并' }))
    await waitFor(() => expect(screen.queryByRole('dialog', { name: '合并到 feat/refund-v2' })).toBeNull())
    expect(toasts()).toContain('有 1 个冲突待解决：README.md')
  })

  it('rebases the current branch at once, or checks a branch out and rebases it onto the current one', async () => {
    const calls = mockApi(routes({ [`POST ${BASE}/actions`]: done }))
    render(<Page />)
    let pop = await popup()
    fireEvent.click(pop.getAllByRole('button', { name: /^main/ })[0] as HTMLElement)
    fireEvent.click(await pop.findByRole('menuitem', { name: '将 feat/refund-v2 变基到 main' }))
    await waitFor(() => expect(actionsCalled(calls)).toEqual([{ action: 'rebase', onto: 'main' }]))
    expect(screen.queryByRole('dialog', { name: /变基/ })).toBeNull()

    fireEvent.click(screen.getByRole('button', { name: '切换 小王的 Claude 的分支' }))
    pop = await dialog('小王的 Claude 的分支')
    fireEvent.click((await pop.findAllByTitle('feat/fee'))[0] as HTMLElement)
    fireEvent.click(await pop.findByRole('menuitem', { name: '检出并变基到 feat/refund-v2' }))
    const d = await dialog('将 feat/fee 变基')
    expect(d.getByText('会先检出 feat/fee')).toBeTruthy()
    fireEvent.click(d.getByRole('button', { name: '变基' }))
    await waitFor(() =>
      expect(actionsCalled(calls).at(-1)).toEqual({
        action: 'rebase',
        onto: 'feat/refund-v2',
        branch: 'feat/fee',
      }),
    )
  })

  it('renames and deletes branches; one git finds unmerged is deleted anyway, a remote one on the remote', async () => {
    const calls = mockApi(
      routes({
        [`POST ${BASE}/actions`]: (b: { action: string; force?: boolean; branch: string }) =>
          b.action === 'branch-delete' && !b.force && !b.branch.startsWith('origin/')
            ? op({
                action: 'branch-delete',
                status: 'failed',
                error: "error: The branch 'feat/fee' is not fully merged.",
              })
            : done(b),
      }),
    )
    render(<Page />)
    let pop = await popup()
    fireEvent.click((await pop.findAllByTitle('feat/fee'))[0] as HTMLElement)
    fireEvent.click(await pop.findByRole('menuitem', { name: '重命名…' }))
    let d = await dialog('重命名分支 feat/fee')
    fireEvent.change(d.getByRole('textbox', { name: '新名称' }), { target: { value: 'feat/fees' } })
    fireEvent.click(d.getByRole('button', { name: '重命名' }))
    await waitFor(() =>
      expect(actionsCalled(calls)).toEqual([
        { action: 'branch-rename', branch: 'feat/fee', name: 'feat/fees' },
      ]),
    )
    await waitFor(() => expect(screen.queryByRole('dialog', { name: /重命名分支/ })).toBeNull())

    fireEvent.click(screen.getByRole('button', { name: '切换 小王的 Claude 的分支' }))
    pop = await dialog('小王的 Claude 的分支')
    fireEvent.click((await pop.findAllByTitle('feat/fee'))[0] as HTMLElement)
    fireEvent.click(await pop.findByRole('menuitem', { name: '删除…' }))
    d = await dialog('删除分支 feat/fee')
    expect(d.getByText('删除本地分支 feat/fee')).toBeTruthy()
    // The unmerged commits can't be read here (no log): git's refusal tells.
    const del = d.getByRole('button', { name: '删除' }) as HTMLButtonElement
    await waitFor(() => expect(del.disabled).toBe(false))
    fireEvent.click(del)
    expect(await d.findByText(/有尚未合并的提交/)).toBeTruthy()
    fireEvent.click(d.getByRole('button', { name: '仍然删除' }))
    await waitFor(() =>
      expect(actionsCalled(calls).slice(-2)).toEqual([
        { action: 'branch-delete', branch: 'feat/fee', force: false },
        { action: 'branch-delete', branch: 'feat/fee', force: true },
      ]),
    )
    await waitFor(() => expect(screen.queryByRole('dialog', { name: /删除分支/ })).toBeNull())

    fireEvent.click(screen.getByRole('button', { name: '切换 小王的 Claude 的分支' }))
    pop = await dialog('小王的 Claude 的分支')
    fireEvent.click(await pop.findByTitle('origin/feat/pay'))
    fireEvent.click(await pop.findByRole('menuitem', { name: '在远程删除…' }))
    d = await dialog('删除分支 origin/feat/pay')
    expect(d.getByText('在远程 origin 上删除分支 feat/pay，其他人将无法再拉取它')).toBeTruthy()
    fireEvent.click(d.getByRole('button', { name: '删除' }))
    await waitFor(() =>
      expect(actionsCalled(calls).at(-1)).toEqual({
        action: 'branch-delete',
        branch: 'origin/feat/pay',
        force: false,
      }),
    )
  })

  it('pushes or deletes a tag, on the remote too when asked', async () => {
    const calls = mockApi(routes({ [`POST ${BASE}/actions`]: done }))
    render(<Page />)
    let pop = await popup()
    fireEvent.click(await pop.findByTitle('v1.2'))
    fireEvent.click(await pop.findByRole('menuitem', { name: '推送到 origin' }))
    await waitFor(() =>
      expect(actionsCalled(calls)).toEqual([{ action: 'tag-push', name: 'v1.2', remote: 'origin' }]),
    )
    await waitFor(() => expect(screen.queryByRole('dialog', { name: '小王的 Claude 的分支' })).toBeNull())
    fireEvent.click(screen.getByRole('button', { name: '切换 小王的 Claude 的分支' }))
    pop = await dialog('小王的 Claude 的分支')
    fireEvent.click(await pop.findByTitle('v1.2'))
    fireEvent.click(await pop.findByRole('menuitem', { name: '删除标签…' }))
    const d = await dialog('删除标签 v1.2')
    fireEvent.click(d.getByRole('checkbox', { name: '同时从远程 origin 删除' }))
    fireEvent.click(d.getByRole('button', { name: '删除' }))
    await waitFor(() =>
      expect(actionsCalled(calls).at(-1)).toEqual({ action: 'tag-delete', name: 'v1.2', remote: 'origin' }),
    )
  })

  it('stars branches in this browser', async () => {
    mockApi(routes())
    render(<Page />)
    const pop = await popup()
    fireEvent.click(pop.getByRole('button', { name: '取消收藏 main' }))
    fireEvent.click(pop.getAllByRole('button', { name: '收藏 feat/fee' })[0] as HTMLElement)
    expect(JSON.parse(localStorage.getItem('gg.git.favorites') ?? '{}')).toEqual({
      b1: ['origin/main', 'feat/fee'],
    })
  })

  it("tells a non-owner that a checkout is a request for the owner's approval", async () => {
    setMe('u2')
    const calls = mockApi(
      routes({
        'GET /groups/g1/bot-states': [state({ git: status({ dirty: false }) })],
        [`POST ${BASE}/actions`]: op({ action: 'checkout', status: 'pending_approval' }),
      }),
    )
    render(<Page />)
    const pop = await popup()
    fireEvent.click(pop.getAllByRole('button', { name: /^main/ })[0] as HTMLElement)
    fireEvent.click(await pop.findByRole('menuitem', { name: '检出' }))
    const d = await dialog('检出 main')
    expect(d.getByText('需要 Bot 主人 小王 批准后才会执行')).toBeTruthy()
    fireEvent.click(d.getByRole('button', { name: '提交申请' }))
    await waitFor(() =>
      expect(actionsCalled(calls)).toEqual([{ action: 'checkout', branch: 'main', detach: false }]),
    )
    await waitFor(() => expect(toasts()).toContain('已提交申请，等待 Bot 主人 小王 审批'))
  })
})

describe('push dialog', () => {
  const LOG = {
    commits: [
      {
        hash: 'c1'.repeat(20),
        shortHash: 'c1c1c1c',
        author: '小王',
        email: 'w@corp',
        at: '2026-10-21T00:00:00.000Z',
        subject: '退款按原路返回',
        parents: [],
        refs: [],
      },
    ],
    hasMore: false,
  }

  it('lists the commits going out; pushes, force-pushes with lease, and confirms the protected base twice', async () => {
    const calls = mockApi(
      routes({
        [`GET ${BASE}/refs`]: {
          ...REFS,
          branches: [...REFS.branches, branch('origin/feat/refund-v2', { kind: 'remote' })],
        },
        [`GET ${BASE}/log?ref=origin%2Ffeat%2Frefund-v2..feat%2Frefund-v2&skip=0`]: LOG,
        [`GET ${BASE}/log?ref=origin%2Fmain..main&skip=0`]: { commits: [], hasMore: false },
        [`POST ${BASE}/actions`]: done,
      }),
    )
    render(<Page />)
    const tab = await openGit()
    fireEvent.click(tab.getByRole('button', { name: /^推送…/ }))
    let d = await dialog('推送')
    expect(d.getByText('feat/refund-v2 → origin/feat/refund-v2')).toBeTruthy()
    expect(await d.findByText('退款按原路返回')).toBeTruthy()
    fireEvent.click(d.getByRole('checkbox', { name: '同时推送标签' }))
    fireEvent.click(d.getByRole('button', { name: '推送' }))
    await waitFor(() =>
      expect(actionsCalled(calls)).toEqual([
        {
          action: 'push',
          remote: 'origin',
          branch: 'feat/refund-v2',
          confirmBase: false,
          force: false,
          tags: true,
        },
      ]),
    )
    await waitFor(() => expect(screen.queryByRole('dialog', { name: '推送' })).toBeNull())

    fireEvent.click(tab.getByRole('button', { name: /^推送…/ }))
    d = await dialog('推送')
    fireEvent.click(d.getByRole('checkbox', { name: '强制推送（--force-with-lease）' }))
    expect(d.getByText(/别人已推送但你还没获取的提交会让推送被拒绝/)).toBeTruthy()
    fireEvent.click(d.getByRole('button', { name: '强制推送' }))
    await waitFor(() =>
      expect(actionsCalled(calls).at(-1)).toMatchObject({ force: true, branch: 'feat/refund-v2' }),
    )
    await waitFor(() => expect(screen.queryByRole('dialog', { name: '推送' })).toBeNull())

    fireEvent.click(tab.getByRole('button', { name: /^推送…/ }))
    d = await dialog('推送')
    fireEvent.change(d.getByRole('textbox', { name: '分支' }), { target: { value: 'main' } })
    expect(d.getByText(/main 是受保护的基准分支/)).toBeTruthy()
    expect(d.queryByRole('checkbox', { name: '强制推送（--force-with-lease）' })).toBeNull()
    const push = d.getByRole('button', { name: '推送' }) as HTMLButtonElement
    expect(push.disabled).toBe(true)
    fireEvent.click(d.getByRole('checkbox', { name: '我确认推送到基准分支' }))
    fireEvent.click(push)
    await waitFor(() =>
      expect(actionsCalled(calls).at(-1)).toMatchObject({
        action: 'push',
        branch: 'main',
        confirmBase: true,
        force: false,
      }),
    )
  })

  it("pushes a branch to its upstream's branch, and asks twice when that is the protected base", async () => {
    const calls = mockApi(
      routes({
        'GET /groups/g1/bot-states': [state({ git: status({ branch: 'feat/hotfix' }) })],
        [`GET ${BASE}/refs`]: {
          ...REFS,
          branches: [branch('main'), branch('feat/hotfix', { current: true, upstream: 'origin/main' })],
        },
        [`GET ${BASE}/log?ref=origin%2Fmain..feat%2Fhotfix&skip=0`]: LOG,
        [`POST ${BASE}/actions`]: done,
      }),
    )
    render(<Page />)
    const tab = await openGit()
    fireEvent.click(tab.getByRole('button', { name: /^推送…/ }))
    const d = await dialog('推送')
    expect(d.getByText('feat/hotfix → origin/main')).toBeTruthy()
    expect(d.getByText(/main 是受保护的基准分支/)).toBeTruthy()
    const push = d.getByRole('button', { name: '推送' }) as HTMLButtonElement
    expect(push.disabled).toBe(true)
    fireEvent.click(d.getByRole('checkbox', { name: '我确认推送到基准分支' }))
    fireEvent.click(push)
    await waitFor(() =>
      expect(actionsCalled(calls).at(-1)).toMatchObject({
        action: 'push',
        branch: 'feat/hotfix',
        target: 'main',
        confirmBase: true,
      }),
    )
  })

  it('explains the first push, and the way out when the remote rejects it', async () => {
    mockApi(
      routes({
        'GET /groups/g1/bot-states': [
          state({ git: status({ branch: 'feat/x', ahead: null, behind: null }) }),
        ],
        [`GET ${BASE}/refs`]: { ...REFS, branches: [branch('main'), branch('feat/x', { current: true })] },
        [`GET ${BASE}/log?ref=origin%2Fmain..feat%2Fx&skip=0`]: { commits: [], hasMore: false },
        [`POST ${BASE}/actions`]: op({
          status: 'failed',
          requestedBy: { id: 'u1', name: '小王' },
          error: 'origin/feat/x [rejected] (fetch first)',
        }),
      }),
    )
    render(<Page />)
    fireEvent.click((await openGit()).getByRole('button', { name: /^推送…/ }))
    const d = await dialog('推送')
    expect(await d.findByText('首次推送，会在远程创建 feat/x 并设为上游')).toBeTruthy()
    fireEvent.click(d.getByRole('button', { name: '推送' }))
    expect(await d.findByText('远程有新的提交：先更新再推送，或改写过历史时强制推送')).toBeTruthy()
    expect(screen.getByRole('dialog', { name: '推送' })).toBeTruthy()
  })
})

describe('git operation approvals', () => {
  it('badges pending requests; the owner approves or rejects them in the Git tab’s activity', async () => {
    const calls = mockApi(
      routes({
        'GET /groups/g1/git/operations': {
          operations: [
            op(),
            op({
              id: 'op2',
              action: 'merge',
              branch: 'feat/fee',
              remote: null,
              args: { mode: 'no-ff' },
              pushesBase: false,
            }),
          ],
        },
        'POST /git-operations/op1/decide': op({ status: 'succeeded' }),
        'POST /git-operations/op2/decide': op({ id: 'op2', status: 'rejected' }),
      }),
    )
    render(<Page />)
    fireEvent.click(await screen.findByRole('button', { name: '待审批 2' }))
    const tab = within(await screen.findByTestId('git-tab'))
    expect(tab.getByRole('tab', { name: '记录 · 待审批 2' }).getAttribute('aria-selected')).toBe('true')
    const first = within(tab.getByTestId('git-op-op1'))
    expect(first.getByText('老李')).toBeTruthy()
    expect(first.getByText('推送')).toBeTruthy()
    expect(first.getByText('origin/main')).toBeTruthy()
    expect(first.getByText('批准即确认推送基准分支')).toBeTruthy()
    const second = within(tab.getByTestId('git-op-op2'))
    expect(second.getByText('合并')).toBeTruthy()
    expect(second.getByText('feat/fee')).toBeTruthy()

    fireEvent.click(first.getByRole('button', { name: '批准' }))
    await waitFor(() =>
      expect(calls.filter((c) => c.method === 'POST').at(-1)).toMatchObject({
        path: '/git-operations/op1/decide',
        body: { approve: true },
      }),
    )
    fireEvent.click(second.getByRole('button', { name: '拒绝' }))
    await waitFor(() =>
      expect(calls.filter((c) => c.method === 'POST').at(-1)).toMatchObject({
        path: '/git-operations/op2/decide',
        body: { approve: false },
      }),
    )
    await waitFor(() => expect(screen.queryByRole('button', { name: /^待审批/ })).toBeNull())
  })

  it('shows others the status read-only', async () => {
    setMe('u3')
    mockApi(routes({ 'GET /groups/g1/git/operations': { operations: [op()] } }))
    render(<Page />)
    fireEvent.click(await screen.findByRole('button', { name: '待审批 1' }))
    const tab = within(await screen.findByTestId('git-tab'))
    expect(within(tab.getByTestId('git-op-op1')).getByText('待审批')).toBeTruthy()
    expect(tab.queryByRole('button', { name: '批准' })).toBeNull()
  })

  it('follows group.gitOperation events and toasts the requester when it ends', async () => {
    setMe('u2')
    mockApi(routes())
    render(<Page />)
    await screen.findByTestId('git-b1')
    act(() =>
      useWorkspace
        .getState()
        .applyEvent({ t: 'group.gitOperation', groupId: 'g1', operation: op({ id: 'op9' }) }),
    )
    expect(await screen.findByRole('button', { name: '待审批 1' })).toBeTruthy()
    act(() =>
      useWorkspace.getState().applyEvent({
        t: 'group.gitOperation',
        groupId: 'g1',
        operation: op({ id: 'op9', status: 'failed', error: 'rejected: non-fast-forward' }),
      }),
    )
    await waitFor(() => expect(screen.queryByRole('button', { name: /^待审批/ })).toBeNull())
    const item = useToasts.getState().items.at(-1)
    expect(item?.title).toBe('小王的 Claude：推送失败')
    expect(item?.message).toBe('rejected: non-fast-forward')
  })

  it('opens the linked operation from ?git= in the Git tab', async () => {
    mockApi(routes({ 'GET /groups/g1/git/operations': { operations: [op({ status: 'succeeded' })] } }))
    render(
      <MemoryRouter initialEntries={['/g/g1?git=op1']}>
        <Page />
        <LinkedGitOperation groupId="g1" />
      </MemoryRouter>,
    )
    const tab = within(await screen.findByTestId('git-tab'))
    expect(tab.getByTestId('git-op-op1').dataset.focused).toBe('true')
    expect(benchTabs()).toEqual([{ kind: 'git', botId: 'b1', focus: 'op1', view: 'ops' }])
  })
})
