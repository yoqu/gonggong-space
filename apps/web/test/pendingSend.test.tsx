import type { BotDto, GroupDto, MessageDto, UserDto, WebEvent } from '@gonggong/protocol'
import { act, fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import { MemoryRouter } from 'react-router'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { App } from '../src/App'
import { useSession } from '../src/app/session'
import { useWorkspace } from '../src/app/workspace'
import { useQuote } from '../src/features/attachments/quote'
import { usePending } from '../src/features/chat/pending'
import { apiError, mockApi } from './mockApi'

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
  botIds: [],
  unread: 0,
  lastSeq: 1,
  last: '',
  pinned: false,
  notifyLevel: 'mentions',
  foldRuns: false,
  liveRunIds: [],
  liveRuns: [],
}

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
  createdAt: new Date().toISOString(),
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

const renderChat = (routes: Record<string, unknown>) => {
  const calls = mockApi({
    'GET /groups': [group],
    'GET /bots': [] as BotDto[],
    'GET /machines': [],
    'GET /notifications/unread': { n: 0 },
    'GET /groups/g1/timeline?limit=50': {
      messages: [msg({ seq: 1, authorId: 'u2', body: '原文' })],
      runs: [],
    },
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

const input = () =>
  screen.getByPlaceholderText('输入消息，@ 触发 Bot 或引用文件，/ 查看命令') as HTMLTextAreaElement
const send = async (text: string) => {
  await screen.findByText('原文')
  fireEvent.change(input(), { target: { value: text } })
  fireEvent.keyDown(input(), { key: 'Enter' })
}
const posts = (calls: ReturnType<typeof mockApi>) =>
  calls.filter((c) => c.method === 'POST' && c.path === '/groups/g1/messages')

beforeEach(() => {
  Object.defineProperty(window, 'innerWidth', { configurable: true, value: 1440 })
  vi.stubGlobal('WebSocket', FakeSocket)
  Element.prototype.scrollIntoView = vi.fn()
  useSession.setState({ user: me, status: 'ready' })
  useWorkspace.setState({ groups: [], bots: [], machines: [], activeGroupId: null })
  usePending.setState({ list: [] })
  useQuote.getState().clear()
})
afterEach(() => vi.unstubAllGlobals())

describe('optimistic send', () => {
  it('shows the message as sending at once, then swaps in the server copy without a duplicate', async () => {
    let reply: (m: MessageDto) => void = () => {}
    const calls = renderChat({
      'POST /groups/g1/messages': () => new Promise<MessageDto>((r) => (reply = r)),
    })
    await send('马上看到我')
    const main = screen.getByRole('main')
    const pending = await within(main).findByTestId('pending-message')
    expect(pending.textContent).toContain('马上看到我')
    expect(within(pending).getByLabelText('正在发送')).toBeTruthy()
    expect(input().value).toBe('')

    // The realtime echo can beat the response: it replaces the pending row by its clientId.
    const clientId = String((posts(calls)[0]!.body as { clientId: string }).clientId)
    const real = msg({ seq: 2, body: '马上看到我', clientId })
    push({ t: 'message.new', message: real })
    expect(within(main).queryByTestId('pending-message')).toBeNull()
    expect(within(main).getAllByText('马上看到我')).toHaveLength(1)

    await act(async () => reply(real))
    expect(within(main).queryByTestId('pending-message')).toBeNull()
    expect(within(main).getAllByText('马上看到我')).toHaveLength(1)
  })

  it('marks a failed send in place and resends the same request, quote included', async () => {
    let fail = true
    const calls = renderChat({
      'POST /groups/g1/messages': (body: { clientId: string }) =>
        fail
          ? apiError(400, 'invalid', '消息太长')
          : msg({ seq: 2, body: '发不出去', clientId: body.clientId }),
    })
    await screen.findByText('原文')
    act(() =>
      useQuote.getState().set({ groupId: 'g1', kind: 'message', id: 'm1', who: '李建国', text: '引用的话' }),
    )
    await send('发不出去')
    const main = screen.getByRole('main')
    expect(await screen.findByText('消息太长')).toBeTruthy()
    const pending = await within(main).findByTestId('pending-message')
    await within(pending).findByText('发送失败')
    expect(pending.textContent).toContain('发不出去')
    expect(pending.textContent).toContain('引用的话')
    expect(input().value).toBe('')
    expect(document.querySelector('.composer--shake')).toBeNull()

    fail = false
    fireEvent.click(within(pending).getByRole('button', { name: '重发' }))
    await waitFor(() => expect(within(main).queryByTestId('pending-message')).toBeNull())
    expect(within(main).getAllByText('发不出去')).toHaveLength(1)
    const [first, again] = posts(calls)
    expect(again!.body).toEqual(first!.body)
    expect(first!.body).toMatchObject({ body: '发不出去', quote: { kind: 'message', id: 'm1' } })
  })

  it('deletes a failed message', async () => {
    renderChat({ 'POST /groups/g1/messages': apiError(400, 'invalid', '消息太长') })
    await send('不要了')
    const pending = await screen.findByTestId('pending-message')
    await within(pending).findByText('发送失败')
    fireEvent.click(within(pending).getByRole('button', { name: '删除' }))
    expect(screen.queryByTestId('pending-message')).toBeNull()
    expect(screen.queryByText('不要了')).toBeNull()
  })
})
