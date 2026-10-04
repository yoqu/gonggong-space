import type {
  GroupDto,
  MessageDto,
  RunSyncDone,
  SyncConflictDto,
  SyncReplicaDto,
  SyncStatusDto,
  UserDto,
} from '@gonggong/protocol'
import { act, fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import { MemoryRouter } from 'react-router'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { useSession } from '../src/app/session'
import { useWorkspace } from '../src/app/workspace'
import { ConflictDialog } from '../src/features/sync/ConflictDialog'
import { ConflictEvent, RunSyncLine } from '../src/features/sync/RunSyncLine'
import { SyncBar, useLinkedSync } from '../src/features/sync/SyncBar'
import { SyncModeTab } from '../src/features/sync/SyncModeTab'
import { SyncPanel } from '../src/features/sync/SyncPanel'
import { resetSync } from '../src/features/sync/store'
import { realtime } from '../src/lib/realtime'
import { useToasts } from '../src/ui'
import { mockApi } from './mockApi'

const me = { id: 'u1', account: 'wanglei', name: '王磊', role: 'member' } as UserDto
const h = (c: string) => c.repeat(64)

const replica = (o: Partial<SyncReplicaDto> = {}): SyncReplicaDto => ({
  botId: 'b1',
  botName: 'Claude',
  ownerId: 'u1',
  machineName: 'mbp',
  workspace: 'managed',
  version: 14,
  state: 'consistent',
  updatedAt: null,
  issue: null,
  files: [],
  reason: null,
  ...o,
})

const status = (replicas: SyncReplicaDto[], o: Partial<SyncStatusDto> = {}): SyncStatusDto => ({
  groupId: 'g1',
  headVersion: 15,
  consistent: 0,
  total: replicas.length,
  switching: false,
  replicas,
  ...o,
})

const conflict = (o: Partial<SyncConflictDto> = {}): SyncConflictDto => ({
  id: 'c1',
  botId: 'b1',
  versionBase: 12,
  headVersion: 15,
  files: [{ path: 'src/a.ts', binary: false, mineHash: h('a'), theirsHash: h('b'), baseHash: h('c') }],
  createdAt: '2026-10-04T10:00:00Z',
  ...o,
})

class NoopSocket {
  close() {}
}

beforeEach(() => {
  useSession.setState({ user: me, status: 'ready' })
  useWorkspace.setState({
    bots: [
      { id: 'b1', name: 'Claude', ownerId: 'u1' },
      { id: 'b2', name: 'Codex', ownerId: 'u2' },
    ] as never,
    groups: [{ id: 'g1', members: [{ userId: 'u1', name: '王磊', isAdmin: false }] } as unknown as GroupDto],
  })
  useToasts.setState({ items: [] })
  resetSync()
  vi.stubGlobal('WebSocket', NoopSocket)
})
afterEach(() => {
  vi.unstubAllGlobals()
  vi.restoreAllMocks()
})

const line = (sync: RunSyncDone, botId = 'b1') => render(<RunSyncLine run={{ groupId: 'g1', botId, sync }} />)

describe('run card: a turn waiting for its replica', () => {
  it('local edits: 处理 opens the sync panel focused on the bot', async () => {
    mockApi({ 'GET /groups/g1/sync': status([replica({ state: 'drift', issue: 'drift', files: ['x'] })]) })
    line({ outcome: 'waiting', issue: 'drift' })
    const s = screen.getByTestId('run-sync')
    expect(s.textContent).toContain('等待处理本地改动')
    fireEvent.click(await within(s).findByRole('button', { name: '处理' }))
    expect(await screen.findByRole('dialog', { name: '同步状态' })).toBeTruthy()
    expect((await screen.findByTestId('replica-b1')).className).toContain('sync-row--focus')
  })

  it('a held conflict: 处理 opens the conflict dialog; others see no button', async () => {
    mockApi({
      'GET /groups/g1/sync': status([
        replica({ state: 'conflict', issue: 'held' }),
        replica({ botId: 'b2', botName: 'Codex', ownerId: 'u2', state: 'conflict', issue: 'held' }),
      ]),
      'GET /groups/g1/sync/conflicts': [conflict()],
    })
    const other = line({ outcome: 'waiting', issue: 'held' }, 'b2')
    expect(other.container.textContent).toBe('等待处理同步冲突')
    other.unmount()
    line({ outcome: 'waiting', issue: 'held' })
    fireEvent.click(await screen.findByRole('button', { name: '处理' }))
    expect(await screen.findByText('处理 Claude 的同步冲突')).toBeTruthy()
  })

  it('shows 已处理 once the replica no longer waits', async () => {
    mockApi({ 'GET /groups/g1/sync': status([replica()]) })
    line({ outcome: 'waiting', issue: 'drift' })
    expect(await screen.findByText('已处理')).toBeTruthy()
    expect(screen.queryByRole('button', { name: '处理' })).toBeNull()
  })

  it('does not repeat 同步 in a failure reason', () => {
    mockApi({ 'GET /groups/g1/sync': status([replica()]) })
    expect(line({ outcome: 'error', reason: '同步失败：网络断开' }).container.textContent).toBe(
      '同步失败：网络断开',
    )
  })
})

describe('conflict card', () => {
  const card = (id = 'c1') =>
    render(
      <ConflictEvent
        m={
          {
            groupId: 'g1',
            body: '@Claude 的改动与 v15 冲突：1 个文件',
            syncConflict: { id, botId: 'b1' },
          } as MessageDto & {
            syncConflict: { id: string; botId: string }
          }
        }
      />,
    )

  it('offers 处理 only while the replica is held, then 已处理', async () => {
    mockApi({ 'GET /groups/g1/sync': status([replica({ state: 'conflict', issue: 'held' })]) })
    const held = card()
    expect(await screen.findByRole('button', { name: '处理' })).toBeTruthy()
    held.unmount()
    resetSync()
    mockApi({ 'GET /groups/g1/sync': status([replica()]) })
    card()
    expect(await screen.findByText('已处理')).toBeTruthy()
  })

  it('the dialog opens the conflict by id', async () => {
    mockApi({
      'GET /groups/g1/sync/conflicts': [conflict({ id: 'c0', headVersion: 9 }), conflict({ id: 'c2' })],
    })
    render(<ConflictDialog groupId="g1" botId="b1" conflictId="c2" botName="Claude" onClose={() => {}} />)
    expect(await screen.findByText('基于 v12 的改动与 v15 冲突：1 个文件')).toBeTruthy()
  })
})

describe('a replica whose submit failed', () => {
  const failed = status([
    replica({ state: 'drift', issue: 'error', reason: '文件超过 50 MB', files: ['big.bin'] }),
    replica({ botId: 'b2', ownerId: 'u2', state: 'drift', issue: 'drift' }),
  ])

  it('is flagged apart from local changes and says it retries', async () => {
    mockApi({ 'GET /groups/g1/sync': failed })
    render(<SyncBar group={{ id: 'g1', mode: 'force' }} />)
    const bar = await screen.findByRole('button', { name: /强制同步/ })
    expect(bar.textContent).toContain('1 提交失败')
    expect(bar.textContent).toContain('1 本地有改动')
    fireEvent.click(bar)
    const row = await screen.findByTestId('replica-b1')
    expect(within(row).getByText('提交失败')).toBeTruthy()
    expect(within(row).getByText(/文件超过 50 MB/)).toBeTruthy()
    expect(within(row).getByText(/下一轮会自动重试/)).toBeTruthy()
    expect(within(row).queryByRole('button', { name: '提交本地改动' })).toBeNull()
  })
})

describe('loading the sync status', () => {
  it('the panel spins while loading, shows an error with 重试, and the bar stays hidden', async () => {
    let fail = true
    mockApi({
      'GET /groups/g1/sync': () =>
        fail
          ? new Response(JSON.stringify({ error: 'x', message: '加载失败了' }), { status: 500 })
          : status([replica()]),
    })
    render(<SyncBar group={{ id: 'g1', mode: 'force' }} />)
    render(<SyncPanel groupId="g1" onClose={() => {}} />)
    expect(screen.getByRole('status')).toBeTruthy()
    expect(await screen.findByText('加载失败了')).toBeTruthy()
    expect(screen.queryByRole('button', { name: /强制同步/ })).toBeNull()
    fail = false
    fireEvent.click(screen.getByRole('button', { name: '重试' }))
    expect(await screen.findByTestId('replica-b1')).toBeTruthy()
  })

  it('reloads loaded groups in place after a reconnect', async () => {
    let listener: ((s: string) => void) | undefined
    vi.spyOn(realtime, 'onStatus').mockImplementation((l) => {
      listener = l as never
      return () => {}
    })
    let head = 15
    const calls = mockApi({ 'GET /groups/g1/sync': () => status([replica()], { headVersion: head }) })
    render(<SyncBar group={{ id: 'g1', mode: 'force' }} />)
    await screen.findByRole('button', { name: /v15/ })
    head = 16
    act(() => listener?.('open'))
    expect(screen.getByRole('button', { name: /v15/ })).toBeTruthy()
    expect(await screen.findByRole('button', { name: /v16/ })).toBeTruthy()
    expect(calls.filter((c) => c.path === '/groups/g1/sync')).toHaveLength(2)
  })
})

describe('deep link to a replica', () => {
  function Linked() {
    useLinkedSync('g1')
    return <SyncBar group={{ id: 'g1', mode: 'force' }} />
  }
  it('?sync=<botId> opens the panel focused on that bot', async () => {
    mockApi({ 'GET /groups/g1/sync': status([replica({ state: 'drift', issue: 'drift' })]) })
    render(
      <MemoryRouter initialEntries={['/g/g1?sync=b1']}>
        <Linked />
      </MemoryRouter>,
    )
    expect(await screen.findByRole('dialog', { name: '同步状态' })).toBeTruthy()
    expect((await screen.findByTestId('replica-b1')).className).toContain('sync-row--focus')
  })
})

describe('joining', () => {
  it('a replica left out for uncommitted changes can only discard them and join', async () => {
    mockApi({
      'GET /groups/g1/sync': status([replica({ state: 'excluded', issue: 'dirty', version: null })]),
    })
    render(<SyncPanel groupId="g1" onClose={() => {}} />)
    const row = await screen.findByTestId('replica-b1')
    expect(within(row).queryByRole('button', { name: '加入' })).toBeNull()
    expect(within(row).getByRole('button', { name: '丢弃本地改动并加入' })).toBeTruthy()
    expect(within(row).getByText('或先在本机提交、清理后再加入')).toBeTruthy()
  })

  it('a plain join says it started', async () => {
    const left = status([replica({ state: 'excluded', version: null })])
    mockApi({ 'GET /groups/g1/sync': left, 'POST /groups/g1/sync/replicas/b1/join': left })
    render(<SyncPanel groupId="g1" onClose={() => {}} />)
    fireEvent.click(within(await screen.findByTestId('replica-b1')).getByRole('button', { name: '加入' }))
    await waitFor(() => expect(useToasts.getState().items.map((x) => x.message)).toContain('已开始加入'))
  })
})

describe('switching', () => {
  it('tells admins how to cancel a switch in progress', async () => {
    mockApi({ 'GET /groups/g1/sync': status([replica()], { switching: true }) })
    render(<SyncPanel groupId="g1" isAdmin onClose={() => {}} />)
    expect(await screen.findByText(/可在同步模式设置中切回分区模式以取消/)).toBeTruthy()
  })

  it('the wizard offers 重试 and 取消 when the preview fails', async () => {
    let fail = true
    mockApi({
      'GET /groups/g1/sync/preview': () =>
        fail
          ? new Response(JSON.stringify({ error: 'x', message: '预览失败' }), { status: 500 })
          : { bots: [] },
    })
    const group = {
      id: 'g1',
      name: '支付',
      mode: 'partition',
      repo: { url: 'git@x:y.git', branch: 'main' },
      members: [{ userId: 'u1', name: '王磊', isAdmin: true }],
    } as unknown as GroupDto
    render(<SyncModeTab group={group} />)
    fireEvent.click(screen.getByRole('button', { name: '切换为强制同步' }))
    expect(await screen.findByText('预览失败')).toBeTruthy()
    fail = false
    fireEvent.click(screen.getByRole('button', { name: '重试' }))
    expect(await screen.findByText('切换后各 Bot 的处理方式')).toBeTruthy()
  })

  it('the wizard error 取消 leaves the wizard', async () => {
    mockApi({
      'GET /groups/g1/sync/preview': new Response(JSON.stringify({ error: 'x', message: '预览失败' }), {
        status: 500,
      }),
    })
    const group = {
      id: 'g1',
      name: '支付',
      mode: 'partition',
      repo: { url: 'git@x:y.git', branch: 'main' },
      members: [{ userId: 'u1', name: '王磊', isAdmin: true }],
    } as unknown as GroupDto
    render(<SyncModeTab group={group} />)
    fireEvent.click(screen.getByRole('button', { name: '切换为强制同步' }))
    await screen.findByText('预览失败')
    fireEvent.click(screen.getByRole('button', { name: '取消' }))
    expect(screen.getByRole('button', { name: '切换为强制同步' })).toBeTruthy()
  })
})
