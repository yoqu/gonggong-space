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
  gitProtocol: 'auto',
}

const group: GroupDto = {
  id: 'g1',
  teamId: 't1',
  name: '退款 v2 迁移',
  kind: 'group',
  mode: 'partition',
  notice: '',
  noticeHidden: false,
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
  liveRunIds: [],
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

describe('edit (编辑)', () => {
  it('edits my message inline: Enter saves, the bubble shows the new text and 已编辑', async () => {
    const m = msg({ seq: 1, body: '原来的话' })
    const calls = renderChat([m], {
      'PATCH /messages/m1': { ...m, body: '改过的话', editedAt: new Date().toISOString(), reactions: [] },
    })
    await openMore('原来的话')
    fireEvent.click(screen.getByRole('menuitem', { name: '编辑' }))
    const box = screen.getByRole('textbox', { name: '编辑消息' }) as HTMLTextAreaElement
    expect(box.value).toBe('原来的话')
    fireEvent.change(box, { target: { value: '改过的话' } })
    fireEvent.keyDown(box, { key: 'Enter' })
    expect(await screen.findByText('改过的话')).toBeTruthy()
    expect(screen.getByText('已编辑')).toBeTruthy()
    expect(screen.queryByRole('textbox', { name: '编辑消息' })).toBeNull()
    expect(calls.find((c) => c.method === 'PATCH')).toMatchObject({
      path: '/messages/m1',
      body: { body: '改过的话' },
    })
  })

  it('Esc cancels without saving', async () => {
    const calls = renderChat([msg({ seq: 1, body: '不改了' })])
    await openMore('不改了')
    fireEvent.click(screen.getByRole('menuitem', { name: '编辑' }))
    const box = screen.getByRole('textbox', { name: '编辑消息' })
    fireEvent.change(box, { target: { value: '改一半' } })
    fireEvent.keyDown(box, { key: 'Escape' })
    expect(await screen.findByText('不改了')).toBeTruthy()
    expect(calls.some((c) => c.method === 'PATCH')).toBe(false)
  })

  it('keeps the editor open and shows the reason when the server refuses', async () => {
    renderChat([msg({ seq: 1, body: '@某 Bot 做' })], {
      'PATCH /messages/m1': apiError(400, 'invalid', '编辑不能修改 @ 的对象'),
    })
    await openMore('@某 Bot 做')
    fireEvent.click(screen.getByRole('menuitem', { name: '编辑' }))
    const box = screen.getByRole('textbox', { name: '编辑消息' })
    fireEvent.change(box, { target: { value: '做' } })
    fireEvent.keyDown(box, { key: 'Enter' })
    expect(await screen.findByText('编辑不能修改 @ 的对象')).toBeTruthy()
    expect(screen.getByRole('textbox', { name: '编辑消息' })).toBeTruthy()
  })

  it('offers no 编辑 past 24 hours or on commands', async () => {
    renderChat([
      msg({ seq: 1, body: '旧消息', createdAt: new Date(Date.now() - 25 * HOUR).toISOString() }),
      msg({ seq: 2, body: '/stop' }),
    ])
    expect(await openMore('旧消息')).not.toContain('编辑')
    fireEvent.keyDown(document.activeElement ?? document.body, { key: 'Escape' })
    expect(await openMore('/stop')).not.toContain('编辑')
  })

  it("applies others' edits live, keeping my reactions, and updates quotes of the message", async () => {
    const theirs = msg({ seq: 1, authorId: 'u2', authorName: '李建国', body: '旧方案' })
    renderChat([
      theirs,
      msg({ seq: 2, body: '收到', quote: { kind: 'message', id: 'm1', who: '李建国', text: '旧方案' } }),
    ])
    await screen.findByText('收到')
    push({
      t: 'message.edited',
      message: { ...theirs, body: '新方案', editedAt: new Date().toISOString(), reactions: [] },
    })
    await waitFor(() => expect(screen.getAllByText('新方案').length).toBe(2))
    expect(screen.getByText('已编辑')).toBeTruthy()
  })
})
