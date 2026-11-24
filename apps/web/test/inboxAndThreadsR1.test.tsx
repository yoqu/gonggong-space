import type {
  DirectoryGroupDto,
  GroupDto,
  GroupThreadsDto,
  MessageDto,
  ThreadDto,
  UserDto,
} from '@gonggong/protocol'
import { fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import { MemoryRouter } from 'react-router'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { App } from '../src/App'
import { useInspector } from '../src/app/inspector'
import { useSession } from '../src/app/session'
import { useWorkspace } from '../src/app/workspace'
import { GroupThreads } from '../src/features/chat/GroupThreads'
import { ThreadInbox } from '../src/features/chat/ThreadInbox'
import { ThreadView } from '../src/features/chat/ThreadView'
import { UnreadInbox } from '../src/features/chat/UnreadInbox'
import { escFree } from '../src/features/chat/unreadMark'
import { JoinPreview } from '../src/features/groups/JoinPreview'
import { useTeamSections } from '../src/features/groups/sections'
import { LaterPage } from '../src/features/saved/LaterPage'
import { hasOpenOverlay } from '../src/ui'
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
  botIds: [],
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

const previewGroup: DirectoryGroupDto = {
  id: 'g-preview',
  name: '支付结算群',
  avatar: null,
  notice: '负责结算对账',
  memberCount: 5,
  visibility: 'public',
  teamSectionId: 'ts1',
  admins: ['王磊'],
  requestId: null,
}

const at = '2026-09-23T02:00:00.000Z'
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
  createdAt: at,
  attachments: [],
  quote: null,
  ...o,
})

const root = msg({
  seq: 1,
  body: '发版前要不要冻结主干？',
  thread: { replyCount: 1, lastReplyAt: at, participants: ['u2'] },
})
const replies = [msg({ seq: 2, body: '要，周四开始', threadRootId: 'm1' })]
const threadDto = (): ThreadDto => ({
  root,
  replies,
  runs: [],
  state: { rootId: 'm1', groupId: 'g1', following: true, lastReadSeq: 1, unread: 0, mentioned: false },
})
const groupThreadsDto: GroupThreadsDto = {
  threads: [{ root, state: threadDto().state, live: false }],
  next: null,
}

class FakeSocket {
  close() {}
}

beforeEach(() => {
  Object.defineProperty(window, 'innerWidth', { configurable: true, value: 1440 })
  vi.stubGlobal('WebSocket', FakeSocket)
  Element.prototype.scrollIntoView = vi.fn()
  useSession.setState({ user: me, status: 'ready' })
  useWorkspace.setState({ groups: [], bots: [], machines: [], activeGroupId: null })
  useInspector.setState({ view: null, payload: null, back: null })
  useTeamSections.setState({ sections: [], canManage: false, directory: [] })
})

afterEach(() => {
  vi.unstubAllGlobals()
  sessionStorage.clear()
})

describe('JoinPreview mobile back button (R1-01)', () => {
  it('renders a header with .pn-chathead__back and invokes onBack when provided', () => {
    const onBack = vi.fn()
    const { container } = render(<JoinPreview group={previewGroup} onBack={onBack} />)
    const head = container.querySelector('.join-preview__head') as HTMLElement
    expect(head).toBeTruthy()
    expect(head.textContent).toContain('支付结算群')
    const back = within(head).getByRole('button', { name: '返回' })
    expect(back.className).toContain('pn-chathead__back')
    fireEvent.click(back)
    expect(onBack).toHaveBeenCalledOnce()
  })

  it('omits the header and back button on desktop when onBack is absent', () => {
    const { container } = render(<JoinPreview group={previewGroup} />)
    expect(container.querySelector('.join-preview__head')).toBeNull()
    expect(screen.queryByRole('button', { name: '返回' })).toBeNull()
    expect(screen.getByRole('region', { name: '入群预览' })).toBeTruthy()
  })

  it('passes onBack on mobile ChatPage and returns to the conversation list on click', async () => {
    Object.defineProperty(window, 'innerWidth', { configurable: true, value: 375 })
    mockApi({
      'GET /groups': [group()],
      'GET /bots': [],
      'GET /machines': [],
      'GET /notifications/unread': { n: 0 },
      'GET /threads/unread': { unread: 0, mentioned: 0 },
      'GET /saved/state': { ids: [], due: 0 },
      'GET /terminal-spaces': [],
      'GET /sidebar-sections': [],
      'GET /team-sections': { sections: [{ id: 'ts1', name: '产研', parentId: null }], canManage: false },
      'GET /team-directory': [previewGroup],
    })
    render(
      <MemoryRouter initialEntries={['/g/g-preview']}>
        <App />
      </MemoryRouter>,
    )
    await screen.findByRole('region', { name: '入群预览' })
    const back = screen.getByRole('button', { name: '返回' })
    expect(back.className).toContain('pn-chathead__back')
    fireEvent.click(back)
    await waitFor(() => expect(screen.queryByRole('region', { name: '入群预览' })).toBeNull())
    expect(screen.getByRole('navigation', { name: '会话列表' })).toBeTruthy()
  })
})

describe('GroupThreads and ThreadView Escape handling (R1-04)', () => {
  it('closes GroupThreads on Escape without falling through to lower-layer handlers', () => {
    mockApi({ 'GET /groups/g1/threads': groupThreadsDto })
    const onClose = vi.fn()
    const lower = vi.fn()
    const onLower = (e: KeyboardEvent) => {
      if (e.key === 'Escape' && !e.defaultPrevented && escFree()) lower()
    }
    window.addEventListener('keydown', onLower)
    try {
      render(<GroupThreads group={group()} onClose={onClose} />)
      expect(hasOpenOverlay()).toBe(true)
      fireEvent.keyDown(document.body, { key: 'Escape' })
      expect(onClose).toHaveBeenCalledOnce()
      expect(lower).not.toHaveBeenCalled()
    } finally {
      window.removeEventListener('keydown', onLower)
    }
  })

  it('closes ThreadView on Escape without falling through to lower-layer handlers', async () => {
    mockApi({
      'GET /messages/m1/thread?limit=50': threadDto(),
      'PUT /messages/m1/thread/read': threadDto().state,
    })
    const onClose = vi.fn()
    const lower = vi.fn()
    const onLower = (e: KeyboardEvent) => {
      if (e.key === 'Escape' && !e.defaultPrevented && escFree()) lower()
    }
    window.addEventListener('keydown', onLower)
    try {
      render(
        <MemoryRouter>
          <ThreadView group={group()} rootId="m1" onClose={onClose} />
        </MemoryRouter>,
      )
      await screen.findByText('要，周四开始')
      expect(hasOpenOverlay()).toBe(true)
      fireEvent.keyDown(document.body, { key: 'Escape' })
      expect(onClose).toHaveBeenCalledOnce()
      expect(lower).not.toHaveBeenCalled()
    } finally {
      window.removeEventListener('keydown', onLower)
    }
  })

  it('pops nested overlays (menu and @ mention picker) inside ThreadView before closing it', async () => {
    mockApi({
      'GET /messages/m1/thread?limit=50': threadDto(),
      'PUT /messages/m1/thread/read': threadDto().state,
    })
    const onClose = vi.fn()
    render(
      <MemoryRouter>
        <ThreadView group={group()} rootId="m1" onClose={onClose} />
      </MemoryRouter>,
    )
    const row = (await screen.findByText('要，周四开始')).closest('.pn-msg') as HTMLElement
    fireEvent.click(within(row).getByRole('button', { name: '更多' }))
    expect(await screen.findByRole('menu')).toBeTruthy()
    fireEvent.keyDown(document.activeElement ?? document.body, { key: 'Escape' })
    await waitFor(() => expect(screen.queryByRole('menu')).toBeNull())
    expect(onClose).not.toHaveBeenCalled()

    const input = screen.getByPlaceholderText('回复话题，@ 触发 Bot')
    fireEvent.change(input, { target: { value: '@' } })
    await waitFor(() => expect(input.getAttribute('aria-expanded')).toBe('true'))
    fireEvent.keyDown(input, { key: 'Escape' })
    await waitFor(() => expect(input.getAttribute('aria-expanded')).toBe('false'))
    expect(onClose).not.toHaveBeenCalled()

    fireEvent.keyDown(document.body, { key: 'Escape' })
    expect(onClose).toHaveBeenCalledOnce()
  })

  it('never falls through to ChatView mark-all-read when Escape closes GroupThreads or ThreadView', async () => {
    const calls = mockApi({
      'GET /groups': [group({ unread: 2 })],
      'GET /bots': [],
      'GET /machines': [],
      'GET /notifications/unread': { n: 0 },
      'GET /threads/unread': { unread: 0, mentioned: 0 },
      'GET /saved/state': { ids: [], due: 0 },
      'GET /terminal-spaces': [],
      'GET /sidebar-sections': [],
      'GET /team-sections': { sections: [], canManage: false },
      'GET /team-directory': [],
      'GET /groups/g1/timeline?limit=50': { messages: [root], runs: [] },
      'GET /groups/g1/threads': groupThreadsDto,
      'GET /messages/m1/thread?limit=50': threadDto(),
      'PUT /messages/m1/thread/read': threadDto().state,
      'POST /groups/g1/read': group(),
    })
    const escReads = () =>
      calls.filter(
        (c) =>
          c.method === 'POST' &&
          c.path === '/groups/g1/read' &&
          Object.keys((c.body ?? {}) as Record<string, unknown>).length === 0,
      )
    render(
      <MemoryRouter initialEntries={['/g/g1']}>
        <App />
      </MemoryRouter>,
    )
    await screen.findByText('发版前要不要冻结主干？')

    fireEvent.click(screen.getByRole('button', { name: '话题' }))
    await screen.findByRole('complementary', { name: '本群话题' })
    fireEvent.keyDown(document.body, { key: 'Escape' })
    await waitFor(() => expect(screen.queryByRole('complementary', { name: '本群话题' })).toBeNull())
    expect(escReads()).toHaveLength(0)

    fireEvent.click(screen.getByRole('button', { name: /1 条回复/ }))
    const rail = await screen.findByRole('complementary', { name: '话题' })
    await within(rail).findByText('要，周四开始')
    fireEvent.keyDown(document.body, { key: 'Escape' })
    await waitFor(() => expect(screen.queryByRole('complementary', { name: '话题' })).toBeNull())
    expect(escReads()).toHaveLength(0)

    fireEvent.keyDown(document.body, { key: 'Escape' })
    await waitFor(() => expect(escReads()).toHaveLength(1))
  })
})

describe('Inbox pages mobile back button (R1-05)', () => {
  it('UnreadInbox renders .pn-chathead__back with onBack and omits it without', async () => {
    mockApi({ 'GET /unreads': { groups: [] } })
    const onBack = vi.fn()
    const { rerender } = render(
      <MemoryRouter>
        <UnreadInbox onBack={onBack} />
      </MemoryRouter>,
    )
    await screen.findByText('没有未读消息')
    const back = screen.getByRole('button', { name: '返回' })
    expect(back.className).toContain('pn-chathead__back')
    expect(back.className).not.toContain('ui-btn--small')
    fireEvent.click(back)
    expect(onBack).toHaveBeenCalledOnce()

    rerender(
      <MemoryRouter>
        <UnreadInbox />
      </MemoryRouter>,
    )
    expect(screen.queryByRole('button', { name: '返回' })).toBeNull()
  })

  it('ThreadInbox renders .pn-chathead__back with onBack and omits it without', async () => {
    mockApi({ 'GET /threads': { threads: [] } })
    const onBack = vi.fn()
    const { rerender } = render(
      <MemoryRouter>
        <ThreadInbox onBack={onBack} />
      </MemoryRouter>,
    )
    await screen.findByText('还没有关注的话题')
    const back = screen.getByRole('button', { name: '返回' })
    expect(back.className).toContain('pn-chathead__back')
    expect(back.className).not.toContain('ui-btn--small')
    fireEvent.click(back)
    expect(onBack).toHaveBeenCalledOnce()

    rerender(
      <MemoryRouter>
        <ThreadInbox />
      </MemoryRouter>,
    )
    expect(screen.queryByRole('button', { name: '返回' })).toBeNull()
  })

  it('LaterPage renders .pn-chathead__back with onBack and omits it without', async () => {
    mockApi({ 'GET /saved?state=open': { items: [] } })
    const onBack = vi.fn()
    const { rerender } = render(
      <MemoryRouter>
        <LaterPage onBack={onBack} />
      </MemoryRouter>,
    )
    await screen.findByText('没有待处理的消息')
    const back = screen.getByRole('button', { name: '返回' })
    expect(back.className).toContain('pn-chathead__back')
    expect(back.className).not.toContain('ui-btn--small')
    fireEvent.click(back)
    expect(onBack).toHaveBeenCalledOnce()

    rerender(
      <MemoryRouter>
        <LaterPage />
      </MemoryRouter>,
    )
    expect(screen.queryByRole('button', { name: '返回' })).toBeNull()
  })
})
