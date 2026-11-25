import type {
  BotDto,
  GroupDto,
  TeamDto,
  TeamInviteDto,
  TeamMemberDto,
  TeamOnboardingDto,
  UserDto,
} from '@gonggong/protocol'
import { fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import { MemoryRouter } from 'react-router'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { useSession } from '../src/app/session'
import { useWorkspace } from '../src/app/workspace'
import { useGuide } from '../src/features/onboarding/store'
import { UserGuide } from '../src/features/onboarding/UserGuide'
import { TeamSettingsDialog } from '../src/features/teams/TeamSettingsDialog'
import { useToasts } from '../src/ui'
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

const team = (o: Partial<TeamDto> = {}): TeamDto => ({
  id: 't1',
  name: '支付组',
  avatar: null,
  role: 'admin',
  archivedAt: null,
  createdAt: '2026-01-01T00:00:00Z',
  unread: 0,
  ...o,
})

const members: TeamMemberDto[] = [
  { userId: 'u1', name: '王磊', account: 'wanglei', avatar: null, role: 'admin', joinedAt: '' },
  { userId: 'u2', name: '李建国', account: 'lijg', avatar: null, role: 'owner', joinedAt: '' },
]

const invite = (o: Partial<TeamInviteDto> = {}): TeamInviteDto => ({
  id: 'i1',
  teamId: 't1',
  role: 'member',
  maxUses: 10,
  uses: 1,
  expiresAt: '2099-12-01T00:00:00Z',
  createdBy: 'u1',
  revokedAt: null,
  createdAt: '',
  ...o,
})

const starterGroup: GroupDto = {
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
  members: [{ userId: 'u1', name: '王磊', avatar: null, isAdmin: false }],
  botIds: ['b1'],
  unread: 0,
  lastSeq: 0,
  last: '',
  pinned: false,
  notifyLevel: 'mentions',
  foldRuns: false,
  liveRunIds: [],
  liveRuns: [],
}

const starterBot: BotDto = {
  id: 'b1',
  teamId: 't1',
  name: '小助手',
  ownerId: 'u2',
  ownerName: '李建国',
  agentKind: 'claude',
  avatar: 'role-no',
  followAgent: false,
  avatarUrl: null,
  machineId: 'mc1',
  machineName: 'dev-mbp',
  binding: 'bound',
  presence: 'online',
  systemPrompt: '',
  tier: 'workspace',
  triggerScope: 'all',
  access: { trusted: 'ask', others: 'auto' },
  triggerList: [],
  concurrency: 2,
  createdBy: 'u2',
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
  aiReview: false,
  model: null,
  effort: null,
  catalog: null,
}

const onboardingDto: TeamOnboardingDto = {
  groupId: 'g1',
  groupName: '新手群',
  botId: 'b1',
  botName: '小助手',
  examples: ['怎么申请服务器？', '帮我写周报'],
  feishuUrl: null,
}

beforeEach(() => {
  localStorage.clear()
  localStorage.setItem('gg.locale', 'zh')
  useToasts.setState({ items: [] })
  useSession.setState({
    user: me,
    status: 'ready',
    tenancy: {
      teams: [team()],
      singleTeamMode: false,
      canCreateTeam: false,
      demoMode: false,
      pluginsEnabled: false,
    },
  })
  useWorkspace.setState({ groups: [], bots: [], machines: [], loaded: true, notifCount: 0 })
  useGuide.setState({ open: false })
})

afterEach(() => {
  vi.unstubAllGlobals()
})

describe('TeamSettingsDialog › InvitesTab UX', () => {})

describe('TeamSettingsDialog › OverviewTab, MembersTab & unsaved changes', () => {
  it('switches tab after confirming discard', async () => {
    mockApi({ 'GET /teams/t1/members': members })
    render(<TeamSettingsDialog team={team()} onClose={() => {}} />)

    fireEvent.change(screen.getByRole('textbox', { name: '团队名称' }), { target: { value: '支付平台' } })
    fireEvent.click(screen.getByRole('button', { name: '成员' }))
    const discard = await screen.findByRole('alertdialog')
    fireEvent.click(within(discard).getByRole('button', { name: '放弃更改' }))
    expect(await screen.findByTestId('team-member-u2')).toBeTruthy()
  })

  it('shows loading on OverviewTab save button and toasts on success', async () => {
    let finishSave = () => {}
    mockApi({
      'GET /teams/t1/members': members,
      'PATCH /teams/t1': async (body: { name: string }) => {
        await new Promise<void>((r) => {
          finishSave = r
        })
        return team({ name: body.name })
      },
    })
    render(<TeamSettingsDialog team={team()} onClose={() => {}} />)

    fireEvent.change(screen.getByRole('textbox', { name: '团队名称' }), { target: { value: '支付中台' } })
    const saveBtn = screen.getByRole('button', { name: '保存' })
    fireEvent.click(saveBtn)
    expect(saveBtn.getAttribute('aria-busy')).toBe('true')

    finishSave()
    await waitFor(() =>
      expect(useToasts.getState().items[0]).toMatchObject({ type: 'success', message: '已保存团队设置' }),
    )
    expect(saveBtn.getAttribute('aria-busy')).toBeNull()
  })

  it('renders error Alert with retry on MembersTab failure and prevents double-submit when adding', async () => {
    let failLoad = true
    let finishAdd = () => {}
    let list = [...members]
    const calls = mockApi({
      'GET /teams/t1/members': () => {
        if (failLoad) {
          failLoad = false
          return apiError(500, 'internal', '成员加载失败')
        }
        return list
      },
      'POST /teams/t1/members': async (body: { account: string }) => {
        await new Promise<void>((r) => {
          finishAdd = r
        })
        const added: TeamMemberDto = {
          userId: 'u3',
          name: '赵敏',
          account: body.account,
          avatar: null,
          role: 'member',
          joinedAt: '',
        }
        list = [...list, added]
        return added
      },
    })

    render(<TeamSettingsDialog team={team()} tab="members" onClose={() => {}} />)
    const alert = await screen.findByRole('alert')
    expect(within(alert).getByText('成员加载失败')).toBeTruthy()

    fireEvent.click(within(alert).getByRole('button', { name: '重试' }))
    expect(await screen.findByTestId('team-member-u2')).toBeTruthy()

    const input = screen.getByRole('textbox', { name: '账号' })
    fireEvent.change(input, { target: { value: 'zhaomin' } })
    const addBtn = screen.getByRole('button', { name: '添加成员' }) as HTMLButtonElement
    fireEvent.click(addBtn)
    expect(addBtn.getAttribute('aria-busy')).toBe('true')
    expect(addBtn.disabled).toBe(true)

    // Re-submit while adding should be ignored.
    fireEvent.submit(input.closest('form') as HTMLFormElement)
    expect(calls.filter((c) => c.method === 'POST')).toHaveLength(1)

    finishAdd()
    expect(await screen.findByTestId('team-member-u3')).toBeTruthy()
    expect(useToasts.getState().items[0]).toMatchObject({ type: 'success' })
  })
})

describe('UserGuide UX', () => {
  it('shows Alert with retry on step 2 when team onboarding fails to load', async () => {
    let fail = true
    mockApi({
      'GET /teams/t1/onboarding': () => {
        if (fail) {
          fail = false
          return apiError(500, 'internal', '新手群配置加载失败')
        }
        return onboardingDto
      },
      'GET /me/feishu': () => ({ identity: null }),
    })
    useWorkspace.setState({ groups: [starterGroup], bots: [starterBot], machines: [], loaded: true })
    useGuide.setState({ open: true })

    render(
      <MemoryRouter>
        <UserGuide ready />
      </MemoryRouter>,
    )
    const dialog = await screen.findByRole('dialog', { name: '新手指引' })
    fireEvent.click(within(dialog).getByRole('button', { name: '下一步' }))

    const alert = await within(dialog).findByRole('alert')
    expect(within(alert).getByText('新手群配置加载失败')).toBeTruthy()

    fireEvent.click(within(alert).getByRole('button', { name: '重试' }))
    expect(await within(dialog).findByRole('button', { name: '帮我写周报' })).toBeTruthy()
  })

  it('disables footer navigation and Escape closing while an example question is being sent', async () => {
    let release = () => {}
    const calls = mockApi({
      'GET /teams/t1/onboarding': () => onboardingDto,
      'GET /me/feishu': () => ({ identity: null }),
      'PATCH /me/onboarding': (body: unknown) => ({ ...(body as object), at: '2026-11-24T00:00:00Z' }),
      'POST /groups/g1/messages': async (body: unknown) => {
        await new Promise<void>((r) => {
          release = r
        })
        return { id: 'm1', ...(body as object) }
      },
    })
    useWorkspace.setState({ groups: [starterGroup], bots: [starterBot], machines: [], loaded: true })
    useGuide.setState({ open: true })

    render(
      <MemoryRouter>
        <UserGuide ready />
      </MemoryRouter>,
    )
    const dialog = await screen.findByRole('dialog', { name: '新手指引' })
    fireEvent.click(within(dialog).getByRole('button', { name: '下一步' }))
    const exampleBtn = await within(dialog).findByRole('button', { name: '帮我写周报' })
    fireEvent.click(exampleBtn)

    expect((within(dialog).getByRole('button', { name: '跳过' }) as HTMLButtonElement).disabled).toBe(true)
    expect((within(dialog).getByRole('button', { name: '上一步' }) as HTMLButtonElement).disabled).toBe(true)
    expect((within(dialog).getByRole('button', { name: '下一步' }) as HTMLButtonElement).disabled).toBe(true)

    fireEvent.keyDown(document, { key: 'Escape' })
    expect(screen.getByRole('dialog', { name: '新手指引' })).toBeTruthy()
    expect(calls.some((c) => c.path === '/me/onboarding')).toBe(false)

    release()
    await waitFor(() => expect(screen.queryByRole('dialog', { name: '新手指引' })).toBeNull())
  })
})
