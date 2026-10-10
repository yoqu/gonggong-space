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
import { tabKey, useBench, useWorkbench, WORKBENCH_MAX_TABS } from '../src/app/workbench'
import { useWorkspace } from '../src/app/workspace'
import { TabLabel } from '../src/features/workbench/TabContent'

const me: UserDto = {
  id: 'u1',
  account: 'wanglei',
  name: '王磊',
  role: 'member',
  mustChangePassword: false,
  disabled: false,
  gitProtocol: 'auto',
  email: null,
  avatar: null,
}
const group: GroupDto = {
  id: 'g1',
  teamId: 't1',
  name: '退款 v2 迁移',
  kind: 'group',
  mode: 'partition',
  adminOnlyInvite: false,
  notice: '',
  noticeHidden: false,
  repo: { url: 'git@git.corp:pay/refund.git', branch: 'main' },
  members: [{ userId: 'u1', name: '王磊', avatar: null, isAdmin: true }],
  botIds: ['b1'],
  unread: 0,
  lastSeq: 3,
  last: '',
  pinned: false,
  muted: false,
  foldRuns: false,
  liveRunIds: [],
}
const bot: BotDto = {
  id: 'b1',
  teamId: 't1',
  name: '小王的 Claude',
  ownerId: 'u1',
  ownerName: '王磊',
  agentKind: 'claude',
  avatar: 'role-no',
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
  gitName: null,
  gitEmail: null,
  gitDefaultEmail: 'b1@bots.gonggong.local',
  sharedWith: [],
  approval: 'ask',
  allowlist: [],
  alwaysAllow: [],
  model: null,
  effort: null,
  catalog: null,
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
      remember: [],
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
  model: null,
  effort: null,
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
  run: run({ model: 'opus', effort: 'high' }),
  patch,
  purged: false,
  patchRepos: [],
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

function mockApi(runDetail: () => RunDetailDto, extra: Record<string, () => unknown> = {}) {
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
    'GET /runs/r1/session': () => ({ rounds: [] }),
    ...extra,
  }
  // A bot workspace's changes: this turn's patch, other scopes from the fixtures below.
  const diff = (url: string) => {
    const scope = new URL(url, 'http://x').searchParams.get('scope')
    if (scope === 'turn')
      return { scope, patch: runDetail().patch, base: null, branch: 'feat/refund', repos: [] }
    if (scope === 'uncommitted')
      return { scope, patch: UNCOMMITTED, base: null, branch: 'feat/refund', repos: [] }
    return { scope, patch: null, base: 'main', branch: 'feat/refund', repos: [] }
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

/** Stands in for the workbench column (layout slice): every tab body of the group, mounted, with its label. */
/** Tab titles as data attributes; the bodies render in the real workbench. */
function Bench() {
  const { tabs } = useBench()
  return (
    <>
      {tabs.map((t) => (
        <section key={tabKey(t)} data-testid={`bench-${tabKey(t)}`}>
          <TabLabel tab={t}>
            {(m) => (
              <h2 data-status={m.status} data-icon={m.icon}>
                {m.title}
              </h2>
            )}
          </TabLabel>
        </section>
      ))}
    </>
  )
}

const renderChat = (at = '/g/g1') =>
  render(
    <MemoryRouter initialEntries={[at]}>
      <App />
      <Bench />
    </MemoryRouter>,
  )

const tabs = () => useWorkbench.getState().benches.g1?.tabs ?? []

beforeEach(() => {
  Object.defineProperty(window, 'innerWidth', { configurable: true, value: 1440 })
  vi.stubGlobal('WebSocket', FakeSocket)
  useSession.setState({ user: me, status: 'ready' })
  useWorkspace.setState({ groups: [], bots: [], machines: [], activeGroupId: null })
  useWorkbench.setState({ groupId: 'g1', open: false, benches: {} })
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

describe('run tab', () => {
  const openProcess = async () => {
    const card = (await screen.findAllByTestId('run-card')).at(-1)
    fireEvent.click(within(card!).getByRole('button', { name: '查看过程' }))
    return screen.findByTestId('run-tab')
  }

  it('opens from the card with process, diff and approval views, and live-updates', async () => {
    let current = detail()
    const calls = mockApi(() => current)
    renderChat()
    const rail = await openProcess()
    expect(tabs()).toEqual([{ kind: 'run', runId: 'r1', view: 'process', file: null }])
    expect(useWorkbench.getState().open).toBe(true)
    expect(await within(rail).findByText('本轮上下文')).toBeTruthy()
    expect(rail.textContent).toContain('opus · 高')
    // The tab bar closes tabs: no rail close button.
    expect(within(rail).queryByRole('button', { name: '关闭' })).toBeNull()
    // Machine and session id stay behind ⓘ.
    expect(rail.textContent).not.toContain('wanglei-mbp')
    fireEvent.click(within(rail).getByRole('button', { name: '机器与会话' }))
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
    expect(
      within(rail)
        .getByText('正在处理')
        .closest('li')
        ?.querySelector('.ui-mascot')
        ?.getAttribute('data-action'),
    ).toBe('think')
    expect(
      within(rail).getByText('正在处理').closest('li')?.querySelector('.ui-mascot[data-role]'),
    ).toBeTruthy()

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

    // 改动 lists this turn's files beside the picked one's diff, written back to the tab.
    fireEvent.click(within(rail).getByRole('tab', { name: '改动' }))
    expect(tabs()[0]).toMatchObject({ view: 'diff', file: null })
    expect(rail.textContent).toContain('a.ts')
    expect(rail.textContent).toContain('+2')
    expect(rail.textContent).toContain('−1')
    expect(await within(rail).findByText('+second line')).toBeTruthy()
    fireEvent.click(within(rail).getByRole('button', { name: /b\.md/ }))
    expect(tabs()[0]).toMatchObject({ view: 'diff', file: 'docs/b.md' })
    expect(await within(rail).findByText('+# b')).toBeTruthy()
    fireEvent.click(within(rail).getByRole('radio', { name: '未提交' }))
    expect(tabs()[0]).toMatchObject({ file: null })
    expect(await within(rail).findByText('+wip')).toBeTruthy()
    fireEvent.click(within(rail).getByRole('radio', { name: '对比主分支' }))
    expect(await within(rail).findByText('feat/refund 相对 main 没有改动')).toBeTruthy()

    fireEvent.click(within(rail).getByRole('tab', { name: '审批记录' }))
    expect(tabs()[0]).toMatchObject({ view: 'audit' })
    expect(rail.textContent).toContain('echo hello-approval')
    expect(rail.textContent).toContain('王磊 已批准')
    expect(rail.textContent).toContain(
      '审批与提问记录永久保存；完整运行过程保留 30 天，过期后卡片只保留摘要。',
    )
  })

  it('streams text onto the stored reply and drops it once the process is refetched', async () => {
    const [tool] = detail().events.slice(-1)
    let current = detail({ events: [tool!, { id: 4, at, event: { kind: 'text', delta: '改完了' } }] })
    mockApi(() => current)
    renderChat()
    const rail = await openProcess()
    expect(await within(rail).findByText('改完了')).toBeTruthy()
    push({ t: 'run.delta', runId: 'r1', text: '，' })
    push({ t: 'run.delta', runId: 'r1', text: '收尾' })
    expect(await within(rail).findByText('改完了，收尾')).toBeTruthy()
    current = detail({ events: [{ id: 4, at, event: { kind: 'text', delta: '改完了，收尾。' } }] })
    push({ t: 'run.progress', runId: 'r1', groupId: 'g1', botId: 'b1' })
    expect(await within(rail).findByText('改完了，收尾。')).toBeTruthy()
  })

  it('refetches the process only from its last event, and nothing while the tab is hidden', async () => {
    let current = detail()
    mockApi(() => current)
    renderChat()
    const rail = await openProcess()
    expect(await within(rail).findByText('本轮上下文')).toBeTruthy()
    const urls = (path: string) =>
      vi
        .mocked(fetch)
        .mock.calls.map(([u]) => String(u))
        .filter((u) => u.split('?')[0] === `/api${path}`)
    const [tool] = detail().events.slice(-1)
    current = detail({ events: [tool!, { id: 4, at, event: { kind: 'text', delta: '改完了' } }] })
    push({ t: 'run.updated', run: current.run })
    await waitFor(() => expect(urls('/runs/r1')).toEqual(['/api/runs/r1', '/api/runs/r1?since=3']))
    expect(await within(rail).findByText('改完了')).toBeTruthy()
    expect(within(rail).getByRole('button', { name: /思考\s*先看调用方/ })).toBeTruthy()
    const diffsLive = urls('/groups/g1/bots/b1/diff').length
    push({ t: 'run.progress', runId: 'r1', groupId: 'g1', botId: 'b1' })
    await waitFor(() => expect(urls('/runs/r1').at(-1)).toBe('/api/runs/r1?since=4'))
    await waitFor(() => expect(urls('/groups/g1/bots/b1/diff').length).toBe(diffsLive + 1), { timeout: 3000 })

    act(() => {
      useWorkbench.getState().show({ kind: 'run', runId: 'r2', view: 'process', file: null })
    })
    const diffs = urls('/groups/g1/bots/b1/diff').length
    push({ t: 'run.progress', runId: 'r1', groupId: 'g1', botId: 'b1' })
    push({ t: 'run.delta', runId: 'r1', text: '，收尾' })
    await act(() => new Promise((r) => setTimeout(r, 2100)))
    expect(urls('/runs/r1')).toHaveLength(3)
    expect(urls('/groups/g1/bots/b1/diff')).toHaveLength(diffs)

    act(() => useWorkbench.getState().activate('run:r1'))
    await waitFor(() => expect(urls('/runs/r1')).toHaveLength(4))
  }, 15_000)

  it('titles the tab by bot and round, with the run state as its mark', async () => {
    let current = detail()
    mockApi(() => current, {
      'GET /runs/r1/session': () => ({
        rounds: [{ run: run({ id: 'p1', status: 'completed', endedAt: at }), prompt: '先看看' }],
      }),
    })
    renderChat()
    await openProcess()
    const label = await waitFor(() => screen.getByTestId('bench-run:r1').querySelector('h2')!)
    await waitFor(() => expect(label.textContent).toBe('小王的 Claude · 第 2 轮'))
    expect(label.dataset.status).toBe('running')
    expect(label.dataset.icon).toBe('square-terminal')
    current = detail({ run: run({ status: 'completed', endedAt: at }) })
    push({ t: 'run.updated', run: current.run })
    await waitFor(() => expect(label.dataset.status).toBe('done'))
    push({ t: 'run.updated', run: run({ status: 'interrupted', endedAt: at }) })
    await waitFor(() => expect(label.dataset.status).toBe('failed'))
  })

  it('renders replies as markdown and copies the session id', async () => {
    const base = detail()
    mockApi(() => ({
      ...base,
      events: [...base.events, { id: 9, at, event: { kind: 'text', delta: '改好了 **加粗** `code`' } }],
    }))
    const writeText = vi.fn(async (_: string) => {})
    vi.stubGlobal('navigator', { ...navigator, clipboard: { writeText } })
    renderChat()
    const rail = await openProcess()
    expect((await within(rail).findByText('加粗')).tagName).toBe('STRONG')
    expect(within(rail).getByText('code').tagName).toBe('CODE')
    expect(rail.textContent).not.toContain('**')

    fireEvent.click(within(rail).getByRole('button', { name: '机器与会话' }))
    fireEvent.click(within(rail).getByRole('button', { name: '复制会话 ID' }))
    await waitFor(() => expect(writeText).toHaveBeenCalledWith('sess-7f3a'))
    writeText.mockRejectedValueOnce(new Error('denied'))
    fireEvent.click(within(rail).getByRole('button', { name: '复制会话 ID' }))
    expect(await screen.findByText('复制失败')).toBeTruthy()
  })

  it('opens the diff of a file path clicked in a bot reply', async () => {
    mockApi(detail)
    renderChat()
    fireEvent.click(await screen.findByRole('button', { name: 'a.ts' }))
    expect(tabs()).toEqual([{ kind: 'run', runId: 'r1', view: 'diff', file: 'src/a.ts' }])
    const tab = await screen.findByTestId('run-tab')
    expect(await within(tab).findByText('+second line')).toBeTruthy()

    fireEvent.click(screen.getByRole('button', { name: 'untouched.go' }))
    expect(tabs()).toHaveLength(1)
    expect(await within(tab).findByText('server/untouched.go 在这个范围内没有改动')).toBeTruthy()
  })

  it('opens the run (and file) linked from a notification or search hit', async () => {
    mockApi(detail)
    renderChat('/g/g1?run=r1&file=src%2Fa.ts')
    const tab = await screen.findByTestId('run-tab')
    expect(tabs()).toEqual([{ kind: 'run', runId: 'r1', view: 'diff', file: 'src/a.ts' }])
    expect(await within(tab).findByText('+second line')).toBeTruthy()
  })

  it('opens the preview linked from a Feishu card', async () => {
    const preview = {
      id: 'p1',
      groupId: 'g1',
      groupName: '退款 v2 迁移',
      botId: 'b1',
      botName: '小王的 Claude',
      kind: 'http' as const,
      title: '登录页',
      path: '/login',
      serviceId: null,
      serviceName: null,
      port: 5173,
      snapshotAt: null,
      status: 'online' as const,
      awaiting: null,
      snapshotError: null,
      live: null,
      control: null,
      canManage: false,
      createdAt: '2026-09-27T10:00:00Z',
    }
    mockApi(detail, {
      'GET /groups/g1/previews': () => ({ previews: [preview], services: [], manageableBotIds: [] }),
    })
    renderChat('/g/g1?preview=p1')
    await waitFor(() => expect(tabs()).toEqual([{ kind: 'web', previewId: 'p1', path: '/login' }]))
  })

  it('says so when the workbench is full', async () => {
    mockApi(detail)
    useWorkbench.setState({
      benches: {
        g1: {
          tabs: Array.from({ length: WORKBENCH_MAX_TABS }, (_, i) => ({
            kind: 'web' as const,
            previewId: `p${i}`,
            path: '/',
          })),
          active: null,
          used: {},
        },
      },
    })
    render(
      <MemoryRouter initialEntries={['/g/g1']}>
        <App />
      </MemoryRouter>,
    )
    const card = (await screen.findAllByTestId('run-card')).at(-1)
    fireEvent.click(within(card!).getByRole('button', { name: '查看过程' }))
    expect(await screen.findByText('标签页已满（最多 12 个），请先关闭一些')).toBeTruthy()
    expect(tabs().some((t) => t.kind === 'run')).toBe(false)
  })

  it('keeps only the summary once the process has been purged', async () => {
    mockApi(() => detail({ purged: true, patch: null, events: [] }))
    renderChat()
    const rail = await openProcess()
    expect(await within(rail).findByText('运行过程已过期，仅保留摘要')).toBeTruthy()
    fireEvent.click(within(rail).getByRole('tab', { name: '审批记录' }))
    expect(rail.textContent).toContain('echo hello-approval')
  })

  it('reveals the earlier rounds of the session above this one, one per click', async () => {
    const past = (id: string, reply: string) =>
      detail({
        run: run({ id, status: 'completed', endedAt: at, approvals: [] }),
        events: [{ id: 1, at, event: { kind: 'text', delta: reply } }],
      })
    const calls = mockApi(detail, {
      'GET /runs/r1/session': () => ({
        rounds: [
          { run: run({ id: 'p1', status: 'completed', endedAt: at }), prompt: '@小王的 Claude 先看看' },
          { run: run({ id: 'p2', status: 'completed', endedAt: at }), prompt: '@小王的 Claude 再改改' },
        ],
      }),
      'GET /runs/p1': () => past('p1', '第一轮回复'),
      'GET /runs/p2': () => past('p2', '第二轮回复'),
    })
    renderChat()
    const rail = await openProcess()
    fireEvent.click(await within(rail).findByRole('button', { name: '查看上一轮（还有 2 轮）' }))
    expect(await within(rail).findByText('第二轮回复')).toBeTruthy()
    expect(rail.textContent).toContain('@小王的 Claude 再改改')
    expect(within(rail).getByText('本轮')).toBeTruthy()
    expect(calls).not.toContain('GET /runs/p1')

    fireEvent.click(within(rail).getByRole('button', { name: '查看上一轮（还有 1 轮）' }))
    expect(await within(rail).findByText('第一轮回复')).toBeTruthy()
    const text = rail.textContent!
    expect(text.indexOf('第一轮回复')).toBeLessThan(text.indexOf('第二轮回复'))
    expect(within(rail).queryByRole('button', { name: /查看上一轮/ })).toBeNull()

    // A round folds to its header.
    fireEvent.click(within(rail).getByRole('button', { name: /再改改/ }))
    expect(within(rail).queryByText('第二轮回复')).toBeNull()
  })
})

describe('process timeline', () => {
  const openRail = async () => {
    const card = (await screen.findAllByTestId('run-card')).at(-1)
    fireEvent.click(within(card!).getByRole('button', { name: '查看过程' }))
    return screen.findByTestId('run-tab')
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
            reason: null,
            tier: null,
            model: null,
            effort: null,
            context: null,
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
    await within(list).findByRole('button', { name: /已编辑\s*a\.ts\s*\+2 −1/ })
    fireEvent.click(seg)
    expect(seg.getAttribute('aria-expanded')).toBe('false')
    fireEvent.click(seg)
    fireEvent.click(within(list).getByRole('button', { name: /已编辑\s*a\.ts\s*\+2 −1/ }))
    expect(tabs()[0]).toMatchObject({ view: 'diff', file: '/h/ws/src/a.ts' })
    expect(await within(rail).findByText('+second line')).toBeTruthy()
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
    // The dock under the run counts them on every view and leads back to the row.
    fireEvent.click(within(rail).getByRole('tab', { name: '改动' }))
    const dock = within(rail).getByTestId('activity-dock')
    const head = within(dock).getByRole('button', { name: /子 agent 1 个运行中\s*后台任务 1 个运行中/ })
    fireEvent.click(head)
    const scroll = vi.fn()
    Element.prototype.scrollIntoView = scroll
    fireEvent.click(within(dock).getByRole('button', { name: /^pnpm dev/ }))
    expect(tabs()[0]).toMatchObject({ view: 'process' })
    await waitFor(() => expect(scroll).toHaveBeenCalled())
    expect((scroll.mock.contexts[0] as HTMLElement).dataset.family).toBe('task')
    delete (Element.prototype as Partial<Element>).scrollIntoView
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

  it('shows a five-cell +/− bar per file in the diff view', async () => {
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
