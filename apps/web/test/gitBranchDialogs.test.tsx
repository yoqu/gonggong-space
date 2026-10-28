import type { GitActionDetail, GitOperationDto } from '@gonggong/protocol'
import { act, fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { useWorkbench } from '../src/app/workbench'
import { useWorkspace } from '../src/app/workspace'
import { GitBar } from '../src/features/chat/GitBar'
import { gitCommands } from '../src/features/git/commands'
import { GitDialogHost } from '../src/features/git/dialogs/GitDialogHost'
import { GitTab } from '../src/features/workbench/tabs/GitTab'
import { Toaster, useToasts } from '../src/ui'
import {
  actionsCalled,
  BASE,
  benchTabs,
  branch,
  done,
  group,
  op,
  REFS,
  refreshes,
  resetStores,
  routes,
  setMe,
} from './gitFixtures'
import { mockApi } from './mockApi'

beforeEach(resetStores)
afterEach(() => vi.unstubAllGlobals())

/** The chat page's git bar, the bot's Git tab once opened, the git dialogs and the toasts. */
function Page() {
  const tab = useWorkbench((s) => s.benches.g1?.tabs.find((t) => t.kind === 'git'))
  return (
    <>
      <GitBar group={group()} />
      {tab?.kind === 'git' ? <GitTab tab={tab} tabKey={`git:${tab.botId}`} active /> : null}
      <GitDialogHost />
      <Toaster />
    </>
  )
}

const TARGET = { groupId: 'g1', botId: 'b1', repo: null }
const cmd = () => gitCommands(TARGET)
const openGit = async () => {
  fireEvent.click(await screen.findByRole('button', { name: '打开 小王的 Claude 的 Git' }))
  return within(await screen.findByTestId('git-tab'))
}
const dialog = async (name: string | RegExp) => within(await screen.findByRole('dialog', { name }))
const gone = (name: string | RegExp) =>
  waitFor(() => expect(screen.queryByRole('dialog', { name })).toBeNull())
const toasts = () => useToasts.getState().items.map((t) => t.message)
const lastToast = () => useToasts.getState().items.at(-1)
/** A button of a toast shown, not of one leaving. */
const toastButton = (name: string) => {
  const shown = [...document.querySelectorAll<HTMLElement>('.ui-toast[data-state="open"]')]
  const [button] = shown.flatMap((el) => within(el).queryAllByRole('button', { name }))
  if (!button) throw new Error(`no toast button ${name}`)
  return button
}

const detail = (o: Partial<GitActionDetail>): GitActionDetail => ({
  code: null,
  paths: [],
  ahead: null,
  behind: null,
  updated: null,
  commands: null,
  ...o,
})
const OVERWRITTEN = detail({ code: 'overwritten', paths: ['src/a.ts', 'README.md'] })
/** The owner's action answered as failed (git refused), with what the daemon told. */
const refused = (b: unknown, d: GitActionDetail | null, error = 'error: checkout refused') => ({
  ...done(b),
  branch: (b as { branch?: string }).branch ?? null,
  status: 'failed',
  error,
  detail: d,
})
/** An operation of the signed-in user's that ended, as the realtime event brings it. */
const settle = (o: Partial<GitOperationDto>) =>
  act(() =>
    useWorkspace.getState().applyEvent({
      t: 'group.gitOperation',
      groupId: 'g1',
      operation: op({ status: 'succeeded', remote: null, requestedBy: { id: 'u1', name: '小王' }, ...o }),
    }),
  )

describe('checkout (IDEA)', () => {
  it('checks out at once despite changes; changes in the way ask for a smart, a force (confirmed) or no checkout', async () => {
    const calls = mockApi(
      routes({
        [`POST ${BASE}/actions`]: (b: { mode?: string }) => (b.mode ? done(b) : refused(b, OVERWRITTEN)),
      }),
    )
    render(<Page />)
    act(() => cmd().checkout('main'))
    let d = await dialog('Git 检出问题')
    expect(actionsCalled(calls)).toEqual([{ action: 'checkout', branch: 'main' }])
    expect(d.getByText('检出 main 会覆盖以下文件的本地改动')).toBeTruthy()
    const files = within(d.getByRole('list', { name: '会被覆盖的文件' }))
    expect(files.getAllByRole('listitem').map((li) => li.textContent)).toEqual(['src/a.ts', 'README.md'])
    // The dialog tells it: no failure toast besides.
    expect(useToasts.getState().items).toEqual([])
    fireEvent.click(d.getByRole('button', { name: '不检出' }))
    await gone('Git 检出问题')
    expect(actionsCalled(calls)).toHaveLength(1)

    act(() => cmd().checkout('main'))
    d = await dialog('Git 检出问题')
    fireEvent.click(d.getByRole('button', { name: '智能检出' }))
    await waitFor(() =>
      expect(actionsCalled(calls).at(-1)).toEqual({ action: 'checkout', branch: 'main', mode: 'smart' }),
    )
    await gone('Git 检出问题')
    expect(toasts()).toContain('已检出 main')

    act(() => cmd().checkout('main'))
    d = await dialog('Git 检出问题')
    fireEvent.click(d.getByRole('button', { name: '强制检出' }))
    expect(d.getByText('这些文件的本地改动会丢失，无法恢复')).toBeTruthy()
    expect(actionsCalled(calls).at(-1)).toEqual({ action: 'checkout', branch: 'main' })
    fireEvent.click(d.getByRole('button', { name: '确认强制检出' }))
    await waitFor(() =>
      expect(actionsCalled(calls).at(-1)).toEqual({ action: 'checkout', branch: 'main', mode: 'force' }),
    )
  })

  it("keeps git's first line when an older daemon tells nothing more", async () => {
    mockApi(
      routes({
        [`POST ${BASE}/actions`]: (b: unknown) =>
          refused(
            b,
            null,
            'error: Your local changes to the following files would be overwritten by checkout:\n\tsrc/a.ts\nAborting',
          ),
      }),
    )
    render(<Page />)
    act(() => cmd().checkout('main'))
    await waitFor(() =>
      expect(lastToast()).toMatchObject({
        type: 'error',
        title: '小王的 Claude：切换分支失败',
        message: 'error: Your local changes to the following files would be overwritten by checkout:',
      }),
    )
    expect(screen.queryByRole('dialog', { name: 'Git 检出问题' })).toBeNull()
  })

  it("asks the owner for anyone else; when the owner's run meets their changes, offers to ask for a smart checkout", async () => {
    setMe('u2')
    const calls = mockApi(
      routes({
        [`POST ${BASE}/actions`]: (b: { action: GitOperationDto['action'] }) =>
          op({ id: `ask-${actionsCalled(calls).length}`, action: b.action, status: 'pending_approval' }),
      }),
    )
    render(<Page />)
    act(() => cmd().checkout('main'))
    let d = await dialog('检出 main')
    expect(d.queryByRole('radio')).toBeNull()
    fireEvent.click(d.getByRole('button', { name: '提交申请' }))
    await waitFor(() =>
      expect(actionsCalled(calls)).toEqual([{ action: 'checkout', branch: 'main', detach: false }]),
    )
    settle({
      id: 'co-asked',
      action: 'checkout',
      branch: 'main',
      status: 'failed',
      error: 'error: Your local changes would be overwritten by checkout',
      detail: OVERWRITTEN,
      requestedBy: { id: 'u2', name: '老李' },
    })
    expect(lastToast()).toMatchObject({ type: 'error', title: '小王的 Claude：切换分支失败' })
    expect(screen.queryByRole('dialog', { name: 'Git 检出问题' })).toBeNull()
    fireEvent.click(toastButton('智能检出…'))
    d = await dialog('Git 检出问题')
    expect(d.getByText('需要 Bot 主人 小王 批准后才会执行')).toBeTruthy()
    fireEvent.click(d.getByRole('button', { name: '智能检出' }))
    await waitFor(() =>
      expect(actionsCalled(calls).at(-1)).toEqual({ action: 'checkout', branch: 'main', mode: 'smart' }),
    )
    await waitFor(() => expect(toasts()).toContain('已提交申请，等待 Bot 主人 小王 审批'))
  })

  it("offers to rebase a remote branch's diverged local one onto it, or to drop its commits (confirmed)", async () => {
    const calls = mockApi(
      routes({
        [`POST ${BASE}/actions`]: (b: { localCommits?: string }) =>
          b.localCommits ? done(b) : refused(b, detail({ code: 'diverged', ahead: 2, behind: 3 })),
      }),
    )
    render(<Page />)
    act(() => cmd().checkout('origin/feat/pay'))
    let d = await dialog('本地分支 feat/pay 与 origin/feat/pay 已分叉')
    expect(d.getByText('本地独有 2 个提交，远程独有 3 个提交')).toBeTruthy()
    expect(useToasts.getState().items).toEqual([])
    fireEvent.click(d.getByRole('button', { name: '变基到远程' }))
    await waitFor(() =>
      expect(actionsCalled(calls).at(-1)).toEqual({
        action: 'checkout',
        branch: 'origin/feat/pay',
        localCommits: 'rebase',
      }),
    )
    await gone(/已分叉/)

    act(() => cmd().checkout('origin/feat/pay'))
    d = await dialog('本地分支 feat/pay 与 origin/feat/pay 已分叉')
    fireEvent.click(d.getByRole('button', { name: '丢弃本地提交' }))
    expect(d.getByText('feat/pay 独有的 2 个提交会被丢弃，只能从引用日志找回')).toBeTruthy()
    expect(actionsCalled(calls).at(-1)).toEqual({ action: 'checkout', branch: 'origin/feat/pay' })
    fireEvent.click(d.getByRole('button', { name: '确认丢弃本地提交' }))
    await waitFor(() =>
      expect(actionsCalled(calls).at(-1)).toEqual({
        action: 'checkout',
        branch: 'origin/feat/pay',
        localCommits: 'drop',
      }),
    )
  })

  it('warns when a smart checkout left conflicts restoring the changes, opening the first in the merge tool', async () => {
    mockApi(
      routes({
        [`POST ${BASE}/actions`]: (b: { mode?: string }) =>
          b.mode
            ? { ...done(b), detail: detail({ code: 'conflicts', paths: ['src/a.ts', 'README.md'] }) }
            : refused(b, OVERWRITTEN),
      }),
    )
    render(<Page />)
    act(() => cmd().checkout('main'))
    fireEvent.click((await dialog('Git 检出问题')).getByRole('button', { name: '智能检出' }))
    await waitFor(() =>
      expect(lastToast()).toMatchObject({
        type: 'warning',
        message: '已检出 main，恢复本地改动时 2 个文件有冲突',
      }),
    )
    fireEvent.click(toastButton('解决冲突'))
    expect(benchTabs().at(-1)).toMatchObject({ kind: 'git-merge', botId: 'b1', repo: null, path: 'src/a.ts' })
  })
})

describe('update project (IDEA)', () => {
  const UPDATED = detail({ updated: { from: '1a2b3c4', to: '5d6e7f8', commits: 2, files: 3 } })

  it('merges by default, says local changes are stashed around any update, and links the commits that came in', async () => {
    const calls = mockApi(
      routes({ [`POST ${BASE}/actions`]: (b: unknown) => ({ ...done(b), detail: UPDATED }) }),
    )
    render(<Page />)
    fireEvent.click((await openGit()).getByRole('button', { name: '更新…' }))
    const d = await dialog('更新 feat/refund-v2')
    expect((d.getByRole('radio', { name: /^合并/ }) as HTMLInputElement).checked).toBe(true)
    for (const mode of [/^变基/, /^仅快进/, /^合并/]) {
      fireEvent.click(d.getByRole('radio', { name: mode }))
      expect(d.getByText('本地改动会先贮藏，更新后自动恢复')).toBeTruthy()
    }
    fireEvent.click(d.getByRole('button', { name: '更新' }))
    await waitFor(() => expect(actionsCalled(calls)).toEqual([{ action: 'pull', mode: 'merge' }]))
    await waitFor(() => expect(toasts()).toContain('已更新 3 个文件（2 个提交）'))
    fireEvent.click(toastButton('查看提交'))
    expect(benchTabs().at(-1)).toMatchObject({
      kind: 'git',
      botId: 'b1',
      view: 'log',
      log: { ref: '1a2b3c4..5d6e7f8' },
    })
  })

  it('says all is up to date when nothing came in, for a branch fast-forwarded from the branch popup too', async () => {
    const calls = mockApi(
      routes({
        [`POST ${BASE}/actions`]: (b: unknown) => ({
          ...done(b),
          detail: detail({ updated: { from: '1a2b3c4', to: '1a2b3c4', commits: 0, files: 0 } }),
        }),
      }),
    )
    render(<Page />)
    act(() => cmd().updateBranch('main'))
    await waitFor(() => expect(actionsCalled(calls)).toEqual([{ action: 'pull', branch: 'main' }]))
    await waitFor(() => expect(toasts()).toContain('已是最新'))
  })

  it('warns when the stashed changes came back with conflicts', async () => {
    mockApi(
      routes({
        [`POST ${BASE}/actions`]: (b: unknown) => ({
          ...done(b),
          detail: detail({ code: 'conflicts', paths: ['src/a.ts'], updated: UPDATED.updated }),
        }),
      }),
    )
    render(<Page />)
    fireEvent.click((await openGit()).getByRole('button', { name: '更新…' }))
    fireEvent.click((await dialog('更新 feat/refund-v2')).getByRole('button', { name: '更新' }))
    await waitFor(() =>
      expect(lastToast()).toMatchObject({
        type: 'warning',
        message: '已更新，恢复本地改动时 1 个文件有冲突',
      }),
    )
    fireEvent.click(toastButton('解决冲突'))
    expect(benchTabs().at(-1)).toMatchObject({ kind: 'git-merge', path: 'src/a.ts' })
  })
})

describe('fetch', () => {
  it('says when the remotes are fetched', async () => {
    const calls = mockApi(routes())
    render(<Page />)
    const tab = await openGit()
    await waitFor(() => expect(refreshes(calls)).toHaveLength(1))
    fireEvent.click(tab.getByRole('button', { name: '获取远程更新' }))
    await waitFor(() => expect(toasts()).toContain('获取完成'))
    expect(refreshes(calls).at(-1)).toEqual({ fetch: true })
  })
})

describe('new branch (IDEA)', () => {
  it('names a branch made from a remote one after it, checks names as typed and overwrites one when asked', async () => {
    const calls = mockApi(
      routes({ [`POST ${BASE}/actions`]: (b: { name: string }) => ({ ...done(b), branch: b.name }) }),
    )
    render(<Page />)
    act(() => cmd().newBranch('origin/feat/pay'))
    const d = await dialog('新建分支')
    const name = d.getByRole('textbox', { name: '新分支名称' }) as HTMLInputElement
    await waitFor(() => expect(name.value).toBe('feat/pay'))
    const create = d.getByRole('button', { name: '创建' }) as HTMLButtonElement
    expect(create.disabled).toBe(false)
    fireEvent.change(name, { target: { value: 'feat/my fee' } })
    expect(d.getByText('无效的分支名')).toBeTruthy()
    expect(create.disabled).toBe(true)
    fireEvent.change(name, { target: { value: 'feat/x.lock' } })
    expect(d.getByText('无效的分支名')).toBeTruthy()
    fireEvent.change(name, { target: { value: 'feat' } })
    expect(d.getByText('与已有分支 feat/refund-v2 冲突')).toBeTruthy()
    fireEvent.change(name, { target: { value: 'feat/fee/x' } })
    expect(d.getByText('与已有分支 feat/fee 冲突')).toBeTruthy()
    expect(create.disabled).toBe(true)
    fireEvent.change(name, { target: { value: 'feat/refund-v2' } })
    expect(d.getByText('feat/refund-v2 是当前分支，不能覆盖')).toBeTruthy()
    expect(d.queryByRole('checkbox', { name: '覆盖已存在的分支' })).toBeNull()
    expect(create.disabled).toBe(true)
    fireEvent.change(name, { target: { value: 'feat/fee' } })
    expect(create.disabled).toBe(true)
    fireEvent.click(d.getByRole('checkbox', { name: '覆盖已存在的分支' }))
    expect(create.disabled).toBe(false)
    fireEvent.click(create)
    await waitFor(() =>
      expect(actionsCalled(calls)).toEqual([
        {
          action: 'branch-create',
          name: 'feat/fee',
          checkout: true,
          from: 'origin/feat/pay',
          overwrite: true,
        },
      ]),
    )
    await waitFor(() => expect(toasts()).toContain('已创建分支 feat/fee'))
  })
})

describe('delete branch (IDEA)', () => {
  const commit = (c: string, subject: string) => ({
    hash: c.repeat(40),
    shortHash: c.repeat(7),
    author: '小王',
    email: 'w@corp',
    at: '2026-10-21T00:00:00.000Z',
    subject,
    parents: [],
    refs: [],
  })
  const UNMERGED = { commits: [commit('c', '退款按原路返回'), commit('d', '手续费')], hasMore: false }
  const PAY_REFS = {
    ...REFS,
    branches: [...REFS.branches, branch('feat/pay', { upstream: 'origin/feat/pay' })],
  }
  const deleted = (b: { action: string; branch?: string; name?: string }) => ({
    ...done(b),
    branch: b.branch ?? b.name ?? null,
    output: b.action === 'branch-delete' ? `Deleted branch ${b.branch} (was 1a2b3c4).` : null,
  })

  it('deletes a merged branch once confirmed, then offers to restore it or to delete the branch it tracked', async () => {
    const calls = mockApi(
      routes({
        [`GET ${BASE}/refs`]: PAY_REFS,
        [`GET ${BASE}/log?ref=origin%2Ffeat%2Fpay..feat%2Fpay&skip=0`]: { commits: [], hasMore: false },
        [`POST ${BASE}/actions`]: deleted,
      }),
    )
    render(<Page />)
    act(() => cmd().deleteBranch('feat/pay'))
    let d = await dialog('删除分支 feat/pay')
    expect(d.getByText('删除本地分支 feat/pay')).toBeTruthy()
    let del = d.getByRole('button', { name: '删除' }) as HTMLButtonElement
    await waitFor(() => expect(del.disabled).toBe(false))
    fireEvent.click(del)
    await waitFor(() =>
      expect(actionsCalled(calls)).toEqual([{ action: 'branch-delete', branch: 'feat/pay', force: false }]),
    )
    await waitFor(() => expect(toasts()).toContain('已删除分支 feat/pay'))
    await gone('删除分支 feat/pay')
    fireEvent.click(toastButton('恢复'))
    await waitFor(() =>
      expect(actionsCalled(calls).at(-1)).toEqual({
        action: 'branch-create',
        name: 'feat/pay',
        from: '1a2b3c4',
        checkout: false,
      }),
    )
    await waitFor(() => expect(toasts()).toContain('已创建分支 feat/pay'))

    act(() => cmd().deleteBranch('feat/pay'))
    d = await dialog('删除分支 feat/pay')
    del = d.getByRole('button', { name: '删除' }) as HTMLButtonElement
    await waitFor(() => expect(del.disabled).toBe(false))
    fireEvent.click(del)
    await waitFor(() => expect(toastButton('删除跟踪分支')).toBeTruthy())
    fireEvent.click(toastButton('删除跟踪分支'))
    d = await dialog('删除分支 origin/feat/pay')
    expect(await d.findByText('在远程 origin 上删除分支 feat/pay，其他人将无法再拉取它')).toBeTruthy()
    fireEvent.click(d.getByRole('button', { name: '删除' }))
    await waitFor(() =>
      expect(actionsCalled(calls).at(-1)).toEqual({
        action: 'branch-delete',
        branch: 'origin/feat/pay',
        force: false,
      }),
    )
  })

  it('lists the commits not merged yet, and deletes anyway with force', async () => {
    const calls = mockApi(
      routes({
        [`GET ${BASE}/log?ref=HEAD..feat%2Ffee&skip=0`]: UNMERGED,
        [`POST ${BASE}/actions`]: deleted,
      }),
    )
    render(<Page />)
    act(() => cmd().deleteBranch('feat/fee'))
    const d = await dialog('删除分支 feat/fee')
    expect(await d.findByText('2 个提交未合并到 feat/refund-v2')).toBeTruthy()
    expect(d.getByText('退款按原路返回')).toBeTruthy()
    expect(d.getByText('手续费')).toBeTruthy()
    expect(d.queryByRole('button', { name: '删除' })).toBeNull()
    fireEvent.click(d.getByRole('button', { name: '仍然删除' }))
    await waitFor(() =>
      expect(actionsCalled(calls)).toEqual([{ action: 'branch-delete', branch: 'feat/fee', force: true }]),
    )
    await gone('删除分支 feat/fee')
  })

  it('lets anyone else ask to delete an unmerged branch anyway', async () => {
    setMe('u2')
    const calls = mockApi(
      routes({
        [`GET ${BASE}/log?ref=HEAD..feat%2Ffee&skip=0`]: UNMERGED,
        [`POST ${BASE}/actions`]: op({
          id: 'ask-delete',
          action: 'branch-delete',
          status: 'pending_approval',
        }),
      }),
    )
    render(<Page />)
    act(() => cmd().deleteBranch('feat/fee'))
    const d = await dialog('删除分支 feat/fee')
    expect(await d.findByText('2 个提交未合并到 feat/refund-v2')).toBeTruthy()
    fireEvent.click(d.getByRole('button', { name: '提交申请' }))
    await waitFor(() =>
      expect(actionsCalled(calls)).toEqual([{ action: 'branch-delete', branch: 'feat/fee', force: true }]),
    )
    await gone('删除分支 feat/fee')
  })
})

describe('operation notices (IDEA)', () => {
  it("says what each action did, the rest as before; a failure keeps git's first line", async () => {
    mockApi(routes())
    render(<Page />)
    await screen.findByTestId('git-b1')
    settle({ id: 'n1', action: 'push', branch: 'feat/x', remote: 'origin', args: { target: 'feat/y' } })
    settle({ id: 'n2', action: 'push', branch: 'feat/x', remote: 'origin' })
    settle({ id: 'n3', action: 'branch-create', branch: 'feat/z' })
    settle({ id: 'n4', action: 'branch-rename', branch: 'feat/z', args: { name: 'feat/zz' } })
    settle({ id: 'n5', action: 'merge', branch: 'main' })
    settle({ id: 'n6', action: 'rebase', branch: null, args: { onto: 'origin/main' } })
    settle({ id: 'n7', action: 'checkout', branch: 'v1.2' })
    settle({
      id: 'n8',
      action: 'cherry-pick',
      branch: null,
      args: { commits: ['a'.repeat(40), 'b'.repeat(40)] },
    })
    settle({ id: 'n9', action: 'add', branch: null, paths: ['a.ts'] })
    settle({
      id: 'n10',
      action: 'merge',
      branch: 'main',
      status: 'failed',
      error:
        'error: Merging is not possible because you have unmerged files.\nhint: Fix them up in the work tree',
    })
    expect(toasts()).toEqual([
      '已推送到 origin/feat/y',
      '已推送到 origin/feat/x',
      '已创建分支 feat/z',
      '已将分支 feat/z 重命名为 feat/zz',
      '已合并 main',
      '已变基到 origin/main',
      '已检出 v1.2',
      '已优选 2 个提交',
      '小王的 Claude：加入版本控制完成',
      'error: Merging is not possible because you have unmerged files.',
    ])
    expect(lastToast()?.title).toBe('小王的 Claude：合并失败')
  })
})
