import type {
  BotDto,
  GroupDto,
  MessageDto,
  RunDetailDto,
  RunDto,
  UserDto,
  WebEvent,
} from '@gonggong/protocol'
import { act, fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import { MemoryRouter } from 'react-router'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { App } from '../src/App'
import { useSession } from '../src/app/session'
import { useWorkspace } from '../src/app/workspace'
import { useRunRail } from '../src/features/runs/rail'

const me: UserDto = {
  id: 'u1',
  account: 'wanglei',
  name: '王磊',
  role: 'member',
  mustChangePassword: false,
  disabled: false,
}
const group: GroupDto = {
  id: 'g1',
  name: '退款 v2 迁移',
  kind: 'group',
  mode: 'partition',
  notice: '',
  repo: { url: 'git@git.corp:pay/refund.git', branch: 'main' },
  members: [{ userId: 'u1', name: '王磊', isAdmin: true }],
  botIds: ['b1'],
  unread: 0,
  lastSeq: 3,
  last: '',
  pinned: false,
  muted: false,
  foldRuns: false,
}
const bot: BotDto = {
  id: 'b1',
  name: '小王的 Claude',
  ownerId: 'u1',
  ownerName: '王磊',
  agentKind: 'claude',
  avatar: null,
  machineId: 'mc1',
  machineName: 'wanglei-mbp',
  binding: 'bound',
  presence: 'online',
  systemPrompt: '',
  tier: 'workspace',
  triggerScope: 'all',
  triggerList: [],
  concurrency: 2,
  createdBy: 'u1',
  agentVersion: null,
  agentMinVersion: null,
  groupCount: 1,
  defaultWorkspace: null,
}
const at = '2026-09-23T02:21:00.000Z'
const msg = (o: Partial<MessageDto>): MessageDto => ({
  id: `m${o.seq}`,
  seq: 1,
  groupId: 'g1',
  kind: 'user',
  authorId: 'u1',
  authorName: '王磊',
  body: '',
  mentions: [],
  runId: null,
  createdAt: at,
  attachments: [],
  quote: null,
  ...o,
})
const run = (o: Partial<RunDto> = {}): RunDto => ({
  id: 'r1',
  groupId: 'g1',
  botId: 'b1',
  triggerMessageId: 'm1',
  triggerUserId: 'u1',
  hop: 2,
  status: 'running',
  step: '编辑 src/a.ts',
  filesChanged: 1,
  usage: { totalTokens: 1500 },
  newSessionReason: null,
  queuedAt: at,
  startedAt: at,
  endedAt: null,
  parentRunId: 'r0',
  hopMax: 3,
  offlineWaitMin: 30,
  originUserId: 'u1',
  questions: [],
  approvals: [
    {
      id: 'a1',
      runId: 'r1',
      title: 'Bash',
      toolKind: 'execute',
      detail: 'echo hello-approval',
      options: [],
      status: 'approved',
      voidReason: null,
      decidedBy: 'u1',
      decidedByName: '王磊',
      decidedAt: at,
      expiresAt: at,
      createdAt: at,
    },
  ],
  interrupt: null,
  stoppedBy: null,
  delegation: { subagents: 0, subagentsRunning: 0, tasksRunning: 0 },
  ...o,
})
const patch = [
  'diff --git a/src/a.ts b/src/a.ts',
  '--- a/src/a.ts',
  '+++ b/src/a.ts',
  '@@ -1 +1,2 @@',
  '-old line',
  '+new line',
  '+second line',
  'diff --git a/docs/b.md b/docs/b.md',
  'new file mode 100644',
  '@@ -0,0 +1 @@',
  '+# b',
  '',
].join('\n')
const UNCOMMITTED = [
  'diff --git a/wip.txt b/wip.txt',
  'new file mode 100644',
  '@@ -0,0 +1 @@',
  '+wip',
  '',
].join('\n')
const detail = (o: Partial<RunDetailDto> = {}): RunDetailDto => ({
  run: run(),
  patch,
  purged: false,
  sessionId: 'sess-7f3a',
  retentionDays: 30,
  events: [
    { id: 1, at, event: { kind: 'status', status: 'running', step: 'git fetch 完成，当前分支 main' } },
    { id: 2, at, event: { kind: 'thought', delta: '先看调用方' } },
    {
      id: 3,
      at,
      event: {
        kind: 'tool',
        toolCallId: 't1',
        title: 'echo hi',
        toolKind: 'execute',
        status: 'completed',
        detail: '$ echo hi\nhi [已脱敏]',
      },
    },
  ],
  ...o,
})
const timeline = {
  messages: [
    msg({ seq: 1, body: '@小王的 Claude 改一下', mentions: ['b1'] }),
    msg({
      seq: 2,
      kind: 'bot',
      authorId: 'b1',
      authorName: '小王的 Claude',
      body: '改好了 `src/a.ts`，另见 `server/untouched.go`。',
      runId: 'r1',
    }),
  ],
  runs: [
    run(),
    run({
      id: 'r2',
      hop: 1,
      status: 'forbidden',
      step: '该 Bot 仅允许指定名单触发，未启动运行',
      startedAt: null,
    }),
    run({ id: 'r3', hop: 1, status: 'offline_wait', step: 'Bot 离线，等待上线', startedAt: null }),
  ],
}

class FakeSocket {
  static last: FakeSocket | undefined
  onopen: (() => void) | null = null
  onmessage: ((e: { data: string }) => void) | null = null
  onclose: (() => void) | null = null
  constructor() {
    FakeSocket.last = this
  }
  close() {}
}
const push = (e: WebEvent) => act(() => FakeSocket.last!.onmessage!({ data: JSON.stringify(e) }))

function mockApi(runDetail: () => RunDetailDto) {
  const calls: string[] = []
  const routes: Record<string, () => unknown> = {
    'GET /groups': () => [group],
    'GET /users': () => [],
    'GET /bots': () => [bot],
    'GET /machines': () => [],
    'GET /notifications': () => [],
    'GET /groups/g1/timeline': () => timeline,
    'POST /groups/g1/read': () => group,
    'GET /groups/g1/bot-states': () => [],
    'GET /runs/r1': runDetail,
    'POST /runs/r1/tasks/bg1/stop': () => ({ sent: true }),
  }
  // A bot workspace's changes: this turn's patch, other scopes from the fixtures below.
  const diff = (url: string) => {
    const scope = new URL(url, 'http://x').searchParams.get('scope')
    if (scope === 'turn') return { scope, patch: runDetail().patch, base: null, branch: 'feat/refund' }
    if (scope === 'uncommitted') return { scope, patch: UNCOMMITTED, base: null, branch: 'feat/refund' }
    return { scope, patch: null, base: 'main', branch: 'feat/refund' }
  }
  vi.stubGlobal(
    'fetch',
    vi.fn(async (url: string, init?: RequestInit) => {
      const path = url.replace(/^\/api/, '').split('?')[0]
      calls.push(`${init?.method ?? 'GET'} ${path}`)
      if (path === '/groups/g1/bots/b1/diff') return new Response(JSON.stringify(diff(url)))
      const handler = routes[`${init?.method ?? 'GET'} ${path}`]
      if (!handler) return new Response(JSON.stringify({ error: 'not_found', message: '' }), { status: 404 })
      return new Response(JSON.stringify(handler()))
    }),
  )
  return calls
}

const renderChat = () =>
  render(
    <MemoryRouter initialEntries={['/g/g1']}>
      <App />
    </MemoryRouter>,
  )

beforeEach(() => {
  Object.defineProperty(window, 'innerWidth', { configurable: true, value: 1440 })
  vi.stubGlobal('WebSocket', FakeSocket)
  useSession.setState({ user: me, status: 'ready' })
  useWorkspace.setState({ groups: [], bots: [], machines: [], activeGroupId: null })
  useRunRail.getState().close()
})
afterEach(() => vi.unstubAllGlobals())

describe('run card', () => {
  it('shows relay hop, meta, notes and the actions row', async () => {
    mockApi(detail)
    renderChat()
    const cards = await screen.findAllByTestId('run-card')
    // r1 has its final reply, so its card sits at the reply, after the cards still under the trigger.
    const [forbidden, offline, live] = cards as [HTMLElement, HTMLElement, HTMLElement]
    expect(live.textContent).toContain('接力 2/3')
    expect(live.textContent).toContain('改动 1 个文件')
    expect(live.textContent).toContain('1.5k tokens')
    expect(within(live).getByRole('button', { name: '查看过程' })).toBeTruthy()
    expect(forbidden.textContent).toContain('无权触发')
    expect(forbidden.textContent).toContain('该 Bot 仅允许指定名单触发，未启动运行')
    expect(within(forbidden).queryByRole('button', { name: '查看过程' })).toBeNull()
    expect(offline.textContent).toContain('Bot 离线，已进入本机队列 · 上线后自动执行')
    expect(forbidden.textContent).not.toContain('接力')
  })
})

describe('run rail', () => {
  it('opens from the card with process, diff and approval tabs, and live-updates', async () => {
    let current = detail()
    const calls = mockApi(() => current)
    renderChat()
    const card = (await screen.findAllByTestId('run-card')).at(-1)
    fireEvent.click(within(card!).getByRole('button', { name: '查看过程' }))
    const rail = await screen.findByTestId('run-rail')
    expect(await within(rail).findByText('本轮上下文')).toBeTruthy()
    expect(rail.textContent).toContain('wanglei-mbp')
    expect(rail.textContent).toContain('sess-7f3a')
    // Context, outputs and thoughts stay one quiet line each until clicked (Codex / ZCode).
    expect(rail.textContent).not.toContain('git 默认动作')
    const ctx = within(rail).getByRole('button', { name: /本轮上下文/ })
    fireEvent.click(ctx)
    expect(rail.textContent).toContain('git 默认动作：fetch 完成，当前分支 main')
    const cmd = within(rail).getByRole('button', { name: /已运行\s*echo hi/ })
    expect(rail.textContent).not.toContain('hi [已脱敏]')
    fireEvent.click(cmd)
    expect(cmd.getAttribute('aria-expanded')).toBe('true')
    expect(rail.textContent).toContain('hi [已脱敏]')
    const thought = within(rail).getByRole('button', { name: /思考\s*先看调用方/ })
    expect(thought.getAttribute('aria-expanded')).toBe('false')
    // Nothing is running between calls: the model is working.
    expect(within(rail).getByText('正在处理')).toBeTruthy()

    push({ t: 'run.delta', runId: 'r1', text: '正在收尾' })
    expect(await within(rail).findByText('正在收尾')).toBeTruthy()
    // The user's own unfolding survives live updates.
    expect(
      within(rail)
        .getByRole('button', { name: /已运行\s*echo hi/ })
        .getAttribute('aria-expanded'),
    ).toBe('true')
    current = detail({ run: run({ status: 'completed', endedAt: at }) })
    push({ t: 'run.updated', run: current.run })
    await waitFor(() => expect(calls.filter((c) => c === 'GET /runs/r1')).toHaveLength(2))
    expect(within(rail).getAllByText('已完成').length).toBeGreaterThan(0)

    fireEvent.click(within(rail).getByRole('tab', { name: '改动' }))
    expect(rail.textContent).toContain('a.ts')
    expect(rail.textContent).toContain('+2')
    expect(rail.textContent).toContain('−1')
    // A file opens in the diff window, which shares the scopes of the tab.
    fireEvent.click(within(rail).getByRole('button', { name: /b\.md/ }))
    const win = await screen.findByRole('dialog', { name: '改动 · 小王的 Claude' })
    expect(await within(win).findByText('+# b')).toBeTruthy()
    fireEvent.click(within(win).getByRole('radio', { name: '未提交' }))
    expect(await within(win).findByText('+wip')).toBeTruthy()
    fireEvent.click(within(win).getByRole('radio', { name: '对比主分支' }))
    expect(await within(win).findByText('feat/refund 相对 main 没有改动')).toBeTruthy()
    fireEvent.click(within(win).getByRole('button', { name: '关闭' }))
    await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull())

    fireEvent.click(within(rail).getByRole('tab', { name: '审批记录' }))
    expect(rail.textContent).toContain('echo hello-approval')
    expect(rail.textContent).toContain('王磊 已批准')
    expect(rail.textContent).toContain(
      '审批与提问记录永久保存；完整运行过程保留 30 天，过期后卡片只保留摘要。',
    )

    fireEvent.click(within(rail).getByRole('button', { name: '关闭' }))
    expect(screen.queryByTestId('run-rail')).toBeNull()
  })

  it('renders replies as markdown, copies the session id and closes on Escape (not mid-IME)', async () => {
    const base = detail()
    mockApi(() => ({
      ...base,
      events: [...base.events, { id: 9, at, event: { kind: 'text', delta: '改好了 **加粗** `code`' } }],
    }))
    const writeText = vi.fn(async (_: string) => {})
    vi.stubGlobal('navigator', { ...navigator, clipboard: { writeText } })
    renderChat()
    const card = (await screen.findAllByTestId('run-card')).at(-1)
    fireEvent.click(within(card!).getByRole('button', { name: '查看过程' }))
    const rail = await screen.findByTestId('run-rail')
    expect((await within(rail).findByText('加粗')).tagName).toBe('STRONG')
    expect(within(rail).getByText('code').tagName).toBe('CODE')
    expect(rail.textContent).not.toContain('**')

    fireEvent.click(within(rail).getByRole('button', { name: '复制会话 ID' }))
    await waitFor(() => expect(writeText).toHaveBeenCalledWith('sess-7f3a'))
    writeText.mockRejectedValueOnce(new Error('denied'))
    fireEvent.click(within(rail).getByRole('button', { name: '复制会话 ID' }))
    expect(await screen.findByText('复制失败')).toBeTruthy()

    fireEvent.keyDown(document, { key: 'Escape', isComposing: true })
    expect(screen.getByTestId('run-rail')).toBeTruthy()
    fireEvent.keyDown(document, { key: 'Escape' })
    expect(screen.queryByTestId('run-rail')).toBeNull()
  })

  it('opens the diff of a file path clicked in a bot reply', async () => {
    mockApi(detail)
    renderChat()
    fireEvent.click(await screen.findByRole('button', { name: 'src/a.ts' }))
    const win = await screen.findByRole('dialog', { name: /改动/ })
    expect(await within(win).findByText('+second line')).toBeTruthy()
    fireEvent.click(within(win).getByRole('button', { name: '关闭' }))

    fireEvent.click(screen.getByRole('button', { name: 'server/untouched.go' }))
    const again = await screen.findByRole('dialog', { name: /改动/ })
    expect(await within(again).findByText('server/untouched.go 在这个范围内没有改动')).toBeTruthy()
  })

  it('opens the run (and file) linked from a notification or search hit', async () => {
    mockApi(detail)
    render(
      <MemoryRouter initialEntries={['/g/g1?run=r1&file=src%2Fa.ts']}>
        <App />
      </MemoryRouter>,
    )
    expect(await screen.findByTestId('run-rail')).toBeTruthy()
    const win = await screen.findByRole('dialog', { name: /改动/ })
    expect(await within(win).findByText('+second line')).toBeTruthy()
  })

  it('keeps only the summary once the process has been purged', async () => {
    mockApi(() => detail({ purged: true, patch: null, events: [] }))
    renderChat()
    const card = (await screen.findAllByTestId('run-card')).at(-1)
    fireEvent.click(within(card!).getByRole('button', { name: '查看过程' }))
    const rail = await screen.findByTestId('run-rail')
    expect(await within(rail).findByText('运行过程已过期，仅保留摘要')).toBeTruthy()
    fireEvent.click(within(rail).getByRole('tab', { name: '审批记录' }))
    expect(rail.textContent).toContain('echo hello-approval')
  })

  it('covers the whole screen on mobile', async () => {
    Object.defineProperty(window, 'innerWidth', { configurable: true, value: 390 })
    mockApi(detail)
    renderChat()
    const card = (await screen.findAllByTestId('run-card')).at(-1)
    fireEvent.click(within(card!).getByRole('button', { name: '查看过程' }))
    expect((await screen.findByRole('complementary', { name: '侧栏' })).className).toContain(
      'chat__rail--overlay',
    )
  })
})

describe('process timeline', () => {
  const openRail = async () => {
    const card = (await screen.findAllByTestId('run-card')).at(-1)
    fireEvent.click(within(card!).getByRole('button', { name: '查看过程' }))
    return screen.findByTestId('run-rail')
  }
  const tool = (
    id: number,
    toolKind: string,
    status: 'completed' | 'in_progress' | 'failed',
    detail: string,
  ) => ({
    id,
    at,
    event: { kind: 'tool' as const, toolCallId: `t${id}`, title: `t${id}`, toolKind, status, detail },
  })

  it('folds the calls between two texts into one segment titled by what it did (Codex app)', async () => {
    const base = detail({ run: run({ approvals: [] }) })
    mockApi(() => ({
      ...base,
      events: [
        ...base.events.slice(0, 1),
        tool(4, 'read', 'completed', '/h/ws/src/a.ts:1'),
        tool(5, 'read', 'completed', '/h/ws/src/b.ts'),
        tool(6, 'execute', 'failed', '$ make\nboom'),
        tool(7, 'execute', 'in_progress', '$ pnpm test'),
        tool(8, 'edit', 'completed', '/h/ws/src/a.ts'),
      ],
    }))
    useWorkspace.setState({
      botStates: {
        g1: {
          b1: {
            botId: 'b1',
            workspace: 'managed',
            state: 'ready',
            path: '/h/ws',
            git: null,
            error: null,
            tier: null,
          },
        },
      },
    })
    renderChat()
    const rail = await openRail()
    const list = await within(rail).findByRole('list', { name: '运行过程' })
    // The segment still being worked on is open; its title says what happened, with failures.
    const seg = within(list).getByRole('button', { name: /读取了文件、运行了命令、编辑了文件\s*1 个失败/ })
    expect(seg.getAttribute('aria-expanded')).toBe('true')
    // File names only, relative paths on hover.
    expect(within(list).getByText('b.ts').getAttribute('title')).toMatch(/src\/b\.ts$/)
    const failed = within(list)
      .getByRole('button', { name: /运行失败\s*make/ })
      .closest('li')!
    expect(failed.dataset.state).toBe('failed')
    expect(within(list).getByText('正在运行').closest('li')!.dataset.state).toBe('running')
    expect(within(list).queryByText('正在处理')).toBeNull()
    // The live turn's counts come from the bot's machine.
    const edit = await within(list).findByRole('button', { name: /已编辑\s*a\.ts\s*\+2 −1/ })
    fireEvent.click(edit)
    const win = await screen.findByRole('dialog', { name: /改动/ })
    expect(await within(win).findByText('+second line')).toBeTruthy()
    fireEvent.click(seg)
    expect(seg.getAttribute('aria-expanded')).toBe('false')
  })

  it('shows delegated work on the card and in the process, and stops a background task', async () => {
    const base = detail({
      run: run({ approvals: [], delegation: { subagents: 1, subagentsRunning: 1, tasksRunning: 1 } }),
    })
    const events: RunDetailDto['events'] = [
      ...base.events,
      {
        id: 4,
        at,
        event: { kind: 'subagent', agentId: 'a1', name: 'Explore', task: '找调用方', state: 'running' },
      },
      { id: 5, at, event: { kind: 'text', delta: '子报告', agentId: 'a1' } },
      {
        id: 6,
        at,
        event: {
          kind: 'task',
          taskId: 'bg1',
          name: 'pnpm dev',
          taskType: 'shell',
          state: 'running',
          canStop: true,
        },
      },
      {
        id: 7,
        at,
        event: {
          kind: 'tool',
          toolCallId: 'c1',
          title: 'spawnAgent',
          toolKind: 'other',
          status: 'in_progress',
        },
      },
    ]
    const calls = mockApi(() => ({ ...base, events }))
    renderChat()
    const card = (await screen.findAllByTestId('run-card')).at(-1)!
    push({ t: 'run.updated', run: base.run })
    await waitFor(() => expect(card.textContent).toContain('子 agent 1 个，1 个运行中'))
    expect(card.textContent).toContain('后台任务 1 个运行中')
    const rail = await openRail()
    const list = await within(rail).findByRole('list', { name: '运行过程' })
    // A running subagent shows its own process.
    expect(
      within(list)
        .getByRole('button', { name: /Explore\s*找调用方/ })
        .getAttribute('aria-expanded'),
    ).toBe('true')
    expect(within(list).getByText('子报告')).toBeTruthy()
    // Codex v1 spawns report no child session: the call says so instead of spinning.
    expect(within(list).getByText('派出子 agent')).toBeTruthy()
    expect(within(list).getByText('详情不可见')).toBeTruthy()
    fireEvent.click(within(list).getByRole('button', { name: '停止后台任务 pnpm dev' }))
    await waitFor(() => expect(calls).toContain('POST /runs/r1/tasks/bg1/stop'))
  })

  it('tucks a finished turn under 已工作 and clamps the final reply', async () => {
    const base = detail({ run: run({ status: 'completed', endedAt: '2026-09-23T02:22:05.000Z' }) })
    mockApi(() => ({
      ...base,
      events: [
        ...base.events,
        { id: 9, at: '2026-09-23T02:22:00.000Z', event: { kind: 'text', delta: '全部完成' } },
      ],
    }))
    renderChat()
    const rail = await openRail()
    const work = await within(rail).findByRole('button', { name: /已工作/ })
    expect(work.getAttribute('aria-expanded')).toBe('false')
    expect(within(rail).getByText('全部完成')).toBeTruthy()
    expect(within(rail).queryByRole('button', { name: /已运行/ })).toBeNull()
    fireEvent.click(work)
    expect(within(rail).getByRole('button', { name: /已运行\s*echo hi/ })).toBeTruthy()
  })

  it('shows a five-cell +/− bar per file in the diff tab', async () => {
    mockApi(detail)
    renderChat()
    const rail = await openRail()
    await within(rail).findByText('本轮上下文')
    fireEvent.click(within(rail).getByRole('tab', { name: '改动' }))
    const file = await within(rail).findByRole('button', { name: /a\.ts/ })
    const bar = within(file).getByRole('img', { name: '新增 2 行，删除 1 行' })
    const cells = [...bar.children].map((c) => (c as HTMLElement).dataset.cell)
    expect(cells).toEqual(['add', 'add', 'del', 'none', 'none'])
  })
})
