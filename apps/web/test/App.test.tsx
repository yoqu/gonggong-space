import type { GroupDto, UserDto } from '@gonggong/protocol'
import { act, render, screen, within } from '@testing-library/react'
import { MemoryRouter } from 'react-router'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { App } from '../src/App'
import { ChatLayout, useRailOpen } from '../src/app/ChatLayout'
import { useSession } from '../src/app/session'
import { useWorkspace } from '../src/app/workspace'

const me: UserDto = {
  id: 'u1',
  account: 'wanglei',
  name: '王磊',
  role: 'sysadmin',
  mustChangePassword: false,
  disabled: false,
  gitProtocol: 'auto',
  email: null,
  avatar: null,
}

const group = (id: string, name: string, kind: GroupDto['kind'] = 'group'): GroupDto => ({
  id,
  teamId: 't1',
  name,
  kind,
  mode: 'partition',
  notice: '',
  noticeHidden: false,
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
})

class NoopSocket {
  close() {}
}

function setWidth(w: number) {
  Object.defineProperty(window, 'innerWidth', { configurable: true, value: w })
}

function renderAt(path: string) {
  return render(
    <MemoryRouter initialEntries={[path]}>
      <App />
    </MemoryRouter>,
  )
}

beforeEach(() => {
  setWidth(1440)
  vi.stubGlobal('WebSocket', NoopSocket)
  useSession.setState({ user: null, status: 'idle' })
  useWorkspace.setState({ groups: [], bots: [], machines: [] })
})
afterEach(() => vi.unstubAllGlobals())

describe('session guard', () => {
  it('redirects to /login when /api/me is 401', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(
        async () => new Response(JSON.stringify({ error: 'unauthorized', message: '' }), { status: 401 }),
      ),
    )
    renderAt('/')
    expect(await screen.findByTestId('login-page')).toBeTruthy()
  })

  it('loads the current user and renders the chat shell', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(async (url: string) => new Response(JSON.stringify(url === '/api/me' ? me : []))),
    )
    renderAt('/')
    const nav = await screen.findByRole('navigation', { name: '会话列表' })
    expect(within(nav).getByRole('heading', { name: '共工空间' })).toBeTruthy()
    const rail = screen.getByRole('navigation', { name: '应用导航' })
    expect(within(rail).getByRole('button', { name: /^消息/ }).getAttribute('aria-current')).toBe('page')
    expect(within(rail).getByRole('button', { name: '管理后台' })).toBeTruthy()
    expect(within(rail).getByRole('button', { name: '账户菜单' }).textContent).toBe('王磊')
    expect(within(nav).queryByRole('button', { name: '账户菜单' })).toBeNull()
    for (const s of ['群', '私聊', '我的 Bot']) expect(within(nav).getByText(s)).toBeTruthy()
    expect(screen.getByRole('main')).toBeTruthy()
    expect(useSession.getState().user?.name).toBe('王磊')
  })
})

describe('chat shell', () => {
  beforeEach(() => {
    useSession.setState({ user: me, status: 'ready' })
    useWorkspace.setState({ groups: [group('g1', '退款 v2 迁移'), group('d1', '王磊的私聊', 'dm')] })
  })

  it('lists groups and dms and opens the selected group', () => {
    renderAt('/g/g1')
    const nav = screen.getByRole('navigation', { name: '会话列表' })
    expect(
      within(nav)
        .getByRole('link', { name: /退款 v2 迁移/ })
        .getAttribute('aria-current'),
    ).toBe('page')
    expect(within(nav).getByRole('link', { name: /王磊的私聊/ })).toBeTruthy()
    expect(within(screen.getByRole('main')).getByRole('heading', { name: '退款 v2 迁移' })).toBeTruthy()
  })

  it("shows a DM's workspace path under its name and follows the Bot's workspace", () => {
    useWorkspace.setState({
      groups: [{ ...group('d1', '重构登录', 'dm'), botIds: ['b1'], workspacePath: null, last: '王磊：在吗' }],
    })
    renderAt('/')
    const row = screen.getByTestId('group-item-d1')
    expect(row.textContent).toContain('未选择工作区')
    expect(row.textContent).not.toContain('在吗')
    act(() =>
      useWorkspace.getState().applyEvent({
        t: 'group.botState',
        groupId: 'd1',
        state: {
          botId: 'b1',
          workspace: 'cd',
          state: 'ready',
          path: '/Users/wang/code/login',
          git: null,
          error: null,
          reason: null,
          tier: null,
          model: null,
          effort: null,
          context: null,
        },
      }),
    )
    expect(row.textContent).toContain('/Users/wang/code/login')
  })

  it('shows either the list or the chat under 768px', () => {
    setWidth(700)
    const list = renderAt('/')
    expect(screen.getByRole('navigation', { name: '会话列表' })).toBeTruthy()
    expect(screen.queryByRole('main')).toBeNull()
    list.unmount()
    renderAt('/g/g1')
    expect(screen.queryByRole('navigation', { name: '会话列表' })).toBeNull()
    expect(screen.getByRole('main')).toBeTruthy()
    expect(screen.getByRole('button', { name: '返回' })).toBeTruthy()
  })
})

describe('right rail', () => {
  function Page() {
    const [open] = useRailOpen()
    return (
      <ChatLayout sidebar={<div>list</div>} rail={<div>rail content</div>} railOpen={open} mobileView="chat">
        center
      </ChatLayout>
    )
  }

  it('is open by default on wide screens', () => {
    render(<Page />)
    expect(screen.getByText('rail content')).toBeTruthy()
    expect(screen.getByText('list')).toBeTruthy()
  })

  it('is collapsed by default under 1100px', () => {
    setWidth(1000)
    render(<Page />)
    expect(screen.queryByText('rail content')).toBeNull()
    expect(screen.getByText('center')).toBeTruthy()
  })
})

describe('unknown routes', () => {
  it('shows a not-found page with a way back instead of a blank screen', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(async (url: string) => new Response(JSON.stringify(url === '/api/me' ? me : []))),
    )
    renderAt('/admin/nope')
    expect(await screen.findByText('页面不存在')).toBeTruthy()
    expect(screen.getByRole('link', { name: '返回消息' }).getAttribute('href')).toBe('/')
  })
})
