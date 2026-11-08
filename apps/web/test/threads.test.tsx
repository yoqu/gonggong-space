import type {
  BotDto,
  GroupDto,
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
  useInspector.setState({ view: null, payload: null })
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
    const card = (await screen.findByText('发版前要不要冻结主干？')).closest('button') as HTMLElement
    expect(within(card).getByText('[有人@我]')).toBeTruthy()
    expect(within(card).getByText('要，周四开始')).toBeTruthy()
    fireEvent.click(card)
    expect(await panel()).toBeTruthy()
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
