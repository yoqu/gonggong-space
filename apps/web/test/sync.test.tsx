import type {
  GroupDto,
  SyncPreviewDto,
  SyncReplicaDto,
  SyncStatusDto,
  SyncVersionDto,
  UserDto,
} from '@gonggong/protocol'
import { act, fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { useSession } from '../src/app/session'
import { SyncBar } from '../src/features/sync/SyncBar'
import { SyncModeTab } from '../src/features/sync/SyncModeTab'
import { SyncPanel } from '../src/features/sync/SyncPanel'
import { resetSync } from '../src/features/sync/store'
import { realtime } from '../src/lib/realtime'
import { mockApi } from './mockApi'

const replica = (o: Partial<SyncReplicaDto> = {}): SyncReplicaDto => ({
  botId: 'b1',
  botName: 'Claude',
  ownerId: 'u1',
  machineName: 'wanglei-mbp',
  workspace: 'managed',
  issue: null,
  version: 17,
  state: 'consistent',
  updatedAt: new Date(Date.now() - 5 * 60_000).toISOString(),
  files: [],
  reason: null,
  ...o,
})

const status = (o: Partial<SyncStatusDto> = {}): SyncStatusDto => ({
  groupId: 'g1',
  headVersion: 17,
  consistent: 4,
  total: 5,
  switching: false,
  replicas: [
    replica(),
    replica({ botId: 'b2', botName: 'Codex', machineName: 'lin-pc' }),
    replica({ botId: 'b3', botName: 'Gemini' }),
    replica({ botId: 'b4', botName: 'Kimi' }),
    replica({
      botId: 'b5',
      botName: 'Qwen',
      version: 15,
      state: 'conflict',
      files: ['src/a.ts', 'src/b.ts', 'src/c.ts', 'src/d.ts'],
      reason: null,
    }),
  ],
  ...o,
})

const version = (n: number, o: Partial<SyncVersionDto> = {}): SyncVersionDto => ({
  version: n,
  author: { kind: 'bot', id: 'b1', name: 'Claude' },
  runId: null,
  tags: [],
  files: 3,
  createdAt: new Date(Date.now() - 60 * 60_000).toISOString(),
  ...o,
})

class NoopSocket {
  close() {}
}

const me = { id: 'u1', account: 'wanglei', name: '王磊', role: 'member' } as UserDto

beforeEach(() => {
  useSession.setState({ user: me, status: 'ready' })
  resetSync()
  vi.stubGlobal('WebSocket', NoopSocket)
})
afterEach(() => {
  vi.unstubAllGlobals()
  vi.restoreAllMocks()
})

describe('sync status bar', () => {
  it('sums up the head version, consistency and issues of a force group', async () => {
    mockApi({ 'GET /groups/g1/sync': status() })
    render(<SyncBar group={{ id: 'g1', mode: 'force' }} />)
    const bar = await screen.findByRole('button', { name: /强制同步 · v17 · 4\/5 一致/ })
    expect(bar.textContent).toContain('1 冲突')
    expect(bar.textContent).not.toContain('落后')
  })

  it('flags a group still switching to force sync', async () => {
    mockApi({ 'GET /groups/g1/sync': status({ switching: true }) })
    render(<SyncBar group={{ id: 'g1', mode: 'force' }} />)
    expect((await screen.findByRole('button', { name: /强制同步/ })).textContent).toContain('切换中')
  })

  it('is absent from partition groups and loads nothing', () => {
    const calls = mockApi({})
    render(<SyncBar group={{ id: 'g1', mode: 'partition' }} />)
    expect(screen.queryByRole('button')).toBeNull()
    expect(calls).toHaveLength(0)
  })

  it('follows group.sync events', async () => {
    mockApi({ 'GET /groups/g1/sync': status() })
    let push: ((e: never) => void) | undefined
    vi.spyOn(realtime, 'subscribe').mockImplementation((h) => {
      push = h as never
      return () => {}
    })
    render(<SyncBar group={{ id: 'g1', mode: 'force' }} />)
    await screen.findByRole('button', { name: /v17/ })
    act(() =>
      push!({
        t: 'group.sync',
        ...status({
          headVersion: 18,
          consistent: 3,
          replicas: [
            replica({ version: 18 }),
            replica({ botId: 'b2', state: 'syncing' }),
            replica({ botId: 'b3', state: 'behind' }),
            replica({ botId: 'b4', state: 'drift', files: ['x.md'] }),
          ],
        }),
      } as never),
    )
    const bar = screen.getByRole('button', { name: /v18 · 3\/5 一致/ })
    expect(bar.textContent).toContain('1 同步中')
    expect(bar.textContent).toContain('1 落后')
    expect(bar.textContent).toContain('1 本地有改动')
  })

  it('opens the sync panel', async () => {
    mockApi({ 'GET /groups/g1/sync': status() })
    render(<SyncBar group={{ id: 'g1', mode: 'force' }} />)
    fireEvent.click(await screen.findByRole('button', { name: /强制同步/ }))
    expect(await screen.findByRole('dialog', { name: '同步状态' })).toBeTruthy()
  })
})

describe('sync panel', () => {
  it('lists each replica with its machine, version, state and concerned files', async () => {
    mockApi({
      'GET /groups/g1/sync': status({
        replicas: [
          replica(),
          replica({
            botId: 'b2',
            botName: 'Codex',
            machineName: null,
            version: null,
            state: 'excluded',
            files: ['big.bin'],
            reason: '本地有未提交改动',
          }),
          replica({
            botId: 'b5',
            botName: 'Qwen',
            version: 15,
            state: 'conflict',
            files: ['src/a.ts', 'src/b.ts', 'src/c.ts', 'src/d.ts'],
          }),
          replica({ botId: 'b6', botName: 'Kimi', state: 'offline', updatedAt: null }),
        ],
      }),
    })
    render(<SyncPanel groupId="g1" onClose={() => {}} />)
    const claude = await screen.findByTestId('replica-b1')
    expect(within(claude).getByText('Claude')).toBeTruthy()
    expect(within(claude).getByText(/wanglei-mbp/)).toBeTruthy()
    expect(within(claude).getByText('v17')).toBeTruthy()
    expect(within(claude).getByText('一致')).toBeTruthy()
    expect(within(claude).getByText(/5 分钟前/)).toBeTruthy()

    const codex = screen.getByTestId('replica-b2')
    expect(within(codex).getByText('—')).toBeTruthy()
    expect(within(codex).getByText('不参与')).toBeTruthy()
    expect(within(codex).getByText('本地有未提交改动')).toBeTruthy()
    expect(within(codex).getByText(/big\.bin/)).toBeTruthy()

    const qwen = screen.getByTestId('replica-b5')
    expect(within(qwen).getByText('冲突待处理')).toBeTruthy()
    expect(within(qwen).getByText(/src\/a\.ts/).textContent).not.toContain('src/d.ts')
    expect(within(qwen).getByText(/等 4 个文件/)).toBeTruthy()

    expect(within(screen.getByTestId('replica-b6')).getByText('离线')).toBeTruthy()
  })

  it('pages through the version history', async () => {
    const first = Array.from({ length: 50 }, (_, i) => version(60 - i))
    const calls = mockApi({
      'GET /groups/g1/sync': status(),
      'GET /groups/g1/sync/versions?limit=50': [
        version(61, { author: { kind: 'user', id: 'u1', name: '王磊' }, tags: ['local'], files: 1 }),
        version(60, { tags: ['auto_merge', 'interrupted'] }),
        ...first.slice(2),
      ],
      'GET /groups/g1/sync/versions?before=11&limit=50': [version(12), version(1, { tags: ['init'] })],
    })
    render(<SyncPanel groupId="g1" onClose={() => {}} />)
    fireEvent.click(await screen.findByRole('tab', { name: '版本历史' }))
    const v61 = await screen.findByTestId('version-61')
    expect(within(v61).getByText('v61')).toBeTruthy()
    expect(within(v61).getByText(/王磊/)).toBeTruthy()
    expect(within(v61).getByText(/1 个文件/)).toBeTruthy()
    expect(within(v61).getByText('本地修改')).toBeTruthy()
    const v60 = screen.getByTestId('version-60')
    expect(within(v60).getByText('自动合并')).toBeTruthy()
    expect(within(v60).getByText('中断')).toBeTruthy()

    fireEvent.click(screen.getByRole('button', { name: '加载更多' }))
    const v1 = await screen.findByTestId('version-1')
    expect(within(v1).getByText('初始')).toBeTruthy()
    expect(calls.map((c) => c.path)).toContain('/groups/g1/sync/versions?before=11&limit=50')
    await waitFor(() => expect(screen.queryByRole('button', { name: '加载更多' })).toBeNull())
  })
})

describe('joining a left-out replica', () => {
  const left = status({
    replicas: [
      replica({
        botId: 'b1',
        botName: 'Claude',
        ownerId: 'u1',
        state: 'excluded',
        issue: 'dirty',
        files: ['wip.ts'],
        version: null,
      }),
      replica({ botId: 'b2', botName: 'Codex', ownerId: 'u2', state: 'excluded', version: null }),
      replica({
        botId: 'b3',
        botName: 'Kimi',
        ownerId: 'u2',
        state: 'excluded',
        workspace: 'cd',
        version: null,
      }),
    ],
  })

  it('offers 加入 and 丢弃本地改动并加入 to the bot owner; a group admin may join any managed replica', async () => {
    mockApi({ 'GET /groups/g1/sync': left })
    const { unmount } = render(<SyncPanel groupId="g1" onClose={() => {}} />)
    const mine = await screen.findByTestId('replica-b1')
    expect(within(mine).getByText('有未提交的改动')).toBeTruthy()
    expect(within(mine).getByRole('button', { name: '加入' })).toBeTruthy()
    expect(within(mine).getByRole('button', { name: '丢弃本地改动并加入' })).toBeTruthy()
    expect(within(screen.getByTestId('replica-b2')).queryByRole('button', { name: '加入' })).toBeNull()
    expect(within(screen.getByTestId('replica-b2')).getByText('未加入')).toBeTruthy()
    unmount()

    render(<SyncPanel groupId="g1" isAdmin onClose={() => {}} />)
    expect(within(await screen.findByTestId('replica-b2')).getByRole('button', { name: '加入' })).toBeTruthy()
    const cd = screen.getByTestId('replica-b3')
    expect(within(cd).getByText('本机目录')).toBeTruthy()
    expect(within(cd).queryByRole('button', { name: '加入' })).toBeNull()
  })

  it('joins as is, or discards local changes after a confirmation that they are backed up first', async () => {
    const calls = mockApi({
      'GET /groups/g1/sync': left,
      'POST /groups/g1/sync/replicas/b1/join': left,
    })
    render(<SyncPanel groupId="g1" onClose={() => {}} />)
    const mine = await screen.findByTestId('replica-b1')
    fireEvent.click(within(mine).getByRole('button', { name: '加入' }))
    await waitFor(() =>
      expect(calls.filter((c) => c.method === 'POST').map((c) => c.body)).toEqual([{ force: false }]),
    )
    fireEvent.click(within(mine).getByRole('button', { name: '丢弃本地改动并加入' }))
    const dlg = await screen.findByRole('alertdialog')
    expect(within(dlg).getByText(/先备份到本机/)).toBeTruthy()
    fireEvent.click(within(dlg).getByRole('button', { name: '丢弃并加入' }))
    await waitFor(() =>
      expect(calls.filter((c) => c.method === 'POST').map((c) => c.body)).toEqual([
        { force: false },
        { force: true },
      ]),
    )
  })

  it('leads group admins to the mode settings', async () => {
    mockApi({ 'GET /groups/g1/sync': status() })
    const onSettings = vi.fn()
    render(<SyncPanel groupId="g1" isAdmin onSettings={onSettings} onClose={() => {}} />)
    fireEvent.click(await screen.findByRole('button', { name: '同步模式设置' }))
    expect(onSettings).toHaveBeenCalled()
  })
})

const group = (o: Partial<GroupDto> = {}) =>
  ({
    id: 'g1',
    name: '支付服务',
    kind: 'group',
    mode: 'partition',
    repo: { url: 'git@git.corp:pay/pay.git', branch: 'main' },
    members: [
      { userId: 'u1', name: '王磊', isAdmin: true },
      { userId: 'u2', name: '李建国', isAdmin: false },
    ],
    ...o,
  }) as GroupDto

const preview: SyncPreviewDto = {
  bots: [
    {
      botId: 'b1',
      botName: 'Claude',
      machineName: 'wanglei-mbp',
      plan: 'align',
      reason: null,
      canBase: true,
    },
    {
      botId: 'b2',
      botName: 'Codex',
      machineName: 'lin-pc',
      plan: 'excluded',
      reason: 'dirty',
      canBase: true,
    },
    { botId: 'b3', botName: 'Kimi', machineName: 'lin-pc', plan: 'excluded', reason: 'cd', canBase: false },
    { botId: 'b4', botName: 'Qwen', machineName: null, plan: 'align', reason: 'offline', canBase: false },
  ],
}

describe('sync mode settings', () => {
  it('switches to force sync: pick the base, preview each bot, confirm', async () => {
    const calls = mockApi({
      'GET /groups/g1/sync/preview': preview,
      'POST /groups/g1/sync/enable': group({ mode: 'force' }),
    })
    render(<SyncModeTab group={group()} />)
    fireEvent.click(screen.getByRole('button', { name: '切换为强制同步' }))
    expect(within(await screen.findByTestId('plan-b1')).getByText('对齐')).toBeTruthy()
    expect(within(screen.getByTestId('plan-b2')).getByText('不参与（有未提交的改动）')).toBeTruthy()
    expect(within(screen.getByTestId('plan-b3')).getByText('不参与（本机目录）')).toBeTruthy()
    expect(within(screen.getByTestId('plan-b4')).getByText('对齐（机器离线，上线后对齐）')).toBeTruthy()
    const confirm = screen.getByRole('button', { name: '确认切换' })
    expect(confirm.hasAttribute('disabled')).toBe(true)

    fireEvent.click(screen.getByRole('button', { name: '基准 Bot' }))
    expect(screen.queryByRole('menuitemcheckbox', { name: 'Kimi' })).toBeNull()
    fireEvent.click(screen.getByRole('menuitemcheckbox', { name: 'Claude' }))
    expect(within(screen.getByTestId('plan-b1')).getByText('基准')).toBeTruthy()
    fireEvent.click(confirm)
    await waitFor(() =>
      expect(calls.find((c) => c.method === 'POST')).toMatchObject({
        path: '/groups/g1/sync/enable',
        body: { baseBotId: 'b1' },
      }),
    )
  })

  it('cannot switch without a repo', () => {
    mockApi({})
    render(<SyncModeTab group={group({ repo: null })} />)
    expect(screen.getByRole('button', { name: '切换为强制同步' }).hasAttribute('disabled')).toBe(true)
    expect(screen.getByText('绑定仓库后才能切换为强制同步')).toBeTruthy()
  })

  it('switches back to partition after a confirmation', async () => {
    const calls = mockApi({
      'GET /groups/g1/sync': status(),
      'POST /groups/g1/sync/disable': group(),
    })
    render(<SyncModeTab group={group({ mode: 'force' })} />)
    expect(await screen.findByText('v17 · 4/5 一致')).toBeTruthy()
    fireEvent.click(screen.getByRole('button', { name: '切回分区模式' }))
    const dlg = await screen.findByRole('alertdialog')
    expect(within(dlg).getByText('各 Bot 保留当前文件，此后各自独立工作')).toBeTruthy()
    fireEvent.click(within(dlg).getByRole('button', { name: '切回分区模式' }))
    await waitFor(() => expect(calls.some((c) => c.path === '/groups/g1/sync/disable')).toBe(true))
  })

  it('is read-only for members who are not group admins', () => {
    useSession.setState({ user: { ...me, id: 'u2' }, status: 'ready' })
    mockApi({})
    render(<SyncModeTab group={group()} />)
    expect(screen.getByRole('button', { name: '切换为强制同步' }).hasAttribute('disabled')).toBe(true)
    expect(screen.getByText('仅群管理员可切换同步模式')).toBeTruthy()
  })
})
