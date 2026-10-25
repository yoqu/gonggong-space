import type { GitChangesDto, GitConflictDto } from '@gonggong/protocol'
import { fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { useWorkbench } from '../src/app/workbench'
import { useWorkspace } from '../src/app/workspace'
import { GitDialogHost } from '../src/features/git/dialogs/GitDialogHost'
import { GitMergeTab } from '../src/features/workbench/tabs/GitMergeTab'
import { GitTab } from '../src/features/workbench/tabs/GitTab'
import {
  actionsCalled,
  BASE,
  benchTabs,
  CHANGES,
  done,
  HEAD_COMMIT,
  op,
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

/** The bot's Git tab as the workbench shows it, its states loaded, with the git dialogs. */
function Bench() {
  const tab = useWorkbench((s) => s.benches.g1?.tabs.find((t) => t.kind === 'git'))
  return (
    <>
      {tab?.kind === 'git' ? <GitTab tab={tab} tabKey={`git:${tab.botId}`} active /> : null}
      <GitDialogHost />
    </>
  )
}

async function openGit(git = status()) {
  useWorkspace.setState({ botStates: { g1: { b1: state({ git }) } } })
  useWorkbench.getState().show({ kind: 'git', botId: 'b1' })
  render(<Bench />)
  return within(await screen.findByTestId('git-tab'))
}
const dialog = async (name: string | RegExp) => within(await screen.findByRole('dialog', { name }))
const box = (tab: ReturnType<typeof within>) =>
  tab.getByRole('textbox', { name: '提交说明' }) as HTMLTextAreaElement

describe('commit view', () => {
  it('groups tracked changes and untracked files, in IDEA’s colours with line counts, tracked ones picked', async () => {
    mockApi(routes())
    const tab = await openGit()
    const tree = within(await tab.findByRole('region', { name: '要提交的文件' }))
    expect(tree.getByRole('button', { name: /^更改/ }).textContent).toBe('更改2 个文件')
    expect(tree.getByRole('button', { name: /^未跟踪的文件/ }).textContent).toBe('未跟踪的文件1 个文件')
    const a = tree.getByRole('button', { name: '修改：src/a.ts' })
    expect(a.className).toContain('gt-file--modified')
    expect(a.textContent).toBe('a.ts+12−3M')
    expect(tree.getByRole('button', { name: '重命名：b.ts' }).getAttribute('title')).toBe('old.ts → b.ts')
    expect(tree.getByRole('button', { name: '未跟踪：src/new.ts' }).className).toContain('gt-file--untracked')
    expect((tree.getByRole('checkbox', { name: '选择 更改' }) as HTMLInputElement).checked).toBe(true)
    expect((tree.getByRole('checkbox', { name: '选择 未跟踪的文件' }) as HTMLInputElement).checked).toBe(
      false,
    )
    expect(tab.getByText('已选 2 / 3 个文件')).toBeTruthy()
  })

  it('commits the picked files (a rename’s both sides) with the message, ⌘↩ too, and remembers it', async () => {
    const calls = mockApi(routes({ [`POST ${BASE}/actions`]: done }))
    const tab = await openGit()
    await tab.findByRole('region', { name: '要提交的文件' })
    const commit = tab.getByRole('button', { name: '提交' }) as HTMLButtonElement
    expect(commit.disabled).toBe(true)
    fireEvent.change(box(tab), { target: { value: '修复退款' } })
    fireEvent.keyDown(box(tab), { key: 'Enter', metaKey: true })
    await waitFor(() =>
      expect(actionsCalled(calls)).toEqual([
        { action: 'commit', message: '修复退款', paths: ['src/a.ts', 'old.ts', 'b.ts'], amend: false },
      ]),
    )
    await waitFor(() => expect(box(tab).value).toBe(''))
    fireEvent.click(tab.getByRole('button', { name: '最近的提交说明' }))
    fireEvent.click(await screen.findByRole('button', { name: '修复退款' }))
    expect(box(tab).value).toBe('修复退款')
  })

  it('picks a folder or a whole group, selects all or none', async () => {
    mockApi(routes())
    const tab = await openGit()
    const tree = within(await tab.findByRole('region', { name: '要提交的文件' }))
    // src holds a tracked change and an untracked file: a folder per group.
    fireEvent.click(tree.getAllByRole('checkbox', { name: '选择 src' })[0] as HTMLElement)
    expect(tab.getByText('已选 1 / 3 个文件')).toBeTruthy()
    expect((tree.getByRole('checkbox', { name: '选择 更改' }) as HTMLInputElement).indeterminate).toBe(true)
    fireEvent.click(tree.getByRole('checkbox', { name: '选择 未跟踪的文件' }))
    expect(tab.getByText('已选 2 / 3 个文件')).toBeTruthy()
    fireEvent.click(tab.getByRole('button', { name: '全选' }))
    expect(tab.getByText('已选 3 / 3 个文件')).toBeTruthy()
    fireEvent.click(tab.getByRole('button', { name: '取消全选' }))
    expect(tab.getByText('勾选要提交的文件')).toBeTruthy()
  })

  it('amends the last commit: its message filled in, a reword when nothing is picked, then commit and push', async () => {
    const calls = mockApi(routes({ [`POST ${BASE}/actions`]: done }))
    const tab = await openGit()
    await tab.findByRole('region', { name: '要提交的文件' })
    fireEvent.click(tab.getByRole('checkbox', { name: '选择 更改' }))
    fireEvent.click(tab.getByRole('checkbox', { name: '修改上一次提交' }))
    expect(box(tab).value).toBe('修复退款金额\n\n按原路退回。')
    expect(tab.getByText('只修改提交说明')).toBeTruthy()
    fireEvent.change(box(tab), { target: { value: '修复退款金额的计算' } })
    fireEvent.click(tab.getByRole('button', { name: '修改并推送…' }))
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
    expect(await dialog('推送提交')).toBeTruthy()
  })

  it('keeps the message when git fails, with its reason', async () => {
    mockApi(
      routes({
        [`POST ${BASE}/actions`]: op({
          id: 'op-fail',
          action: 'commit',
          status: 'failed',
          error: '没有可提交的改动',
          requestedBy: { id: 'u1', name: '小王' },
        }),
      }),
    )
    const tab = await openGit()
    await tab.findByRole('region', { name: '要提交的文件' })
    fireEvent.change(box(tab), { target: { value: '修复退款' } })
    fireEvent.click(tab.getByRole('button', { name: '提交' }))
    await waitFor(() => expect(toasts()).toContain('没有可提交的改动'))
    expect(box(tab).value).toBe('修复退款')
  })

  it('shows the picked file’s diff beside the list, with a rollback in its toolbar', async () => {
    const calls = mockApi(
      routes({
        [`GET ${BASE}/diff?from=HEAD&path=b.ts&oldPath=old.ts&context=100000`]: {
          patch: '',
          truncated: false,
        },
        [`POST ${BASE}/actions`]: done,
      }),
    )
    const tab = await openGit()
    await waitFor(() =>
      expect(calls.some((c) => c.path === `${BASE}/diff?from=HEAD&path=src%2Fa.ts&context=100000`)).toBe(
        true,
      ),
    )
    fireEvent.click(tab.getByRole('button', { name: '重命名：b.ts' }))
    expect(benchTabs()).toEqual([{ kind: 'git', botId: 'b1', file: 'b.ts' }])
    await waitFor(() =>
      expect(
        calls.some((c) => c.path === `${BASE}/diff?from=HEAD&path=b.ts&oldPath=old.ts&context=100000`),
      ).toBe(true),
    )
    fireEvent.click(tab.getByRole('button', { name: '回滚' }))
    const d = await dialog('回滚改动')
    expect(d.getByText('将 1 个文件恢复到上次提交的状态')).toBeTruthy()
    fireEvent.click(d.getByRole('button', { name: '回滚' }))
    await waitFor(() =>
      expect(actionsCalled(calls)).toEqual([{ action: 'discard', paths: ['old.ts', 'b.ts'] }]),
    )
  })

  it('rolls back, stashes or shows the history of files from their context menu', async () => {
    const calls = mockApi(routes({ [`POST ${BASE}/actions`]: done }))
    const tab = await openGit()
    const tree = await tab.findByRole('region', { name: '要提交的文件' })
    fireEvent.contextMenu(within(tree).getByRole('button', { name: /^更改/ }))
    fireEvent.click(await screen.findByRole('menuitem', { name: /^回滚…/ }))
    const d = await dialog('回滚改动')
    expect(d.getByText('将 2 个文件恢复到上次提交的状态')).toBeTruthy()
    fireEvent.click(d.getByRole('button', { name: '回滚' }))
    await waitFor(() =>
      expect(actionsCalled(calls)).toEqual([{ action: 'discard', paths: ['src/a.ts', 'old.ts', 'b.ts'] }]),
    )
    await waitFor(() => expect(screen.queryByRole('dialog', { name: '回滚改动' })).toBeNull())

    fireEvent.contextMenu(within(tree).getByRole('button', { name: /^更改/ }))
    fireEvent.click(await screen.findByRole('menuitem', { name: '贮藏所选文件…' }))
    const s = await dialog('贮藏改动')
    expect(s.getByText('只贮藏选中的 3 个文件')).toBeTruthy()
    fireEvent.change(s.getByRole('textbox', { name: '说明（可选）' }), { target: { value: '先放一放' } })
    fireEvent.click(s.getByRole('button', { name: '贮藏' }))
    await waitFor(() =>
      expect(actionsCalled(calls).at(-1)).toEqual({
        action: 'stash',
        untracked: true,
        message: '先放一放',
        paths: ['src/a.ts', 'old.ts', 'b.ts'],
      }),
    )

    fireEvent.contextMenu(within(tree).getByRole('button', { name: '修改：src/a.ts' }))
    fireEvent.click(await screen.findByRole('menuitem', { name: '显示历史' }))
    expect(benchTabs().at(-1)).toMatchObject({ kind: 'git-log', botId: 'b1', path: 'src/a.ts' })
  })

  it('lists files flat with their folders, folds groups and folders', async () => {
    mockApi(routes())
    const tab = await openGit()
    const tree = within(await tab.findByRole('region', { name: '要提交的文件' }))
    fireEvent.click(tab.getByRole('button', { name: '全部折叠' }))
    expect(tree.queryByRole('button', { name: '修改：src/a.ts' })).toBeNull()
    fireEvent.click(tab.getByRole('button', { name: '全部展开' }))
    fireEvent.click(tab.getByRole('button', { name: '平铺显示' }))
    expect(tree.getByRole('button', { name: '修改：src/a.ts' }).textContent).toBe('a.tssrc+12−3M')
    expect(tree.queryByRole('button', { name: 'src' })).toBeNull()
  })

  it('says when there is nothing to commit, the changes cannot be read, or the client is older', async () => {
    mockApi(routes({ [`GET ${BASE}/changes`]: { ...CHANGES, changes: [] } }))
    const { unmount } = render(<></>)
    let tab = await openGit()
    expect(await tab.findByText('没有未提交的改动')).toBeTruthy()
    expect((tab.getByRole('button', { name: '提交' }) as HTMLButtonElement).disabled).toBe(true)
    unmount()
    document.body.innerHTML = ''

    mockApi(routes({ [`GET ${BASE}/changes`]: apiError(502, 'git_failed', '工作区不可用') }))
    useWorkbench.setState({ benches: {} })
    tab = await openGit()
    expect(await tab.findByText('读取改动失败：工作区不可用')).toBeTruthy()
    document.body.innerHTML = ''

    mockApi(routes({ [`GET ${BASE}/changes`]: { ...CHANGES, head: null, limited: true } }))
    useWorkbench.setState({ benches: {} })
    tab = await openGit()
    expect(await tab.findByText(/客户端版本较旧/)).toBeTruthy()
    expect((tab.getByRole('checkbox', { name: '修改上一次提交' }) as HTMLInputElement).disabled).toBe(true)
  })

  it('words a non-owner’s commit as a request', async () => {
    setMe('u2')
    mockApi(routes())
    const tab = await openGit()
    await tab.findByRole('region', { name: '要提交的文件' })
    expect(tab.getByRole('button', { name: '提交申请' })).toBeTruthy()
    expect(tab.queryByRole('button', { name: '提交并推送…' })).toBeNull()
  })
})

const MERGING: GitChangesDto = {
  ...CHANGES,
  changes: [CHANGES.changes[0] as GitChangesDto['changes'][number]],
  conflicts: [
    { path: 'src/order.ts', ours: 'modified', theirs: 'modified' },
    { path: 'src/legacy.ts', ours: 'modified', theirs: 'deleted' },
  ],
  ongoing: {
    kind: 'merge',
    subject: 'feat/fee',
    step: null,
    total: null,
    message: "Merge branch 'feat/fee'",
  },
}

describe('merge or rebase in progress', () => {
  it('bannered with the conflicts left; they head the change list and open the merge tool', async () => {
    mockApi(routes({ [`GET ${BASE}/changes`]: MERGING }))
    const tab = await openGit(status({ ongoing: 'merge', conflicts: 2 }))
    const banner = within(await tab.findByRole('status'))
    expect(banner.getByText('正在合并 feat/fee')).toBeTruthy()
    expect(banner.getByText('2 个文件有冲突，解决后才能继续')).toBeTruthy()
    const tree = within(tab.getByRole('region', { name: '要提交的文件' }))
    expect(tree.getByRole('button', { name: /^合并冲突/ })).toBeTruthy()
    // A click selects the conflict, a double click opens it.
    fireEvent.click(tree.getByRole('button', { name: '冲突：src/legacy.ts' }))
    expect(benchTabs()).toEqual([{ kind: 'git', botId: 'b1', file: 'src/legacy.ts' }])
    fireEvent.doubleClick(tree.getByRole('button', { name: '冲突：src/legacy.ts' }))
    expect(benchTabs().at(-1)).toEqual({ kind: 'git-merge', botId: 'b1', repo: null, path: 'src/legacy.ts' })
    fireEvent.click(banner.getByRole('button', { name: '解决冲突' }))
    expect(benchTabs().at(-1)).toEqual({ kind: 'git-merge', botId: 'b1', repo: null, path: 'src/order.ts' })
  })

  it('accepts a side from the context menu, aborts after a confirmation', async () => {
    const calls = mockApi(routes({ [`GET ${BASE}/changes`]: MERGING, [`POST ${BASE}/actions`]: done }))
    const tab = await openGit(status({ ongoing: 'merge', conflicts: 2 }))
    const tree = await tab.findByRole('region', { name: '要提交的文件' })
    fireEvent.contextMenu(within(tree).getByRole('button', { name: '冲突：src/legacy.ts' }))
    fireEvent.click(await screen.findByRole('menuitem', { name: '接受他们的版本' }))
    await waitFor(() =>
      expect(actionsCalled(calls)).toEqual([{ action: 'resolve', path: 'src/legacy.ts', side: 'theirs' }]),
    )
    fireEvent.click(within(tab.getByRole('status')).getByRole('button', { name: '中止合并' }))
    const d = await dialog('中止合并')
    expect(d.getByText('已解决的冲突会丢失')).toBeTruthy()
    fireEvent.click(d.getByRole('button', { name: '中止' }))
    await waitFor(() => expect(actionsCalled(calls).at(-1)).toEqual({ action: 'abort' }))
  })

  it('commits a merge with the message git prepared once every conflict is resolved', async () => {
    const calls = mockApi(
      routes({ [`GET ${BASE}/changes`]: { ...MERGING, conflicts: [] }, [`POST ${BASE}/actions`]: done }),
    )
    const tab = await openGit(status({ ongoing: 'merge', conflicts: 0 }))
    const banner = within(await tab.findByRole('status'))
    expect(banner.getByText('冲突已全部解决，可以继续')).toBeTruthy()
    fireEvent.click(banner.getByRole('button', { name: '提交合并…' }))
    const d = await dialog('完成合并')
    expect((d.getByRole('textbox', { name: '合并提交说明' }) as HTMLTextAreaElement).value).toBe(
      "Merge branch 'feat/fee'",
    )
    fireEvent.click(d.getByRole('button', { name: '提交' }))
    await waitFor(() =>
      expect(actionsCalled(calls)).toEqual([{ action: 'continue', message: "Merge branch 'feat/fee'" }]),
    )
  })

  it('shows a rebase’s progress, skips a commit or continues', async () => {
    const calls = mockApi(
      routes({
        [`GET ${BASE}/changes`]: {
          ...CHANGES,
          ongoing: { kind: 'rebase', subject: 'feat/refund-v2', step: 2, total: 5, message: null },
        },
        [`POST ${BASE}/actions`]: done,
      }),
    )
    const tab = await openGit(status({ ongoing: 'rebase', branch: null }))
    const banner = within(await tab.findByRole('status'))
    expect(banner.getByText('正在变基 feat/refund-v2（第 2 / 5 个提交）')).toBeTruthy()
    fireEvent.click(banner.getByRole('button', { name: '跳过此提交' }))
    await waitFor(() => expect(actionsCalled(calls)).toEqual([{ action: 'skip' }]))
    fireEvent.click(banner.getByRole('button', { name: '继续变基' }))
    await waitFor(() => expect(actionsCalled(calls).at(-1)).toEqual({ action: 'continue' }))
  })
})

describe('stashes', () => {
  const STASHES = {
    stashes: [
      {
        index: 0,
        hash: 'c0ffee0000000000000000000000000000000001',
        message: 'WIP on feat/refund-v2: a1b2c3d 修复退款金额',
        branch: 'feat/refund-v2',
        at: '2026-10-22T10:00:00.000Z',
        untracked: true,
      },
      {
        index: 1,
        hash: 'c0ffee0000000000000000000000000000000002',
        message: '试验新的费率',
        branch: null,
        at: '2026-10-21T10:00:00.000Z',
        untracked: false,
      },
    ],
  }
  const S0 = 'c0ffee0000000000000000000000000000000001'
  const S1 = 'c0ffee0000000000000000000000000000000002'

  it('lists them; one unfolds the files it holds, tracked and untracked, a pick shows its diff', async () => {
    const calls = mockApi(
      routes({
        [`GET ${BASE}/stashes`]: STASHES,
        [`GET ${BASE}/compare?from=${S0}%5E1&to=${S0}`]: {
          changes: [{ path: 'src/a.ts', change: 'modified', oldPath: null }],
        },
        [`GET ${BASE}/compare?from=4b825dc642cb6eb9a060e54bf8d69288fbee4904&to=${S0}%5E3`]: {
          changes: [{ path: 'notes.md', change: 'added', oldPath: null }],
        },
        [`GET ${BASE}/diff?from=${S0}%5E1&to=${S0}&path=src%2Fa.ts&context=100000`]: {
          patch: '',
          truncated: false,
        },
      }),
    )
    const tab = await openGit(status({ stashes: 2 }))
    fireEvent.click(tab.getByRole('tab', { name: '贮藏 · 2' }))
    const stash = await tab.findByRole('button', { name: /WIP on feat\/refund-v2/ })
    expect(stash.textContent).toContain('stash@{0} · feat/refund-v2')
    fireEvent.click(stash)
    const files = within(await tab.findByRole('region', { name: '贮藏的文件' }))
    expect(files.getByRole('button', { name: '未跟踪：notes.md' })).toBeTruthy()
    fireEvent.click(files.getByRole('button', { name: '修改：src/a.ts' }))
    await waitFor(() =>
      expect(
        calls.some((c) => c.path === `${BASE}/diff?from=${S0}%5E1&to=${S0}&path=src%2Fa.ts&context=100000`),
      ).toBe(true),
    )
  })

  it('unstashes (popping, reinstating the index, or as a new branch), drops one or clears them all, naming the stash they mean', async () => {
    const calls = mockApi(routes({ [`GET ${BASE}/stashes`]: STASHES, [`POST ${BASE}/actions`]: done }))
    const tab = await openGit(status({ stashes: 2 }))
    fireEvent.click(tab.getByRole('tab', { name: '贮藏 · 2' }))
    fireEvent.click((await tab.findAllByRole('button', { name: '恢复…' }))[0] as HTMLElement)
    let d = await dialog('恢复贮藏 stash@{0}')
    fireEvent.click(d.getByRole('checkbox', { name: '同时恢复暂存区（--index）' }))
    fireEvent.click(d.getByRole('button', { name: '弹出' }))
    await waitFor(() =>
      expect(actionsCalled(calls)).toEqual([
        { action: 'unstash', stash: 0, expect: S0, pop: true, index: true },
      ]),
    )
    await waitFor(() => expect(screen.queryByRole('dialog', { name: /恢复贮藏/ })).toBeNull())

    fireEvent.click((await tab.findAllByRole('button', { name: '恢复…' }))[1] as HTMLElement)
    d = await dialog('恢复贮藏 stash@{1}')
    fireEvent.change(d.getByRole('textbox', { name: '恢复为新分支（可选）' }), {
      target: { value: 'try/fee' },
    })
    fireEvent.click(d.getByRole('button', { name: '恢复为新分支' }))
    await waitFor(() =>
      expect(actionsCalled(calls).at(-1)).toEqual({
        action: 'unstash',
        stash: 1,
        expect: S1,
        branch: 'try/fee',
      }),
    )
    await waitFor(() => expect(screen.queryByRole('dialog', { name: /恢复贮藏/ })).toBeNull())

    fireEvent.click(tab.getByRole('button', { name: '删除 stash@{1}' }))
    fireEvent.click((await dialog('删除贮藏')).getByRole('button', { name: '删除' }))
    await waitFor(() =>
      expect(actionsCalled(calls).at(-1)).toEqual({ action: 'stash-drop', stash: 1, expect: S1 }),
    )
    await waitFor(() => expect(screen.queryByRole('dialog', { name: '删除贮藏' })).toBeNull())

    fireEvent.click(tab.getByRole('button', { name: '清空' }))
    const clear = await dialog('清空贮藏')
    expect(clear.getByText('删除全部 2 个贮藏')).toBeTruthy()
    fireEvent.click(clear.getByRole('button', { name: '清空' }))
    await waitFor(() => expect(actionsCalled(calls).at(-1)).toEqual({ action: 'stash-drop' }))
  })
})

describe('merge tool', () => {
  const CONFLICT: GitConflictDto = {
    base: 'a\nfee = 1\nb\n',
    ours: 'a\nfee = 2\nb\n',
    theirs: 'a\nfee = 3\nb\n',
    merged: 'a\n<<<<<<< ours\nfee = 2\n||||||| base\nfee = 1\n=======\nfee = 3\n>>>>>>> theirs\nb\n',
    binary: false,
  }
  function Merge({ path }: { path: string }) {
    const tab = useWorkbench((s) => s.benches.g1?.tabs.find((t) => t.kind === 'git-merge'))
    return tab?.kind === 'git-merge' ? (
      <GitMergeTab tab={tab} tabKey={`git-merge:b1::${tab.path}`} active />
    ) : (
      <span>{path}</span>
    )
  }
  const open = (path: string) => {
    useWorkspace.setState({
      botStates: { g1: { b1: state({ git: status({ ongoing: 'merge', conflicts: 2 }) }) } },
    })
    useWorkbench.getState().show({ kind: 'git-merge', botId: 'b1', repo: null, path })
    render(<Merge path={path} />)
  }

  it('settles each conflict with yours, theirs, both or an edit, then writes the result and moves to the next file', async () => {
    const calls = mockApi(
      routes({
        [`GET ${BASE}/changes`]: MERGING,
        [`GET ${BASE}/conflict?path=src%2Forder.ts`]: CONFLICT,
        [`GET ${BASE}/conflict?path=src%2Flegacy.ts`]: { ...CONFLICT, merged: null, theirs: null },
        [`POST ${BASE}/actions`]: done,
      }),
    )
    open('src/order.ts')
    expect(await screen.findByText('你的：feat/refund-v2（当前分支）')).toBeTruthy()
    expect(screen.getByText('他们的：feat/fee')).toBeTruthy()
    expect(screen.getByText('1 处冲突，已解决 0 处')).toBeTruthy()
    const apply = screen.getByRole('button', { name: '应用' }) as HTMLButtonElement
    expect(apply.disabled).toBe(true)
    fireEvent.click(screen.getByRole('button', { name: '显示基准' }))
    expect(screen.getByText('fee = 1')).toBeTruthy()
    fireEvent.click(screen.getByRole('button', { name: '两者都要（他们的在前）' }))
    expect(screen.getByText('已保留两者（他们的在前）')).toBeTruthy()
    fireEvent.click(screen.getByRole('button', { name: '撤销' }))
    fireEvent.click(screen.getByRole('button', { name: '手动编辑' }))
    fireEvent.change(screen.getByRole('textbox', { name: '冲突 1 的合并结果' }), {
      target: { value: 'fee = 4' },
    })
    fireEvent.click(screen.getByRole('button', { name: '完成' }))
    expect(screen.getByText('1 处冲突，已解决 1 处')).toBeTruthy()
    fireEvent.click(apply)
    await waitFor(() =>
      expect(actionsCalled(calls)).toEqual([
        { action: 'resolve', path: 'src/order.ts', content: 'a\nfee = 4\nb\n' },
      ]),
    )
    // The next conflicted file: theirs deleted it, so only a whole side can be kept.
    expect(await screen.findByText('两边对这个文件的处理不同，请选择保留哪一方')).toBeTruthy()
    expect(benchTabs().at(-1)).toMatchObject({ kind: 'git-merge', path: 'src/legacy.ts' })
    expect(screen.getByText('删除了文件')).toBeTruthy()
    fireEvent.click(screen.getByRole('button', { name: '保留你的版本' }))
    await waitFor(() =>
      expect(actionsCalled(calls).at(-1)).toEqual({ action: 'resolve', path: 'src/legacy.ts', side: 'ours' }),
    )
  })

  it('edits the whole text, refusing to apply while markers are left', async () => {
    const calls = mockApi(
      routes({
        [`GET ${BASE}/changes`]: MERGING,
        [`GET ${BASE}/conflict?path=src%2Forder.ts`]: CONFLICT,
        [`POST ${BASE}/actions`]: done,
      }),
    )
    open('src/order.ts')
    fireEvent.click(await screen.findByRole('button', { name: '编辑全文' }))
    const text = screen.getByRole('textbox', { name: '合并结果' }) as HTMLTextAreaElement
    expect(text.value).toBe('a\n<<<<<<< ours\nfee = 2\n=======\nfee = 3\n>>>>>>> theirs\nb\n')
    expect(screen.getByText(/还有冲突标记/)).toBeTruthy()
    expect((screen.getByRole('button', { name: '应用' }) as HTMLButtonElement).disabled).toBe(true)
    fireEvent.change(text, { target: { value: 'a\nfee = 5\nb\n' } })
    fireEvent.click(screen.getByRole('button', { name: '应用' }))
    await waitFor(() =>
      expect(actionsCalled(calls)).toEqual([
        { action: 'resolve', path: 'src/order.ts', content: 'a\nfee = 5\nb\n' },
      ]),
    )
  })

  it('says when the file is resolved already', async () => {
    mockApi(
      routes({
        [`GET ${BASE}/changes`]: { ...MERGING, conflicts: [] },
        [`GET ${BASE}/conflict?path=x.ts`]: CONFLICT,
      }),
    )
    open('x.ts')
    expect(await screen.findByText('x.ts 的冲突已解决')).toBeTruthy()
  })
})

describe('status bar', () => {
  it('flags a merge in progress and its conflicts, opening the Git tab', async () => {
    const { GitBar } = await import('../src/features/chat/GitBar')
    const { group } = await import('./gitFixtures')
    mockApi(
      routes({
        'GET /groups/g1/bot-states': [
          state({ git: status({ ongoing: 'merge', conflicts: 2, branch: null }) }),
        ],
      }),
    )
    render(<GitBar group={group()} />)
    expect((await screen.findByRole('button', { name: '打开 小王的 Claude 的 Git' })).textContent).toBe(
      'a1b2c3d（游离）',
    )
    fireEvent.click(screen.getByRole('button', { name: '合并中 · 2 个冲突' }))
    expect(benchTabs()).toEqual([{ kind: 'git', botId: 'b1', view: 'commit' }])
  })
})
