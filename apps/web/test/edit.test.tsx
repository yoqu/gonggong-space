import type { BotDto, CreationDraftCard, GroupDto, MessageDto, UserDto, WebEvent } from '@gonggong/protocol'
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
  lastSeq: 9,
  last: '',
  pinned: false,
  notifyLevel: 'mentions',
  foldRuns: false,
  liveRunIds: [],
  liveRuns: [],
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
    'GET /notifications/unread': { n: 0 },
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

  it('marks messages that came in from Feishu', async () => {
    renderChat([msg({ seq: 1, authorId: null, authorName: '外部同事', body: '接口好了', fromFeishu: true })])
    await screen.findByText('接口好了')
    expect(screen.getByText('外部同事')).toBeTruthy()
    expect(screen.getByText('来自飞书')).toBeTruthy()
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

  it("applies a reply's answered actions and its progress card live", async () => {
    const body = '```actions\n{"id":"pick","options":[{"label":"A"},{"label":"B"}]}\n```'
    const bot = msg({ seq: 1, kind: 'bot', authorId: 'b1', authorName: '小助手', body })
    const card = {
      id: 'm2',
      botId: 'b1',
      title: '部署',
      stages: [{ name: '构建', status: 'running' as const }],
      percent: null,
      detail: '构建中',
      link: null,
      status: 'running' as const,
      updatedAt: new Date().toISOString(),
    }
    const progress = msg({
      seq: 2,
      kind: 'bot',
      authorId: 'b1',
      authorName: '小助手',
      body: '',
      progress: card,
    })
    renderChat([bot, progress])
    await screen.findByText('构建中')
    const at = new Date().toISOString()
    push({
      t: 'message.edited',
      message: { ...bot, actions: { pick: { userId: 'u2', name: '李建国', labels: ['B'], at } } },
    })
    expect(await screen.findByText('李建国 已选择 B')).toBeTruthy()
    push({ t: 'message.edited', message: { ...progress, progress: { ...card, detail: '部署中' } } })
    expect(await screen.findByText('部署中')).toBeTruthy()

    const draft: CreationDraftCard = {
      type: 'creation-draft',
      pluginId: 'p1',
      pluginTitle: '网页原型',
      category: 'web',
      pluginVersion: '1.0.0',
      template: null,
      designSystem: null,
      inputs: [],
      directions: false,
      botId: 'b1',
      botName: '小助手',
      missing: [],
      note: null,
      status: 'pending',
      by: null,
      creationId: null,
    }
    const proposal = msg({ seq: 3, id: 'm3', kind: 'event', authorId: null, body: '', card: draft })
    push({ t: 'message.new', message: proposal })
    expect(await screen.findByText('创作确认 · 网页原型')).toBeTruthy()
    push({
      t: 'message.edited',
      message: { ...proposal, card: { ...draft, status: 'started', by: '李建国' } },
    })
    expect(await screen.findByText('李建国 已开始创作')).toBeTruthy()
  })
})
