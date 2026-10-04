import type {
  GroupDto,
  RunSyncDone,
  SyncConflictDto,
  SyncReplicaDto,
  SyncStatusDto,
  UserDto,
} from '@gonggong/protocol'
import { fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { useSession } from '../src/app/session'
import { useWorkspace } from '../src/app/workspace'
import { ConflictDialog } from '../src/features/sync/ConflictDialog'
import { lineDiff } from '../src/features/sync/diff'
import { RunSyncLine } from '../src/features/sync/RunSyncLine'
import { SyncPanel } from '../src/features/sync/SyncPanel'
import { resetSync } from '../src/features/sync/store'
import { mockApi } from './mockApi'

const me = { id: 'u1', account: 'wanglei', name: '王磊', role: 'member' } as UserDto
const h = (c: string) => c.repeat(64)

const conflict: SyncConflictDto = {
  id: 'c1',
  botId: 'b1',
  versionBase: 12,
  headVersion: 15,
  files: [
    { path: 'src/a.ts', binary: false, mineHash: h('a'), theirsHash: h('b'), baseHash: h('c') },
    { path: 'logo.png', binary: true, mineHash: h('d'), theirsHash: h('e'), baseHash: h('f') },
  ],
  createdAt: '2026-10-04T10:00:00Z',
}

const replica = (o: Partial<SyncReplicaDto>): SyncReplicaDto => ({
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
  reasonI18n: null,
  ...o,
})

const status = (replicas: SyncReplicaDto[]): SyncStatusDto => ({
  groupId: 'g1',
  headVersion: 15,
  consistent: 0,
  total: replicas.length,
  switching: false,
  replicas,
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
  resetSync()
  vi.stubGlobal('WebSocket', NoopSocket)
})
afterEach(() => {
  vi.unstubAllGlobals()
  vi.restoreAllMocks()
})

describe('line diff', () => {
  it('keeps common lines and marks removals and additions', () => {
    expect(lineDiff('a\nb\nc\n', 'a\nB\nc\nd\n')).toEqual([' a', '+B', '-b', ' c', '+d'])
    expect(lineDiff('', 'x\n')).toEqual(['+x'])
  })
})

describe('conflict dialog', () => {
  it('lists the files; binary ones have no preview and cannot go to the bot; decisions are posted', async () => {
    const calls = mockApi({
      'GET /groups/g1/sync/conflicts': [conflict],
      'POST /groups/g1/sync/conflicts/c1/resolve': { ok: true },
    })
    const onClose = vi.fn()
    render(<ConflictDialog groupId="g1" botId="b1" botName="Claude" onClose={onClose} />)
    const text = await screen.findByTestId('conflict-src/a.ts')
    expect(screen.getByText('基于 v12 的改动与 v15 冲突：2 个文件')).toBeTruthy()
    const bin = screen.getByTestId('conflict-logo.png')
    expect(within(bin).getByText('二进制文件')).toBeTruthy()
    expect(within(bin).queryByRole('button', { name: '预览' })).toBeNull()
    expect((within(bin).getByRole('radio', { name: '交给 Bot 合并' }) as HTMLButtonElement).disabled).toBe(
      true,
    )

    const submit = screen.getByRole('button', { name: '提交' }) as HTMLButtonElement
    expect(submit.disabled).toBe(true)
    fireEvent.click(within(text).getByRole('radio', { name: '交给 Bot 合并' }))
    fireEvent.click(within(bin).getByRole('radio', { name: '采用最新' }))
    expect(screen.getByText(/写入冲突标记/)).toBeTruthy()
    fireEvent.click(submit)
    await waitFor(() => expect(onClose).toHaveBeenCalled())
    expect(calls.find((c) => c.method === 'POST')?.body).toEqual({
      decisions: [
        { path: 'src/a.ts', choice: 'bot' },
        { path: 'logo.png', choice: 'theirs' },
      ],
    })
  })

  it('previews my change and the latest change against the base', async () => {
    const calls = mockApi({
      'GET /groups/g1/sync/conflicts': [conflict],
      [`GET /groups/g1/sync/conflicts/c1/blobs/${h('c')}`]: new Response('one\ntwo\n'),
      [`GET /groups/g1/sync/conflicts/c1/blobs/${h('a')}`]: new Response('one mine\ntwo\n'),
      [`GET /groups/g1/sync/conflicts/c1/blobs/${h('b')}`]: new Response('one\ntwo theirs\n'),
    })
    render(<ConflictDialog groupId="g1" botId="b1" botName="Claude" onClose={() => {}} />)
    const row = await screen.findByTestId('conflict-src/a.ts')
    fireEvent.click(within(row).getByRole('button', { name: '预览' }))
    expect(await within(row).findByText('我的改动（相对 v12）')).toBeTruthy()
    expect(within(row).getByText('最新版本的改动（v15）')).toBeTruthy()
    expect(within(row).getByText('+one mine')).toBeTruthy()
    expect(within(row).getByText('+two theirs')).toBeTruthy()
    expect(calls.filter((c) => c.path.includes('/blobs/'))).toHaveLength(3)
  })

  it('discards the whole change after a confirmation', async () => {
    const calls = mockApi({
      'GET /groups/g1/sync/conflicts': [conflict],
      'POST /groups/g1/sync/conflicts/c1/discard': { ok: true },
    })
    render(<ConflictDialog groupId="g1" botId="b1" botName="Claude" onClose={() => {}} />)
    await screen.findByTestId('conflict-src/a.ts')
    fireEvent.click(screen.getByRole('button', { name: '整版丢弃' }))
    const dlg = await screen.findByRole('alertdialog')
    expect(within(dlg).getByText(/先备份到本机/)).toBeTruthy()
    fireEvent.click(within(dlg).getByRole('button', { name: '整版丢弃' }))
    await waitFor(() =>
      expect(calls.some((c) => c.path === '/groups/g1/sync/conflicts/c1/discard')).toBe(true),
    )
  })

  it('says so when the conflict was already resolved', async () => {
    mockApi({ 'GET /groups/g1/sync/conflicts': [] })
    render(<ConflictDialog groupId="g1" botId="b1" botName="Claude" onClose={() => {}} />)
    expect(await screen.findByText('冲突已处理')).toBeTruthy()
  })
})

describe('run card sync line', () => {
  const line = (sync: RunSyncDone | null, botId = 'b1') =>
    render(<RunSyncLine run={{ groupId: 'g1', botId, sync }} />).container.textContent

  it('tells how the turn went in', () => {
    expect(line({ outcome: 'accepted', version: 15, merged: false })).toBe('提交为 v15')
    expect(line({ outcome: 'accepted', version: 15, merged: true })).toBe('提交为 v15（自动合并）')
    expect(line({ outcome: 'unchanged', version: 14 })).toBe('无文件改动 · v14')
    expect(line({ outcome: 'error', reason: '超过单版体积上限', reasonI18n: null })).toBe(
      '同步失败：超过单版体积上限',
    )
    expect(line(null)).toBe('')
    expect(line({ outcome: 'waiting', issue: 'drift' })).toBe('等待处理本地改动')
  })

  it('a held turn offers 处理 to the bot owner or a group admin only', async () => {
    mockApi({
      'GET /groups/g1/sync': status([
        replica({ state: 'conflict', issue: 'held' }),
        replica({ botId: 'b2', botName: 'Codex', ownerId: 'u2', state: 'conflict', issue: 'held' }),
      ]),
      'GET /groups/g1/sync/conflicts': [conflict],
    })
    render(<RunSyncLine run={{ groupId: 'g1', botId: 'b1', sync: { outcome: 'held', files: 2 } }} />)
    const settle = await screen.findByRole('button', { name: '处理' })
    expect(line({ outcome: 'held', files: 2 }, 'b2')).toBe('冲突待处理 · 2 个文件')
    fireEvent.click(settle)
    expect(await screen.findByText('处理 Claude 的同步冲突')).toBeTruthy()
  })
})

describe('sync panel actions', () => {
  it('local edits: the owner submits them, or discards them after a confirmation', async () => {
    const calls = mockApi({
      'GET /groups/g1/sync': status([
        replica({ state: 'drift', issue: 'drift', files: ['a.txt'] }),
        replica({ botId: 'b2', botName: 'Codex', ownerId: 'u2', state: 'drift', issue: 'drift' }),
      ]),
      'POST /groups/g1/sync/replicas/b1/drift': { ok: true },
    })
    render(<SyncPanel groupId="g1" onClose={() => {}} />)
    const mine = await screen.findByTestId('replica-b1')
    expect(
      within(screen.getByTestId('replica-b2')).queryByRole('button', { name: '提交本地改动' }),
    ).toBeNull()
    fireEvent.click(within(mine).getByRole('button', { name: '提交本地改动' }))
    fireEvent.click(within(mine).getByRole('button', { name: '丢弃本地改动' }))
    const dlg = await screen.findByRole('alertdialog')
    fireEvent.click(within(dlg).getByRole('button', { name: '丢弃' }))
    await waitFor(() =>
      expect(calls.filter((c) => c.method === 'POST').map((c) => c.body)).toEqual([
        { choice: 'submit' },
        { choice: 'discard' },
      ]),
    )
  })

  it('a held replica: 处理冲突 opens the conflict dialog, for group admins too', async () => {
    mockApi({
      'GET /groups/g1/sync': status([
        replica({ botId: 'b2', botName: 'Codex', ownerId: 'u2', state: 'conflict', issue: 'held' }),
      ]),
      'GET /groups/g1/sync/conflicts': [{ ...conflict, botId: 'b2' }],
    })
    const { unmount } = render(<SyncPanel groupId="g1" onClose={() => {}} />)
    expect(
      within(await screen.findByTestId('replica-b2')).queryByRole('button', { name: '处理冲突' }),
    ).toBeNull()
    unmount()
    render(<SyncPanel groupId="g1" isAdmin onClose={() => {}} />)
    fireEvent.click(within(await screen.findByTestId('replica-b2')).getByRole('button', { name: '处理冲突' }))
    expect(await screen.findByText('处理 Codex 的同步冲突')).toBeTruthy()
    expect(await screen.findByTestId('conflict-src/a.ts')).toBeTruthy()
  })
})
