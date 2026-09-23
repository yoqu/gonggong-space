import type { BotDto, GroupDto, RunDto, UserDto } from '@aiws/protocol'
import { act, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { useSession } from '../src/app/session'
import { useWorkspace } from '../src/app/workspace'
import { InterruptBlock } from '../src/features/runs/InterruptBlock'
import { OfflineNote, RunActions } from '../src/features/runs/RunActions'
import { mockApi } from './mockApi'

const run = (o: Partial<RunDto> = {}): RunDto => ({
  id: 'r1',
  groupId: 'g1',
  botId: 'b1',
  triggerMessageId: 'm1',
  triggerUserId: 'u-wang',
  hop: 1,
  status: 'running',
  step: '',
  filesChanged: 0,
  usage: null,
  newSessionReason: null,
  queuedAt: '2026-09-23T10:00:00.000Z',
  startedAt: '2026-09-23T10:00:01.000Z',
  endedAt: null,
  parentRunId: null,
  hopMax: 3,
  offlineWaitMin: 30,
  originUserId: 'u-wang',
  approvals: [],
  interrupt: null,
  stoppedBy: null,
  ...o,
})

const me = (id: string) => useSession.setState({ user: { id, name: id } as UserDto, status: 'ready' })

beforeEach(() => {
  useWorkspace.setState({
    bots: [{ id: 'b1', name: '小王的 Claude', ownerId: 'u-li' } as BotDto],
    groups: [
      {
        id: 'g1',
        members: [
          { userId: 'u-wang', name: '王磊', isAdmin: true },
          { userId: 'u-li', name: '李建国', isAdmin: false },
          { userId: 'u-zhao', name: '赵敏', isAdmin: false },
        ],
      } as GroupDto,
    ],
  })
  me('u-zhao')
})
afterEach(() => {
  vi.unstubAllGlobals()
  vi.useRealTimers()
})

describe('run actions', () => {
  it('any member can /stop an unfinished run', async () => {
    const calls = mockApi({ 'POST /runs/r1/stop': { stopped: 1 } })
    const { rerender } = render(<RunActions run={run()} />)
    fireEvent.click(screen.getByRole('button', { name: '/stop' }))
    await waitFor(() => expect(calls).toEqual([{ method: 'POST', path: '/runs/r1/stop', body: {} }]))
    expect(screen.queryByRole('button', { name: '终止整条链' })).toBeNull()
    rerender(<RunActions run={run({ status: 'queued' })} />)
    expect(screen.getByRole('button', { name: '/stop' })).toBeTruthy()
    rerender(<RunActions run={run({ status: 'completed' })} />)
    expect(screen.queryByRole('button', { name: '/stop' })).toBeNull()
  })

  it('chained hops offer 终止整条链 instead', async () => {
    const calls = mockApi({ 'POST /runs/r1/stop-chain': { stopped: 2 } })
    render(<RunActions run={run({ hop: 2, status: 'awaiting_approval' })} />)
    expect(screen.queryByRole('button', { name: '/stop' })).toBeNull()
    fireEvent.click(screen.getByRole('button', { name: '终止整条链' }))
    await waitFor(() => expect(calls.map((c) => c.path)).toEqual(['/runs/r1/stop-chain']))
  })

  it('an offline request shows the countdown to expiry', () => {
    vi.useFakeTimers({ now: new Date('2026-09-23T10:02:20.000Z') })
    render(<OfflineNote run={run({ status: 'offline_wait', startedAt: null })} />)
    expect(
      screen.getByText('bot 离线，已进入本机队列 · 上线后自动执行，27:40 后作废并通知 王磊'),
    ).toBeTruthy()
  })
})

describe('interrupt block', () => {
  const stopped = (o: Partial<RunDto> = {}) =>
    run({ status: 'interrupted', filesChanged: 4, interrupt: 'pending', stoppedBy: 'u-zhao', ...o })

  it('explains the default and lets only the initiator or bot owner choose', async () => {
    const { rerender } = render(<InterruptBlock run={stopped()} />)
    expect(screen.getByText('已停止 · 本轮改动 4 个文件留在工作区')).toBeTruthy()
    expect(
      screen.getByText(
        '默认保留：不回滚、不自动提交、不 stash。丢弃只还原本轮触及的文件，不影响此前已有的未提交改动。仅发起人 王磊 或 bot 主人可选，无超时。',
      ),
    ).toBeTruthy()
    expect((screen.getByRole('button', { name: '丢弃本轮改动' }) as HTMLButtonElement).disabled).toBe(true)

    act(() => me('u-li'))
    const calls = mockApi({ 'POST /runs/r1/interrupt': { ok: true } })
    rerender(<InterruptBlock run={stopped()} />)
    fireEvent.click(screen.getByRole('button', { name: '丢弃本轮改动' }))
    await waitFor(() =>
      expect(calls).toEqual([{ method: 'POST', path: '/runs/r1/interrupt', body: { choice: 'discard' } }]),
    )
  })

  it('shows the outcome once chosen', () => {
    const note = '下一轮上下文会告诉 agent：上一轮被 /stop 中断，以及这些文件的当前状态。'
    const { rerender } = render(<InterruptBlock run={stopped({ interrupt: 'kept' })} />)
    expect(screen.getByText('已保留本轮改动 · 留在工作区，未提交')).toBeTruthy()
    expect(screen.getByText(note)).toBeTruthy()
    expect(screen.queryByRole('button')).toBeNull()
    rerender(<InterruptBlock run={stopped({ interrupt: 'discarded' })} />)
    expect(screen.getByText('已丢弃本轮改动 · 之前已有的未提交内容不动')).toBeTruthy()
    rerender(<InterruptBlock run={stopped({ interrupt: null })} />)
    expect(screen.queryByText(note)).toBeNull()
  })
})
