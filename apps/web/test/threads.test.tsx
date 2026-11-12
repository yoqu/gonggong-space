import type {
  BotDto,
  GroupDto,
  GroupThreadsDto,
  MessageDto,
  RunDto,
  ThreadDto,
  ThreadInboxDto,
  UserDto,
  WebEvent,
} from '@gonggong/protocol'
import { act, fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import { MemoryRouter } from 'react-router'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { App } from '../src/App'
import { useInspector } from '../src/app/inspector'
import { useSession } from '../src/app/session'
import { useWorkspace } from '../src/app/workspace'
import { useQuote } from '../src/features/attachments/quote'
import { useRunDeltas } from '../src/features/chat/deltas'
import { useRecalled } from '../src/features/chat/recalled'
import { fullTime } from '../src/lib/time'
import { mockApi } from './mockApi'

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

const group = (o: Partial<GroupDto> = {}): GroupDto => ({
  id: 'g1',
  teamId: 't1',
  name: '退款 v2 迁移',
  kind: 'group',
  mode: 'partition',
  adminOnlyInvite: false,
  protectBase: false,
  notice: '',
  noticeHidden: false,
  avatar: null,
  repo: null,
  members: [
    { userId: 'u1', name: '王磊', avatar: null, isAdmin: true },
    { userId: 'u2', name: '李建国', avatar: null, isAdmin: false },
  ],
  botIds: ['b1'],
  unread: 0,
  lastSeq: 9,
  last: '',
  pinned: false,
  notifyLevel: 'mentions',
  foldRuns: false,
  liveRunIds: [],
  liveRuns: [],
  ...o,
})

const bot: BotDto = {
  id: 'b1',
  teamId: 't1',
  name: '小王的 Claude',
  ownerId: 'u1',
  ownerName: '王磊',
  agentKind: 'claude',
  avatar: 'role-no',
  followAgent: false,
  avatarUrl: null,
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
  groupCount: 0,
  defaultWorkspace: null,
  gitName: null,
  gitEmail: null,
  gitDefaultEmail: 'b1@bots.gonggong.local',
  sharedWith: [],
  agentSettings: {},
  approval: 'ask',
  allowlist: [],
  alwaysAllow: [],
  aiReview: false,
  reviewModel: null,
  model: null,
  effort: null,
  catalog: null,
}

const t0 = Date.parse('2026-09-23T02:00:00.000Z')
const min = (n: number) => new Date(t0 + n * 60_000).toISOString()

const msg = (o: Partial<MessageDto>): MessageDto => ({
  id: `m${o.seq}`,
  seq: 1,
  groupId: 'g1',
  kind: 'user',
  authorId: 'u2',
  authorName: '李建国',
  body: `第 ${o.seq} 条`,
  mentions: [],
  runId: null,
  createdAt: min(o.seq ?? 1),
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
  hop: 1,
  status: 'running',
  step: '读取 server/refund.go',
  filesChanged: 0,
  usage: null,
  newSessionReason: null,
  parentRunId: null,
  hopMax: 5,
  offlineWaitMin: 30,
  originUserId: 'u1',
  approvals: [],
  questions: [],
  interrupt: null,
  stoppedBy: null,
  delegation: { subagents: 0, subagentsRunning: 0, tasksRunning: 0 },
  model: null,
  effort: null,
  queuedAt: min(1),
  startedAt: min(1),
  endedAt: null,
  lastActivityAt: min(1),
  ...o,
})

const root = msg({
  seq: 1,
  body: '发版前要不要冻结主干？',
  thread: { replyCount: 2, lastReplyAt: min(3), participants: ['u2', 'b1'] },
})
const replies = [
  msg({ seq: 2, body: '要，周四开始', threadRootId: 'm1' }),
  msg({ seq: 3, kind: 'bot', authorId: 'b1', authorName: '小王的 Claude', body: '同意', threadRootId: 'm1' }),
]
const threadDto = (o: Partial<ThreadDto> = {}): ThreadDto => ({
  root,
  replies,
  runs: [],
  state: { rootId: 'm1', groupId: 'g1', following: true, lastReadSeq: 1, unread: 2, mentioned: false },
  ...o,
})

class FakeSocket {
  static last: FakeSocket | undefined
  onmessage: ((e: { data: string }) => void) | null = null
  constructor() {
    FakeSocket.last = this
  }
  close() {}
}
const push = (e: WebEvent) => act(() => FakeSocket.last!.onmessage!({ data: JSON.stringify(e) }))

const renderAt = (path: string, routes: Record<string, unknown> = {}) => {
  const calls = mockApi({
    'GET /groups': [group()],
    'GET /bots': [bot],
    'GET /machines': [],
    'GET /notifications/unread': { n: 0 },
    'GET /threads/unread': { unread: 1, mentioned: 0 },
    'GET /groups/g1/timeline?limit=50': { messages: [root], runs: [] },
    'GET /messages/m1/thread?limit=50': threadDto(),
    'PUT /messages/m1/thread/read': threadDto().state,
    ...routes,
  })
  render(
    <MemoryRouter initialEntries={[path]}>
      <App />
    </MemoryRouter>,
  )
  return calls
}

beforeEach(() => {
  Object.defineProperty(window, 'innerWidth', { configurable: true, value: 1440 })
  vi.stubGlobal('WebSocket', FakeSocket)
  Element.prototype.scrollIntoView = vi.fn()
  useSession.setState({ user: me, status: 'ready' })
  useWorkspace.setState({ groups: [], bots: [], machines: [], activeGroupId: null })
  useInspector.setState({ view: null, payload: null, back: null })
  useQuote.setState({ quote: null })
  useWorkspace.setState({ pins: {} })
})
afterEach(() => {
  vi.unstubAllGlobals()
})

const panel = () => screen.findByRole('complementary', { name: '话题' })

describe('thread root in the main timeline', () => {
  it('shows the reply bar and opens the thread in the rail, marking it read', async () => {
    const calls = renderAt('/g/g1')
    fireEvent.click(await screen.findByRole('button', { name: /2 条回复/ }))
    const rail = await panel()
    expect(await within(rail).findByText('要，周四开始')).toBeTruthy()
    expect(within(rail).getByText('同意')).toBeTruthy()
    expect(within(rail).getByText('发版前要不要冻结主干？')).toBeTruthy()
    await waitFor(() =>
      expect(calls).toContainEqual(
        expect.objectContaining({ method: 'PUT', path: '/messages/m1/thread/read', body: { seq: 3 } }),
      ),
    )
  })

  it('opens a thread from the hover bar of any message', async () => {
    renderAt('/g/g1', {
      'GET /groups/g1/timeline?limit=50': { messages: [msg({ seq: 1, body: '没人回过' })], runs: [] },
      'GET /messages/m1/thread?limit=50': threadDto({ root: msg({ seq: 1, body: '没人回过' }), replies: [] }),
    })
    const bubble = await screen.findByText('没人回过')
    const row = bubble.closest('.pn-msg') as HTMLElement
    fireEvent.click(within(row).getByRole('button', { name: '回复话题' }))
    const rail = await panel()
    expect(within(rail).getByText('0 条回复')).toBeTruthy()
  })

  it('keeps live thread replies out of the main timeline and updates the bar', async () => {
    renderAt('/g/g1')
    await screen.findByText('发版前要不要冻结主干？')
    push({ t: 'message.new', message: msg({ seq: 4, body: '话题里的新回复', threadRootId: 'm1' }) })
    push({
      t: 'thread.updated',
      groupId: 'g1',
      rootId: 'm1',
      thread: { replyCount: 3, lastReplyAt: min(4), participants: ['u2', 'b1'] },
    })
    expect(await screen.findByRole('button', { name: /3 条回复/ })).toBeTruthy()
    expect(screen.queryByText('话题里的新回复')).toBeNull()
    expect(screen.getByTestId('group-item-g1').textContent).not.toContain('话题里的新回复')
    push({
      t: 'message.new',
      message: msg({ seq: 5, body: '也发到群里', threadRootId: 'm1', alsoSent: true }),
    })
    expect(await screen.findByText('也发到群里')).toBeTruthy()
    expect(screen.getByText('回复了话题')).toBeTruthy()
  })

  it('shows a thread run on its root, not as a card in the main timeline', async () => {
    renderAt('/g/g1', {
      'GET /groups/g1/timeline?limit=50': { messages: [root], runs: [run({ threadRootId: 'm1' })] },
    })
    expect(await screen.findByText('Bot 回复中')).toBeTruthy()
    expect(screen.queryByTestId('run-card')).toBeNull()
  })

  it('opens the thread of a ?thread= link', async () => {
    renderAt('/g/g1?thread=m1')
    const rail = await panel()
    expect(await within(rail).findByText('要，周四开始')).toBeTruthy()
  })
})

describe('thread composer', () => {
  it('replies in the thread, also to the group when asked', async () => {
    const sent: unknown[] = []
    renderAt('/g/g1', {
      'POST /groups/g1/messages': (body: unknown) => {
        sent.push(body)
        return msg({ seq: 9, body: '收到', threadRootId: 'm1', authorId: 'u1', authorName: '王磊' })
      },
    })
    fireEvent.click(await screen.findByRole('button', { name: /2 条回复/ }))
    const rail = await panel()
    const input = within(rail).getByRole('combobox')
    fireEvent.change(input, { target: { value: '收到' } })
    fireEvent.click(within(rail).getByRole('checkbox', { name: '同时发送到群' }))
    fireEvent.click(within(rail).getByRole('button', { name: '发送' }))
    await waitFor(() => expect(sent).toHaveLength(1))
    expect(sent[0]).toMatchObject({ body: '收到', threadRootId: 'm1', alsoSent: true })
    expect(await within(rail).findByText('收到')).toBeTruthy()
  })
})

describe('话题 inbox', () => {
  const inbox: ThreadInboxDto = {
    threads: [
      {
        groupId: 'g1',
        groupName: '退款 v2 迁移',
        root,
        latest: replies,
        state: { rootId: 'm1', groupId: 'g1', following: true, lastReadSeq: 1, unread: 2, mentioned: true },
      },
    ],
  }

  it('lists followed threads; the sidebar counts only @s', async () => {
    renderAt('/threads', {
      'GET /threads': inbox,
      'GET /threads/unread': { unread: 3, mentioned: 1 },
    })
    const row = await screen.findByTestId('threads-item')
    await waitFor(() => expect(within(row).getByText('3 个话题有新回复')).toBeTruthy())
    expect(within(row).getByText('1')).toBeTruthy()
    const card = (await screen.findByText('发版前要不要冻结主干？')).closest('article') as HTMLElement
    expect(within(card).getByText('[有人@我]')).toBeTruthy()
    expect(within(card).getByText('要，周四开始')).toBeTruthy()
    fireEvent.click(within(card).getByRole('button', { name: /发版前要不要冻结主干/ }))
    expect(await panel()).toBeTruthy()
  })

  it('replies from the card without leaving the page, then collapses and reloads', async () => {
    const sent: unknown[] = []
    let loads = 0
    renderAt('/threads', {
      'GET /threads': () => {
        loads++
        return inbox
      },
      'POST /groups/g1/messages': (body: unknown) => {
        sent.push(body)
        return msg({ seq: 9, body: '收到', threadRootId: 'm1', authorId: 'u1', authorName: '王磊' })
      },
    })
    const card = (await screen.findByText('发版前要不要冻结主干？')).closest('article') as HTMLElement
    fireEvent.click(within(card).getByRole('button', { name: '回复' }))
    const input = within(card).getByPlaceholderText('回复话题，@ 触发 Bot')
    fireEvent.click(input)
    expect(screen.queryByRole('complementary', { name: '话题' })).toBeNull()
    fireEvent.change(input, { target: { value: '收到' } })
    fireEvent.click(within(card).getByRole('button', { name: '发送' }))
    await waitFor(() => expect(sent).toHaveLength(1))
    expect(sent[0]).toMatchObject({ body: '收到', threadRootId: 'm1' })
    await waitFor(() => expect(within(card).queryByPlaceholderText('回复话题，@ 触发 Bot')).toBeNull())
    await waitFor(() => expect(loads).toBe(2))
  })

  it('focuses the card composer when it opens and closes it on Esc, back on 回复', async () => {
    renderAt('/threads', { 'GET /threads': inbox })
    const card = (await screen.findByText('发版前要不要冻结主干？')).closest('article') as HTMLElement
    fireEvent.click(within(card).getByRole('button', { name: '回复' }))
    const input = within(card).getByPlaceholderText('回复话题，@ 触发 Bot')
    await waitFor(() => expect(document.activeElement).toBe(input))
    fireEvent.keyDown(input, { key: 'Escape' })
    await waitFor(() =>
      expect(document.activeElement).toBe(within(card).getByRole('button', { name: '回复' })),
    )
  })

  it('marks a card read, all of them from the header, and unfollows with 撤销', async () => {
    const calls = renderAt('/threads', {
      'GET /threads': inbox,
      'PUT /messages/m1/thread/follow': threadDto().state,
    })
    const main = await screen.findByRole('region', { name: '话题' })
    const card = (await within(main).findByText('发版前要不要冻结主干？')).closest('article') as HTMLElement
    expect(card.hasAttribute('data-unread')).toBe(true)
    fireEvent.click(within(main).getByRole('button', { name: '全部标为已读' }))
    expect(card.hasAttribute('data-unread')).toBe(false)
    expect(within(card).queryByRole('button', { name: '标为已读' })).toBeNull()
    expect(within(main).queryByRole('button', { name: '全部标为已读' })).toBeNull()
    await waitFor(() =>
      expect(calls.some((c) => c.method === 'PUT' && c.path === '/messages/m1/thread/read')).toBe(true),
    )

    fireEvent.click(within(card).getByRole('button', { name: '取消关注' }))
    expect(card.classList.contains('ui-leaving')).toBe(true)
    await waitFor(() => expect(within(main).queryByText('发版前要不要冻结主干？')).toBeNull())
    fireEvent.click(await screen.findByRole('button', { name: '撤销' }))
    await waitFor(() =>
      expect(calls.filter((c) => c.path === '/messages/m1/thread/follow').map((c) => c.body)).toEqual([
        { following: false },
        { following: true },
      ]),
    )
  })

  it('confirms following from the thread rail', async () => {
    renderAt('/g/g1?thread=m1', {
      'PUT /messages/m1/thread/follow': { ...threadDto().state, following: false },
    })
    fireEvent.click(await within(await panel()).findByRole('button', { name: '取消关注' }))
    expect(await screen.findByText('已取消关注话题')).toBeTruthy()
  })

  it('shows no count for new replies without an @', async () => {
    renderAt('/threads', {
      'GET /threads': { threads: [] },
      'GET /threads/unread': { unread: 2, mentioned: 0 },
    })
    const row = await screen.findByTestId('threads-item')
    await waitFor(() => expect(within(row).getByText('2 个话题有新回复')).toBeTruthy())
    expect(row.querySelector('.ui-badge')).toBeNull()
    expect(await screen.findByText('还没有关注的话题')).toBeTruthy()
  })
})

describe('thread runs', () => {
  const threadRun = run({ threadRootId: 'm1' })
  const delta = (runId: string, text: string) => push({ t: 'run.delta', runId, text, lastActivityAt: min(2) })
  const withRuns = (extra: RunDto[] = []) => ({
    'GET /groups/g1/timeline?limit=50': { messages: [root], runs: [threadRun, ...extra] },
    'GET /messages/m1/thread?limit=50': threadDto({ runs: [threadRun] }),
  })
  beforeEach(() => useRunDeltas.setState({}, true))

  it('gathers a streamed fragment once while the thread is open', async () => {
    renderAt('/g/g1?thread=m1', withRuns())
    await panel()
    await screen.findByTestId('run-card')
    delta('r1', '我来看看')
    await waitFor(() => expect(useRunDeltas.getState().r1).toBe('我来看看'))
    await new Promise((r) => setTimeout(r, 250))
    expect(useRunDeltas.getState().r1).toBe('我来看看')
  })

  it('keeps the main channel stream when the thread closes', async () => {
    const mainRun = run({ id: 'r2', triggerMessageId: 'm1' })
    renderAt('/g/g1?thread=m1', withRuns([mainRun]))
    const rail = await panel()
    await within(rail).findByTestId('run-card')
    delta('r2', '主频道文字')
    await waitFor(() => expect(useRunDeltas.getState().r2).toBe('主频道文字'))
    fireEvent.click(within(rail).getByRole('button', { name: '关闭话题' }))
    await waitFor(() => expect(useInspector.getState().view).toBeNull())
    expect(useRunDeltas.getState().r2).toBe('主频道文字')
  })

  it('keeps gathering a thread run while its thread is closed, its text shown once it opens', async () => {
    renderAt('/g/g1', withRuns())
    const row = await screen.findByTestId('task-dock-row')
    delta('r1', '我来看看')
    await waitFor(() => expect(useRunDeltas.getState().r1).toBe('我来看看'))
    fireEvent.click(within(row).getAllByRole('button')[0] as HTMLElement)
    const pop = screen.getByRole('dialog')
    await waitFor(() =>
      expect((pop.querySelector('.task-pop__time') as HTMLElement).title).toBe(fullTime(min(2))),
    )
    fireEvent.click(within(pop).getByRole('button', { name: '定位' }))
    const rail = await panel()
    expect(await within(rail).findByText(/我来看看/)).toBeTruthy()
  })

  it('marks a thread run in the task dock and opens its thread from the row', async () => {
    renderAt('/g/g1', withRuns())
    const row = await screen.findByTestId('task-dock-row')
    expect(within(row).getByText('话题')).toBeTruthy()
    fireEvent.click(within(row).getAllByRole('button')[0] as HTMLElement)
    fireEvent.click(within(screen.getByRole('dialog')).getByRole('button', { name: '定位' }))
    const rail = await panel()
    await within(rail).findByTestId('run-card')
    await waitFor(() => expect(Element.prototype.scrollIntoView).toHaveBeenCalled())
    expect((Element.prototype.scrollIntoView as ReturnType<typeof vi.fn>).mock.contexts.at(-1)).toBe(
      within(rail).getByTestId('run-card'),
    )
  })
})

describe('群内话题列表', () => {
  const second = msg({
    seq: 6,
    id: 'm6',
    body: '另一个话题',
    authorName: '赵敏',
    thread: { replyCount: 4, lastReplyAt: min(8), participants: ['u2'] },
  })
  const quiet = msg({
    seq: 7,
    id: 'm7',
    body: '安静的话题',
    thread: { replyCount: 1, lastReplyAt: min(5), participants: ['u2'] },
  })
  const state = (rootId: string, o: Partial<ThreadDto['state']> = {}): ThreadDto['state'] => ({
    rootId,
    groupId: 'g1',
    following: true,
    lastReadSeq: 0,
    unread: 0,
    mentioned: false,
    ...o,
  })
  const list: GroupThreadsDto = {
    threads: [
      { root, state: state('m1'), live: true },
      { root: second, state: state('m6', { unread: 3, mentioned: true }), live: false },
      { root: quiet, state: state('m7'), live: false },
    ],
    next: 5,
  }
  const openList = async (routes: Record<string, unknown> = {}) => {
    const calls = renderAt('/g/g1', { 'GET /groups/g1/threads': list, ...routes })
    fireEvent.click(await screen.findByRole('button', { name: '话题' }))
    return { calls, rail: await screen.findByRole('complementary', { name: '本群话题' }) }
  }

  it('lists threads: a bot at work marked, unread and @ shown, then back from a thread', async () => {
    const { rail } = await openList()
    const rows = await within(rail).findAllByTestId('group-thread')
    expect(rows.map((r) => r.textContent)).toEqual([
      expect.stringContaining('发版前要不要冻结主干？'),
      expect.stringContaining('另一个话题'),
      expect.stringContaining('安静的话题'),
    ])
    expect(within(rows[0]!).getByText('Bot 回复中')).toBeTruthy()
    expect(within(rows[1]!).getByText('[有人@我]')).toBeTruthy()
    expect(within(rows[1]!).getByText('3')).toBeTruthy()
    expect(within(rows[1]!).getByText('4 条回复')).toBeTruthy()
    expect(rows[1]!.getAttribute('data-unread')).toBe('true')
    expect(rows[2]!.getAttribute('data-unread')).toBeNull()

    fireEvent.click(rows[2]!)
    const thread = await panel()
    fireEvent.click(within(thread).getByRole('button', { name: '返回' }))
    expect(await screen.findByRole('complementary', { name: '本群话题' })).toBeTruthy()
  })

  it('shows no back button for a thread opened from a message', async () => {
    renderAt('/g/g1')
    fireEvent.click(await screen.findByRole('button', { name: /2 条回复/ }))
    expect(within(await panel()).queryByRole('button', { name: '返回' })).toBeNull()
  })

  it('says so when there are no threads', async () => {
    const { rail } = await openList({ 'GET /groups/g1/threads': { threads: [], next: null } })
    expect(await within(rail).findByText('还没有话题')).toBeTruthy()
    expect(within(rail).getByText('在任意消息上选择「回复话题」即可开始')).toBeTruthy()
  })

  it('loads more when scrolled to the end, and refreshes on thread events', async () => {
    const { calls, rail } = await openList({
      'GET /groups/g1/threads?cursor=5': {
        threads: [{ root: msg({ seq: 9, id: 'm9', body: '更早的话题' }), state: state('m9'), live: false }],
        next: null,
      },
    })
    await within(rail).findAllByTestId('group-thread')
    fireEvent.scroll(rail.querySelector('.group-threads__list') as HTMLElement)
    expect(await within(rail).findByText('更早的话题')).toBeTruthy()
    const before = calls.filter((c) => c.path === '/groups/g1/threads').length
    push({ t: 'thread.state', ...state('m6', { unread: 4 }) })
    await waitFor(() =>
      expect(calls.filter((c) => c.path === '/groups/g1/threads').length).toBeGreaterThan(before),
    )
  })
})

describe('reply bar unread', () => {
  const unreadRoot = (n: number) => ({
    ...root,
    thread: { ...root.thread!, unread: n, mentioned: false },
  })
  const bar = async () => (await screen.findByRole('button', { name: /条回复/ })) as HTMLElement

  it('is bold while the thread has unread replies, and follows my thread state', async () => {
    renderAt('/g/g1', { 'GET /groups/g1/timeline?limit=50': { messages: [unreadRoot(2)], runs: [] } })
    expect((await bar()).className).toContain('pn-thread--unread')
    // A new reply keeps my own count until my state says otherwise.
    push({
      t: 'thread.updated',
      groupId: 'g1',
      rootId: 'm1',
      thread: { replyCount: 3, lastReplyAt: min(4), participants: ['u2', 'b1'] },
    })
    expect((await screen.findByRole('button', { name: /3 条回复/ })).className).toContain('pn-thread--unread')
    push({
      t: 'thread.state',
      rootId: 'm1',
      groupId: 'g1',
      following: true,
      lastReadSeq: 4,
      unread: 0,
      mentioned: false,
    })
    await waitFor(() =>
      expect(screen.getByRole('button', { name: /3 条回复/ }).className).not.toContain('unread'),
    )
  })

  it('is regular without unread', async () => {
    renderAt('/g/g1', { 'GET /groups/g1/timeline?limit=50': { messages: [unreadRoot(0)], runs: [] } })
    expect((await bar()).className).not.toContain('unread')
  })
})

describe('thread root boundaries', () => {
  const recalledRoot = { ...root, body: '', recalled: true }

  it('keeps the reply bar on a recalled root and opens its thread with the root marked recalled', async () => {
    renderAt('/g/g1', {
      'GET /groups/g1/timeline?limit=50': { messages: [recalledRoot], runs: [] },
      'GET /messages/m1/thread?limit=50': threadDto({ root: recalledRoot }),
    })
    const bar = await screen.findByRole('button', { name: /2 条回复/ })
    expect(bar.closest('.tl-recalled-thread')).toBeTruthy()
    fireEvent.click(bar)
    const rail = await panel()
    expect(await within(rail).findByText('要，周四开始')).toBeTruthy()
    expect(within(rail).getByText('该消息已撤回')).toBeTruthy()
  })

  it('shows a root I deleted as a placeholder in its thread, and keeps it when the delete event arrives', async () => {
    renderAt('/g/g1?thread=m1', {
      'GET /messages/m1/thread?limit=50': threadDto({ root: { ...root, body: '', hidden: true } }),
    })
    const rail = await panel()
    expect(await within(rail).findByText('你已删除这条消息')).toBeTruthy()
    expect(within(rail).getByText('要，周四开始')).toBeTruthy()
  })

  it('keeps the open thread when its root is deleted live', async () => {
    renderAt('/g/g1?thread=m1')
    const rail = await panel()
    await within(rail).findByText('发版前要不要冻结主干？')
    push({ t: 'message.hidden', groupId: 'g1', messageId: 'm1' })
    expect(await within(rail).findByText('你已删除这条消息')).toBeTruthy()
    expect(within(rail).getByText('要，周四开始')).toBeTruthy()
  })
})

describe('quote in a thread', () => {
  const mainInput = () => screen.getByPlaceholderText('输入消息，@ 触发 Bot 或引用文件，/ 查看命令')
  const threadInput = (rail: HTMLElement) => within(rail).getByPlaceholderText('回复话题，@ 触发 Bot')

  it('goes to the thread composer from the thread, to the main one from the main channel', async () => {
    renderAt('/g/g1?thread=m1')
    const rail = await panel()
    await within(rail).findByText('要，周四开始')
    const reply = within(rail).getByText('要，周四开始').closest('.pn-msg') as HTMLElement
    fireEvent.click(within(reply).getByRole('button', { name: '引用回复' }))
    expect(useQuote.getState().quote).toMatchObject({ id: 'm2', threadRootId: 'm1' })
    expect(await within(rail).findByText('引用 李建国')).toBeTruthy()
    expect(mainInput().closest('.composer')?.textContent).not.toContain('引用 李建国')
    expect(threadInput(rail)).toBeTruthy()

    const main = screen.getByText('发版前要不要冻结主干？', { selector: '.chat-scroll *' })
    fireEvent.click(within(main.closest('.pn-msg') as HTMLElement).getByRole('button', { name: '引用回复' }))
    expect(useQuote.getState().quote).toMatchObject({ id: 'm1' })
    expect(useQuote.getState().quote?.threadRootId).toBeUndefined()
    await waitFor(() => expect(mainInput().closest('.composer')?.textContent).toContain('引用 李建国'))
    expect(within(rail).queryByText('引用 李建国')).toBeNull()
  })
})

describe('locating a thread reply', () => {
  const many = (from: number, to: number) =>
    Array.from({ length: to - from + 1 }, (_, i) =>
      msg({ seq: from + i, id: `r${from + i}`, threadRootId: 'm1' }),
    )
  const bigThread = (replies: MessageDto[]) => threadDto({ replies })

  it('opens the thread from a pin of a reply and flashes it', async () => {
    useWorkspace.setState({
      pins: {
        g1: [
          {
            messageId: 'm2',
            seq: 2,
            authorName: '李建国',
            text: '要，周四开始',
            attachments: 0,
            threadRootId: 'm1',
            pinnedBy: { id: 'u2', name: '李建国' },
            pinnedAt: min(5),
          },
        ],
      },
    })
    renderAt('/g/g1', { 'GET /groups/g1/pins': { pins: useWorkspace.getState().pins.g1 } })
    fireEvent.click(await screen.findByRole('button', { name: /李建国：要，周四开始/ }))
    const rail = await panel()
    const item = (await within(rail).findByText('要，周四开始')).closest('[data-msg-id]') as HTMLElement
    await waitFor(() => expect(item.className).toContain('tl-item--flash'))
  })

  it('pages back to a reply beyond the first page of a ?thread=&msg= link', async () => {
    const first = many(52, 101)
    const calls = renderAt('/g/g1?thread=m1&msg=r10', {
      'GET /messages/m1/thread?limit=50': bigThread(first),
      'GET /messages/m1/thread?limit=50&before=52': bigThread(many(2, 51)),
    })
    const rail = await panel()
    const item = await waitFor(() => {
      const el = rail.querySelector<HTMLElement>('[data-msg-id="r10"]')
      expect(el).toBeTruthy()
      return el as HTMLElement
    })
    await waitFor(() => expect(item.className).toContain('tl-item--flash'))
    expect(calls.some((c) => c.path === '/messages/m1/thread?limit=50&before=52')).toBe(true)
  })

  it('tells when the linked reply is not in the thread', async () => {
    renderAt('/g/g1?thread=m1&msg=gone')
    await panel()
    expect(await screen.findByText('没找到这条回复')).toBeTruthy()
  })

  it('does not look for the reply in the main timeline', async () => {
    const calls = renderAt('/g/g1?thread=m1&msg=m2')
    await panel()
    await waitFor(() => expect(calls.some((c) => c.path.startsWith('/messages/m1/thread'))).toBe(true))
    expect(calls.filter((c) => c.path.startsWith('/groups/g1/timeline')).length).toBe(1)
  })
})

describe('reply bar marks', () => {
  const marked = (o: { unread: number; mentioned: boolean }) => ({
    ...root,
    thread: { ...root.thread!, ...o },
  })

  it('shows a dot with the new reply count, and @我 when mentioned', async () => {
    renderAt('/g/g1', {
      'GET /groups/g1/timeline?limit=50': { messages: [marked({ unread: 2, mentioned: true })], runs: [] },
    })
    const bar = (await screen.findByRole('button', { name: /2 条回复/ })) as HTMLElement
    expect(within(bar).getByText('2 条新回复')).toBeTruthy()
    expect(within(bar).getByText('@我')).toBeTruthy()
    expect(bar.querySelector('.pn-thread__dot')).toBeTruthy()
  })

  it('shows neither without unread', async () => {
    renderAt('/g/g1', {
      'GET /groups/g1/timeline?limit=50': { messages: [marked({ unread: 0, mentioned: false })], runs: [] },
    })
    const bar = (await screen.findByRole('button', { name: /2 条回复/ })) as HTMLElement
    expect(bar.querySelector('.pn-thread__dot')).toBeNull()
    expect(within(bar).queryByText('@我')).toBeNull()
  })
})

describe('header thread button', () => {
  it('stays active in a thread opened from the list, and returns to the list when clicked', async () => {
    const list: GroupThreadsDto = {
      threads: [
        {
          root,
          state: {
            rootId: 'm1',
            groupId: 'g1',
            following: true,
            lastReadSeq: 0,
            unread: 0,
            mentioned: false,
          },
          live: false,
        },
      ],
      next: null,
    }
    renderAt('/g/g1', { 'GET /groups/g1/threads': list })
    const button = await screen.findByRole('button', { name: '话题' })
    fireEvent.click(button)
    fireEvent.click(await screen.findByTestId('group-thread'))
    await panel()
    expect(screen.getByRole('button', { name: '话题' }).getAttribute('aria-pressed')).toBe('true')
    fireEvent.click(screen.getByRole('button', { name: '话题' }))
    expect(await screen.findByRole('complementary', { name: '本群话题' })).toBeTruthy()
  })
})

describe('thread lists of a root I deleted', () => {
  it('show it as deleted rather than blank', async () => {
    const list: GroupThreadsDto = {
      threads: [
        {
          root: { ...root, body: '', hidden: true },
          state: {
            rootId: 'm1',
            groupId: 'g1',
            following: true,
            lastReadSeq: 0,
            unread: 0,
            mentioned: false,
          },
          live: false,
        },
      ],
      next: null,
    }
    renderAt('/g/g1', { 'GET /groups/g1/threads': list })
    fireEvent.click(await screen.findByRole('button', { name: '话题' }))
    expect(
      await within(await screen.findByTestId('group-thread')).findByText('你已删除这条消息'),
    ).toBeTruthy()
  })
})

describe('re-editing a recalled thread reply', () => {
  beforeEach(() => sessionStorage.clear())

  it('puts the content back into the thread composer, not the main one', async () => {
    const mine = msg({
      seq: 2,
      id: 'm2',
      authorId: 'u1',
      authorName: '王磊',
      recalled: true,
      body: '',
      threadRootId: 'm1',
    })
    useRecalled.setState({
      drafts: { m2: { groupId: 'g1', threadRootId: 'm1', body: '撤回前的话', quote: null, files: [] } },
      pending: null,
    })
    renderAt('/g/g1?thread=m1', { 'GET /messages/m1/thread?limit=50': threadDto({ replies: [mine] }) })
    const rail = await panel()
    fireEvent.click(await within(rail).findByRole('button', { name: '重新编辑' }))
    await waitFor(() =>
      expect((within(rail).getByPlaceholderText('回复话题，@ 触发 Bot') as HTMLTextAreaElement).value).toBe(
        '撤回前的话',
      ),
    )
    expect(
      (screen.getByPlaceholderText('输入消息，@ 触发 Bot 或引用文件，/ 查看命令') as HTMLTextAreaElement)
        .value,
    ).toBe('')
  })
})
