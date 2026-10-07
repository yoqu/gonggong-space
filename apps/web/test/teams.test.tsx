import type { GroupDto, TeamDto, TeamGroupDto, TeamMemberDto, UserDto } from '@gonggong/protocol'
import { fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import { MemoryRouter, useLocation } from 'react-router'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { App } from '../src/App'
import { type Tenancy, useSession } from '../src/app/session'
import { useWorkspace } from '../src/app/workspace'
import { TeamSettingsDialog } from '../src/features/teams/TeamSettingsDialog'
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

const team = (o: Partial<TeamDto> = {}): TeamDto => ({
  id: 't1',
  name: '支付组',
  avatar: null,
  role: 'member',
  archivedAt: null,
  createdAt: '2026-01-01T00:00:00Z',
  unread: 0,
  ...o,
})

const members: TeamMemberDto[] = [
  { userId: 'u1', name: '王磊', account: 'wanglei', role: 'member', joinedAt: '' },
  { userId: 'u2', name: '李建国', account: 'lijg', role: 'owner', joinedAt: '' },
]

class FakeSocket {
  onopen = null
  onmessage = null
  onclose = null
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

const teamGroup = (o: Partial<TeamGroupDto>): TeamGroupDto => ({
  id: 'g1',
  name: '支付服务重构',
  ownerName: '王磊',
  kind: 'group',
  mode: 'partition',
  repo: null,
  members: 2,
  bots: 1,
  archivedAt: null,
  teamId: 't1',
  teamName: '支付组',
  memberNames: ['王磊', '李建国'],
  joined: false,
  ...o,
})

const mine = { userId: 'u1', name: '王磊', isAdmin: true }

/** A group of team t1 that I (u1) am not in. */
const chatGroup = (o: Partial<GroupDto> = {}): GroupDto => ({
  id: 'g1',
  teamId: 't1',
  name: '支付服务重构',
  kind: 'group',
  mode: 'partition',
  notice: '',
  noticeHidden: false,
  repo: null,
  members: [
    { userId: 'u2', name: '李建国', isAdmin: true },
    { userId: 'u3', name: '赵敏', isAdmin: false },
  ],
  botIds: [],
  unread: 0,
  lastSeq: 1,
  last: '',
  pinned: false,
  muted: false,
  foldRuns: false,
  liveRunIds: [],
  ...o,
})

const chatRoutes = { 'GET /groups': [], 'GET /bots': [], 'GET /machines': [], 'GET /notifications': [] }

const signIn = (tenancy: Omit<Tenancy, 'demoMode'> | null) =>
  useSession.setState({ user: me, tenancy: tenancy && { ...tenancy, demoMode: false }, status: 'ready' })

let assign: ReturnType<typeof vi.fn>
beforeEach(() => {
  localStorage.clear()
  localStorage.setItem('gg.locale', 'zh')
  vi.stubGlobal('WebSocket', FakeSocket)
  assign = vi.fn()
  vi.stubGlobal('location', { ...window.location, origin: 'http://10.0.0.5', assign })
  useWorkspace.setState({ groups: [], bots: [], machines: [], loaded: false, notifCount: 0 })
})
afterEach(() => vi.unstubAllGlobals())

describe('team switcher', () => {
  it('is hidden in single-team mode', async () => {
    mockApi(chatRoutes)
    signIn({ teams: [team()], singleTeamMode: true, canCreateTeam: false })
    renderAt('/')
    expect(await screen.findByText('共工空间')).toBeTruthy()
    expect(screen.queryByRole('button', { name: /切换团队/ })).toBeNull()
  })

  it('lists my teams with unread counts and switches to the picked one', async () => {
    mockApi(chatRoutes)
    localStorage.setItem('gg.team', 't1')
    signIn({
      teams: [team(), team({ id: 't2', name: '风控组', unread: 3 })],
      singleTeamMode: false,
      canCreateTeam: false,
    })
    renderAt('/')
    fireEvent.click(await screen.findByRole('button', { name: '切换团队，当前：支付组' }))
    const menu = screen.getByRole('menu')
    expect(within(menu).getByText('3')).toBeTruthy()
    expect(within(menu).queryByText('新建团队')).toBeNull()
    fireEvent.click(within(menu).getByText('风控组'))
    expect(localStorage.getItem('gg.team')).toBe('t2')
    expect(assign).toHaveBeenCalledWith('/')
  })

  it('sends someone in no team to /welcome, offering to create a team or join by invite', async () => {
    mockApi(chatRoutes)
    signIn({ teams: [], singleTeamMode: false, canCreateTeam: true })
    renderAt('/')
    await waitFor(() => expect(screen.getByTestId('where').textContent).toBe('/welcome'))
    expect(await screen.findByText('新建一个团队，或粘贴团队管理员发给你的邀请链接加入。')).toBeTruthy()
    expect(screen.getByRole('button', { name: '新建团队' }).closest('.auth__foot')).toBeNull()
  })

  it('tells someone who may not create teams to ask for an invite', async () => {
    mockApi(chatRoutes)
    signIn({ teams: [], singleTeamMode: false, canCreateTeam: false })
    renderAt('/welcome')
    expect(
      await screen.findByText('需要加入团队才能使用。请向团队管理员索取邀请链接，粘贴到下方加入。'),
    ).toBeTruthy()
    expect(screen.queryByRole('button', { name: '新建团队' })).toBeNull()
  })
})

describe('team settings', () => {
  it('is read-only for members: no editing, no invites, no member actions', async () => {
    mockApi({ 'GET /teams/t1/members': members })
    signIn(null)
    render(<TeamSettingsDialog team={team()} onClose={() => {}} />)
    expect(screen.queryByRole('textbox', { name: '团队名称' })).toBeNull()
    expect(screen.queryByRole('button', { name: '邀请' })).toBeNull()
    fireEvent.click(screen.getByRole('button', { name: '成员' }))
    expect(await screen.findByTestId('team-member-u2')).toBeTruthy()
    expect(screen.queryByRole('button', { name: /管理/ })).toBeNull()
    expect(screen.queryByPlaceholderText('输入账号添加成员')).toBeNull()
  })

  it('lets admins rename and create an invite link', async () => {
    const calls = mockApi({
      'PATCH /teams/t1': (body: { name: string }) => team({ role: 'admin', name: body.name }),
      'GET /teams/t1/invites': [],
      'POST /teams/t1/invites': {
        token: 'ggi_abc',
        invite: {
          id: 'i1',
          teamId: 't1',
          role: 'member',
          maxUses: null,
          uses: 0,
          expiresAt: '2026-12-01T00:00:00Z',
          createdBy: 'u1',
          revokedAt: null,
          createdAt: '',
        },
      },
    })
    signIn({ teams: [team({ role: 'admin' })], singleTeamMode: false, canCreateTeam: false })
    render(<TeamSettingsDialog team={team({ role: 'admin' })} onClose={() => {}} />)
    fireEvent.change(screen.getByRole('textbox', { name: '团队名称' }), { target: { value: '支付中台' } })
    fireEvent.click(screen.getByRole('button', { name: '保存' }))
    await waitFor(() => expect(calls.some((c) => c.method === 'PATCH')).toBe(true))
    expect(calls.find((c) => c.method === 'PATCH')?.body).toEqual({ name: '支付中台', avatar: null })

    fireEvent.click(screen.getByRole('button', { name: '邀请' }))
    fireEvent.click(screen.getByRole('button', { name: '生成邀请链接' }))
    expect(await screen.findByText('http://10.0.0.5/join/ggi_abc')).toBeTruthy()
    expect(calls.find((c) => c.method === 'POST')?.body).toEqual({
      role: 'member',
      expiresInDays: 7,
      maxUses: null,
    })
  })
})

describe('team management tabs', () => {
  const TABS = ['群', 'MCP', '参数', '用量', '审计']

  it('are only for admins', () => {
    mockApi({ 'GET /teams/t1/members': members })
    signIn(null)
    const { unmount } = render(<TeamSettingsDialog team={team()} onClose={() => {}} />)
    for (const name of TABS) expect(screen.queryByRole('button', { name })).toBeNull()
    unmount()
    render(<TeamSettingsDialog team={team({ role: 'admin' })} onClose={() => {}} />)
    for (const name of TABS) expect(screen.getByRole('button', { name })).toBeTruthy()
  })

  it('overrides params with the platform value as placeholder, and can inherit again', async () => {
    const calls = mockApi({
      'GET /teams/t1/params': {
        overrides: { chainMaxHops: 2 },
        platform: {
          approvalTimeoutMin: 30,
          chainMaxHops: 3,
          offlineWaitMin: 30,
          contextInlineMax: 20,
          sessionReplayCount: 50,
          botConcurrencyDefault: 2,
          attachmentsPerMessage: 10,
          questionsPerCard: 5,
        },
      },
      'PATCH /teams/t1': () => team({ role: 'admin' }),
    })
    signIn({ teams: [team({ role: 'admin' })], singleTeamMode: false, canCreateTeam: false })
    render(<TeamSettingsDialog team={team({ role: 'admin' })} onClose={() => {}} />)
    fireEvent.click(screen.getByRole('button', { name: '参数' }))
    const context = (await screen.findByLabelText('每轮随消息附带的群聊上下文')) as HTMLInputElement
    expect([context.value, context.placeholder]).toEqual(['', '20'])
    expect((screen.getByLabelText('接力链长上限 · 群默认') as HTMLInputElement).value).toBe('2')
    fireEvent.change(context, { target: { value: '8' } })
    fireEvent.blur(context)
    fireEvent.click(screen.getByRole('button', { name: '接力链长上限 · 群默认：恢复继承' }))
    fireEvent.click(screen.getByRole('button', { name: '保存' }))
    await waitFor(() => expect(calls.some((c) => c.method === 'PATCH')).toBe(true))
    expect(calls.find((c) => c.method === 'PATCH')?.body).toEqual({ params: { contextInlineMax: 8 } })
  })

  it('opens my groups; views or takes over the others; never archives', async () => {
    const calls = mockApi({
      'GET /teams/t1/groups': [
        teamGroup({ id: 'g1', name: '支付服务重构', joined: false }),
        teamGroup({ id: 'g2', name: '风控规则', joined: true }),
      ],
      'POST /teams/t1/groups/g1/takeover': chatGroup({ members: [...chatGroup().members, mine] }),
    })
    const onClose = vi.fn()
    render(
      <MemoryRouter>
        <TeamSettingsDialog team={team({ role: 'admin' })} onClose={onClose} />
        <Where />
      </MemoryRouter>,
    )
    fireEvent.click(screen.getByRole('button', { name: '群' }))
    expect(await screen.findAllByText('2 位成员 · 1 个 Bot')).toHaveLength(2)
    fireEvent.click(screen.getAllByRole('button', { name: '查看成员' })[0]!)
    const list = await screen.findByRole('dialog', { name: '「支付服务重构」的成员' })
    expect(within(list).getByText('李建国')).toBeTruthy()
    fireEvent.click(within(list).getByRole('button', { name: '完成' }))
    await waitFor(() => expect(screen.queryByRole('dialog', { name: '「支付服务重构」的成员' })).toBeNull())
    expect(screen.queryByRole('button', { name: '归档' })).toBeNull()
    expect(screen.getAllByRole('button', { name: '打开' })).toHaveLength(1)
    expect(screen.getAllByRole('button', { name: '查看' })).toHaveLength(1)

    fireEvent.click(screen.getByRole('button', { name: '打开' }))
    expect(screen.getByTestId('where').textContent).toBe('/g/g2')
    fireEvent.click(screen.getByRole('button', { name: '查看' }))
    expect(screen.getByTestId('where').textContent).toBe('/g/g1')
    expect(onClose).toHaveBeenCalledTimes(2)

    fireEvent.click(screen.getByRole('button', { name: '进群并成为管理员' }))
    const confirm = await screen.findByRole('alertdialog')
    fireEvent.click(within(confirm).getByRole('button', { name: '进群并成为管理员' }))
    await waitFor(() => expect(calls.some((c) => c.path === '/teams/t1/groups/g1/takeover')).toBe(true))
    await waitFor(() => expect(onClose).toHaveBeenCalledTimes(3))
    expect(useWorkspace.getState().groups.map((g) => g.id)).toEqual(['g1'])
  })

  it('saves the team MCP layer under the team', async () => {
    const calls = mockApi({
      'GET /teams/t1/mcp': [
        {
          id: 'm1',
          enabled: true,
          config: { transport: 'http', name: 'wiki', url: 'https://mcp.corp/wiki', headers: {} },
          updatedAt: '',
        },
      ],
      'PATCH /teams/t1/mcp/m1': (b: unknown) => b,
    })
    render(<TeamSettingsDialog team={team({ role: 'owner' })} onClose={() => {}} />)
    fireEvent.click(screen.getByRole('button', { name: 'MCP' }))
    expect(await screen.findByText('wiki')).toBeTruthy()
    expect(screen.getByText('团队层')).toBeTruthy()
    fireEvent.click(screen.getByRole('switch', { name: '启用 wiki' }))
    fireEvent.click(screen.getByRole('button', { name: '保存' }))
    await waitFor(() => expect(calls.some((c) => c.method === 'PATCH')).toBe(true))
    expect(calls.find((c) => c.method === 'PATCH')?.body).toMatchObject({ enabled: false })
  })
})

describe('single-team mode', () => {
  it('keeps 团队设置 in the account menu while hiding team switching', async () => {
    mockApi({ ...chatRoutes, 'GET /teams/t1/members': members })
    signIn({ teams: [team({ role: 'owner' })], singleTeamMode: true, canCreateTeam: false })
    renderAt('/')
    expect(await screen.findByText('共工空间')).toBeTruthy()
    expect(screen.queryByRole('button', { name: /切换团队/ })).toBeNull()
    fireEvent.click(screen.getAllByRole('button', { name: '账户菜单' })[0] as HTMLElement)
    fireEvent.click(within(screen.getByRole('menu')).getByText('团队设置'))
    const dialog = await screen.findByRole('dialog', { name: '概览 · 支付组' })
    expect(within(dialog).getByRole('button', { name: 'MCP' })).toBeTruthy()
    expect(within(dialog).queryByText('新建团队')).toBeNull()
  })

  it('has no 团队设置 entry outside single-team mode (the switcher has it)', async () => {
    mockApi(chatRoutes)
    signIn({ teams: [team()], singleTeamMode: false, canCreateTeam: false })
    renderAt('/')
    fireEvent.click((await screen.findAllByRole('button', { name: '账户菜单' }))[0] as HTMLElement)
    expect(within(screen.getByRole('menu')).queryByText('团队设置')).toBeNull()
  })
})

describe('join page', () => {
  it('shows the invite to a signed-out visitor with login and sign-up paths', async () => {
    mockApi({
      'GET /me': apiError(401, 'unauthorized'),
      'GET /invites/ggi_abc': { teamName: '支付组', inviterName: '李建国', valid: true },
    })
    useSession.setState({ user: null, tenancy: null, status: 'idle' })
    renderAt('/join/ggi_abc')
    expect(await screen.findByText('李建国 邀请你加入团队「支付组」。')).toBeTruthy()
    expect(screen.getByRole('link', { name: '注册并加入' }).getAttribute('href')).toBe(
      '/register?invite=ggi_abc',
    )
    fireEvent.click(screen.getByRole('button', { name: '登录后加入' }))
    await waitFor(() => expect(screen.getByTestId('where').textContent).toBe('/login'))
  })

  it('joins a signed-in user and switches to the team', async () => {
    const calls = mockApi({
      'GET /invites/ggi_abc': { teamName: '支付组', inviterName: '李建国', valid: true },
      'POST /invites/ggi_abc/accept': team({ id: 't9' }),
    })
    signIn({ teams: [team()], singleTeamMode: false, canCreateTeam: false })
    renderAt('/join/ggi_abc')
    fireEvent.click(await screen.findByRole('button', { name: '加入团队' }))
    await waitFor(() => expect(assign).toHaveBeenCalledWith('/'))
    expect(localStorage.getItem('gg.team')).toBe('t9')
    expect(calls.some((c) => c.path === '/invites/ggi_abc/accept')).toBe(true)
  })

  it('says when the invite is no longer valid', async () => {
    mockApi({ 'GET /invites/ggi_old': { teamName: '支付组', inviterName: '李建国', valid: false } })
    signIn(null)
    renderAt('/join/ggi_old')
    expect(await screen.findByText('邀请链接已失效')).toBeTruthy()
    expect(screen.queryByRole('button', { name: '加入团队' })).toBeNull()
  })
})

describe('viewing a group as team admin (plan D19)', () => {
  it('is read-only until the team admin joins as group admin', async () => {
    const calls = mockApi({
      ...chatRoutes,
      'GET /groups/g1': chatGroup(),
      'GET /groups/g1/timeline?limit=50': {
        messages: [
          {
            id: 'm1',
            seq: 1,
            groupId: 'g1',
            kind: 'user',
            authorId: 'u2',
            authorName: '李建国',
            body: '周五前完成评审',
            mentions: [],
            runId: null,
            createdAt: '2026-01-01T00:00:00Z',
            attachments: [],
            quote: null,
          },
        ],
        runs: [],
      },
      'POST /teams/t1/groups/g1/takeover': chatGroup({ members: [...chatGroup().members, mine] }),
    })
    localStorage.setItem('gg.team', 't1')
    signIn({ teams: [team({ role: 'admin' })], singleTeamMode: true, canCreateTeam: false })
    renderAt('/g/g1')
    const banner = await screen.findByTestId('readonly-banner')
    expect(within(banner).getByText(/你正以团队管理员身份查看此群/)).toBeTruthy()
    // Shown as members see it, but nothing in it can be acted on.
    expect((await screen.findByText('周五前完成评审')).closest('[inert]')).toBeTruthy()
    expect(screen.queryByPlaceholderText(/触发 Bot/)).toBeNull()
    expect(screen.queryByRole('button', { name: '群设置' })).toBeNull()
    expect(calls.some((c) => c.method === 'POST' && c.path === '/groups/g1/read')).toBe(false)

    fireEvent.click(within(banner).getByRole('button', { name: '进群并成为管理员' }))
    fireEvent.click(
      within(await screen.findByRole('alertdialog')).getByRole('button', { name: '进群并成为管理员' }),
    )
    expect(await screen.findByPlaceholderText(/触发 Bot/)).toBeTruthy()
    expect(screen.queryByTestId('readonly-banner')).toBeNull()
  })
})
