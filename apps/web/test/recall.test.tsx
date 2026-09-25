import type { BotDto, GroupDto, MessageDto, UserDto, WebEvent } from '@gonggong/protocol'
import { act, fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import { MemoryRouter } from 'react-router'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { App } from '../src/App'
import { useSession } from '../src/app/session'
import { useWorkspace } from '../src/app/workspace'
import { apiError, mockApi } from './mockApi'

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
  repo: null,
  members: [
    { userId: 'u1', name: '王磊', isAdmin: true },
    { userId: 'u2', name: '李建国', isAdmin: false },
  ],
  botIds: [],
  unread: 0,
  lastSeq: 9,
  last: '',
  pinned: false,
  muted: false,
  foldRuns: false,
}

const HOUR = 3600_000
const msg = (o: Partial<MessageDto>): MessageDto => ({
  id: `m${o.seq}`,
  seq: 1,
  groupId: 'g1',
  kind: 'user',
  authorId: 'u1',
  authorName: '王磊',
  body: `第 ${o.seq} 条`,
  mentions: [],
  runId: null,
  createdAt: new Date(Date.now() - HOUR).toISOString(),
  attachments: [],
  quote: null,
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

const renderChat = (messages: MessageDto[], routes: Record<string, unknown> = {}) => {
  const calls = mockApi({
    'GET /groups': [group],
    'GET /bots': [] as BotDto[],
    'GET /machines': [],
    'GET /notifications': [],
    'GET /groups/g1/timeline?limit=50': { messages, runs: [] },
    'POST /groups/g1/read': group,
    ...routes,
  })
  render(
    <MemoryRouter initialEntries={['/g/g1']}>
      <App />
    </MemoryRouter>,
  )
  return calls
}

const openMore = async (text: string) => {
  const row = (await screen.findByText(text)).closest('.pn-msg') as HTMLElement
  fireEvent.click(within(row).getByRole('button', { name: '更多' }))
  return screen.getAllByRole('menuitem').map((b) => b.textContent)
}

beforeEach(() => {
  Object.defineProperty(window, 'innerWidth', { configurable: true, value: 1440 })
  vi.stubGlobal('WebSocket', FakeSocket)
  Element.prototype.scrollIntoView = vi.fn()
  useSession.setState({ user: me, status: 'ready' })
  useWorkspace.setState({ groups: [], bots: [], machines: [], activeGroupId: null })
})
afterEach(() => vi.unstubAllGlobals())

describe('更多 menu', () => {
  it('offers 撤回 and 删除 on my own messages, after 复制链接', async () => {
    renderChat([msg({ seq: 1, body: '我的消息' })])
    expect(await openMore('我的消息')).toEqual(['复制链接', '撤回', '删除'])
  })

  it('hides 撤回 once my message is older than 24 hours', async () => {
    renderChat([msg({ seq: 1, body: '旧消息', createdAt: new Date(Date.now() - 25 * HOUR).toISOString() })])
    expect(await openMore('旧消息')).toEqual(['复制链接', '删除'])
  })

  it("offers neither on other members' messages", async () => {
    renderChat([msg({ seq: 1, authorId: 'u2', authorName: '李建国', body: '别人的' })])
    expect(await openMore('别人的')).toEqual(['复制链接'])
  })
})

describe('recall', () => {
  it('replaces my message with a notice right away', async () => {
    const m = msg({ seq: 1, body: '说错了' })
    const calls = renderChat([m], {
      'POST /messages/m1/recall': { ...m, body: '', recalled: true, reactions: [] },
    })
    await openMore('说错了')
    fireEvent.click(screen.getByRole('menuitem', { name: '撤回' }))
    expect(await screen.findByText('你撤回了一条消息')).toBeTruthy()
    expect(screen.queryByText('说错了')).toBeNull()
    expect(calls.some((c) => c.method === 'POST' && c.path === '/messages/m1/recall')).toBe(true)
  })

  it("shows the author's name to others, live, and marks quotes of it", async () => {
    renderChat([
      msg({ seq: 1, authorId: 'u2', authorName: '李建国', body: '机密方案' }),
      msg({ seq: 2, body: '收到', quote: { kind: 'message', id: 'm1', who: '李建国', text: '机密方案' } }),
    ])
    await screen.findByText('收到')
    push({ t: 'message.recalled', groupId: 'g1', messageId: 'm1' })
    expect(screen.getByText('李建国 撤回了一条消息')).toBeTruthy()
    expect(screen.queryByText('机密方案')).toBeNull()
    expect(screen.getByText('该消息已撤回')).toBeTruthy()
  })

  it('renders recalled messages from the server as notices', async () => {
    renderChat([
      msg({ seq: 1, body: '', recalled: true }),
      msg({ seq: 2, authorId: 'u2', authorName: '李建国', body: '', recalled: true }),
    ])
    expect(await screen.findByText('你撤回了一条消息')).toBeTruthy()
    expect(screen.getByText('李建国 撤回了一条消息')).toBeTruthy()
    expect(screen.queryByRole('toolbar', { name: '消息操作' })).toBeNull()
  })

  it('explains a late recall', async () => {
    renderChat(
      [msg({ seq: 1, body: '快到期', createdAt: new Date(Date.now() - 23.99 * HOUR).toISOString() })],
      {
        'POST /messages/m1/recall': apiError(409, 'recall_expired', 'late'),
      },
    )
    await openMore('快到期')
    fireEvent.click(screen.getByRole('menuitem', { name: '撤回' }))
    expect(await screen.findByText('超过 24 小时，无法撤回')).toBeTruthy()
    expect(screen.getByText('快到期')).toBeTruthy()
  })
})

describe('delete', () => {
  it('asks first, then hides the message only for me', async () => {
    const calls = renderChat([msg({ seq: 1, body: '要删的' }), msg({ seq: 2, body: '留下的' })], {
      'POST /messages/m1/hide': undefined,
    })
    await openMore('要删的')
    fireEvent.click(screen.getByRole('menuitem', { name: '删除' }))
    const dialog = screen.getByRole('dialog')
    expect(within(dialog).getByText('删除后仅对你隐藏，其他成员仍可见')).toBeTruthy()
    expect(calls.some((c) => c.path === '/messages/m1/hide')).toBe(false)
    fireEvent.click(within(dialog).getByRole('button', { name: '删除' }))
    await waitFor(() => expect(screen.queryByText('要删的')).toBeNull())
    expect(screen.getByText('留下的')).toBeTruthy()
    expect(calls.some((c) => c.method === 'POST' && c.path === '/messages/m1/hide')).toBe(true)
  })

  it('drops a message deleted in another session', async () => {
    renderChat([msg({ seq: 1, body: '别处删了' })])
    await screen.findByText('别处删了')
    push({ t: 'message.hidden', groupId: 'g1', messageId: 'm1' })
    expect(screen.queryByText('别处删了')).toBeNull()
  })
})
