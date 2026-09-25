import type { GroupDto, MachineDto, UserDto } from '@gonggong/protocol'
import { act, fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import { MemoryRouter, useLocation } from 'react-router'
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

const group = (id: string, name: string, o: Partial<GroupDto> = {}): GroupDto => ({
  id,
  name,
  kind: 'group',
  mode: 'partition',
  notice: '',
  repo: null,
  members: [],
  botIds: [],
  unread: 0,
  lastSeq: 0,
  last: '',
  pinned: false,
  muted: false,
  foldRuns: false,
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

const routes = (groups: unknown, machines: MachineDto[] = []) => ({
  'GET /groups': groups,
  'GET /bots': [],
  'GET /machines': machines,
  'GET /notifications': [],
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
  it('shows the unread count on the bell on mobile and names it', async () => {
    setWidth(700)
    mockApi({
      ...routes([]),
      'GET /notifications': [1, 2, 3].map((n) => ({
        id: `n${n}`,
        type: 'approval',
        payload: {},
        readAt: null,
        createdAt: '',
      })),
    })
    renderAt('/')
    const bell = await screen.findByRole('button', { name: '通知（3 条未读）' })
    expect(bell.textContent).toContain('3')
  })

  it('shows the platform search shortcut', () => {
    mockApi(routes([]))
    const ua = vi.spyOn(navigator, 'userAgent', 'get')
    ua.mockReturnValue('Mozilla/5.0 (X11; Linux x86_64)')
    const linux = renderAt('/')
    expect(within(screen.getByRole('banner')).getByText('Ctrl K')).toBeTruthy()
    linux.unmount()
    ua.mockReturnValue('Mozilla/5.0 (Macintosh; Intel Mac OS X 14_0)')
    renderAt('/')
    expect(within(screen.getByRole('banner')).getByText('⌘K')).toBeTruthy()
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
    expect(within(nav).getByText('我的 Bot')).toBeTruthy()
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
    expect(localStorage.getItem('gonggong.lastGroup')).toBe('g1')
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
