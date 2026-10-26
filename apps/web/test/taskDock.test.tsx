import type { ApprovalDto, BotDto, QuestionSetDto, RunDto } from '@gonggong/protocol'
import { act, fireEvent, render, screen, within } from '@testing-library/react'
import { createRef } from 'react'
import { MemoryRouter } from 'react-router'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { useSession } from '../src/app/session'
import { useWorkbench } from '../src/app/workbench'
import { useWorkspace } from '../src/app/workspace'
import { TaskDock } from '../src/features/chat/TaskDock'
import { ApprovalCard } from '../src/features/runs/ApprovalBlock'
import { QuestionCard } from '../src/features/runs/QuestionBlock'

const NOW = new Date(2026, 8, 23, 10, 21, 0)

const bots = [
  { id: 'b1', name: '小王的 Claude', ownerId: 'u1', ownerName: '王磊', avatar: 'role-no' },
  { id: 'b2', name: '老李的 Codex', ownerId: 'u2', ownerName: '李建国', avatar: 'role-no' },
] as BotDto[]

const approval = (o: Partial<ApprovalDto> = {}): ApprovalDto => ({
  id: 'a1',
  runId: 'r1',
  title: 'Bash',
  toolKind: 'execute',
  detail: 'go test ./...',
  reason: 'not_allowed',
  options: [],
  remember: [],
  status: 'pending',
  voidReason: null,
  decidedBy: null,
  decidedByName: null,
  decidedAt: null,
  expiresAt: new Date(NOW.getTime() + 90_000).toISOString(),
  createdAt: NOW.toISOString(),
  ...o,
})

const set = (o: Partial<QuestionSetDto> = {}): QuestionSetDto => ({
  id: 'qs1',
  runId: 'r2',
  questions: [
    { id: 'q1', type: 'yesno', title: '允许改 fixture 吗？', options: ['是', '否'], recommended: 0 },
  ],
  status: 'pending',
  answers: null,
  attachments: [],
  answeredBy: null,
  answeredByName: null,
  answeredAt: null,
  expiresAt: new Date(NOW.getTime() + 60_000).toISOString(),
  createdAt: NOW.toISOString(),
  leanings: [],
  ...o,
})

const run = (o: Partial<RunDto> = {}): RunDto =>
  ({
    id: 'r1',
    groupId: 'g1',
    botId: 'b1',
    triggerMessageId: 'm1',
    triggerUserId: 'u1',
    hop: 1,
    status: 'running',
    step: '读取 server/refund.go',
    filesChanged: 0,
    usage: null,
    newSessionReason: null,
    parentRunId: null,
    hopMax: 3,
    offlineWaitMin: 30,
    originUserId: 'u1',
    approvals: [],
    questions: [],
    interrupt: null,
    stoppedBy: null,
    delegation: { subagents: 0, subagentsRunning: 0, tasksRunning: 0 },
    model: null,
    effort: null,
    queuedAt: NOW.toISOString(),
    startedAt: NOW.toISOString(),
    endedAt: null,
    lastActivityAt: NOW.toISOString(),
    ...o,
  }) as RunDto

const login = (id: string) =>
  useSession.setState({
    user: {
      id,
      account: id,
      name: id,
      role: 'member',
      mustChangePassword: false,
      disabled: false,
      gitProtocol: 'auto',
      email: null,
      avatar: null,
    },
    status: 'ready',
  })

class FakeObserver {
  static all: FakeObserver[] = []
  targets: Element[] = []
  readonly root: Element | Document | null
  readonly rootMargin = '0px'
  readonly thresholds = [0]
  constructor(
    readonly cb: IntersectionObserverCallback,
    readonly options?: IntersectionObserverInit,
  ) {
    this.root = options?.root ?? null
    FakeObserver.all.push(this)
  }
  observe(el: Element) {
    this.targets.push(el)
  }
  unobserve(el: Element) {
    this.targets = this.targets.filter((target) => target !== el)
  }
  disconnect() {
    this.targets = []
  }
  takeRecords() {
    return []
  }
  fire(isIntersecting: boolean) {
    this.cb(
      this.targets.map((target) => ({ target, isIntersecting }) as IntersectionObserverEntry),
      this as unknown as IntersectionObserver,
    )
  }
  enter() {
    this.fire(true)
  }
}

beforeEach(() => {
  vi.useFakeTimers({ shouldAdvanceTime: true })
  vi.setSystemTime(NOW)
  useWorkspace.setState({ bots })
  useWorkbench.setState({ groupId: 'g1', open: false, benches: {} })
  login('u1')
})

afterEach(() => {
  vi.useRealTimers()
  vi.unstubAllGlobals()
  FakeObserver.all = []
})

describe('TaskDock', () => {
  it('groups my pending approvals and questions without duplicating their forms', () => {
    const pending = [
      run({ id: 'r1', status: 'awaiting_approval', approvals: [approval()] }),
      run({
        id: 'r2',
        botId: 'b2',
        originUserId: 'u1',
        status: 'awaiting_answer',
        questions: [set({ runId: 'r2' })],
      }),
    ]
    render(<TaskDock runs={pending} onLocate={() => {}} />)

    expect(screen.getByTestId('task-dock').textContent).toContain('待我处理 2')
    expect(screen.getAllByTestId('task-dock-pending')).toHaveLength(2)
    expect(screen.queryByRole('button', { name: '批准' })).toBeNull()
    expect(screen.queryByRole('button', { name: '是' })).toBeNull()
  })

  it('keeps every item that needs me visible while collapsing other rows', () => {
    const pending = ['r1', 'r2', 'r3'].map((id) =>
      run({ id, status: 'awaiting_approval', approvals: [approval({ id: `a-${id}`, runId: id })] }),
    )
    render(<TaskDock runs={[...pending, run({ id: 'r4', status: 'running' })]} onLocate={() => {}} />)

    expect(screen.getAllByTestId('task-dock-pending')).toHaveLength(3)
    expect(screen.getAllByTestId('task-dock-row')).toHaveLength(1)
    expect(screen.queryByRole('button', { name: /展开 [1-9]/ })).toBeNull()
  })

  it('groups running, queued and offline-waiting tasks and excludes finished runs', () => {
    render(
      <TaskDock
        runs={[
          run(),
          run({ id: 'r2', status: 'queued', startedAt: null }),
          run({ id: 'r3', status: 'offline_wait', startedAt: null }),
          run({ id: 'r4', status: 'completed', endedAt: NOW.toISOString() }),
        ]}
        onLocate={() => {}}
      />,
    )

    expect(screen.getByTestId('task-dock').textContent).toContain('运行中 1')
    expect(screen.getByTestId('task-dock').textContent).toContain('等待中 2')
    expect(screen.getByTestId('task-dock').textContent).toContain('排队中')
    fireEvent.click(screen.getByRole('button', { name: /展开 1/ }))
    expect(screen.getByTestId('task-dock').textContent).toContain('离线等待')
    expect(screen.queryByText('已完成')).toBeNull()
  })

  it('shows a waiting run I cannot decide as waiting, with the latest activity time', () => {
    const active = new Date(NOW.getTime() - 65_000).toISOString()
    render(
      <TaskDock
        runs={[
          run({
            id: 'r1',
            botId: 'b2',
            originUserId: 'u2',
            status: 'awaiting_approval',
            approvals: [approval({ runId: 'r1' })],
            lastActivityAt: active,
          }),
          run({
            id: 'r2',
            botId: 'b2',
            originUserId: 'u2',
            status: 'awaiting_answer',
            questions: [set({ runId: 'r2' })],
            lastActivityAt: active,
          }),
        ]}
        onLocate={() => {}}
      />,
    )

    const rows = screen.getAllByTestId('task-dock-row')
    expect(rows.map((row) => row.textContent)).toEqual([
      expect.stringContaining('等待审批'),
      expect.stringContaining('等待回答'),
    ])
    expect(rows[0]!.textContent).toContain('1 分钟前')
    act(() => vi.advanceTimersByTime(60_000))
    expect(rows[0]!.textContent).toContain('2 分钟前')
  })

  it('locates a running task from its row and opens its process from the process action', () => {
    const onLocate = vi.fn()
    const r = run()
    render(<TaskDock runs={[r]} onLocate={onLocate} />)

    expect(screen.getByTestId('task-dock').textContent).toContain('小王的 Claude')
    fireEvent.click(screen.getByRole('button', { name: /小王的 Claude/ }))
    expect(onLocate).toHaveBeenCalledWith(r)

    fireEvent.click(screen.getByRole('button', { name: '过程' }))
    expect(useWorkbench.getState().benches.g1?.tabs).toEqual([
      { kind: 'run', runId: 'r1', view: 'process', file: null },
    ])
  })

  it('collapses and expands the task rows', () => {
    const runs = ['r1', 'r2', 'r3', 'r4'].map((id) =>
      run({ id, queuedAt: new Date(NOW.getTime() + Number(id.slice(1))).toISOString() }),
    )
    render(<TaskDock runs={runs} onLocate={() => {}} />)

    expect(screen.getAllByTestId('task-dock-row')).toHaveLength(2)
    fireEvent.click(screen.getByRole('button', { name: /展开/ }))
    expect(screen.getAllByTestId('task-dock-row')).toHaveLength(4)
    fireEvent.click(screen.getByRole('button', { name: '收起' }))
    expect(screen.getAllByTestId('task-dock-row')).toHaveLength(2)
  })

  it('hides pending items whose original forms are visible and shows them after scrolling away', () => {
    vi.stubGlobal('IntersectionObserver', FakeObserver)
    const root = createRef<HTMLDivElement>()
    const r = run({ status: 'awaiting_approval', approvals: [approval()] })
    render(
      <MemoryRouter>
        <div ref={root}>
          <ApprovalCard run={r} approval={approval()} />
          <TaskDock runs={[r]} root={root} onLocate={() => {}} />
        </div>
      </MemoryRouter>,
    )
    const observer = FakeObserver.all.find((item) => item.targets.length > 0)
    expect(observer).toBeDefined()
    act(() => (observer as FakeObserver).enter())
    expect(screen.queryByTestId('task-dock-pending')).toBeNull()

    const target = (observer as FakeObserver).targets[0]
    act(() =>
      (observer as FakeObserver).cb(
        [{ target, isIntersecting: false } as unknown as IntersectionObserverEntry],
        observer as unknown as IntersectionObserver,
      ),
    )
    expect(screen.getByTestId('task-dock-pending')).toBeTruthy()
  })

  it('locates a pending item and keeps its answer form in the timeline', () => {
    vi.stubGlobal('IntersectionObserver', FakeObserver)
    const root = createRef<HTMLDivElement>()
    const onLocate = vi.fn()
    const r = run({ status: 'awaiting_answer', questions: [set()] })
    render(
      <MemoryRouter>
        <div ref={root}>
          <QuestionCard run={r} set={set()} />
          <TaskDock runs={[r]} root={root} onLocate={onLocate} />
        </div>
      </MemoryRouter>,
    )
    const observer = FakeObserver.all.find((item) => item.targets.length > 0) as FakeObserver
    const target = observer.targets[0] as HTMLElement
    const scroll = vi.fn()
    target.scrollIntoView = scroll
    act(() =>
      observer.cb(
        [{ target, isIntersecting: false } as unknown as IntersectionObserverEntry],
        observer as unknown as IntersectionObserver,
      ),
    )
    const pending = screen.getByTestId('task-dock-pending')
    expect(within(pending).queryByRole('button', { name: '是' })).toBeNull()
    fireEvent.click(within(pending).getByRole('button'))
    expect(scroll).toHaveBeenCalledWith({ block: 'center', behavior: 'smooth' })
    expect(onLocate).not.toHaveBeenCalled()
  })
})
