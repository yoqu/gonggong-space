import type { ApprovalDto, BotDto, RunDto } from '@aiws/protocol'
import { act, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { useSession } from '../src/app/session'
import { useWorkspace } from '../src/app/workspace'
import { ApprovalBlock } from '../src/features/runs/ApprovalBlock'
import { apiError, mockApi } from './mockApi'

const NOW = new Date(2026, 8, 23, 10, 21, 0)

const bot = {
  id: 'b1',
  name: '小王的 Claude',
  ownerId: 'u1',
  ownerName: '王磊',
  tier: 'workspace',
} as BotDto

const approval = (o: Partial<ApprovalDto> = {}): ApprovalDto => ({
  id: 'a1',
  runId: 'r1',
  title: 'Bash',
  toolKind: 'execute',
  detail: 'go build ./...',
  options: [
    { optionId: 'allow', name: 'Allow', kind: 'allow_once' },
    { optionId: 'reject', name: 'Reject', kind: 'reject_once' },
  ],
  status: 'pending',
  decidedBy: null,
  decidedByName: null,
  decidedAt: null,
  expiresAt: new Date(NOW.getTime() + 90_000).toISOString(),
  createdAt: NOW.toISOString(),
  ...o,
})

const run = (approvals: ApprovalDto[], o: Partial<RunDto> = {}) =>
  ({ id: 'r1', botId: 'b1', status: 'awaiting_approval', step: '', approvals, ...o }) as RunDto

const login = (id: string, name: string) =>
  useSession.setState({
    user: { id, account: id, name, role: 'member', mustChangePassword: false, disabled: false },
    status: 'ready',
  })

beforeEach(() => {
  vi.useFakeTimers({ shouldAdvanceTime: true })
  vi.setSystemTime(NOW)
  useWorkspace.setState({ bots: [bot] })
})
afterEach(() => {
  vi.useRealTimers()
  vi.unstubAllGlobals()
})

describe('ApprovalBlock', () => {
  it('renders nothing without approvals', () => {
    login('u1', '王磊')
    const { container } = render(<ApprovalBlock run={run([])} />)
    expect(container.textContent).toBe('')
  })

  it('lets the bot owner approve, with a live countdown', async () => {
    login('u1', '王磊')
    const calls = mockApi({ 'POST /runs/r1/approvals/a1': approval({ status: 'approved' }) })
    render(<ApprovalBlock run={run([approval()])} />)
    expect(screen.getByText('权限请求 · 执行命令')).toBeTruthy()
    expect(screen.getByText('go build ./...')).toBeTruthy()
    expect(screen.getByText('超出 workspace 档位 · 01:30 后自动拒绝，agent 自行绕路')).toBeTruthy()
    expect(screen.getByText('你是 bot 主人')).toBeTruthy()
    act(() => {
      vi.advanceTimersByTime(1000)
    })
    expect(screen.getByText('超出 workspace 档位 · 01:29 后自动拒绝，agent 自行绕路')).toBeTruthy()

    fireEvent.click(screen.getByRole('button', { name: '批准' }))
    await waitFor(() => expect(calls).toHaveLength(1))
    expect(calls[0]).toMatchObject({
      method: 'POST',
      path: '/runs/r1/approvals/a1',
      body: { optionId: 'allow' },
    })
  })

  it('counts down from the moment a request arrives', () => {
    login('u1', '王磊')
    const { rerender } = render(<ApprovalBlock run={run([])} />)
    vi.setSystemTime(NOW.getTime() + 20_000)
    rerender(<ApprovalBlock run={run([approval()])} />)
    expect(screen.getByText('超出 workspace 档位 · 01:10 后自动拒绝，agent 自行绕路')).toBeTruthy()
  })

  it('sends the reject option and shows a failed decision', async () => {
    login('u1', '王磊')
    const calls = mockApi({ 'POST /runs/r1/approvals/a1': apiError(409, 'conflict', '该请求已处理') })
    render(<ApprovalBlock run={run([approval()])} />)
    fireEvent.click(screen.getByRole('button', { name: '拒绝' }))
    await waitFor(() => expect(calls[0]?.body).toEqual({ optionId: 'reject' }))
  })

  it('shows non-owners the request read-only', () => {
    login('u2', '陈晨')
    render(<ApprovalBlock run={run([approval()])} />)
    expect((screen.getByRole('button', { name: '批准' }) as HTMLButtonElement).disabled).toBe(true)
    expect((screen.getByRole('button', { name: '拒绝' }) as HTMLButtonElement).disabled).toBe(true)
    expect(screen.getByText('仅 bot 主人 王磊 可操作，你只能查看')).toBeTruthy()
  })

  it.each([
    [
      approval({ status: 'approved', decidedByName: '王磊', decidedAt: NOW.toISOString() }),
      {},
      '王磊 已批准 · 10:21',
    ],
    [
      approval({ status: 'rejected', decidedByName: '王磊', decidedAt: NOW.toISOString() }),
      {},
      '王磊 已拒绝 · 10:21 · agent 将自行绕路',
    ],
    [
      approval({ status: 'expired', decidedAt: NOW.toISOString() }),
      {},
      '超时未处理，已自动拒绝 · 10:21 · agent 将自行绕路',
    ],
    [approval({ status: 'void' }), { status: 'interrupted' }, '运行已停止，请求作废'],
    [
      approval({ status: 'void' }),
      { status: 'interrupted', step: '整条链已被 王磊 /stop 终止' },
      '链已终止，请求作废',
    ],
    [approval({ status: 'void' }), { status: 'completed' }, '运行已结束，请求作废'],
  ] as const)('shows the outcome %#', (a, o, text) => {
    login('u1', '王磊')
    render(<ApprovalBlock run={run([a], o as Partial<RunDto>)} />)
    expect(screen.getByText(text)).toBeTruthy()
    expect(screen.queryByRole('button', { name: '批准' })).toBeNull()
    expect(screen.getByText('超出 workspace 档位')).toBeTruthy()
  })

  it('shows the latest request of the run', () => {
    login('u1', '王磊')
    render(
      <ApprovalBlock
        run={run([
          approval({ status: 'approved', decidedByName: '王磊', decidedAt: NOW.toISOString() }),
          approval({ id: 'a2', toolKind: 'fetch', detail: 'https://wiki.corp' }),
        ])}
      />,
    )
    expect(screen.getByText('权限请求 · 访问网络')).toBeTruthy()
    expect(screen.queryByText('go build ./...')).toBeNull()
  })
})
