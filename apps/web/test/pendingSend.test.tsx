import type { BotDto, GroupDto, MessageDto, UserDto, WebEvent } from '@gonggong/protocol'
import { act, fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import { MemoryRouter } from 'react-router'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { App } from '../src/App'
import { useSession } from '../src/app/session'
import { useWorkspace } from '../src/app/workspace'
import { useQuote } from '../src/features/attachments/quote'
import { logout } from '../src/features/auth/logout'
import { usePending } from '../src/features/chat/pending'
import { messageKey } from '../src/features/chat/TimelineItems'
import { useAppend } from '../src/features/runs/append'
import { realtime } from '../src/lib/realtime'
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
  send() {}
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
  usePending.setState({ list: [], back: null, reusable: [] })
  useQuote.getState().clear()
  useAppend.getState().clear()
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

    // The realtime echo can beat the response: it replaces the pending row by its clientId without double-animating.
    const clientId = String((posts(calls)[0]!.body as { clientId: string }).clientId)
    expect(pending.dataset.clientId).toBe(clientId)
    expect(pending.className).toContain('tl-item--enter')
    const real = msg({ seq: 2, body: '马上看到我', clientId })
    expect(messageKey(real)).toBe(clientId)
    expect(messageKey(msg({ seq: 3, body: '其他人' }))).toBe('m3')
    push({ t: 'message.new', message: real })
    expect(within(main).queryByTestId('pending-message')).toBeNull()
    expect(within(main).getAllByText('马上看到我')).toHaveLength(1)
    const confirmedRow = main.querySelector(`[data-msg-id="${real.id}"]`) as HTMLElement
    expect(confirmedRow.querySelector('.pn-msg--from-optimistic')).toBeTruthy()

    // Another member's arriving message is not marked as optimistic so it plays its entrance normally.
    const other = msg({ seq: 3, authorId: 'u2', authorName: '李建国', body: '他人消息' })
    push({ t: 'message.new', message: other })
    const otherRow = main.querySelector(`[data-msg-id="${other.id}"]`) as HTMLElement
    expect(otherRow.querySelector('.pn-msg--from-optimistic')).toBeNull()

    await act(async () => reply(real))
    expect(within(main).queryByTestId('pending-message')).toBeNull()
    expect(within(main).getAllByText('马上看到我')).toHaveLength(1)
  })

  it('marks a send failing on the server side in place and resends the same request, quote included', async () => {
    let fail = true
    const calls = renderChat({
      'POST /groups/g1/messages': (body: { clientId: string }) =>
        fail
          ? apiError(503, 'unavailable', '服务暂不可用')
          : msg({ seq: 2, body: '发不出去', clientId: body.clientId }),
    })
    await screen.findByText('原文')
    act(() =>
      useQuote.getState().set({ groupId: 'g1', kind: 'message', id: 'm1', who: '李建国', text: '引用的话' }),
    )
    await send('发不出去')
    const main = screen.getByRole('main')
    const pending = await within(main).findByTestId('pending-message')
    await within(pending).findByText('发送失败')
    expect(screen.getByText('服务暂不可用')).toBeTruthy()
    expect(pending.textContent).toContain('发不出去')
    expect(pending.textContent).toContain('引用的话')
    expect(input().value).toBe('')
    expect(document.querySelector('.composer--shake')).toBeNull()

    fail = false
    fireEvent.click(within(pending).getByRole('button', { name: '重发' }))
    await waitFor(() => expect(within(main).queryByTestId('pending-message')).toBeNull())
    expect(within(main).getAllByText('发不出去')).toHaveLength(1)
    // Network / 5xx failures are retried twice on their own before the row shows 发送失败.
    const all = posts(calls)
    expect(all).toHaveLength(4)
    const [first, again] = [all[0], all[3]]
    expect(again!.body).toEqual(first!.body)
    expect(first!.body).toMatchObject({ body: '发不出去', quote: { kind: 'message', id: 'm1' } })
  })

  it('takes a send the server refuses (4xx) back into the composer, quote and 追加 included, and shakes it', async () => {
    renderChat({ 'POST /groups/g1/messages': () => apiError(400, 'invalid', '消息太长') })
    await screen.findByText('原文')
    act(() => {
      useQuote.getState().set({ groupId: 'g1', kind: 'message', id: 'm1', who: '李建国', text: '引用的话' })
      useAppend.getState().start({ groupId: 'g1', runId: 'r1', botName: '小王的 Claude' })
    })
    await send('太长了')
    expect(await screen.findByText('消息太长')).toBeTruthy()
    await waitFor(() => expect(input().value).toBe('太长了'))
    expect(screen.queryByTestId('pending-message')).toBeNull()
    expect(useQuote.getState().quote).toMatchObject({ id: 'm1', text: '引用的话' })
    expect(useAppend.getState().target).toMatchObject({ runId: 'r1' })
    expect(document.querySelector('.composer--shake')).toBeTruthy()
  })

  it('puts a failed message back without shaking, adding only its text to a draft in progress', async () => {
    renderChat({ 'POST /groups/g1/messages': () => apiError(500, 'internal', '服务出错') })
    await screen.findByText('原文')
    act(() =>
      useQuote.getState().set({ groupId: 'g1', kind: 'message', id: 'm1', who: '李建国', text: '旧引用' }),
    )
    await send('不要了')
    const pending = await screen.findByTestId('pending-message')
    await within(pending).findByText('发送失败', undefined, { timeout: 4000 })
    act(() =>
      useQuote.getState().set({ groupId: 'g1', kind: 'message', id: 'm9', who: '李建国', text: '新引用' }),
    )
    fireEvent.change(input(), { target: { value: '新草稿' } })
    fireEvent.click(within(pending).getByRole('button', { name: '放回输入框' }))
    expect(screen.queryByTestId('pending-message')).toBeNull()
    await waitFor(() => expect(input().value).toBe('新草稿\n不要了'))
    expect(useQuote.getState().quote).toMatchObject({ id: 'm9' })
    expect(document.querySelector('.composer--shake')).toBeNull()
  })

  it('discards a failed message', async () => {
    renderChat({ 'POST /groups/g1/messages': () => apiError(500, 'internal', '服务出错') })
    await send('算了')
    const pending = await screen.findByTestId('pending-message')
    await within(pending).findByText('发送失败', undefined, { timeout: 4000 })
    fireEvent.click(within(pending).getByRole('button', { name: '丢弃' }))
    expect(screen.queryByTestId('pending-message')).toBeNull()
    expect(input().value).toBe('')
  })

  const reconnect = () =>
    act(() => {
      realtime.stop()
      realtime.start()
      FakeSocket.last!.onopen!()
    })

  it('resends on reconnect, once, what the network cut off, with the same clientId and saying so', async () => {
    let mode: 'down' | 'hold' = 'down'
    let release = () => {}
    const calls = renderChat({
      'POST /groups/g1/messages': (body: { clientId: string }) => {
        if (mode === 'down') throw new TypeError('Failed to fetch')
        return new Promise<MessageDto>((r) => {
          release = () => r(msg({ seq: 2, body: '断网时发的', clientId: body.clientId }))
        })
      },
    })
    await screen.findByText('原文')
    act(() => FakeSocket.last!.onopen!())
    await send('断网时发的')
    const pending = await screen.findByTestId('pending-message')
    await within(pending).findByText('发送失败', undefined, { timeout: 4000 })
    expect(posts(calls)).toHaveLength(3)

    // Still down: the one automatic try fails too, and the next reconnect leaves it to the user.
    reconnect()
    await waitFor(() => expect(posts(calls)).toHaveLength(6), { timeout: 4000 })
    await within(pending).findByText('发送失败', undefined, { timeout: 4000 })
    reconnect()
    await new Promise((r) => setTimeout(r, 50))
    expect(posts(calls)).toHaveLength(6)

    mode = 'hold'
    fireEvent.click(within(pending).getByRole('button', { name: '重发' }))
    await waitFor(() => expect(posts(calls)).toHaveLength(7))
    expect(new Set(posts(calls).map((c) => (c.body as { clientId: string }).clientId)).size).toBe(1)
    await act(async () => release())
    await waitFor(() => expect(screen.queryByTestId('pending-message')).toBeNull())
  }, 15_000)

  it('says it is resending once the connection is back', async () => {
    let down = true
    let release = () => {}
    const calls = renderChat({
      'POST /groups/g1/messages': (body: { clientId: string }) => {
        if (down) throw new TypeError('Failed to fetch')
        return new Promise<MessageDto>((r) => {
          release = () => r(msg({ seq: 2, body: '断网时发的', clientId: body.clientId }))
        })
      },
    })
    await screen.findByText('原文')
    act(() => FakeSocket.last!.onopen!())
    await send('断网时发的')
    const pending = await screen.findByTestId('pending-message')
    await within(pending).findByText('发送失败', undefined, { timeout: 4000 })
    down = false
    reconnect()
    expect(await within(pending).findByText('网络恢复，正在重发')).toBeTruthy()
    expect(posts(calls).at(-1)!.body).toEqual(posts(calls)[0]!.body)
    await act(async () => release())
    await waitFor(() => expect(screen.queryByTestId('pending-message')).toBeNull())
  }, 10_000)

  it('leaves server failures and older network failures for the user to decide on reconnect', async () => {
    let status: 'server' | 'network' = 'server'
    const calls = renderChat({
      'POST /groups/g1/messages': () => {
        if (status === 'network') throw new TypeError('Failed to fetch')
        return apiError(503, 'unavailable', '服务暂不可用')
      },
    })
    await screen.findByText('原文')
    act(() => FakeSocket.last!.onopen!())
    await send('服务端挂了')
    await within(await screen.findByTestId('pending-message')).findByText('发送失败', undefined, {
      timeout: 4000,
    })
    reconnect()
    await new Promise((r) => setTimeout(r, 50))
    expect(posts(calls)).toHaveLength(3)

    status = 'network'
    usePending.setState({ list: [] })
    await send('很早断网的')
    await within(await screen.findByTestId('pending-message')).findByText('发送失败', undefined, {
      timeout: 4000,
    })
    const now = Date.now()
    vi.spyOn(Date, 'now').mockReturnValue(now + 3 * 60_000)
    reconnect()
    await new Promise((r) => setTimeout(r, 50))
    expect(posts(calls)).toHaveLength(6)
    vi.restoreAllMocks()
  }, 15_000)

  it('sends a message whose fate was unknown with its clientId again when taken back and sent unchanged', async () => {
    let down = true
    const calls = renderChat({
      'POST /groups/g1/messages': (body: { clientId: string }) => {
        if (down) throw new TypeError('Failed to fetch')
        return msg({ seq: 2, body: '可能已到', clientId: body.clientId })
      },
    })
    await send('可能已到')
    const pending = await screen.findByTestId('pending-message')
    await within(pending).findByText('发送失败', undefined, { timeout: 4000 })
    fireEvent.click(within(pending).getByRole('button', { name: '放回输入框' }))
    await waitFor(() => expect(input().value).toBe('可能已到'))
    down = false
    fireEvent.keyDown(input(), { key: 'Enter' })
    await waitFor(() => expect(posts(calls)).toHaveLength(4))
    const ids = posts(calls).map((c) => (c.body as { clientId: string }).clientId)
    expect(ids[3]).toBe(ids[0])
  }, 10_000)

  it('keeps the clientId of a 5xx message taken back only while every part of the request is unchanged', async () => {
    let fail = true
    const calls = renderChat({
      'POST /groups/g1/messages': (body: { clientId: string }) =>
        fail
          ? apiError(502, 'bad_gateway', '网关出错')
          : msg({ seq: 2, body: '可能已到', clientId: body.clientId }),
    })
    const takeBack = async () => {
      const pending = await screen.findByTestId('pending-message')
      await within(pending).findByText('发送失败', undefined, { timeout: 4000 })
      fireEvent.click(within(pending).getByRole('button', { name: '放回输入框' }))
      await waitFor(() => expect(input().value).toBe('可能已到'))
    }
    await send('可能已到')
    await takeBack()
    fireEvent.keyDown(input(), { key: 'Enter' })
    await takeBack()
    act(() =>
      useQuote.getState().set({ groupId: 'g1', kind: 'message', id: 'm1', who: '李建国', text: '新引用' }),
    )
    fail = false
    fireEvent.keyDown(input(), { key: 'Enter' })
    await waitFor(() => expect(posts(calls)).toHaveLength(7))
    const ids = posts(calls).map((c) => (c.body as { clientId: string }).clientId)
    expect(ids[3]).toBe(ids[0])
    expect(ids[6]).not.toBe(ids[0])
  }, 15_000)

  it("keeps one account's unsent messages from the next account in this tab, and drops them on logout", async () => {
    const calls = renderChat({
      'POST /groups/g1/messages': () => {
        throw new TypeError('Failed to fetch')
      },
      'POST /auth/logout': undefined,
    })
    await screen.findByText('原文')
    act(() => FakeSocket.last!.onopen!())
    await send('王磊的私话')
    await within(await screen.findByTestId('pending-message')).findByText('发送失败', undefined, {
      timeout: 4000,
    })
    act(() => useSession.setState({ user: { ...me, id: 'u2', name: '李建国' } }))
    expect(screen.queryByTestId('pending-message')).toBeNull()
    reconnect()
    await new Promise((r) => setTimeout(r, 50))
    expect(posts(calls)).toHaveLength(3)

    act(() => useSession.setState({ user: me }))
    expect(await screen.findByTestId('pending-message')).toBeTruthy()
    await act(() => logout())
    expect(usePending.getState().list).toEqual([])
  }, 10_000)
})
