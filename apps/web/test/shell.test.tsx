import type { BotDto, GroupDto, LiveRun, MachineDto, UserDto } from '@gonggong/protocol'
import { act, fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import { MemoryRouter, useLocation } from 'react-router'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { App } from '../src/App'
import { InspectorPortal, useInspector } from '../src/app/inspector'
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

const group = (id: string, name: string, o: Partial<GroupDto> = {}): GroupDto => ({
  id,
  teamId: 't1',
  name,
  kind: 'group',
  mode: 'partition',
  adminOnlyInvite: false,
  protectBase: false,
  notice: '',
  noticeHidden: false,
  avatar: null,
  repo: null,
  members: [],
  botIds: [],
  unread: 0,
  lastSeq: 0,
  last: '',
  pinned: false,
  muted: false,
  foldRuns: false,
  liveRunIds: [],
  liveRuns: [],
  ...o,
})

const machine = (id: string, online: boolean): MachineDto => ({
  id,
  ownerId: 'u1',
  name: id,
  os: 'macos',
  arch: 'aarch64',
  online,
  agents: [],
  daemonVersion: '0.1.0',
  features: [],
  lastSeenAt: null,
  hostname: id,
  system: null,
  boundAt: '2026-09-01T00:00:00Z',
  createdAt: '2026-09-01T00:00:00Z',
})

class FakeSocket {
  static last: FakeSocket | undefined
  onopen: (() => void) | null = null
  onmessage: (() => void) | null = null
  onclose: (() => void) | null = null
  constructor() {
    FakeSocket.last = this
  }
  close() {}
  send() {}
}

function Where() {
  return <div data-testid="where">{useLocation().pathname}</div>
}

const renderAt = (path: string) =>
  render(
    <MemoryRouter initialEntries={[path]}>
      <App />
      <Where />
    </MemoryRouter>,
  )

const setWidth = (w: number) => Object.defineProperty(window, 'innerWidth', { configurable: true, value: w })

const routes = (groups: unknown, machines: MachineDto[] = [], bots: BotDto[] = []) => ({
  'GET /groups': groups,
  'GET /bots': bots,
  'GET /machines': machines,
  'GET /notifications/unread': { n: 0 },
})

beforeEach(() => {
  setWidth(1440)
  localStorage.clear()
  vi.stubGlobal('WebSocket', FakeSocket)
  useSession.setState({ user: me, status: 'ready' })
  useWorkspace.setState({ groups: [], bots: [], machines: [], loaded: false, notifCount: 0 })
})
afterEach(() => vi.unstubAllGlobals())

describe('top bar', () => {
  it('shows the unread notification count in the bottom tab bar on mobile', async () => {
    setWidth(700)
    const calls = mockApi({ ...routes([]), 'GET /notifications/unread': { n: 3 } })
    renderAt('/')
    const bar = screen.getByRole('navigation', { name: '应用导航' })
    expect(await within(bar).findByRole('button', { name: '通知（3 条未读）' })).toBeTruthy()
    // Counted server-side: startup does not download the notification list.
    expect(calls.some((c) => c.path === '/notifications')).toBe(false)
  })

  it('shows the platform search shortcut', () => {
    mockApi(routes([]))
    const ua = vi.spyOn(navigator, 'userAgent', 'get')
    ua.mockReturnValue('Mozilla/5.0 (X11; Linux x86_64)')
    const linux = renderAt('/')
    expect(within(screen.getByRole('navigation', { name: '会话列表' })).getByText('Ctrl K')).toBeTruthy()
    linux.unmount()
    ua.mockReturnValue('Mozilla/5.0 (Macintosh; Intel Mac OS X 14_0)')
    renderAt('/')
    expect(within(screen.getByRole('navigation', { name: '会话列表' })).getByText('⌘K')).toBeTruthy()
    ua.mockRestore()
  })
})

describe('connection status', () => {
  it('shows machine count once in the sidebar footer, not a 本机 daemon line', async () => {
    mockApi(routes([], [machine('mbp', true), machine('box', false), machine('nuc', true)]))
    renderAt('/')
    const nav = screen.getByRole('navigation', { name: '会话列表' })
    expect(await within(nav).findByText('2 台机器在线')).toBeTruthy()
    expect(within(nav).queryByText(/本机 daemon/)).toBeNull()
  })

  it('counts only my own bots as online in the sidebar footer, like the machines', async () => {
    const bot = (id: string, ownerId: string, presence: BotDto['presence']) =>
      ({
        id,
        teamId: 't1',
        name: id,
        ownerId,
        ownerName: ownerId,
        agentKind: 'claude',
        avatar: 'role-no',
        avatarUrl: null,
        machineId: 'mbp',
        binding: 'bound',
        presence,
        triggerScope: 'all',
        triggerList: [],
        sharedWith: [],
      }) as unknown as BotDto
    mockApi(
      routes(
        [],
        [machine('mbp', true)],
        [bot('mine', 'u1', 'online'), bot('mine-off', 'u1', 'offline'), bot('theirs', 'u2', 'running')],
      ),
    )
    renderAt('/')
    const nav = screen.getByRole('navigation', { name: '会话列表' })
    expect(await within(nav).findByText('1 个 Bot 在线')).toBeTruthy()
  })

  it('shows a reconnect banner on mobile only after the realtime connection drops', async () => {
    setWidth(700)
    mockApi(routes([]))
    renderAt('/')
    const banner = () => screen.queryByText('连接已断开，正在重连…')
    expect(banner()).toBeNull()
    act(() => FakeSocket.last!.onopen!())
    expect(banner()).toBeNull()
    act(() => FakeSocket.last!.onclose!())
    expect(banner()).toBeTruthy()
  })
})

describe('sidebar', () => {
  it('shows no empty-state copy until lists have loaded', async () => {
    let answer: (r: Response) => void = () => {}
    mockApi(routes([]))
    const stubbed = fetch
    vi.stubGlobal('fetch', (url: string, init?: RequestInit) =>
      url === '/api/groups' ? new Promise((r) => (answer = r)) : stubbed(url, init),
    )
    renderAt('/')
    const nav = screen.getByRole('navigation', { name: '会话列表' })
    expect(within(nav).getByRole('region', { name: '会话' })).toBeTruthy()
    await waitFor(() => expect(useWorkspace.getState().loaded).toBe(true))
    expect(within(nav).queryByText(/还没有/)).toBeNull()
    await act(async () => answer(new Response('[]')))
    // No groups on desktop: the main-area welcome guides; the sidebar doesn't repeat "还没有…".
    expect(await within(screen.getByRole('main')).findByRole('region', { name: '开始使用' })).toBeTruthy()
    expect(within(nav).queryByText(/还没有/)).toBeNull()
  })

  it('labels unread badges and keeps full bot info in a title', async () => {
    mockApi(routes([group('g1', '退款 v2 迁移', { unread: 3 })]))
    renderAt('/g/g1')
    const nav = screen.getByRole('navigation', { name: '会话列表' })
    expect(await within(nav).findByLabelText('3 条未读')).toBeTruthy()
  })
})

describe('sidebar live runs', () => {
  const live = (id: string, status: LiveRun['status'], o: Partial<LiveRun> = {}): LiveRun => ({
    id,
    botId: 'b1',
    status,
    needsMe: false,
    ...o,
  })

  it('tags conversations where an agent is running with the animated mascot', async () => {
    mockApi(routes([group('g1', '退款 v2 迁移', { liveRuns: [live('r1', 'running')] }), group('g2', '闲聊')]))
    renderAt('/g/g1')
    const row = await screen.findByTestId('group-item-g1')
    const tag = within(row).getByText('运行中')
    expect(tag.closest('.pn-conv__live')?.querySelector('.ui-mascot[data-action="carry"]')).toBeTruthy()
    expect(within(screen.getByTestId('group-item-g2')).queryByText('运行中')).toBeNull()
  })

  it('shows the most urgent state, stacks the bots with only the first moving, and flags what waits on me in place', async () => {
    const runs = [
      live('r1', 'running'),
      live('r2', 'queued'),
      live('r3', 'awaiting_approval', { needsMe: true, title: 'rm -rf build' }),
      live('r4', 'running'),
    ]
    mockApi(
      routes([
        group('g1', '闲聊', { mentioned: true, unread: 1 }),
        group('g2', '退款 v2 迁移', { liveRuns: runs, mentioned: true }),
        group('g3', '置顶群', { pinned: true }),
        group('g4', '别人审批', { liveRuns: [live('r5', 'awaiting_approval')] }),
      ]),
    )
    renderAt('/g/g1')
    const row = await screen.findByTestId('group-item-g2')
    const tag = within(row).getByTitle('待审批 · 3 个运行中')
    expect(tag.textContent).toBe('待审批')
    const figures = [...(tag.closest('.pn-conv__live')?.querySelectorAll('.ui-mascot') ?? [])]
    expect(
      figures.map((f) => [f.getAttribute('data-action'), f.classList.contains('ui-mascot--still')]),
    ).toEqual([
      ['raise', false],
      ['carry', true],
      ['carry', true],
    ])
    expect(within(row).getByText('+1')).toBeTruthy()
    expect(within(row).getByText('[待审批]')).toBeTruthy()
    expect(within(row).getByText(/：rm -rf build$/)).toBeTruthy()
    expect(within(row).queryByText('[有人@我]')).toBeNull()
    expect(within(screen.getByTestId('group-item-g4')).getByText('等待审批')).toBeTruthy()
    const order = [...document.querySelectorAll('[data-testid^="group-item-"]')].map((e) =>
      e.getAttribute('data-testid'),
    )
    // Waiting on me shows on the row; the order stays pinned first, then the latest message.
    expect(order).toEqual(['group-item-g3', 'group-item-g1', 'group-item-g2', 'group-item-g4'])
  })
})

describe('conversation order', () => {
  const order = () =>
    [...document.querySelectorAll('[data-testid^="group-item-"]')].map((e) =>
      e.getAttribute('data-testid')?.slice(11),
    )

  it('sorts by the latest message, pinned first, and holds the order while the pointer is over the list', async () => {
    mockApi(
      routes([
        group('g1', '旧群', { lastAt: '2026-10-01T00:00:00.000Z' }),
        group('g2', '新群', { lastAt: '2026-10-03T00:00:00.000Z' }),
        group('g3', '置顶群', { pinned: true, lastAt: '2026-09-01T00:00:00.000Z' }),
        group('g4', '中间', { lastAt: '2026-10-02T00:00:00.000Z' }),
      ]),
    )
    renderAt('/g/g2')
    await screen.findByTestId('group-item-g1')
    expect(order()).toEqual(['g3', 'g2', 'g4', 'g1'])

    const list = screen.getByTestId('group-item-g1').closest('.sidebar__scroll')!
    fireEvent.pointerEnter(list)
    act(() =>
      useWorkspace.getState().applyEvent({
        t: 'message.new',
        message: {
          id: 'm9',
          seq: 1,
          groupId: 'g1',
          kind: 'user',
          authorId: 'u2',
          authorName: '李建国',
          body: '新消息',
          mentions: [],
          runId: null,
          createdAt: '2026-10-04T00:00:00.000Z',
          attachments: [],
          quote: null,
        },
      }),
    )
    expect(within(screen.getByTestId('group-item-g1')).getByText(/新消息/)).toBeTruthy()
    expect(order()).toEqual(['g3', 'g2', 'g4', 'g1'])
    fireEvent.pointerLeave(list)
    expect(order()).toEqual(['g3', 'g1', 'g2', 'g4'])
  })
})

describe('home route', () => {
  it('opens the last opened group on desktop', async () => {
    localStorage.setItem('gonggong.lastGroup', 'g2')
    mockApi(routes([group('g1', '退款'), group('g2', '支付')]))
    renderAt('/')
    await waitFor(() => expect(screen.getByTestId('where').textContent).toBe('/g/g2'))
  })

  it('falls back to the first group and remembers the opened one', async () => {
    mockApi(routes([group('g1', '退款'), group('g2', '支付')]))
    renderAt('/')
    await waitFor(() => expect(screen.getByTestId('where').textContent).toBe('/g/g1'))
    // Remembered in a passive effect, which can run after the commit that updated the path.
    await waitFor(() => expect(localStorage.getItem('gonggong.lastGroup')).toBe('g1'))
  })

  it('keeps the list on mobile and the empty state without groups', async () => {
    setWidth(700)
    mockApi(routes([group('g1', '退款')]))
    const mobile = renderAt('/')
    expect(await screen.findByRole('link', { name: /退款/ })).toBeTruthy()
    expect(screen.getByTestId('where').textContent).toBe('/')
    mobile.unmount()
    setWidth(1440)
    useWorkspace.setState({ groups: [] })
    mockApi(routes([]))
    renderAt('/')
    expect(await screen.findByText('选择一个群或私聊开始')).toBeTruthy()
    expect(screen.getByTestId('where').textContent).toBe('/')
  })

  it('offers a retry when groups fail to load', async () => {
    let fail = true
    mockApi({
      ...routes([]),
      'GET /groups': () => (fail ? apiError(500, 'internal') : [group('g1', '退款')]),
    })
    renderAt('/g/g1')
    expect(await screen.findByText('加载失败')).toBeTruthy()
    expect(screen.queryByText('群不存在或你已不在群内')).toBeNull()
    fail = false
    fireEvent.click(screen.getByRole('button', { name: '重试' }))
    expect(await screen.findByRole('heading', { name: '退款' })).toBeTruthy()
  })
})

describe('nav rail', () => {
  it('shows total unread on 消息, toggles the notification popover and sends sysadmins to the admin console', async () => {
    useSession.setState({ user: { ...me, role: 'sysadmin' }, status: 'ready' })
    mockApi(
      routes([
        group('g1', '退款', { unread: 2 }),
        group('g2', '支付', { unread: 3 }),
        group('g3', '静音', { unread: 9, muted: true }),
      ]),
    )
    renderAt('/')
    const rail = screen.getByRole('navigation', { name: '应用导航' })
    expect(await within(rail).findByRole('button', { name: '消息（5 条未读）' })).toBeTruthy()
    const notif = within(rail).getByRole('button', { name: '通知' })
    fireEvent.click(notif)
    expect(await screen.findByRole('dialog', { name: '通知' })).toBeTruthy()
    expect(notif.getAttribute('aria-current')).toBe('page')
    fireEvent.click(within(rail).getByRole('button', { name: '管理后台' }))
    await waitFor(() => expect(screen.getByTestId('where').textContent).toMatch(/^\/admin/))
  })

  it('keeps every entry reachable from a bottom tab bar on phones', async () => {
    setWidth(390)
    mockApi(routes([group('g1', '退款')]))
    renderAt('/')
    const bar = screen.getByRole('navigation', { name: '应用导航' })
    expect(bar.className).toContain('ui-rail--bar')
    for (const name of [/^消息/, /^通知/, '账户菜单'])
      expect(within(bar).getByRole('button', { name })).toBeTruthy()
  })

  it('stays on the phone layout when overflowing content widens window.innerWidth (Android Chrome zooms out)', async () => {
    Object.defineProperty(document.documentElement, 'clientWidth', { configurable: true, value: 390 })
    try {
      mockApi(routes([group('g1', '退款')]))
      renderAt('/')
      expect(screen.getByRole('navigation', { name: '应用导航' }).className).toContain('ui-rail--bar')
    } finally {
      delete (document.documentElement as { clientWidth?: number }).clientWidth
    }
  })
})

describe('sidebar rows', () => {
  it('moves between conversations with the arrow keys from a single tab stop', async () => {
    mockApi(routes([group('g1', '退款'), group('g2', '支付')]))
    renderAt('/g/g1')
    const nav = screen.getByRole('navigation', { name: '会话列表' })
    const first = await within(nav).findByRole('link', { name: /退款/ })
    const second = within(nav).getByRole('link', { name: /支付/ })
    expect([first.tabIndex, second.tabIndex]).toEqual([0, -1])
    first.focus()
    fireEvent.keyDown(first, { key: 'ArrowDown' })
    expect(document.activeElement).toBe(second)
    await waitFor(() => expect(screen.getByTestId('where').textContent).toBe('/g/g2'))
  })

  it('leaves out machine details that are missing instead of printing undefined', async () => {
    const bare = { ...machine('m1', true), os: undefined } as unknown as MachineDto
    mockApi(routes([], [bare]))
    renderAt('/machines')
    const nav = screen.getByRole('navigation', { name: '我的机器管理' })
    const row = await within(nav).findByRole('link', { name: /^m1/ })
    expect(row.textContent).not.toContain('undefined')
    expect(row.getAttribute('title')).toBe('m1 · 在线')
  })
})

describe('inspector', () => {
  it('renders an opened view into the chat inspector and closes it on group switch', async () => {
    mockApi(routes([group('g1', '退款'), group('g2', '支付')]))
    render(
      <MemoryRouter initialEntries={['/g/g1']}>
        <App />
        <InspectorPortal view="group-info">群信息内容</InspectorPortal>
      </MemoryRouter>,
    )
    await screen.findByRole('heading', { name: '退款' })
    expect(screen.queryByRole('complementary', { name: '侧栏' })).toBeNull()
    act(() => useInspector.getState().open('group-info'))
    const aside = screen.getByRole('complementary', { name: '侧栏' })
    expect(within(aside).getByText('群信息内容')).toBeTruthy()
    fireEvent.click(screen.getByRole('link', { name: /支付/ }))
    await waitFor(() => expect(screen.queryByRole('complementary', { name: '侧栏' })).toBeNull())
  })
})
