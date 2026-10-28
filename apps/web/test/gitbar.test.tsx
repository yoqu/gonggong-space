import type { BotDto, GroupBotStateDto, GroupDto, RepoStatus, UserDto } from '@gonggong/protocol'
import { fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { useSession } from '../src/app/session'
import { useWorkbench } from '../src/app/workbench'
import { loadBotStates, useWorkspace } from '../src/app/workspace'
import { GitBar } from '../src/features/chat/GitBar'
import { mockApi } from './mockApi'
import { startRealtime } from './socket'

const group = (o: Partial<GroupDto> = {}): GroupDto => ({
  id: 'g1',
  teamId: 't1',
  name: '退款 v2 迁移',
  kind: 'group',
  mode: 'partition',
  adminOnlyInvite: false,
  protectBase: false,
  notice: '',
  noticeHidden: false,
  avatar: null,
  repo: { url: 'git@git.corp:pay/refund.git', branch: 'main' },
  members: [],
  botIds: ['b1', 'b2', 'b3', 'b4'],
  unread: 0,
  lastSeq: 0,
  last: '',
  pinned: false,
  muted: false,
  foldRuns: false,
  liveRunIds: [],
  liveRuns: [],
  ...o,
})

const bot = (id: string, name: string) => ({ id, name, ownerId: 'u1', ownerName: '小王' }) as BotDto

const state = (botId: string, o: Partial<GroupBotStateDto> = {}): GroupBotStateDto => ({
  botId,
  workspace: 'managed',
  path: null,
  state: 'ready',
  git: null,
  error: null,
  reason: null,
  tier: null,
  model: null,
  effort: null,
  context: null,
  extraDirs: [],
  ...o,
})

const git = (o: Partial<NonNullable<GroupBotStateDto['git']>> = {}) => ({
  branch: 'main',
  ahead: 0,
  behind: 0,
  dirty: false,
  workspace: 'managed' as const,
  repos: [],
  ...o,
})

beforeEach(() => {
  useSession.setState({ user: { id: 'u1', name: '小王' } as UserDto })
  useWorkspace.setState({
    bots: [
      bot('b1', '小王的 Claude'),
      bot('b2', '老李的 Codex'),
      bot('b3', '阿杰的 Claude'),
      bot('b4', '小周的 Codex'),
    ],
    botStates: {},
  })
})
afterEach(() => vi.unstubAllGlobals())

/** Opens a bot's one menu: where it works, then its actions. */
async function menu(name: string) {
  fireEvent.click(await screen.findByRole('button', { name: `${name} 的工作区` }))
  return screen.findByRole('dialog', { name: `${name} 的工作区` })
}

describe('git status bar', () => {
  it('shows added and deleted lines with capped badges and exact totals on hover', async () => {
    mockApi({
      'GET /groups/g1/bot-states': [
        state('b1', { git: git({ dirty: true, additions: 12, deletions: 3 }) }),
        state('b2', { git: git({ dirty: true, additions: 150, deletions: 100 }) }),
      ],
      'GET /groups/g1/git/operations': { operations: [] },
    })
    render(<GitBar group={group({ botIds: ['b1', 'b2'] })} />)
    expect((await screen.findByTestId('git-b1')).textContent).toContain('未提交+12-3')
    expect(screen.getByTitle('新增 12 行')).toBeTruthy()
    expect(screen.getByTitle('删除 3 行')).toBeTruthy()
    expect(screen.getByTestId('git-b2').textContent).toContain('未提交+99+-99+')
    expect(screen.getByTitle('新增 150 行')).toBeTruthy()
    expect(screen.getByTitle('删除 100 行')).toBeTruthy()
  })

  it('shows Git for a detected local workspace without a group repository', async () => {
    mockApi({
      'GET /groups/g1/bot-states': [
        state('b1', {
          workspace: 'cd',
          path: '/work/local',
          git: git({ workspace: 'cd', branch: 'feature/local' }),
        }),
        state('b2', { workspace: 'cd', path: '/work/plain' }),
      ],
      'GET /groups/g1/git/operations': { operations: [] },
    })
    render(<GitBar group={group({ repo: null, botIds: ['b1', 'b2'] })} />)
    expect(await screen.findByRole('button', { name: '打开 小王的 Claude 的 Git' })).toBeTruthy()
    expect(screen.queryByRole('button', { name: '打开 老李的 Codex 的 Git' })).toBeNull()
  })
  it('keeps my bots and issues visible while other healthy bots stay in 更多工作区', async () => {
    mockApi({
      'GET /groups/g1/bot-states': [
        state('b1'),
        state('b2'),
        state('b3', { git: git({ behind: 2 }) }),
        state('b4', { state: 'failed', error: 'clone failed' }),
      ],
      'GET /groups/g1/git/operations': { operations: [] },
    })
    useWorkspace.setState({
      bots: [
        bot('b1', '小王的 Claude'),
        { ...bot('b2', '老李的 Codex'), ownerId: 'u2' },
        { ...bot('b3', '阿杰的 Claude'), ownerId: 'u3' },
        { ...bot('b4', '小周的 Codex'), ownerId: 'u4' },
      ],
    })
    render(<GitBar group={group()} />)
    expect(await screen.findByTestId('git-b1')).toBeTruthy()
    expect(screen.getByTestId('git-b3')).toBeTruthy()
    expect(screen.getByTestId('git-b4')).toBeTruthy()
    expect(screen.queryByTestId('git-b2')).toBeNull()
    const more = screen.getByRole('button', { name: '展开其余 1 个 Bot 的工作区' })
    expect(more.textContent).toContain('更多工作区')
    fireEvent.click(more)
    expect(await screen.findByTestId('git-b2')).toBeTruthy()
    expect(screen.getByRole('button', { name: '收起更多工作区' }).getAttribute('aria-expanded')).toBe('true')
  })

  it('anchors the bar on the first healthy bot in group order when I own none, without hiding issues', async () => {
    mockApi({
      'GET /groups/g1/bot-states': [
        state('b1'),
        state('b2'),
        state('b3', { git: git({ conflicts: 1 }) }),
        state('b4', { state: 'unbound' }),
      ],
      'GET /groups/g1/git/operations': { operations: [] },
    })
    useSession.setState({ user: { id: 'u9', name: '旁观的成员' } as UserDto })
    useWorkspace.setState({
      bots: [
        { ...bot('b1', '小王的 Claude'), ownerId: 'u1' },
        { ...bot('b2', '老李的 Codex'), ownerId: 'u2' },
        { ...bot('b3', '阿杰的 Claude'), ownerId: 'u3' },
        { ...bot('b4', '小周的 Codex'), ownerId: 'u4' },
      ],
    })
    render(<GitBar group={group()} />)
    expect(await screen.findByTestId('git-b1')).toBeTruthy()
    expect(screen.getByTestId('git-b3')).toBeTruthy()
    expect(screen.getByTestId('git-b4')).toBeTruthy()
    expect(screen.queryByTestId('git-b2')).toBeNull()
    expect(screen.getByRole('button', { name: '展开其余 1 个 Bot 的工作区' })).toBeTruthy()
  })

  it('starts with other workspaces collapsed after switching groups', async () => {
    mockApi({
      'GET /groups/g1/bot-states': [state('b1'), state('b2')],
      'GET /groups/g2/bot-states': [state('b1'), state('b2')],
      'GET /groups/g1/git/operations': { operations: [] },
      'GET /groups/g2/git/operations': { operations: [] },
    })
    useSession.setState({ user: { id: 'u9', name: '旁观的成员' } as UserDto })
    useWorkspace.setState({
      bots: [
        { ...bot('b1', '小王的 Claude'), ownerId: 'u1' },
        { ...bot('b2', '老李的 Codex'), ownerId: 'u2' },
      ],
    })
    const { rerender } = render(<GitBar group={group({ botIds: ['b1', 'b2'] })} />)
    fireEvent.click(await screen.findByRole('button', { name: '展开其余 1 个 Bot 的工作区' }))
    expect(await screen.findByTestId('git-b2')).toBeTruthy()

    useWorkspace.setState((s) => ({
      botStates: {
        ...s.botStates,
        g2: { b1: state('b1'), b2: state('b2') },
      },
    }))
    rerender(<GitBar group={group({ id: 'g2', botIds: ['b2', 'b1'] })} />)
    expect(screen.queryByTestId('git-bar-others')).toBeNull()
    const more = screen.getByRole('button', { name: '展开其余 1 个 Bot 的工作区' })
    expect(more.getAttribute('aria-expanded')).toBe('false')
  })

  it('shows a Bot with a Git operation waiting for approval, not one that failed', async () => {
    const operation = (botId: string, status: 'pending_approval' | 'failed') => ({
      id: `${botId}-${status}`,
      groupId: 'g1',
      botId,
      repo: null,
      action: 'push' as const,
      branch: 'main',
      remote: 'origin',
      message: null,
      paths: null,
      args: null,
      pushesBase: false,
      status,
      requestedBy: { id: 'u2', name: '老李' },
      decidedBy: null,
      output: null,
      error: status === 'failed' ? 'rejected' : null,
      detail: null,
      createdAt: '2026-10-26T10:00:00.000Z',
      expiresAt: '2026-10-27T10:00:00.000Z',
      finishedAt: status === 'failed' ? '2026-10-26T10:01:00.000Z' : null,
    })
    mockApi({
      'GET /groups/g1/bot-states': [state('b1'), state('b2'), state('b3'), state('b4')],
      'GET /groups/g1/git/operations': {
        operations: [operation('b2', 'pending_approval'), operation('b3', 'failed')],
      },
    })
    useWorkspace.setState({
      bots: [
        bot('b1', '小王的 Claude'),
        { ...bot('b2', '老李的 Codex'), ownerId: 'u2' },
        { ...bot('b3', '阿杰的 Claude'), ownerId: 'u3' },
        { ...bot('b4', '小周的 Codex'), ownerId: 'u4' },
      ],
    })
    render(<GitBar group={group()} />)
    expect(await screen.findByTestId('git-b2')).toBeTruthy()
    expect(screen.getByTestId('git-b2').textContent).toContain('待审批 1')
    expect(screen.queryByTestId('git-b3')).toBeNull()
    expect(screen.queryByTestId('git-b4')).toBeNull()
  })

  it('shows every issue once, even when I own none of the group’s Bots', async () => {
    mockApi({
      'GET /groups/g1/bot-states': [
        state('b1', { state: 'failed', error: 'clone failed' }),
        state('b2', { git: git({ dirty: true }) }),
      ],
      'GET /groups/g1/git/operations': { operations: [] },
    })
    useSession.setState({ user: { id: 'u9' } as UserDto })
    useWorkspace.setState({
      bots: [
        { ...bot('b1', '小王的 Claude'), ownerId: 'u1' },
        { ...bot('b2', '老李的 Codex'), ownerId: 'u2' },
      ],
    })
    render(<GitBar group={group({ botIds: ['b1', 'b2'] })} />)
    expect(screen.getAllByTestId('git-b1')).toHaveLength(1)
    expect(screen.getAllByTestId('git-b2')).toHaveLength(1)
    expect(screen.queryByTestId('git-bar-more')).toBeNull()
  })

  it('puts my own bots first, keeping the group order otherwise', async () => {
    mockApi({ 'GET /groups/g1/bot-states': [] })
    useWorkspace.setState({
      bots: [
        { ...bot('b1', '小王的 Claude'), ownerId: 'u1' },
        { ...bot('b2', '老李的 Codex'), ownerId: 'u2' },
        { ...bot('b3', '阿杰的 Claude'), ownerId: 'u3' },
        { ...bot('b4', '老李的 Claude'), ownerId: 'u2' },
      ],
    })
    const order = () =>
      [...screen.getByTestId('git-bar-items').children].map((el) => el.getAttribute('data-testid'))
    const others = () =>
      [...screen.getByTestId('git-bar-others').children].map((el) => el.getAttribute('data-testid'))
    useSession.setState({ user: { id: 'u2' } as UserDto })
    const { unmount } = render(<GitBar group={group({ mode: 'force', repo: null })} />)
    expect(order()).toEqual(['git-b2', 'git-b4'])
    fireEvent.click(screen.getByRole('button', { name: '展开其余 2 个 Bot 的工作区' }))
    expect(others()).toEqual(['git-b1', 'git-b3'])
    unmount()
    useSession.setState({ user: { id: 'u9' } as UserDto })
    render(<GitBar group={group({ mode: 'force', repo: null })} />)
    expect(order()).toEqual(['git-b1'])
    fireEvent.click(screen.getByRole('button', { name: '展开其余 3 个 Bot 的工作区' }))
    expect(others()).toEqual(['git-b2', 'git-b3', 'git-b4'])
  })

  it('loads the states and renders branch, behind/ahead, dirty and workspace hints', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(
        async () =>
          new Response(
            JSON.stringify([
              state('b1', { git: git({ branch: 'feat/refund-v2', ahead: 3, dirty: true }) }),
              state('b2', { state: 'cloning' }),
              state('b3', { state: 'failed', error: 'Permission denied (publickey)' }),
              state('b4', {
                workspace: 'cd',
                git: git({ branch: null, ahead: null, behind: null, workspace: 'cd' }),
              }),
            ]),
          ),
      ),
    )
    render(<GitBar group={group()} />)
    const b1 = await screen.findByTestId('git-b1')
    expect(fetch).toHaveBeenCalledWith('/api/groups/g1/bot-states', expect.anything())
    expect(b1.textContent).toBe('小王的 Claudefeat/refund-v23未提交')
    expect(within(b1).getByRole('img', { name: '领先 3 个提交' }).querySelector('svg')).toBeTruthy()
    expect(screen.getByTestId('git-b2').textContent).toBe('老李的 Codexclone 中…')
    expect(screen.getByTestId('git-b3').textContent).toBe('阿杰的 Claude工作区创建失败')
    expect(screen.getByText('工作区创建失败').getAttribute('title')).toBe('Permission denied (publickey)')
    expect(screen.getByTestId('git-b4').textContent).toBe('小周的 Codex—')
  })

  it('opens the bot workspace changes: uncommitted work first, else the branch against main', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(
        async () =>
          new Response(
            JSON.stringify([
              state('b1', { git: git({ dirty: true }) }),
              state('b2', { git: git({ branch: 'feat/x', dirty: false }) }),
              state('b3', { state: 'cloning' }),
            ]),
          ),
      ),
    )
    useWorkbench.setState({ groupId: 'g1', benches: {} })
    render(<GitBar group={group({ botIds: ['b1', 'b2', 'b3'] })} />)
    // One menu per bot: its changes come first, next to its files, pull, commit and push.
    fireEvent.click(
      within(await menu('小王的 Claude')).getByRole('button', { name: '查看 小王的 Claude 的改动' }),
    )
    const tabs = () => useWorkbench.getState().benches.g1?.tabs
    expect(tabs()).toEqual([{ kind: 'diff', botId: 'b1', scope: 'uncommitted', file: null }])
    fireEvent.click(
      within(await menu('老李的 Codex')).getByRole('button', { name: '查看 老李的 Codex 的改动' }),
    )
    expect(tabs()?.at(-1)).toEqual({ kind: 'diff', botId: 'b2', scope: 'base', file: null })
    const cloning = await menu('阿杰的 Claude')
    expect(
      (within(cloning).getByRole('button', { name: '查看 阿杰的 Claude 的改动' }) as HTMLButtonElement)
        .disabled,
    ).toBe(true)
    expect(within(cloning).queryByRole('button', { name: /拉取/ })).toBeNull()
  })

  it('heads the menu with where a bot works: machine, copyable directory and its kind, repo, base branch, extra dirs', async () => {
    const writeText = vi.fn(async () => {})
    vi.stubGlobal('navigator', { ...navigator, clipboard: { writeText } })
    useWorkspace.setState({
      bots: [{ ...bot('b1', '小王的 Claude'), machineName: '王磊的 MacBook' }, bot('b2', '老李的 Codex')],
    })
    vi.stubGlobal(
      'fetch',
      vi.fn(
        async () =>
          new Response(
            JSON.stringify([
              state('b1', {
                workspace: 'cd',
                path: '/Users/w/code/refund',
                git: git({ branch: 'feat/x', dirty: true, workspace: 'cd' }),
                extraDirs: ['/Users/w/shared'],
              }),
              state('b2', { path: '/w/b2', git: git() }),
            ]),
          ),
      ),
    )
    render(<GitBar group={group({ botIds: ['b1', 'b2'] })} />)
    const panel = await menu('小王的 Claude')
    expect(within(panel).getByText('git@git.corp:pay/refund.git')).toBeTruthy()
    expect(within(panel).getByText('王磊的 MacBook')).toBeTruthy()
    expect(within(panel).getByText('/Users/w/code/refund')).toBeTruthy()
    expect(within(panel).getByText('本机目录')).toBeTruthy()
    expect(within(panel).getByText('main')).toBeTruthy()
    expect(within(panel).getByText('当前在 feat/x')).toBeTruthy()
    expect(within(panel).getByText('/Users/w/shared')).toBeTruthy()
    fireEvent.click(within(panel).getByRole('button', { name: '复制目录' }))
    expect(writeText).toHaveBeenCalledWith('/Users/w/code/refund')

    const other = await menu('老李的 Codex')
    expect(within(other).getByText('未绑定机器')).toBeTruthy()
    expect(within(other).getByText('托管目录')).toBeTruthy()
    expect(within(other).queryByText(/当前在/)).toBeNull()
    expect(within(other).queryByText('附加目录')).toBeNull()
  })

  it('opens the bot workspace files once the workspace exists', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(
        async () =>
          new Response(
            JSON.stringify([
              state('b1', { git: git() }),
              state('b2', { state: 'ready' }),
              state('b3', { state: 'cloning' }),
            ]),
          ),
      ),
    )
    useWorkbench.setState({ groupId: 'g1', benches: {} })
    render(<GitBar group={group({ botIds: ['b1', 'b2', 'b3'] })} />)
    fireEvent.click(
      within(await menu('小王的 Claude')).getByRole('button', { name: '浏览 小王的 Claude 的文件' }),
    )
    const tabs = () => useWorkbench.getState().benches.g1?.tabs
    expect(tabs()).toEqual([{ kind: 'files', botId: 'b1', dir: '', selected: null }])
    fireEvent.click(
      within(await menu('老李的 Codex')).getByRole('button', { name: '浏览 老李的 Codex 的文件' }),
    )
    expect(tabs()?.at(-1)).toEqual({ kind: 'files', botId: 'b2', dir: '', selected: null })
    const cloning = await menu('阿杰的 Claude')
    expect(
      (within(cloning).getByRole('button', { name: '浏览 阿杰的 Claude 的文件' }) as HTMLButtonElement)
        .disabled,
    ).toBe(true)
  })

  it('opens the files of any bound workspace, without a repo or outside partition groups; changes stay hidden', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(
        async () =>
          new Response(
            JSON.stringify([
              state('b1', { state: 'ready', workspace: 'cd', git: null }),
              state('b2', { state: 'ready', git: null }),
              state('b3', { state: 'unbound', git: null }),
            ]),
          ),
      ),
    )
    useWorkbench.setState({ groupId: 'g1', benches: {} })
    render(<GitBar group={group({ mode: 'force', repo: null, botIds: ['b1', 'b2', 'b3'] })} />)
    const first = await menu('小王的 Claude')
    expect(within(first).queryByRole('button', { name: /的改动$/ })).toBeNull()
    expect(within(first).queryByRole('button', { name: /拉取/ })).toBeNull()
    fireEvent.click(within(first).getByRole('button', { name: '浏览 小王的 Claude 的文件' }))
    const tabs = () => useWorkbench.getState().benches.g1?.tabs
    expect(tabs()).toEqual([{ kind: 'files', botId: 'b1', dir: '', selected: null }])
    fireEvent.click(
      within(await menu('老李的 Codex')).getByRole('button', { name: '浏览 老李的 Codex 的文件' }),
    )
    expect(tabs()?.at(-1)).toEqual({ kind: 'files', botId: 'b2', dir: '', selected: null })
    const unbound = await menu('阿杰的 Claude')
    expect(
      (within(unbound).getByRole('button', { name: '浏览 阿杰的 Claude 的文件' }) as HTMLButtonElement)
        .disabled,
    ).toBe(true)
  })

  it('shows 待创建 before the daemon reports and follows realtime updates', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => new Response(JSON.stringify([]))),
    )
    render(<GitBar group={group({ botIds: ['b1'] })} />)
    await waitFor(() => expect(fetch).toHaveBeenCalled())
    expect(screen.getByTestId('git-b1').textContent).toBe('小王的 Claude待创建')
    useWorkspace.getState().applyEvent({
      t: 'group.botState',
      groupId: 'g1',
      // A turn's git report counts even before a workspace.state arrives.
      state: state('b1', { state: 'pending', git: git({ behind: 2 }) }),
    })
    await waitFor(() => expect(screen.getByTestId('git-b1').textContent).toBe('小王的 Claudemain2'))
    expect(screen.getByRole('img', { name: '落后 2 个提交' })).toBeTruthy()
    useWorkspace
      .getState()
      .applyEvent({ t: 'group.botState', groupId: 'g1', state: state('b1', { state: 'unbound' }) })
    await waitFor(() => expect(screen.getByTestId('git-b1').textContent).toBe('小王的 Claude待绑定'))
  })

  it('loads once on the first connect and again after a reconnect', async () => {
    const calls = mockApi({
      'GET /groups/g1/bot-states': [],
      'GET /groups/g1/git/operations': { operations: [] },
    })
    const rt = startRealtime()
    render(<GitBar group={group({ botIds: ['b1'] })} />)
    await screen.findByText('待创建')
    await rt.open()
    expect(calls.map((c) => c.path)).toEqual(['/groups/g1/bot-states', '/groups/g1/git/operations'])
    await rt.reconnect()
    expect(calls).toHaveLength(4)
  })

  it('re-reads the git status of the bots showing it when the window regains focus, at most every 30s', async () => {
    vi.useFakeTimers({ toFake: ['Date', 'setInterval', 'clearInterval'] })
    vi.setSystemTime(new Date('2026-10-15T02:00:00.000Z'))
    const calls = mockApi({
      'GET /groups/g1/bot-states': [state('b1', { git: git() }), state('b2', { state: 'cloning' })],
      'GET /groups/g1/git/operations': { operations: [] },
      'POST /groups/g1/bots/b1/git/refresh': undefined,
    })
    render(<GitBar group={group({ botIds: ['b1', 'b2'] })} />)
    await screen.findByRole('button', { name: '打开 小王的 Claude 的 Git' })
    const refreshes = () => calls.filter((c) => c.path.endsWith('/git/refresh'))
    expect(refreshes()).toEqual([])
    fireEvent.focus(window)
    expect(refreshes()).toEqual([
      { method: 'POST', path: '/groups/g1/bots/b1/git/refresh', body: { fetch: false } },
    ])
    vi.setSystemTime(new Date('2026-10-15T02:00:20.000Z'))
    fireEvent.focus(window)
    expect(refreshes()).toHaveLength(1)
    vi.setSystemTime(new Date('2026-10-15T02:00:31.000Z'))
    fireEvent.focus(window)
    expect(refreshes()).toHaveLength(2)
    await vi.advanceTimersByTimeAsync(30_000)
    expect(refreshes()).toHaveLength(3)
    vi.useRealTimers()
  })

  it('does not refresh git on focus outside partition groups with a repo', async () => {
    const calls = mockApi({ 'GET /groups/g1/bot-states': [state('b1', { git: git() })] })
    render(<GitBar group={group({ mode: 'force', botIds: ['b1'] })} />)
    await waitFor(() => expect(calls).toHaveLength(1))
    fireEvent.focus(window)
    expect(calls.filter((c) => c.path.endsWith('/git/refresh'))).toEqual([])
  })

  it('sums sub-repos up in the bar', async () => {
    const sub = (path: string, o: Partial<RepoStatus> = {}): RepoStatus => ({
      path,
      kind: 'submodule',
      branch: 'main',
      ahead: 0,
      behind: 0,
      dirty: false,
      ...o,
    })
    mockApi({
      'GET /groups/g1/bot-states': [
        state('b1', {
          git: git({
            repos: [
              sub('lib', { dirty: true }),
              sub('vendor/x', { branch: null, ahead: 2, behind: 1 }),
              sub('/Users/w/sdk', { kind: 'extra' }),
            ],
          }),
        }),
        state('b2', { git: git({ repos: [sub('lib')] }) }),
        // The root itself is not a repo: the summary stands in for the branch.
        state('b3', {
          git: git({ branch: null, ahead: null, behind: null, repos: [sub('a', { kind: 'nested' })] }),
        }),
      ],
      'GET /groups/g1/git/operations': { operations: [] },
      'POST /groups/g1/bots/b1/git/refresh': undefined,
    })
    useSession.setState({ user: { id: 'u1' } as UserDto })
    useWorkspace.setState({
      bots: [
        { ...bot('b1', '小王的 Claude'), ownerId: 'u1' },
        { ...bot('b2', '老李的 Codex'), ownerId: 'u1' },
        { ...bot('b3', '阿杰的 Claude'), ownerId: 'u1' },
      ],
    })
    useWorkbench.setState({ groupId: 'g1', benches: {} })
    render(<GitBar group={group({ botIds: ['b1', 'b2', 'b3'] })} />)
    expect((await screen.findByRole('button', { name: '打开 小王的 Claude 的 Git' })).textContent).toBe(
      'main · 2 个子仓库有改动',
    )
    expect(screen.getByRole('button', { name: '打开 老李的 Codex 的 Git' }).textContent).toBe(
      'main · 1 个子仓库',
    )
    expect(screen.getByTestId('git-b3').textContent).toBe('阿杰的 Claude1 个子仓库')
  })

  it('outside partition groups shows every bot with its menu and only surfaces context near its limit', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => new Response('[]')),
    )
    render(<GitBar group={group({ mode: 'force', botIds: ['b1', 'b2'] })} />)
    await waitFor(() => expect(fetch).toHaveBeenCalledWith('/api/groups/g1/bot-states', expect.anything()))
    expect(screen.getByRole('button', { name: '小王的 Claude 的工作区' })).toBeTruthy()
    expect(screen.getByRole('button', { name: '老李的 Codex 的工作区' })).toBeTruthy()
    useWorkspace.getState().applyEvent({
      t: 'group.botState',
      groupId: 'g1',
      state: state('b1', { git: git(), context: { used: 50_000, size: 200_000 } }),
    })
    useWorkspace.getState().applyEvent({
      t: 'group.botState',
      groupId: 'g1',
      state: state('b2', { git: git(), context: { used: 50_000, size: 200_000 } }),
    })
    await waitFor(() => expect(screen.getByTestId('git-b2').textContent).toBe('老李的 Codex'))
    expect(screen.getByTestId('git-b1').textContent).toBe('小王的 Claude')
    useWorkspace.getState().applyEvent({
      t: 'group.botState',
      groupId: 'g1',
      state: state('b2', { git: git(), context: { used: 150_000, size: 200_000 } }),
    })
    await waitFor(() => expect(screen.getByTestId('git-b2').textContent).toBe('老李的 Codex75%'))
  })

  it('heads the menu with 执行位置 in a group without a repo: the repo row says so, base branch is hidden', async () => {
    useWorkspace.setState({ bots: [{ ...bot('b1', '小王的 Claude'), machineName: '王磊的 MacBook' }] })
    const writeText = vi.fn(async () => {})
    vi.stubGlobal('navigator', { ...navigator, clipboard: { writeText } })
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => new Response(JSON.stringify([state('b1', { path: '/w/b1', git: null })]))),
    )
    render(<GitBar group={group({ kind: 'dm', mode: 'force', repo: null, botIds: ['b1'] })} />)
    const panel = await menu('小王的 Claude')
    expect(within(panel).getByText('未绑定仓库')).toBeTruthy()
    expect(within(panel).getByText('王磊的 MacBook')).toBeTruthy()
    expect(within(panel).getByText('/w/b1')).toBeTruthy()
    expect(within(panel).queryByText('基准')).toBeNull()
    fireEvent.click(within(panel).getByRole('button', { name: '复制目录' }))
    expect(writeText).toHaveBeenCalledWith('/w/b1')
  })
})

describe('context meter', () => {
  const posted = () =>
    vi
      .mocked(fetch)
      .mock.calls.filter(([url]) => url === '/api/groups/g1/messages')
      .map(([, init]) => JSON.parse(String(init?.body)).body)

  it('hides healthy occupancy, shows warning and critical, and offers /compact and /new', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(async (url: string) =>
        url.endsWith('/bot-states')
          ? new Response(
              JSON.stringify([
                state('b1', { git: git(), context: { used: 124_000, size: 200_000 } }),
                state('b2', { git: git(), context: { used: 190_000, size: 200_000 } }),
                state('b3', { git: git(), context: { used: 800_000, size: 1_000_000 } }),
              ]),
            )
          : new Response(JSON.stringify({ id: 'm1' })),
      ),
    )
    render(<GitBar group={group({ botIds: ['b1', 'b2', 'b3'] })} />)
    await screen.findByRole('button', { name: '老李的 Codex 上下文 190k / 200k' })
    expect(screen.queryByRole('button', { name: '小王的 Claude 上下文 124k / 200k' })).toBeNull()
    expect(screen.getByRole('button', { name: '老李的 Codex 上下文 190k / 200k' }).dataset.level).toBe(
      'critical',
    )
    const meter = screen.getByRole('button', { name: '阿杰的 Claude 上下文 800k / 1M' })
    expect(meter.dataset.level).toBe('warning')

    fireEvent.click(meter)
    fireEvent.click(await screen.findByRole('button', { name: '压缩上下文' }))
    await waitFor(() => expect(posted()).toEqual(['/compact @阿杰的 Claude']))
    fireEvent.click(meter)
    fireEvent.click(await screen.findByRole('button', { name: '开新对话' }))
    await waitFor(() => expect(posted()).toEqual(['/compact @阿杰的 Claude', '/new @阿杰的 Claude']))
  })

  it('counts down to auto-compaction and warns 20k before it', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(
        async () =>
          new Response(
            JSON.stringify([
              state('b1', { git: git(), context: { used: 50_000, size: 200_000, compactAt: 167_000 } }),
              state('b2', { git: git(), context: { used: 50_000, size: 200_000 } }),
              state('b3', { git: git(), context: { used: 150_000, size: 200_000, compactAt: 167_000 } }),
            ]),
          ),
      ),
    )
    render(<GitBar group={group({ botIds: ['b1', 'b2', 'b3'] })} />)
    await screen.findByRole('button', { name: '阿杰的 Claude 上下文 150k / 200k' })
    expect(screen.queryByRole('button', { name: '小王的 Claude 上下文 50k / 200k' })).toBeNull()
    const meter = screen.getByRole('button', { name: '阿杰的 Claude 上下文 150k / 200k' })
    expect(meter.getAttribute('title')).toContain('还剩 17k 自动压缩')
    expect(meter.dataset.level).toBe('warning')
    expect(meter.querySelector('.ctx-meter__mark')).toBeTruthy()
    fireEvent.click(meter)
    expect(await screen.findByText(/还剩 17k 自动压缩/)).toBeTruthy()
    expect(screen.queryByText(/即将用满/)).toBeNull()
  })

  it('says the agent stops at blockAt when auto-compaction is off', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(
        async () =>
          new Response(
            JSON.stringify([
              state('b1', { git: git(), context: { used: 100_000, size: 200_000, blockAt: 197_000 } }),
              state('b2', { git: git(), context: { used: 180_000, size: 200_000, blockAt: 197_000 } }),
            ]),
          ),
      ),
    )
    render(<GitBar group={group({ botIds: ['b1', 'b2'] })} />)
    const full = await screen.findByRole('button', { name: '老李的 Codex 上下文 180k / 200k' })
    expect(screen.queryByRole('button', { name: '小王的 Claude 上下文 100k / 200k' })).toBeNull()
    expect(full.dataset.level).toBe('critical')
    fireEvent.click(full)
    expect(
      await screen.findByText(/已关闭自动压缩，用到 197k 时 Agent 会停下，需要手动压缩或开新对话/),
    ).toBeTruthy()
    expect(screen.getByText(/即将停下/)).toBeTruthy()
    expect(screen.queryByText(/自动压缩。$|Agent 会自动压缩/)).toBeNull()
  })

  it('sends what to keep along with /compact', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(async (url: string) =>
        url.endsWith('/bot-states')
          ? new Response(
              JSON.stringify([state('b1', { git: git(), context: { used: 180_000, size: 200_000 } })]),
            )
          : new Response(JSON.stringify({ id: 'm1' })),
      ),
    )
    render(<GitBar group={group({ botIds: ['b1'] })} />)
    fireEvent.click(await screen.findByRole('button', { name: '小王的 Claude 上下文 180k / 200k' }))
    fireEvent.change(await screen.findByRole('textbox', { name: '压缩时保留的重点（可选）' }), {
      target: { value: '  保留接口设计 ' },
    })
    fireEvent.click(screen.getByRole('button', { name: '压缩上下文' }))
    await waitFor(() => expect(posted()).toEqual(['/compact 保留接口设计 @小王的 Claude']))
  })
})

describe('bot state store', () => {
  it('keeps states per group and merges realtime updates', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => new Response(JSON.stringify([state('b1'), state('b2')]))),
    )
    await loadBotStates('g1')
    useWorkspace.getState().applyEvent({ t: 'group.botState', groupId: 'g2', state: state('b1') })
    useWorkspace.getState().applyEvent({
      t: 'group.botState',
      groupId: 'g1',
      state: state('b2', { state: 'failed', error: 'x' }),
    })
    const s = useWorkspace.getState().botStates
    expect(Object.keys(s)).toEqual(['g1', 'g2'])
    expect(s.g1?.b1?.state).toBe('ready')
    expect(s.g1?.b2).toEqual(state('b2', { state: 'failed', error: 'x' }))
  })
})
