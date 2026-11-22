import type {
  BotDto,
  GitChangesDto,
  GitCompareDto,
  GitConflictDto,
  GroupDto,
  MachineDto,
  RunDetailDto,
  RunDto,
  UserDto,
} from '@gonggong/protocol'
import { TERMINAL_DIR_FEATURE, TERMINAL_FEATURE } from '@gonggong/protocol'
import { act, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { useSession } from '../src/app/session'
import { useWorkbench } from '../src/app/workbench'
import { useWorkspace } from '../src/app/workspace'
import { AddTabDialog } from '../src/features/group-tabs/AddTabDialog'
import { machineSupportsTerminal } from '../src/features/terminal/spaces'
import { NewTabMenu } from '../src/features/workbench/NewTabMenu'
import { FilesTab } from '../src/features/workbench/tabs/FilesTab'
import { GitMergeTab } from '../src/features/workbench/tabs/GitMergeTab'
import { GitTab } from '../src/features/workbench/tabs/GitTab'
import { LinkTab } from '../src/features/workbench/tabs/LinkTab'
import { OpenWith } from '../src/features/workbench/tabs/OpenWith'
import { RunTab } from '../src/features/workbench/tabs/RunTab'
import { BASE, CHANGES, resetStores, routes, state, status } from './gitFixtures'
import { apiError, mockApi } from './mockApi'

beforeEach(() => {
  resetStores()
  useSession.setState({ user: { id: 'u1', name: '王磊', role: 'member' } as UserDto, status: 'ready' })
})
afterEach(() => {
  vi.unstubAllGlobals()
  vi.restoreAllMocks()
})

describe('Slice 4 Round 2 consolidation', () => {
  it('R2-P0-5: OpenLinkDialog & AddTabDialog reject malformed URLs and LinkTab handles bad URL safely', async () => {
    const group = { id: 'g1', kind: 'group', name: '研发群', botIds: [] } as unknown as GroupDto
    useWorkspace.setState({ groups: [group], bots: [], machines: [] })
    useWorkbench.setState({ groupId: 'g1', open: true, mode: 'split', benches: {} })

    const { unmount } = render(
      <NewTabMenu>
        <span>+</span>
      </NewTabMenu>,
    )
    fireEvent.click(screen.getByRole('button', { name: '新建标签页' }))
    fireEvent.click(screen.getByRole('menuitem', { name: '打开网页…' }))
    const input = await screen.findByPlaceholderText('https://')
    fireEvent.change(input, { target: { value: 'http://[bad' } })
    const openBtn = screen.getByRole('button', { name: '打开' }) as HTMLButtonElement
    expect(openBtn.disabled).toBe(true)
    unmount()

    mockApi({ 'GET /groups/g1/knowledge': [] })
    const add = render(<AddTabDialog group={group} onClose={() => {}} />)
    const urlInput = screen.getByRole('textbox', { name: '链接地址' })
    fireEvent.change(urlInput, { target: { value: 'https://[bad' } })
    expect((screen.getByRole('button', { name: '添加' }) as HTMLButtonElement).disabled).toBe(true)
    add.unmount()

    const { container } = render(
      <LinkTab tab={{ kind: 'link', url: 'http://[bad', title: 'Bad Link' }} tabKey="link:bad" active />,
    )
    const iframe = container.querySelector('iframe')
    expect(iframe).toBeTruthy()
    expect(iframe?.getAttribute('sandbox')).not.toContain('allow-same-origin')
  })

  it('R2-P0-7: RunTab context view shows totalTokens on a purged run without input/output breakdown', async () => {
    useWorkspace.setState({ bots: [] })
    const r: RunDto = {
      id: 'r-purged',
      groupId: 'g1',
      botId: 'b1',
      triggerMessageId: 'm1',
      triggerUserId: 'u1',
      hop: 1,
      status: 'completed',
      step: '',
      filesChanged: 0,
      usage: { totalTokens: 1500 },
      newSessionReason: null,
      queuedAt: '2026-10-18T02:00:00Z',
      startedAt: '2026-10-18T02:00:01Z',
      endedAt: '2026-10-18T02:01:00Z',
      lastActivityAt: '2026-10-18T02:01:00Z',
      parentRunId: null,
      hopMax: 3,
      offlineWaitMin: 30,
      originUserId: 'u1',
      questions: [],
      approvals: [],
      interrupt: null,
      stoppedBy: null,
      delegation: { subagents: 0, subagentsRunning: 0, tasksRunning: 0 },
      model: null,
      effort: null,
    }
    const d: RunDetailDto = {
      run: r,
      patch: null,
      purged: true,
      settings: null,
      patchRepos: [],
      sessionId: null,
      retentionDays: 30,
      events: [],
    }
    mockApi({
      'GET /runs/r-purged': d,
      'GET /runs/r-purged/session': { rounds: [] },
    })
    render(
      <RunTab
        tab={{ kind: 'run', runId: 'r-purged', view: 'context', file: null }}
        tabKey="run:r-purged"
        active
      />,
    )
    expect(await screen.findByText('本轮共 2k tokens，分项已随过程清理')).toBeTruthy()
  })

  it('R2-P0-8: FilesTab compare refreshes when bot git stamp updates for live worktree', async () => {
    useWorkspace.setState({
      groups: [{ id: 'g1', mode: 'partition', repo: { url: 'git@x:y.git', branch: 'main' } } as never],
      bots: [{ id: 'b1', name: 'Bot', ownerId: 'u1', machineId: 'm1' } as BotDto],
      botStates: { g1: { b1: state({ git: status({ head: 'aaa1111' }) }) } },
    })
    let compareCalls = 0
    mockApi({
      'GET /groups/g1/bots/b1/files/tree?path=': {
        entries: [{ name: 'a.ts', dir: false, size: 10 }],
        truncated: false,
      },
      [`GET ${BASE}/compare?from=main`]: (): GitCompareDto => {
        compareCalls++
        return {
          changes: compareCalls === 1 ? [] : [{ path: 'a.ts', change: 'modified', oldPath: null }],
        }
      },
    })
    render(
      <FilesTab
        tab={{ kind: 'files', botId: 'b1', dir: '', selected: null, base: 'main', rev: null }}
        tabKey="files:b1"
        active
      />,
    )
    await waitFor(() => expect(compareCalls).toBe(1))
    act(() => {
      useWorkspace.setState({
        botStates: { g1: { b1: state({ git: status({ dirty: true, dirtyCount: 4 }) }) } },
      })
    })
    await waitFor(() => expect(compareCalls).toBe(2))
  })

  it('R2-P1-5: GitTab on log view calls refreshGitQuietly only once (not twice)', async () => {
    useWorkspace.setState({
      bots: [{ id: 'b1', name: 'Bot', ownerId: 'u1', machineId: 'm1' } as BotDto],
      botStates: { g1: { b1: state({ git: status() }) } },
    })
    const calls = mockApi(
      routes({
        [`GET ${BASE}/changes`]: CHANGES,
        [`GET ${BASE}/log`]: { commits: [], hasMore: false },
        [`GET ${BASE}/refs`]: { branches: [], tags: [], remotes: [] },
        [`POST ${BASE}/refresh`]: {},
      }),
    )
    render(
      <GitTab
        tab={{ kind: 'git', botId: 'b1', repo: null, view: 'log', file: null }}
        tabKey="git:b1"
        active
      />,
    )
    await waitFor(() =>
      expect(calls.filter((c) => c.method === 'POST' && c.path === `${BASE}/refresh`)).toHaveLength(1),
    )
  })

  it('R2-P1-8: GitMergeTab shows retry button on conflict read error and disables SideCard buttons while resolving', async () => {
    const merging: GitChangesDto = {
      ...CHANGES,
      changes: [],
      conflicts: [{ path: 'bin.dat', ours: 'modified', theirs: 'deleted' }],
      ongoing: { kind: 'merge', subject: 'feat/x', step: null, total: null, message: null },
    }
    const binaryConflict: GitConflictDto = {
      base: null,
      ours: null,
      theirs: null,
      merged: null,
      binary: true,
    }
    let fail = true
    let resolvePending: (() => void) | undefined
    mockApi(
      routes({
        [`GET ${BASE}/changes`]: merging,
        [`GET ${BASE}/conflict?path=bin.dat`]: () =>
          fail ? apiError(500, 'err', '读取冲突出错') : binaryConflict,
        [`POST ${BASE}/actions`]: () =>
          new Promise((resolve) => {
            resolvePending = () => resolve({ id: 'op1', status: 'succeeded' })
          }),
      }),
    )
    useWorkspace.setState({
      botStates: { g1: { b1: state({ git: status({ ongoing: 'merge', conflicts: 1 }) }) } },
    })
    render(
      <GitMergeTab
        tab={{ kind: 'git-merge', botId: 'b1', repo: null, path: 'bin.dat' }}
        tabKey="git-merge:b1::bin.dat"
        active
      />,
    )
    await screen.findByText('读取冲突出错')
    fail = false
    fireEvent.click(screen.getByRole('button', { name: '重试' }))
    const keepOurs = await screen.findByRole('button', { name: '保留你的版本' })
    const keepTheirs = screen.getByRole('button', { name: '保留他们的版本' })
    fireEvent.click(keepOurs)
    expect((keepOurs as HTMLButtonElement).disabled).toBe(true)
    expect((keepTheirs as HTMLButtonElement).disabled).toBe(true)
    resolvePending?.()
  })

  it('R2-P1-9: OpenWith survives localStorage throwing SecurityError', async () => {
    vi.spyOn(Storage.prototype, 'getItem').mockImplementation(() => {
      throw new DOMException('blocked', 'SecurityError')
    })
    vi.spyOn(Storage.prototype, 'setItem').mockImplementation(() => {
      throw new DOMException('blocked', 'SecurityError')
    })
    const calls = mockApi({
      'GET /groups/g1/bots/b1/open-apps': { apps: ['finder', 'cursor'] },
      'POST /groups/g1/bots/b1/open': undefined,
    })
    render(<OpenWith groupId="g1" botId="b1" />)
    await screen.findByRole('button', { name: '用 访达 打开' })
    fireEvent.click(screen.getByRole('button', { name: '选择打开方式' }))
    fireEvent.click(screen.getByRole('menuitem', { name: 'Cursor' }))
    await waitFor(() =>
      expect(calls).toContainEqual({
        method: 'POST',
        path: '/groups/g1/bots/b1/open',
        body: { app: 'cursor' },
      }),
    )
  })

  it('R2-P1-3: machineSupportsTerminal requires online macOS/Linux with the requested feature', () => {
    const base = {
      online: true,
      os: 'macos',
      features: [TERMINAL_FEATURE, TERMINAL_DIR_FEATURE],
    } as MachineDto
    expect(machineSupportsTerminal(base)).toBe(true)
    expect(machineSupportsTerminal(base, TERMINAL_DIR_FEATURE)).toBe(true)
    expect(machineSupportsTerminal({ ...base, os: 'linux' })).toBe(true)
    expect(machineSupportsTerminal({ ...base, os: 'windows' })).toBe(false)
    expect(machineSupportsTerminal({ ...base, online: false })).toBe(false)
    expect(machineSupportsTerminal({ ...base, features: [TERMINAL_FEATURE] }, TERMINAL_DIR_FEATURE)).toBe(
      false,
    )
    expect(machineSupportsTerminal(undefined)).toBe(false)
  })
})
