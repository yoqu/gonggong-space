import type { ApprovalDto, BotDto, QuestionSetDto, RunDetailDto, RunDto } from '@gonggong/protocol'
import { fireEvent, render, renderHook, screen, waitFor, within } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { useSession } from '../src/app/session'
import { useWorkspace } from '../src/app/workspace'
import { ActivityDock } from '../src/features/runs/ActivityDock'
import { buildSteps } from '../src/features/runs/process'
import { RunTab, useRunTabMeta } from '../src/features/workbench/tabs/RunTab'

vi.mock('../src/lib/realtime', () => ({
  realtime: { subscribe: () => () => {}, onReconnect: () => () => {} },
}))

const local = (h: number, m: number, s: number) => new Date(2026, 9, 18, h, m, s).toISOString()
const later = new Date(Date.now() + 10 * 60_000).toISOString()

const approval = (o: Partial<ApprovalDto> = {}): ApprovalDto => ({
  id: 'a1',
  runId: 'r1',
  title: 'Bash',
  toolKind: 'execute',
  detail: 'rm -rf dist',
  reason: 'not_allowed',
  options: [
    { optionId: 'allow', name: 'Allow', kind: 'allow_once' },
    { optionId: 'reject', name: 'Reject', kind: 'reject_once' },
  ],
  remember: [],
  status: 'pending',
  voidReason: null,
  decidedBy: null,
  decidedByName: null,
  decidedAt: null,
  expiresAt: later,
  createdAt: local(10, 0, 5),
  ...o,
})
const questions = (o: Partial<QuestionSetDto> = {}): QuestionSetDto => ({
  id: 'qs1',
  runId: 'r1',
  questions: [
    { id: 'q1', type: 'yesno', title: '允许改 fixture 吗？', options: ['是', '否'], recommended: 0 },
  ],
  status: 'pending',
  answers: null,
  attachments: [],
  answeredBy: null,
  answeredByName: null,
  answeredAt: null,
  expiresAt: later,
  createdAt: local(10, 0, 8),
  leanings: [],
  ...o,
})
const run = (o: Partial<RunDto> = {}): RunDto => ({
  id: 'r1',
  groupId: 'g1',
  botId: 'b1',
  triggerMessageId: 'm1',
  triggerUserId: 'u1',
  hop: 1,
  status: 'awaiting_approval',
  step: '',
  filesChanged: 0,
  usage: null,
  newSessionReason: null,
  queuedAt: local(10, 0, 0),
  startedAt: local(10, 0, 1),
  endedAt: null,
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
  ...o,
})
const detail = (r: RunDto): RunDetailDto => ({
  run: r,
  patch: null,
  purged: false,
  settings: null,
  patchRepos: [],
  sessionId: null,
  retentionDays: 30,
  events: [],
})

const posts: { path: string; body: unknown }[] = []
function serve(d: RunDetailDto) {
  posts.length = 0
  vi.stubGlobal(
    'fetch',
    vi.fn(async (input: string, init?: RequestInit) => {
      const path = input.replace(/^\/api/, '').split('?')[0] ?? ''
      if (init?.method === 'POST') {
        posts.push({ path, body: JSON.parse(String(init.body)) })
        return new Response(JSON.stringify({}))
      }
      if (path === '/runs/r1') return new Response(JSON.stringify(d))
      if (path === '/runs/r1/session') return new Response(JSON.stringify({ rounds: [] }))
      return new Response(JSON.stringify({ scope: 'turn', patch: null, base: null, branch: null, repos: [] }))
    }),
  )
}

beforeEach(() => {
  useWorkspace.setState({
    bots: [
      {
        id: 'b1',
        name: '小王的 Claude',
        ownerId: 'u1',
        ownerName: '王磊',
        tier: 'workspace',
        avatar: 'role-gong',
        avatarUrl: null,
      } as unknown as BotDto,
    ],
  })
  useSession.setState({
    user: {
      id: 'u1',
      account: 'u1',
      name: '王磊',
      role: 'member',
      mustChangePassword: false,
      disabled: false,
      gitProtocol: 'auto',
      email: null,
      avatar: null,
    },
    status: 'ready',
  })
})
afterEach(() => vi.unstubAllGlobals())

const props = {
  tab: { kind: 'run' as const, runId: 'r1', view: 'process' as const, file: null },
  tabKey: 'run:r1',
  active: true,
}

describe('approvals and questions in the run tab', () => {
  it('puts questions into the process in time order', () => {
    const steps = buildSteps(detail(run({ approvals: [approval()], questions: [questions()] })))
    const asks = steps.filter((s) => s.kind === 'approval' || s.kind === 'question')
    expect(asks.map((s) => [s.key, s.kind, s.running, s.at])).toEqual([
      ['aa1', 'approval', true, local(10, 0, 5)],
      ['qqs1', 'question', true, local(10, 0, 8)],
    ])
  })

  it('pins pending requests on top where the bot owner decides them', async () => {
    serve(detail(run({ approvals: [approval()], questions: [questions()] })))
    render(<RunTab {...props} />)
    const pinned = await screen.findByRole('region', { name: '待处理' })
    expect(within(pinned).getByText('rm -rf dist')).toBeTruthy()
    fireEvent.click(within(pinned).getByRole('button', { name: '批准' }))
    await waitFor(() =>
      expect(posts).toEqual([{ path: '/runs/r1/approvals/a1', body: { optionId: 'allow' } }]),
    )
    fireEvent.click(within(pinned).getByRole('button', { name: /是/ }))
    fireEvent.click(within(pinned).getByRole('button', { name: '提交回答' }))
    await waitFor(() => expect(posts.at(-1)?.path).toBe('/runs/r1/questions/qs1/answers'))
  })

  it('shows decided requests where they happened, with their outcome', async () => {
    serve(
      detail(
        run({
          status: 'completed',
          endedAt: local(10, 2, 0),
          approvals: [approval({ status: 'approved', decidedByName: '王磊', decidedAt: local(10, 0, 9) })],
        }),
      ),
    )
    render(<RunTab {...props} />)
    const list = await screen.findByRole('list', { name: '运行过程' })
    expect(within(list).getByText('已批准')).toBeTruthy()
    expect(screen.queryByRole('region', { name: '待处理' })).toBeNull()
  })

  it('badges the tab and the dock while a request waits', async () => {
    serve(detail(run({ approvals: [approval()] })))
    render(<RunTab {...props} />)
    await screen.findByRole('region', { name: '待处理' })
    const { result } = renderHook(() => useRunTabMeta(props.tab))
    expect(result.current.badge).toBe('待处理')

    const onLocate = vi.fn()
    const dock = render(
      <ActivityDock steps={buildSteps(detail(run({ approvals: [approval()] })))} onLocate={onLocate} />,
    )
    fireEvent.click(within(dock.container).getByRole('button', { name: '待处理 1 项' }))
    expect(onLocate).toHaveBeenCalledWith('aa1')
  })
})
