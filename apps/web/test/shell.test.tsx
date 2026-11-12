import type { BotDto, DirectoryGroupDto, GroupDto, LiveRun, MachineDto, UserDto } from '@gonggong/protocol'
import { act, fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import { MemoryRouter, useLocation } from 'react-router'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { App } from '../src/App'
import { InspectorPortal, useInspector } from '../src/app/inspector'
import { useSession } from '../src/app/session'
import { useWorkspace } from '../src/app/workspace'
import { useSections, useTeamSections } from '../src/features/groups/sections'
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
  notifyLevel: 'mentions',
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
  useSections.setState({ sections: [] })
  useTeamSections.setState({ sections: [], canManage: false, directory: [] })
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

describe('page chrome', () => {
  it('puts the unread total in the tab title and restores it on leaving', async () => {
    mockApi({
      ...routes([group('g1', '李建国', { kind: 'dm', unread: 2 }), group('g2', '退款', { mentionCount: 1 })]),
      'GET /notifications/unread': { n: 3 },
    })
    const view = renderAt('/')
    await waitFor(() => expect(document.title).toBe('(6) 共工空间'))
    view.unmount()
    expect(document.title).toBe('共工空间')
  })

  it('offers a skip link that moves focus to the page, focusable only for that jump', async () => {
    mockApi(routes([]))
    renderAt('/')
    const skip = screen.getByRole('button', { name: '跳到主要内容' })
    const main = screen.getByRole('main')
    expect(main.hasAttribute('tabindex')).toBe(false)
    fireEvent.click(skip)
    expect(document.activeElement).toBe(main)
    act(() => main.blur())
    expect(main.hasAttribute('tabindex')).toBe(false)
  })
})

describe('conversation rows', () => {
  it('quiets a bot chat whose bot is gone so it never outshines the live ones', async () => {
    mockApi(routes([group('g1', '退款'), group('d1', '已删除的 Bot', { kind: 'dm' })]))
    renderAt('/')
    expect((await screen.findByTestId('group-item-d1')).classList.contains('pn-conv--closed')).toBe(true)
    expect(screen.getByTestId('group-item-g1').classList.contains('pn-conv--closed')).toBe(false)
  })
})

describe('full-width pages', () => {
  it.each(['/market', '/works'])(
    'drops the conversation list on %s, which has nothing to do with it',
    async (path) => {
      mockApi({
        ...routes([group('g1', '退款')]),
        'GET /market': [],
        'GET /works': [],
        'GET /works/groups': [],
      })
      renderAt(path)
      await waitFor(() => expect(screen.getByTestId('where').textContent).toBe(path))
      expect(screen.queryByRole('navigation', { name: '会话列表' })).toBeNull()
      expect(screen.getByRole('navigation', { name: '应用导航' })).toBeTruthy()
    },
  )
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
        followAgent: false,
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
    mockApi(routes([group('g1', '退款 v2 迁移', { unread: 3, mentionCount: 3 })]))
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
        group('g1', '闲聊', { mentionCount: 1, unread: 1 }),
        group('g2', '退款 v2 迁移', { liveRuns: runs, mentionCount: 1 }),
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

describe('sidebar sections', () => {
  const rowsIn = (name: string) =>
    within(screen.getByRole('group', { name }))
      .queryAllByTestId(/^group-item-/)
      .map((e) => e.getAttribute('data-testid')?.slice(11))

  it('stars across kinds above 频道 and 私信, each keeping the latest message first', async () => {
    mockApi(
      routes([
        group('g1', '退款', { lastAt: '2026-10-01T00:00:00.000Z' }),
        group('d1', 'CC专家', { kind: 'dm', botIds: ['b1'], lastAt: '2026-10-03T00:00:00.000Z' }),
        group('g2', '支付', { lastAt: '2026-10-02T00:00:00.000Z' }),
        group('d2', 'Codex', { kind: 'dm', botIds: ['b2'], pinned: true }),
        group('g3', '发版', { pinned: true }),
      ]),
    )
    renderAt('/g/g1')
    await screen.findByTestId('group-item-d1')
    expect(rowsIn('星标').sort()).toEqual(['d2', 'g3'])
    expect(rowsIn('频道')).toEqual(['g2', 'g1'])
    expect(rowsIn('私信')).toEqual(['d1'])
    // Among other kinds a DM says what it is; under 私信 the head does.
    expect(within(screen.getByTestId('group-item-d2')).getByText('Bot')).toBeTruthy()
    expect(within(screen.getByTestId('group-item-d1')).queryByText('Bot')).toBeNull()
  })

  it('folds a section but keeps its unread and open rows in sight, and remembers the fold', async () => {
    mockApi(
      routes([
        group('g1', '退款'),
        group('d1', 'CC专家', { kind: 'dm', botIds: ['b1'] }),
        group('d2', 'Codex', { kind: 'dm', botIds: ['b2'], unread: 2 }),
      ]),
    )
    const { unmount } = renderAt('/g/g1')
    await screen.findByTestId('group-item-d1')
    fireEvent.click(screen.getByRole('button', { name: /^私信/ }))
    expect(rowsIn('私信')).toEqual(['d2'])
    unmount()
    renderAt('/g/d1')
    await screen.findByTestId('group-item-d1')
    expect(screen.getByRole('button', { name: /^私信/ }).getAttribute('aria-expanded')).toBe('false')
    expect(rowsIn('私信').sort()).toEqual(['d1', 'd2'])
  })

  it('files conversations under my own sections, by menu or by dragging, and a star wins', async () => {
    const calls = mockApi({
      ...routes([
        group('g1', '退款', { sectionId: 's1' }),
        group('g2', '支付'),
        group('g3', '告警', { sectionId: 's1', pinned: true }),
      ]),
      'GET /sidebar-sections': [
        { id: 's1', name: '发版', parentId: null },
        { id: 's2', name: '运维', parentId: null },
      ],
      'PUT /groups/g2/prefs': (b: unknown) => group('g2', '支付', b as Partial<GroupDto>),
      'PUT /groups/g1/prefs': (b: unknown) => group('g1', '退款', b as Partial<GroupDto>),
    })
    renderAt('/g/g1')
    await waitFor(() => expect(rowsIn('发版')).toEqual(['g1']))
    expect(rowsIn('星标')).toEqual(['g3'])
    expect(within(screen.getByRole('group', { name: '运维' })).getByText('把会话拖到这里')).toBeTruthy()

    fireEvent.contextMenu(screen.getByTestId('group-item-g2'))
    fireEvent.click(await screen.findByRole('menuitem', { name: '移到分区' }))
    fireEvent.click(await screen.findByRole('menuitemcheckbox', { name: '运维' }))
    await waitFor(() => expect(rowsIn('运维')).toEqual(['g2']))
    expect(calls.find((c) => c.path === '/groups/g2/prefs')?.body).toEqual({ sectionId: 's2', pinned: false })

    const types = ['application/x-gg-group']
    fireEvent.drop(screen.getByRole('group', { name: '频道' }), {
      dataTransfer: { types, getData: () => 'g1' },
    })
    await waitFor(() => expect(rowsIn('频道')).toEqual(['g1']))
    expect(calls.find((c) => c.path === '/groups/g1/prefs')?.body).toEqual({ pinned: false, sectionId: null })
  })

  it('creates, renames, reorders and deletes my sections', async () => {
    const calls = mockApi({
      ...routes([group('g1', '退款', { sectionId: 's1' })]),
      'GET /sidebar-sections': [{ id: 's1', name: '发版', parentId: null }],
      'POST /sidebar-sections': (b: unknown) => ({ id: 's2', parentId: null, ...(b as object) }),
      'PATCH /sidebar-sections/s1': (b: unknown) => ({ id: 's1', parentId: null, ...(b as object) }),
      'PUT /sidebar-sections/order': (b: unknown) =>
        (b as { ids: string[] }).ids.map((id) => ({
          id,
          name: id === 's1' ? '发布' : '运维',
          parentId: null,
        })),
      'DELETE /sidebar-sections/s1': () => undefined,
    })
    renderAt('/g/g1')
    await waitFor(() => expect(rowsIn('发版')).toEqual(['g1']))

    fireEvent.click(screen.getByRole('button', { name: '新建分区' }))
    let dialog = await screen.findByRole('dialog', { name: '新建分区' })
    fireEvent.change(within(dialog).getByRole('textbox', { name: '分区名称' }), {
      target: { value: ' 运维 ' },
    })
    // A double click creates one section, not two.
    fireEvent.click(within(dialog).getByRole('button', { name: '创建' }))
    fireEvent.click(within(dialog).getByRole('button', { name: '创建' }))
    expect(await screen.findByRole('group', { name: '运维' })).toBeTruthy()
    expect(
      calls.filter((c) => c.method === 'POST' && c.path === '/sidebar-sections').map((c) => c.body),
    ).toEqual([{ name: '运维' }])

    fireEvent.click(screen.getByRole('button', { name: '发版 分区操作' }))
    fireEvent.click(await screen.findByRole('menuitem', { name: '重命名…' }))
    dialog = await screen.findByRole('dialog', { name: '重命名分区' })
    fireEvent.change(within(dialog).getByRole('textbox', { name: '分区名称' }), { target: { value: '发布' } })
    fireEvent.click(within(dialog).getByRole('button', { name: '保存' }))
    expect(await screen.findByRole('group', { name: '发布' })).toBeTruthy()

    fireEvent.click(screen.getByRole('button', { name: '发布 分区操作' }))
    fireEvent.click(await screen.findByRole('menuitem', { name: '下移' }))
    await waitFor(() =>
      expect(screen.getAllByRole('group').map((g) => g.getAttribute('aria-label'))).toEqual([
        '运维',
        '发布',
        '频道',
      ]),
    )

    fireEvent.click(screen.getByRole('button', { name: '发布 分区操作' }))
    fireEvent.click(await screen.findByRole('menuitem', { name: '删除分区' }))
    // Its conversations go back to their default section.
    await waitFor(() => expect(rowsIn('频道')).toEqual(['g1']))
    expect(screen.queryByRole('group', { name: '发布' })).toBeNull()
  })

  it('browses the team public channels and joins one', async () => {
    const joined = group('g9', '公告')
    const calls = mockApi({
      ...routes([group('g1', '退款')]),
      'GET /channels': [
        {
          id: 'g1',
          name: '退款',
          avatar: null,
          notice: '',
          memberCount: 3,
          joined: true,
          visibility: 'private',
          createdByName: '王磊',
          lastActivityAt: '2026-09-23T02:00:00.000Z',
        },
        {
          id: 'g9',
          name: '公告',
          avatar: null,
          notice: '全员通知',
          memberCount: 12,
          joined: false,
          visibility: 'public',
          createdByName: '李建国',
          lastActivityAt: null,
        },
      ],
      'POST /groups/g9/join': joined,
    })
    renderAt('/g/g1')
    await screen.findByTestId('group-item-g1')
    fireEvent.click(screen.getByRole('button', { name: '浏览频道' }))
    const dialog = await screen.findByRole('dialog', { name: '浏览频道' })
    expect(await within(dialog).findByText('12 人 · 李建国 创建')).toBeTruthy()
    expect(within(dialog).getByText('全员通知')).toBeTruthy()
    expect(within(dialog).getByLabelText('私有群')).toBeTruthy()
    // 未加入 leaves my own groups out; 最近活跃 puts the active one first.
    const names = () => [...dialog.querySelectorAll('.browse-channels__name')].map((e) => e.textContent)
    expect(names()[0]).toContain('已加入')
    fireEvent.click(within(dialog).getByRole('radio', { name: '未加入' }))
    expect(names()).toHaveLength(1)
    expect(names()[0]).toContain('公告')
    fireEvent.click(within(dialog).getByRole('button', { name: '加入 公告' }))
    expect(within(dialog).getByRole('button', { name: '加入 公告' }).getAttribute('aria-busy')).toBe('true')
    await waitFor(() => expect(screen.getByTestId('where').textContent).toBe('/g/g9'))
    expect(rowsIn('频道').sort()).toEqual(['g1', 'g9'])
    expect(calls.some((c) => c.method === 'POST' && c.path === '/groups/g9/join')).toBe(true)
  })

  it('waits for a pause in typing before searching channels', async () => {
    const calls = mockApi({
      ...routes([group('g1', '退款')]),
      'GET /channels': [],
      'GET /channels?q=%E5%85%AC%E5%91%8A': [],
    })
    renderAt('/g/g1')
    await screen.findByTestId('group-item-g1')
    fireEvent.click(screen.getByRole('button', { name: '浏览频道' }))
    const dialog = await screen.findByRole('dialog', { name: '浏览频道' })
    await within(dialog).findByText('还没有公开频道')
    const box = within(dialog).getByRole('textbox', { name: '搜索频道' })
    fireEvent.change(box, { target: { value: '公' } })
    fireEvent.change(box, { target: { value: '公告' } })
    expect(await within(dialog).findByText('没有匹配的频道')).toBeTruthy()
    await waitFor(() =>
      expect(calls.filter((c) => c.path.startsWith('/channels?q=')).map((c) => c.path)).toEqual([
        '/channels?q=%E5%85%AC%E5%91%8A',
      ]),
    )
  })
})

describe('team sections', () => {
  const rowsIn = (name: string) =>
    within(screen.getByRole('group', { name }))
      .queryAllByTestId(/^(group|directory)-item-/)
      .map((e) => e.getAttribute('data-testid'))
  const dir = (id: string, name: string, o: Partial<DirectoryGroupDto> = {}): DirectoryGroupDto => ({
    id,
    name,
    avatar: null,
    notice: '',
    memberCount: 4,
    visibility: 'private',
    teamSectionId: 'ts1',
    admins: ['李建国'],
    requestId: null,
    ...o,
  })

  it('lists my groups and the ones I am not in under each team section, above my own sections', async () => {
    mockApi({
      ...routes([group('g1', '退款', { teamSectionId: 'ts1' }), group('g2', '支付', { sectionId: 's1' })]),
      'GET /sidebar-sections': [{ id: 's1', name: '我的', parentId: null }],
      'GET /team-sections': { sections: [{ id: 'ts1', name: '支付线', parentId: null }], canManage: false },
      'GET /team-directory': [dir('g9', '结算', { notice: '对账与结算' })],
    })
    renderAt('/g/g1')
    await waitFor(() => expect(rowsIn('支付线')).toEqual(['group-item-g1', 'directory-item-g9']))
    expect(screen.getAllByRole('group').map((g) => g.getAttribute('aria-label'))).toEqual([
      '支付线',
      '我的',
      '频道',
    ])
    const outside = screen.getByTestId('directory-item-g9')
    expect(within(outside).getByText('未加入')).toBeTruthy()
    expect(within(outside).getByText('对账与结算')).toBeTruthy()
    // Only team admins manage team sections.
    expect(screen.queryByRole('button', { name: '支付线 分区操作' })).toBeNull()
  })

  it('opens a group I am not in as a preview and asks to join, then takes it back', async () => {
    let requested: string | null = null
    const calls = mockApi({
      ...routes([group('g1', '退款')]),
      'GET /team-sections': { sections: [{ id: 'ts1', name: '支付线', parentId: null }], canManage: false },
      'GET /team-directory': () => [dir('g9', '结算', { requestId: requested })],
      'POST /groups/g9/join-requests': (b: unknown) => {
        requested = 'r1'
        return { id: 'r1', groupId: 'g9', userId: 'u1', userName: '王磊', createdAt: '', ...(b as object) }
      },
      'DELETE /join-requests/r1': () => {
        requested = null
      },
    })
    renderAt('/g/g1')
    fireEvent.click(await screen.findByTestId('directory-item-g9'))
    const preview = await screen.findByRole('region', { name: '入群预览' })
    expect(within(preview).getByText('支付线 · 私有 · 4 人')).toBeTruthy()
    expect(within(preview).getByText('群管理员：李建国')).toBeTruthy()
    fireEvent.change(within(preview).getByRole('textbox', { name: '申请说明' }), {
      target: { value: '跟进对账' },
    })
    fireEvent.click(within(preview).getByRole('button', { name: '申请加入' }))
    expect(await within(preview).findByText('已申请，等待群管理员处理')).toBeTruthy()
    expect(await screen.findByText('已发送申请，群管理员同意后即可进入')).toBeTruthy()
    expect(calls.find((c) => c.path === '/groups/g9/join-requests')?.body).toEqual({ note: '跟进对账' })
    expect(within(screen.getByTestId('directory-item-g9')).getByText('已申请')).toBeTruthy()
    fireEvent.click(within(preview).getByRole('button', { name: '撤回申请' }))
    expect(await within(preview).findByRole('button', { name: '申请加入' })).toBeTruthy()
  })

  it('joins a public one straight from its preview', async () => {
    const calls = mockApi({
      ...routes([group('g1', '退款')]),
      'GET /team-sections': { sections: [{ id: 'ts1', name: '支付线', parentId: null }], canManage: false },
      'GET /team-directory': [dir('g9', '公告', { visibility: 'public' })],
      'POST /groups/g9/join': group('g9', '公告', { teamSectionId: 'ts1' }),
    })
    renderAt('/g/g9')
    const preview = await screen.findByRole('region', { name: '入群预览' })
    fireEvent.click(within(preview).getByRole('button', { name: '加入' }))
    await waitFor(() =>
      expect(calls.some((c) => c.method === 'POST' && c.path === '/groups/g9/join')).toBe(true),
    )
    await waitFor(() => expect(rowsIn('支付线')).toContain('group-item-g9'))
  })

  it('lets team admins add team sections and file groups under them', async () => {
    const calls = mockApi({
      ...routes([group('g2', '支付')]),
      'GET /team-sections': { sections: [{ id: 'ts1', name: '支付线', parentId: null }], canManage: true },
      'GET /team-directory': [],
      'POST /team-sections': (b: unknown) => ({ id: 'ts2', ...(b as object) }),
      'PUT /groups/g2/team-section': (b: unknown) => group('g2', '支付', b as Partial<GroupDto>),
    })
    renderAt('/g/g2')
    // An empty team section stays for its admins to drop into.
    expect(await screen.findByRole('group', { name: '支付线' })).toBeTruthy()
    expect(screen.getByRole('button', { name: '支付线 分区操作' })).toBeTruthy()

    fireEvent.contextMenu(screen.getByTestId('group-item-g2'))
    fireEvent.click(await screen.findByRole('menuitem', { name: '归入团队分区' }))
    fireEvent.click(await screen.findByRole('menuitemcheckbox', { name: '支付线' }))
    await waitFor(() => expect(rowsIn('支付线')).toEqual(['group-item-g2']))
    expect(calls.find((c) => c.path === '/groups/g2/team-section')?.body).toEqual({ teamSectionId: 'ts1' })

    fireEvent.click(screen.getByRole('button', { name: '新建分区' }))
    fireEvent.click(await screen.findByRole('menuitem', { name: '团队分区…' }))
    const dialog = await screen.findByRole('dialog', { name: '新建团队分区' })
    fireEvent.change(within(dialog).getByRole('textbox', { name: '分区名称' }), { target: { value: '平台' } })
    fireEvent.click(within(dialog).getByRole('button', { name: '创建' }))
    await waitFor(() =>
      expect(calls.find((c) => c.method === 'POST' && c.path === '/team-sections')?.body).toEqual({
        name: '平台',
      }),
    )
  })
})

describe('nested sections', () => {
  const rowsIn = (name: string) =>
    [...screen.getByRole('group', { name }).querySelectorAll(':scope > .sidebar__list [data-testid]')].map(
      (e) => e.getAttribute('data-testid'),
    )

  it('nests sections under their parents and counts the groups in each subtree', async () => {
    mockApi({
      ...routes([
        group('g1', '退款', { teamSectionId: 'rd' }),
        group('g2', '对账', { teamSectionId: 'settle' }),
        group('g3', '周报', { sectionId: 'mine' }),
        group('g4', '复盘', { sectionId: 'sub' }),
      ]),
      'GET /sidebar-sections': [
        { id: 'mine', name: '我的', parentId: null },
        { id: 'sub', name: '复盘类', parentId: 'mine' },
      ],
      'GET /team-sections': {
        sections: [
          { id: 'rd', name: '研发', parentId: null },
          { id: 'pay', name: '支付线', parentId: 'rd' },
          { id: 'settle', name: '结算', parentId: 'pay' },
        ],
        canManage: true,
      },
      'GET /team-directory': [
        {
          id: 'g9',
          name: '清分',
          avatar: null,
          notice: '',
          memberCount: 3,
          visibility: 'private',
          teamSectionId: 'settle',
          admins: [],
          requestId: null,
        },
      ],
    })
    renderAt('/g/g1')
    await waitFor(() => expect(rowsIn('结算')).toEqual(['group-item-g2', 'directory-item-g9']))
    const rd = screen.getByRole('group', { name: '研发' })
    expect(within(rd).getByRole('group', { name: '支付线' })).toBeTruthy()
    expect(rowsIn('研发')).toEqual(['group-item-g1'])
    const count = (name: string) =>
      screen.getByRole('group', { name }).querySelector(':scope > .sidebar__sechead .sidebar__count')
        ?.textContent
    expect(count('研发')).toBe('2/3')
    expect(count('支付线')).toBe('1/2')
    expect(count('我的')).toBe('2')
    expect(count('复盘类')).toBe('1')

    // Three deep is the limit: the deepest section offers no subsection.
    fireEvent.click(screen.getByRole('button', { name: '结算 分区操作' }))
    expect(await screen.findByRole('menuitem', { name: '重命名…' })).toBeTruthy()
    expect(screen.queryByRole('menuitem', { name: '新建子分区…' })).toBeNull()
  })

  it('folds a parent with its subsections, keeping their unread rows', async () => {
    mockApi({
      ...routes([
        group('g1', '退款', { sectionId: 'sub', unread: 2 }),
        group('g2', '周报', { sectionId: 'sub' }),
      ]),
      'GET /sidebar-sections': [
        { id: 'mine', name: '我的', parentId: null },
        { id: 'sub', name: '复盘类', parentId: 'mine' },
      ],
    })
    renderAt('/g/g0')
    await waitFor(() => expect(rowsIn('复盘类').length).toBe(2))
    fireEvent.click(screen.getByRole('button', { name: /^我的\d/ }))
    expect(screen.queryByRole('group', { name: '复盘类' })).toBeNull()
    expect(rowsIn('我的')).toEqual(['group-item-g1'])
  })

  it('adds a subsection from the section menu', async () => {
    const calls = mockApi({
      ...routes([group('g1', '退款')]),
      'GET /sidebar-sections': [{ id: 'mine', name: '我的', parentId: null }],
      'POST /sidebar-sections': (b: unknown) => ({ id: 'sub', ...(b as object) }),
    })
    renderAt('/g/g1')
    fireEvent.click(await screen.findByRole('button', { name: '我的 分区操作' }))
    fireEvent.click(await screen.findByRole('menuitem', { name: '新建子分区…' }))
    const dialog = await screen.findByRole('dialog', { name: '新建子分区' })
    expect(within(dialog).getByText('放在「我的」下')).toBeTruthy()
    fireEvent.change(within(dialog).getByRole('textbox', { name: '分区名称' }), {
      target: { value: '复盘类' },
    })
    fireEvent.click(within(dialog).getByRole('button', { name: '创建' }))
    const parent = await screen.findByRole('group', { name: '我的' })
    expect(await within(parent).findByRole('group', { name: '复盘类' })).toBeTruthy()
    expect(calls.find((c) => c.method === 'POST')?.body).toEqual({ name: '复盘类', parentId: 'mine' })
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

describe('not-found pages', () => {
  it.each([
    ['/bot/zz', 'Bot 不存在或已删除', '返回机器与 Bot', '/machines'],
    ['/machine/zz', '机器不存在或已吊销', '返回机器与 Bot', '/machines'],
    ['/t/zz', '终端不存在或已删除', '返回消息', '/'],
    ['/g/zz', '群不存在或你已不在群内', '返回消息', '/'],
  ])('%s offers a way out, also on a phone', async (path, title, action, target) => {
    for (const width of [1440, 390]) {
      setWidth(width)
      mockApi(routes([]))
      const view = renderAt(path)
      expect(await screen.findByText(title)).toBeTruthy()
      fireEvent.click(screen.getByRole('button', { name: action }))
      await waitFor(() => expect(screen.getByTestId('where').textContent).toBe(target))
      view.unmount()
    }
  })

  it('says why a bot or machine may be missing', async () => {
    mockApi(routes([]))
    renderAt('/bot/zz')
    expect(await screen.findByText('可能已被删除，或你没有访问权限。')).toBeTruthy()
  })
})

describe('nav rail', () => {
  it('totals @ of me and DM unread on 消息, toggles the notification popover and sends sysadmins to the admin console', async () => {
    useSession.setState({ user: { ...me, role: 'sysadmin' }, status: 'ready' })
    mockApi(
      routes([
        group('g1', '退款', { unread: 7, mentionCount: 2 }),
        group('g2', '支付', { kind: 'dm', unread: 3 }),
        group('g3', '静音', { unread: 9, mentionCount: 9, notifyLevel: 'off' }),
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
    const nav = screen.getByRole('navigation', { name: '机器与 Bot' })
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
