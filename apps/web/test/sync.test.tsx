import type { SyncReplicaDto, SyncStatusDto, SyncVersionDto } from '@gonggong/protocol'
import { act, fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { SyncBar } from '../src/features/sync/SyncBar'
import { SyncPanel } from '../src/features/sync/SyncPanel'
import { resetSync } from '../src/features/sync/store'
import { realtime } from '../src/lib/realtime'
import { mockApi } from './mockApi'

const replica = (o: Partial<SyncReplicaDto> = {}): SyncReplicaDto => ({
  botId: 'b1',
  botName: 'Claude',
  machineName: 'wanglei-mbp',
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

beforeEach(() => {
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
