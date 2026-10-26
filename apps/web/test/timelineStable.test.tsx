import type { BotDto, GroupDto, MessageDto, RunDto, UserDto, WebEvent } from '@gonggong/protocol'
import { act, render, screen } from '@testing-library/react'
import { MemoryRouter } from 'react-router'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { App } from '../src/App'
import { useSession } from '../src/app/session'
import { useWorkspace } from '../src/app/workspace'
import { mockApi } from './mockApi'

// Every mention scan (UserMessage text and Markdown's remark plugin) goes through it: a call means a re-render.
const split = vi.hoisted(() => ({ calls: [] as string[] }))
vi.mock('../src/ui/im/message', async (importOriginal) => {
  const mod = await importOriginal<typeof import('../src/ui/im/message')>()
  return {
    ...mod,
    splitMentions: (text: string, names: string[]) => {
      split.calls.push(text)
      return mod.splitMentions(text, names)
    },
  }
})

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
  protectBase: false,
  notice: '',
  noticeHidden: false,
  avatar: null,
  repo: null,
  members: [
    { userId: 'u1', name: '王磊', avatar: null, isAdmin: true },
    { userId: 'u2', name: '李建国', avatar: null, isAdmin: false },
  ],
  botIds: ['b1', 'b2'],
  unread: 0,
  lastSeq: 2,
  last: '',
  pinned: false,
  muted: false,
  foldRuns: false,
  liveRunIds: [],
  liveRuns: [],
}

const bot = (o: Partial<BotDto>): BotDto => ({
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
  model: null,
  effort: null,
  catalog: null,
  ...o,
})
const bots = [bot({}), bot({ id: 'b2', name: '老李的 Codex', agentKind: 'codex' })]

const at = new Date(Date.now() - 3600_000).toISOString()
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

const run = (o: Partial<RunDto>): RunDto => ({
  id: 'r1',
  groupId: 'g1',
  botId: 'b1',
  triggerMessageId: 'm1',
  triggerUserId: 'u1',
  hop: 1,
  status: 'completed',
  step: '',
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
  queuedAt: at,
  startedAt: at,
  endedAt: at,
  lastActivityAt: at,
  ...o,
})

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

beforeEach(() => {
  Object.defineProperty(window, 'innerWidth', { configurable: true, value: 1440 })
  vi.stubGlobal('WebSocket', FakeSocket)
  Element.prototype.scrollIntoView = vi.fn()
  useSession.setState({ user: me, status: 'ready' })
  useWorkspace.setState({ groups: [], bots: [], machines: [], activeGroupId: null })
})
afterEach(() => vi.unstubAllGlobals())

describe('timeline rows stay memoized', () => {
  it('does not re-render or re-parse messages when the group, bots or runs are replaced with equal content', async () => {
    const runs = [run({}), run({ id: 'r2', botId: 'b2', queuedAt: at })]
    mockApi({
      'GET /groups': [group],
      'GET /bots': bots,
      'GET /machines': [],
      'GET /notifications/unread': { n: 0 },
      'GET /groups/g1/timeline?limit=50': {
        messages: [
          msg({ seq: 1, body: '@小王的 Claude @老李的 Codex 看下', mentions: ['b1', 'b2'] }),
          msg({ seq: 2, kind: 'bot', authorId: 'b1', authorName: '小王的 Claude', body: '@李建国 已改好' }),
        ],
        runs,
      },
      'POST /groups/g1/read': group,
    })
    render(
      <MemoryRouter initialEntries={['/g/g1']}>
        <App />
      </MemoryRouter>,
    )
    expect(await screen.findByText('已改好', { exact: false })).toBeTruthy()
    expect(screen.getByText('看下', { exact: false })).toBeTruthy()

    const rows = () => split.calls.filter((s) => s.includes('看下') || s.includes('已改好'))
    split.calls.length = 0
    push({ t: 'group.updated', group: structuredClone(group) })
    push({ t: 'bot.updated', bot: { ...bots[0]!, presence: 'offline' } })
    push({ t: 'run.updated', run: { ...runs[0]!, filesChanged: 1 } })
    await act(async () => {})
    expect(rows()).toEqual([])
  })
})
