import type { BotDto, GroupDto, TeamOnboardingDto, UserDto } from '@gonggong/protocol'
import { fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import { MemoryRouter, useLocation } from 'react-router'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { App } from '../src/App'
import { useSession } from '../src/app/session'
import { useWorkspace } from '../src/app/workspace'
import { useGuide } from '../src/features/onboarding/store'
import { TeamOnboardingTab } from '../src/features/teams/TeamAdminTabs'
import { mockApi } from './mockApi'

const me: UserDto = {
  id: 'u1',
  account: 'xiaoli',
  name: '小李',
  role: 'member',
  mustChangePassword: false,
  disabled: false,
  gitProtocol: 'auto',
  email: null,
  avatar: null,
}

const team = { id: 't1', name: '团队', avatar: null, archivedAt: null, createdAt: '', unread: 0 }

const starter: GroupDto = {
  id: 'g1',
  teamId: 't1',
  name: '新手群',
  kind: 'group',
  mode: 'partition',
  adminOnlyInvite: false,
  protectBase: false,
  notice: '',
  noticeHidden: false,
  avatar: null,
  repo: null,
  members: [
    { userId: 'u0', name: '王磊', avatar: null, isAdmin: true },
    { userId: 'u1', name: '小李', avatar: null, isAdmin: false },
  ],
  botIds: ['b1'],
  unread: 0,
  lastSeq: 0,
  last: '',
  pinned: false,
  muted: false,
  foldRuns: false,
  liveRunIds: [],
  liveRuns: [],
}

const bot: BotDto = {
  id: 'b1',
  teamId: 't1',
  name: '小助手',
  ownerId: 'u0',
  ownerName: '王磊',
  agentKind: 'claude',
  avatar: 'role-no',
  avatarUrl: null,
  machineId: 'mc1',
  machineName: 'wanglei-mbp',
  binding: 'bound',
  presence: 'online',
  systemPrompt: '',
  tier: 'workspace',
  triggerScope: 'all',
  triggerList: [],
  concurrency: 2,
  createdBy: 'u0',
  agentVersion: null,
  agentMinVersion: null,
  groupCount: 1,
  defaultWorkspace: null,
  gitName: null,
  gitEmail: null,
  gitDefaultEmail: 'b1@bots.gonggong.local',
  sharedWith: [],
  agentSettings: {},
  approval: 'ask',
  allowlist: [],
  alwaysAllow: [],
  model: null,
  effort: null,
  catalog: null,
}

const onboarding = (o: Partial<TeamOnboardingDto> = {}): TeamOnboardingDto => ({
  groupId: 'g1',
  groupName: '新手群',
  botId: 'b1',
  botName: '小助手',
  examples: ['怎么申请服务器？', '帮我写周报', '报销流程是什么？'],
  feishuUrl: null,
  ...o,
})

class NoopSocket {
  close() {}
}

function At() {
  return <div data-testid="at">{useLocation().pathname}</div>
}

const routes = (o: { guide?: 'done' | 'skipped'; team?: TeamOnboardingDto; linked?: boolean } = {}) => ({
  'GET /groups': () => [starter],
  'GET /bots': () => [bot],
  'GET /machines': () => [],
  'GET /notifications/unread': () => ({ n: 0 }),
  'GET /terminal-spaces': () => [],
  'GET /me/onboarding': () => (o.guide ? { guide: o.guide, at: '2026-11-01T00:00:00.000Z' } : {}),
  'PATCH /me/onboarding': (body: unknown) => ({ ...(body as object), at: '2026-11-07T00:00:00.000Z' }),
  'GET /teams/t1/onboarding': () => o.team ?? onboarding(),
  'GET /me/feishu': () => ({
    identity: o.linked ? { name: '小李', avatar: null, email: null, boundAt: '', notify: false } : null,
  }),
  'POST /groups/g1/messages': (body: unknown) => ({ id: 'm1', ...(body as object) }),
})

function renderApp() {
  return render(
    <MemoryRouter initialEntries={['/']}>
      <App />
      <At />
    </MemoryRouter>,
  )
}

const guide = () => screen.findByRole('dialog', { name: '新手指引' })

beforeEach(() => {
  Object.defineProperty(window, 'innerWidth', { configurable: true, value: 1440 })
  vi.stubGlobal('WebSocket', NoopSocket)
  useSession.setState({
    user: me,
    status: 'ready',
    tenancy: {
      teams: [{ ...team, role: 'member' }],
      singleTeamMode: true,
      canCreateTeam: false,
      demoMode: false,
      pluginsEnabled: false,
    },
  })
  useWorkspace.setState({ groups: [], bots: [], machines: [], loaded: false })
  useGuide.setState({ open: false })
})
afterEach(() => {
  vi.unstubAllGlobals()
  localStorage.removeItem('gg.builder')
})

describe('团队设置 · 新手群', () => {
  it('picks the group, its bot and edits the examples', async () => {
    const calls = mockApi({
      'GET /teams/t1/onboarding': () =>
        onboarding({
          groupId: null,
          groupName: null,
          botId: null,
          botName: null,
          options: [{ id: 'g1', name: '新手群', bots: [{ id: 'b1', name: '小助手' }] }],
        }),
      'PUT /teams/t1/onboarding': (body: unknown) => ({ ...onboarding(), ...(body as object) }),
    })
    render(<TeamOnboardingTab team={{ ...team, role: 'admin' }} />)
    fireEvent.click(await screen.findByRole('button', { name: '新手群' }))
    fireEvent.click(within(screen.getByRole('menu')).getByRole('menuitemcheckbox', { name: '新手群' }))
    expect(screen.getByRole('button', { name: '默认助手 Bot' }).textContent).toContain('小助手')
    fireEvent.change(screen.getByRole('textbox', { name: '示例问题 2' }), { target: { value: '帮我写日报' } })
    fireEvent.click(screen.getByRole('button', { name: '保存' }))
    await waitFor(() =>
      expect(calls.find((c) => c.method === 'PUT')?.body).toEqual({
        groupId: 'g1',
        botId: 'b1',
        examples: ['怎么申请服务器？', '帮我写日报', '报销流程是什么？'],
      }),
    )
  })
})

describe('使用者首次登录引导', () => {
  it('opens on first visit and walks through groups, an example question and Feishu', async () => {
    const calls = mockApi(routes())
    renderApp()
    const dialog = await guide()
    expect(within(dialog).getByText('第 1/3 步')).toBeTruthy()
    expect(await within(dialog).findByText('新手群')).toBeTruthy()
    expect(within(dialog).getByText('@小助手')).toBeTruthy()

    fireEvent.click(within(dialog).getByRole('button', { name: '下一步' }))
    expect(within(dialog).getByText('第 2/3 步')).toBeTruthy()
    fireEvent.click(await within(dialog).findByRole('button', { name: '帮我写周报' }))

    await waitFor(() =>
      expect(calls.find((c) => c.method === 'POST' && c.path === '/groups/g1/messages')?.body).toMatchObject({
        body: '@小助手 帮我写周报',
      }),
    )
    await waitFor(() =>
      expect(calls.find((c) => c.method === 'PATCH' && c.path === '/me/onboarding')?.body).toEqual({
        guide: 'done',
      }),
    )
    await waitFor(() => expect(screen.queryByRole('dialog', { name: '新手指引' })).toBeNull())
    expect(screen.getByTestId('at').textContent).toBe('/g/g1')
  })

  it('shows how to use it in Feishu, with the chat link or a way to link Feishu', async () => {
    mockApi(
      routes({
        team: onboarding({ feishuUrl: 'https://applink.feishu.cn/client/chat/open?openChatId=oc_1' }),
      }),
    )
    renderApp()
    const dialog = await guide()
    fireEvent.click(within(dialog).getByRole('button', { name: '下一步' }))
    fireEvent.click(within(dialog).getByRole('button', { name: '下一步' }))
    expect(within(dialog).getByText('第 3/3 步')).toBeTruthy()
    const link = await within(dialog).findByRole('link', { name: '打开飞书群' })
    expect(link.getAttribute('href')).toBe('https://applink.feishu.cn/client/chat/open?openChatId=oc_1')
    expect((await within(dialog).findByRole('link', { name: '绑定飞书' })).getAttribute('href')).toContain(
      'mode=link',
    )
  })

  it('records a skip and stays closed', async () => {
    const calls = mockApi(routes())
    renderApp()
    fireEvent.click(within(await guide()).getByRole('button', { name: '跳过' }))
    await waitFor(() =>
      expect(calls.find((c) => c.method === 'PATCH' && c.path === '/me/onboarding')?.body).toEqual({
        guide: 'skipped',
      }),
    )
    await waitFor(() => expect(screen.queryByRole('dialog', { name: '新手指引' })).toBeNull())
  })

  it('does not reopen once done, and the account menu brings it back', async () => {
    mockApi(routes({ guide: 'done', linked: true }))
    renderApp()
    await screen.findByRole('button', { name: '账户菜单' })
    await new Promise((r) => setTimeout(r, 50))
    expect(screen.queryByRole('dialog', { name: '新手指引' })).toBeNull()
    fireEvent.click(screen.getByRole('button', { name: '账户菜单' }))
    fireEvent.click(within(screen.getByRole('menu')).getByRole('menuitem', { name: '新手指引' }))
    expect(await guide()).toBeTruthy()
  })

  it('asks for an admin to add them when the team has no 新手群', async () => {
    mockApi(routes({ team: onboarding({ groupId: null, groupName: null, botId: null, botName: null }) }))
    renderApp()
    const dialog = await guide()
    fireEvent.click(within(dialog).getByRole('button', { name: '下一步' }))
    expect(await within(dialog).findByText('请管理员把你拉进群')).toBeTruthy()
    expect(within(dialog).queryByRole('button', { name: '帮我写周报' })).toBeNull()
  })

  it('never pops up for a builder', async () => {
    localStorage.setItem('gg.builder', '1')
    const calls = mockApi(routes())
    renderApp()
    await screen.findByRole('button', { name: '账户菜单' })
    await new Promise((r) => setTimeout(r, 50))
    expect(screen.queryByRole('dialog', { name: '新手指引' })).toBeNull()
    expect(calls.some((c) => c.path === '/me/onboarding')).toBe(false)
  })
})
