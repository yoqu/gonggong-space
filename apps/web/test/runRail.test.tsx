import type { BotDto, GroupDto, MessageDto, RunDetailDto, RunDto, UserDto, WebEvent } from '@aiws/protocol'
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
}
const bot: BotDto = {
  id: 'b1',
  name: '小王的 Claude',
  ownerId: 'u1',
  ownerName: '王磊',
  agentKind: 'claude',
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
  groupCount: 1,
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
  originUserId: 'u1',
  approvals: [
    {
      id: 'a1',
      runId: 'r1',
      title: 'Bash',
      toolKind: 'execute',
      detail: 'echo hello-approval',
      options: [],
      status: 'approved',
      decidedBy: 'u1',
      decidedByName: '王磊',
      decidedAt: at,
      expiresAt: at,
      createdAt: at,
    },
  ],
  interrupt: null,
  stoppedBy: null,
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
      step: '该 bot 仅允许指定名单触发，未启动运行',
      startedAt: null,
    }),
    run({ id: 'r3', hop: 1, status: 'offline_wait', step: 'bot 离线，等待上线', startedAt: null }),
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
  }
  vi.stubGlobal(
    'fetch',
    vi.fn(async (url: string, init?: RequestInit) => {
      const path = url.replace(/^\/api/, '').split('?')[0]
      calls.push(`${init?.method ?? 'GET'} ${path}`)
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
    const [live, forbidden, offline] = cards as [HTMLElement, HTMLElement, HTMLElement]
    expect(live.textContent).toContain('接力 2/3')
    expect(live.textContent).toContain('改动 1 个文件')
    expect(live.textContent).toContain('1.5k tokens')
    expect(within(live).getByRole('button', { name: '查看过程' })).toBeTruthy()
    expect(forbidden.textContent).toContain('无权触发')
    expect(forbidden.textContent).toContain('该 bot 仅允许指定名单触发，未启动运行')
    expect(within(forbidden).queryByRole('button', { name: '查看过程' })).toBeNull()
    expect(offline.textContent).toContain('bot 离线，等待上线')
    expect(forbidden.textContent).not.toContain('接力')
  })
})

describe('run rail', () => {
  it('opens from the card with process, diff and approval tabs, and live-updates', async () => {
    let current = detail()
    const calls = mockApi(() => current)
    renderChat()
    const [card] = await screen.findAllByTestId('run-card')
    fireEvent.click(within(card!).getByRole('button', { name: '查看过程' }))
    const rail = await screen.findByTestId('run-rail')
    expect(await within(rail).findByText('开场上下文')).toBeTruthy()
    expect(rail.textContent).toContain('git 默认动作：fetch 完成，当前分支 main')
    expect(rail.textContent).toContain('wanglei-mbp')
    expect(rail.textContent).toContain('sess-7f3a')
    expect(within(rail).getByText('执行命令')).toBeTruthy()
    expect(within(rail).getByText(/hi \[已脱敏\]/)).toBeTruthy()
    expect(within(rail).queryByText('echo hi')).toBeNull()
    // Thoughts are collapsed until expanded.
    const thought = within(rail).getByText('思考').closest('details')!
    expect(thought.open).toBe(false)

    push({ t: 'run.delta', runId: 'r1', text: '正在收尾' })
    expect(await within(rail).findByText('正在收尾')).toBeTruthy()
    current = detail({ run: run({ status: 'completed', endedAt: at }) })
    push({ t: 'run.updated', run: current.run })
    await waitFor(() => expect(calls.filter((c) => c === 'GET /runs/r1')).toHaveLength(2))
    expect(within(rail).getAllByText('已完成').length).toBeGreaterThan(0)

    fireEvent.click(within(rail).getByRole('tab', { name: '文件 diff' }))
    expect(rail.textContent).toContain('src/a.ts')
    expect(rail.textContent).toContain('+2')
    expect(rail.textContent).toContain('−1')
    fireEvent.click(within(rail).getByRole('button', { name: /docs\/b\.md/ }))
    expect(within(rail).getByText('+# b')).toBeTruthy()

    fireEvent.click(within(rail).getByRole('tab', { name: '审批记录' }))
    expect(rail.textContent).toContain('echo hello-approval')
    expect(rail.textContent).toContain('王磊 已批准')
    expect(rail.textContent).toContain(
      '审批与提问记录永久保存；完整运行过程保留 30 天，过期后卡片只保留摘要。',
    )

    fireEvent.click(within(rail).getByRole('button', { name: '关闭' }))
    expect(screen.queryByTestId('run-rail')).toBeNull()
  })

  it('opens the diff of a file path clicked in a bot reply', async () => {
    mockApi(detail)
    renderChat()
    fireEvent.click(await screen.findByRole('button', { name: 'src/a.ts' }))
    const rail = await screen.findByTestId('run-rail')
    expect(await within(rail).findByText('+second line')).toBeTruthy()
    expect(within(rail).getByRole('tab', { name: '文件 diff' }).getAttribute('aria-selected')).toBe('true')

    fireEvent.click(screen.getByRole('button', { name: 'server/untouched.go' }))
    expect(await within(screen.getByTestId('run-rail')).findByText('该文件本轮未改动')).toBeTruthy()
  })

  it('keeps only the summary once the process has been purged', async () => {
    mockApi(() => detail({ purged: true, patch: null, events: [] }))
    renderChat()
    const [card] = await screen.findAllByTestId('run-card')
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
    const [card] = await screen.findAllByTestId('run-card')
    fireEvent.click(within(card!).getByRole('button', { name: '查看过程' }))
    expect((await screen.findByRole('complementary', { name: '侧栏' })).className).toContain(
      'chat__rail--overlay',
    )
  })
})
