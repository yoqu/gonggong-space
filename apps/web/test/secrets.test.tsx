import type {
  BotDto,
  SecretCard as Card,
  GroupDto,
  MessageDto,
  MySecretDto,
  SecretDto,
  SecretRequestDto,
  TeamDto,
  UserDto,
} from '@gonggong/protocol'
import { fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import { MemoryRouter, Route, Routes } from 'react-router'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { useSession } from '../src/app/session'
import { useWorkspace } from '../src/app/workspace'
import { GroupSettingsDialog } from '../src/features/groups/GroupSettingsDialog'
import { SecretBanner } from '../src/features/secrets/SecretBanner'
import { SecretCard } from '../src/features/secrets/SecretCard'
import { SecretLayerList } from '../src/features/secrets/SecretLayer'
import { SecretRequestPage } from '../src/features/secrets/SecretRequestPage'
import { SettingsDialog } from '../src/features/settings/SettingsDialog'
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
  email: null,
  avatar: null,
}

const team: TeamDto = {
  id: 't1',
  name: '支付组',
  avatar: null,
  role: 'admin',
  archivedAt: null,
  createdAt: '2026-01-01T00:00:00Z',
  unread: 0,
}

const group = (o: Partial<GroupDto> = {}): GroupDto => ({
  id: 'g1',
  teamId: 't1',
  name: '支付服务重构',
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
  botIds: ['b1'],
  unread: 0,
  lastSeq: 1,
  last: '',
  pinned: false,
  muted: false,
  foldRuns: false,
  liveRunIds: [],
  liveRuns: [],
  ...o,
})

const bot = { id: 'b1', teamId: 't1', name: '构建Bot' } as BotDto

const secret = (o: Partial<SecretDto> = {}): SecretDto => ({
  id: 's1',
  scope: 'team',
  teamId: 't1',
  groupId: null,
  name: 'FEISHU_DEVOPS_TOKEN',
  description: '飞书 devops 构建',
  mode: 'shared',
  botIds: null,
  enabled: true,
  expiresAt: null,
  value: { last4: 'x9z1', updatedBy: '王磊', updatedAt: new Date().toISOString() },
  personalFilled: [],
  updatedAt: new Date().toISOString(),
  ...o,
})
const personal = secret({
  id: 's2',
  name: 'GITHUB_TOKEN',
  description: '个人 GitHub',
  mode: 'personal',
  value: null,
  botIds: ['b1'],
  personalFilled: [{ userId: 'u2', name: '李建国' }],
})

const row = (name: string) => screen.getByText(name).closest('.cfg__item') as HTMLElement

beforeEach(() => {
  localStorage.setItem('gg.locale', 'zh')
  useSession.setState({ user: me, status: 'ready' })
  useWorkspace.setState({ bots: [bot], groups: [group()] })
})
afterEach(() => vi.unstubAllGlobals())

describe('团队设置 · 密钥', () => {
  it('lists definitions with mode, bots, the value state and who filled their own, never a value', async () => {
    mockApi({ 'GET /teams/t1/members': [], 'GET /teams/t1/secrets': [secret(), personal] })
    render(<TeamSettingsDialog team={team} tab="secrets" onClose={() => {}} />)
    await screen.findByText('FEISHU_DEVOPS_TOKEN')
    const shared = row('FEISHU_DEVOPS_TOKEN').textContent
    expect(shared).toContain('统一值')
    expect(shared).toContain('飞书 devops 构建')
    expect(shared).toContain('可用 Bot：全部')
    expect(shared).toContain('已填写 · 末 4 位 x9z1 · 王磊')
    const mine = row('GITHUB_TOKEN').textContent
    expect(mine).toContain('每人自填')
    expect(mine).toContain('可用 Bot：构建Bot')
    expect(mine).toContain('已填个人值：李建国')
    expect(mine).not.toContain('未填写')
  })

  it('creates a definition: validates the name and value, hides the shared value for personal', async () => {
    const calls = mockApi({
      'GET /teams/t1/members': [],
      'GET /teams/t1/secrets': [],
      'POST /teams/t1/secrets': (b: unknown) => secret(b as Partial<SecretDto>),
    })
    render(<TeamSettingsDialog team={team} tab="secrets" onClose={() => {}} />)
    fireEvent.click(await screen.findByRole('button', { name: '新建密钥…' }))
    const dialog = await screen.findByRole('dialog', { name: '新建密钥' })
    fireEvent.change(within(dialog).getByLabelText('名称'), { target: { value: 'github-token' } })
    fireEvent.click(within(dialog).getByRole('button', { name: '保存' }))
    expect(within(dialog).getByText('名称只能用大写字母、数字和下划线，以字母开头')).toBeTruthy()

    fireEvent.change(within(dialog).getByLabelText('名称'), { target: { value: 'GITHUB_TOKEN' } })
    fireEvent.change(within(dialog).getByLabelText('用途'), { target: { value: '构建用' } })
    fireEvent.click(within(dialog).getByRole('radio', { name: '每人自填' }))
    expect(within(dialog).queryByLabelText('填写统一值')).toBeNull()
    fireEvent.click(within(dialog).getByRole('radio', { name: '统一值' }))
    fireEvent.click(within(dialog).getByRole('radio', { name: '指定 Bot' }))
    fireEvent.click(within(dialog).getByRole('checkbox', { name: '构建Bot' }))
    fireEvent.change(within(dialog).getByLabelText('到期时间'), { target: { value: '2026-12-31' } })
    const value = within(dialog).getByLabelText('填写统一值') as HTMLInputElement
    expect(value.type).toBe('password')
    fireEvent.change(value, { target: { value: 'short' } })
    fireEvent.click(within(dialog).getByRole('button', { name: '保存' }))
    expect(within(dialog).getByText('密钥至少 8 个字符')).toBeTruthy()
    fireEvent.change(value, { target: { value: 'ghp_12345678' } })
    fireEvent.click(within(dialog).getByRole('button', { name: '保存' }))
    await waitFor(() =>
      expect(calls).toContainEqual({
        method: 'POST',
        path: '/teams/t1/secrets',
        body: {
          name: 'GITHUB_TOKEN',
          description: '构建用',
          mode: 'shared',
          botIds: ['b1'],
          enabled: true,
          expiresAt: new Date('2026-12-31T23:59:59').toISOString(),
          value: 'ghp_12345678',
        },
      }),
    )
    await waitFor(() => expect(screen.queryByRole('dialog', { name: '新建密钥' })).toBeNull())
    expect(calls.filter((c) => c.path === '/teams/t1/secrets' && c.method === 'GET')).toHaveLength(2)
  })

  it('edits without resending the value, clears the shared value and deletes', async () => {
    const calls = mockApi({
      'GET /teams/t1/members': [],
      'GET /teams/t1/secrets': [secret()],
      'PATCH /secrets/s1': (b: unknown) => secret(b as Partial<SecretDto>),
      'DELETE /secrets/s1': undefined,
    })
    render(<TeamSettingsDialog team={team} tab="secrets" onClose={() => {}} />)
    await screen.findByText('FEISHU_DEVOPS_TOKEN')
    const manage = () => {
      fireEvent.click(screen.getByRole('button', { name: '管理 FEISHU_DEVOPS_TOKEN' }))
    }

    manage()
    fireEvent.click(await screen.findByRole('menuitem', { name: '编辑…' }))
    const dialog = await screen.findByRole('dialog', { name: '编辑密钥' })
    expect((within(dialog).getByLabelText('名称') as HTMLInputElement).disabled).toBe(true)
    expect((within(dialog).getByLabelText('填写统一值') as HTMLInputElement).value).toBe('')
    fireEvent.change(within(dialog).getByLabelText('用途'), { target: { value: '构建与部署' } })
    fireEvent.click(within(dialog).getByRole('button', { name: '保存' }))
    await waitFor(() =>
      expect(calls).toContainEqual({
        method: 'PATCH',
        path: '/secrets/s1',
        body: { description: '构建与部署', mode: 'shared', botIds: null, enabled: true, expiresAt: null },
      }),
    )
    await waitFor(() => expect(screen.queryByRole('dialog', { name: '编辑密钥' })).toBeNull())

    manage()
    fireEvent.click(await screen.findByRole('menuitem', { name: '清除统一值' }))
    fireEvent.click(within(await screen.findByRole('alertdialog')).getByRole('button', { name: '清除' }))
    await waitFor(() =>
      expect(calls).toContainEqual({ method: 'PATCH', path: '/secrets/s1', body: { value: null } }),
    )

    manage()
    fireEvent.click(await screen.findByRole('menuitem', { name: '删除' }))
    fireEvent.click(within(await screen.findByRole('alertdialog')).getByRole('button', { name: '删除' }))
    await waitFor(() => expect(calls.map((c) => `${c.method} ${c.path}`)).toContain('DELETE /secrets/s1'))
  })

  it('is not offered to plain members', () => {
    mockApi({ 'GET /teams/t1/members': [] })
    render(<TeamSettingsDialog team={{ ...team, role: 'member' }} onClose={() => {}} />)
    expect(screen.queryByRole('button', { name: '密钥' })).toBeNull()
  })
})

describe('群设置 · 密钥', () => {
  const inherited = [
    secret({ id: 's1', overridden: true }),
    secret({ id: 's3', scope: 'platform', teamId: null, name: 'NPM_TOKEN', description: '', value: null }),
    secret({ id: 's4', scope: 'group', groupId: 'g1', name: 'FEISHU_DEVOPS_TOKEN', description: '本群' }),
  ]

  it('shows inherited rows with their layer and override; only the group layer is editable', async () => {
    mockApi({ 'GET /groups/g1/secrets': inherited })
    render(<GroupSettingsDialog group={group()} tab="secrets" onClose={() => {}} />)
    expect(await screen.findByText('继承自团队/平台')).toBeTruthy()
    const items = screen
      .getAllByText('FEISHU_DEVOPS_TOKEN')
      .map((n) => n.closest('.cfg__item') as HTMLElement)
    const [own, team] = items as [HTMLElement, HTMLElement]
    expect(own.textContent).toContain('群层')
    expect(within(own).getByRole('button', { name: '管理 FEISHU_DEVOPS_TOKEN' })).toBeTruthy()
    expect(team.textContent).toContain('团队层')
    expect(team.textContent).toContain('已被本群覆盖')
    expect(within(team).queryByRole('button')).toBeNull()
    expect(row('NPM_TOKEN').textContent).toContain('平台层')
    expect(row('NPM_TOKEN').textContent).toContain('统一值未填写')
    expect(screen.getByRole('button', { name: '新建密钥…' })).toBeTruthy()
  })

  it('has no secrets tab in a DM', () => {
    mockApi({})
    render(<GroupSettingsDialog group={group({ kind: 'dm' })} tab="basic" onClose={() => {}} />)
    expect(screen.queryByRole('button', { name: '密钥' })).toBeNull()
  })

  it('is read-only for members', async () => {
    mockApi({ 'GET /groups/g1/secrets': inherited })
    render(<SecretLayerList base="/groups/g1/secrets" scope="group" bots={[bot]} editable={false} />)
    await screen.findByText('NPM_TOKEN')
    expect(screen.queryByRole('button', { name: '新建密钥…' })).toBeNull()
    expect(screen.queryByRole('button', { name: /^管理/ })).toBeNull()
  })

  const mineOf = (s: SecretDto, mine: MySecretDto['mine'] = null): MySecretDto => ({
    secret: { ...s, expiresAt: null },
    where: '支付服务重构',
    mine,
  })

  it('lets a member fill their own value right in the list', async () => {
    const own = secret({
      id: 's5',
      scope: 'group',
      groupId: 'g1',
      name: 'JIRA_TOKEN',
      mode: 'personal',
      value: null,
    })
    const calls = mockApi({
      'GET /groups/g1/secrets': [...inherited, own],
      'GET /me/secrets': [mineOf(own)],
      'PUT /me/secrets/s5': {},
    })
    render(<SecretLayerList base="/groups/g1/secrets" scope="group" bots={[bot]} editable={false} />)
    await waitFor(() => expect(row('JIRA_TOKEN').textContent).toContain('我的值：未填写'))
    expect(within(row('NPM_TOKEN')).queryByRole('button')).toBeNull()
    fireEvent.click(within(row('JIRA_TOKEN')).getByRole('button', { name: '填写我的值…' }))
    const dialog = await screen.findByRole('dialog', { name: '填写 JIRA_TOKEN' })
    fireEvent.change(within(dialog).getByLabelText('值'), { target: { value: 'jira_12345678' } })
    fireEvent.click(within(dialog).getByRole('button', { name: '保存' }))
    await waitFor(() =>
      expect(calls).toContainEqual({
        method: 'PUT',
        path: '/me/secrets/s5',
        body: { value: 'jira_12345678', allowForeignMachines: false },
      }),
    )
    await waitFor(() => expect(calls.filter((c) => c.path === '/me/secrets')).toHaveLength(2))
  })

  it('shows my filled value and offers to update it', async () => {
    const own = secret({
      id: 's5',
      scope: 'group',
      groupId: 'g1',
      name: 'JIRA_TOKEN',
      mode: 'shared_overridable',
    })
    const mine = {
      last4: 'abcd',
      updatedBy: null,
      updatedAt: new Date().toISOString(),
      allowForeignMachines: false,
    }
    mockApi({ 'GET /groups/g1/secrets': [own], 'GET /me/secrets': [mineOf(own, mine)] })
    render(<SecretLayerList base="/groups/g1/secrets" scope="group" bots={[bot]} editable={false} />)
    await waitFor(() => expect(row('JIRA_TOKEN').textContent).toContain('我的值：已填写 · 末 4 位 abcd'))
    expect(within(row('JIRA_TOKEN')).getByRole('button', { name: '更新我的值…' })).toBeTruthy()
  })

  it('fills my own value while creating a per-member secret', async () => {
    const calls = mockApi({
      'GET /groups/g1/secrets': [],
      'GET /me/secrets': [],
      'POST /groups/g1/secrets': (b: unknown) =>
        secret({ ...(b as Partial<SecretDto>), id: 's9', scope: 'group' }),
      'PUT /me/secrets/s9': {},
    })
    render(<GroupSettingsDialog group={group()} tab="secrets" onClose={() => {}} />)
    fireEvent.click(await screen.findByRole('button', { name: '新建密钥…' }))
    const dialog = await screen.findByRole('dialog', { name: '新建密钥' })
    fireEvent.change(within(dialog).getByLabelText('名称'), { target: { value: 'GITHUB_TOKEN' } })
    expect(within(dialog).queryByLabelText('填写我的值')).toBeNull()
    fireEvent.click(within(dialog).getByRole('radio', { name: '每人自填' }))
    const value = within(dialog).getByLabelText('填写我的值') as HTMLInputElement
    expect(value.type).toBe('password')
    fireEvent.change(value, { target: { value: 'short' } })
    fireEvent.click(within(dialog).getByRole('button', { name: '保存' }))
    expect(within(dialog).getByText('密钥至少 8 个字符')).toBeTruthy()
    fireEvent.change(value, { target: { value: 'ghp_12345678' } })
    fireEvent.click(within(dialog).getByRole('button', { name: '保存' }))
    await waitFor(() =>
      expect(calls).toContainEqual({
        method: 'PUT',
        path: '/me/secrets/s9',
        body: { value: 'ghp_12345678', allowForeignMachines: false },
      }),
    )
    const post = calls.find((c) => c.method === 'POST')?.body as Record<string, unknown>
    expect(post.mode).toBe('personal')
    expect(post).not.toHaveProperty('value')
    await waitFor(() => expect(screen.queryByRole('dialog', { name: '新建密钥' })).toBeNull())
  })
})

describe('我的密钥', () => {
  const mineList: MySecretDto[] = [
    {
      secret: {
        id: 's2',
        scope: 'team',
        teamId: 't1',
        groupId: null,
        name: 'GITHUB_TOKEN',
        description: '个人 GitHub',
        mode: 'personal',
        expiresAt: null,
      },
      where: '支付组',
      mine: null,
    },
    {
      secret: {
        id: 's4',
        scope: 'group',
        teamId: 't1',
        groupId: 'g1',
        name: 'JIRA_TOKEN',
        description: '',
        mode: 'shared_overridable',
        expiresAt: null,
      },
      where: '支付服务重构',
      mine: {
        last4: 'abcd',
        updatedBy: '王磊',
        updatedAt: new Date().toISOString(),
        allowForeignMachines: false,
      },
    },
  ]

  it('fills my own value; other machines stay off by default and the reason is stated', async () => {
    const calls = mockApi({ 'GET /me/secrets': mineList, 'PUT /me/secrets/s2': {} })
    render(<SettingsDialog page="secrets" onClose={() => {}} />)
    expect(await screen.findByText('支付组')).toBeTruthy()
    expect(row('GITHUB_TOKEN').textContent).toContain('未填写')
    expect(row('JIRA_TOKEN').textContent).toContain('已填写 · 末 4 位 abcd')
    fireEvent.click(within(row('GITHUB_TOKEN')).getByRole('button', { name: '填写…' }))
    const dialog = await screen.findByRole('dialog', { name: '填写 GITHUB_TOKEN' })
    expect(within(dialog).getByText(/机器主人能读到/)).toBeTruthy()
    const foreign = within(dialog).getByRole('checkbox', { name: '允许在他人机器上的 Bot 使用' })
    expect((foreign as HTMLInputElement).checked).toBe(false)
    const value = within(dialog).getByLabelText('值') as HTMLInputElement
    expect(value.type).toBe('password')
    fireEvent.change(value, { target: { value: 'ghp_12345678' } })
    fireEvent.click(within(dialog).getByRole('button', { name: '保存' }))
    await waitFor(() =>
      expect(calls).toContainEqual({
        method: 'PUT',
        path: '/me/secrets/s2',
        body: { value: 'ghp_12345678', allowForeignMachines: false },
      }),
    )
  })

  it('switches other machines on and clears my value', async () => {
    const calls = mockApi({
      'GET /me/secrets': mineList,
      'PUT /me/secrets/s4': {},
      'DELETE /me/secrets/s4': undefined,
    })
    render(<SettingsDialog page="secrets" onClose={() => {}} />)
    await screen.findByText('JIRA_TOKEN')
    const sw = within(row('JIRA_TOKEN')).getByRole('switch', {
      name: '允许在他人机器上的 Bot 使用 JIRA_TOKEN',
    })
    expect(sw.getAttribute('aria-checked')).toBe('false')
    fireEvent.click(sw)
    await waitFor(() =>
      expect(calls).toContainEqual({
        method: 'PUT',
        path: '/me/secrets/s4',
        body: { allowForeignMachines: true },
      }),
    )
    fireEvent.click(within(row('JIRA_TOKEN')).getByRole('button', { name: '清除' }))
    fireEvent.click(within(await screen.findByRole('alertdialog')).getByRole('button', { name: '清除' }))
    await waitFor(() =>
      expect(calls).toContainEqual({ method: 'DELETE', path: '/me/secrets/s4', body: undefined }),
    )
  })
})

describe('填写密钥 card', () => {
  const card: Card = {
    id: 'q1',
    names: ['GITHUB_TOKEN', 'JIRA_TOKEN'],
    audience: 'origin',
    userId: 'u1',
    filled: false,
  }
  const m: MessageDto = {
    id: 'm1',
    seq: 3,
    groupId: 'g1',
    kind: 'event',
    authorId: null,
    authorName: '',
    body: '构建Bot 请 王磊 填写密钥：GITHUB_TOKEN、JIRA_TOKEN',
    mentions: [],
    runId: null,
    createdAt: new Date().toISOString(),
    attachments: [],
    quote: null,
    secretCard: card,
  }

  it('lets the person asked fill every name at once', async () => {
    const calls = mockApi({ 'POST /secret-requests/q1': {} })
    render(<SecretCard m={m} card={card} />)
    expect(screen.getByTestId('secret-card').textContent).toContain('填写密钥：GITHUB_TOKEN、JIRA_TOKEN')
    fireEvent.click(screen.getByRole('button', { name: '填写密钥' }))
    const dialog = await screen.findByRole('dialog', { name: '填写密钥' })
    const save = within(dialog).getByRole('button', { name: '保存' }) as HTMLButtonElement
    const gh = within(dialog).getByLabelText('GITHUB_TOKEN') as HTMLInputElement
    expect(gh.type).toBe('password')
    fireEvent.change(gh, { target: { value: 'ghp_12345678' } })
    expect(save.disabled).toBe(true)
    fireEvent.change(within(dialog).getByLabelText('JIRA_TOKEN'), { target: { value: 'jira_12345678' } })
    fireEvent.click(save)
    await waitFor(() =>
      expect(calls).toContainEqual({
        method: 'POST',
        path: '/secret-requests/q1',
        body: { values: { GITHUB_TOKEN: 'ghp_12345678', JIRA_TOKEN: 'jira_12345678' } },
      }),
    )
    expect(await screen.findByText('已填写')).toBeTruthy()
  })

  it("lets a card from a bot on someone else's machine allow other machines right away", async () => {
    const calls = mockApi({ 'POST /secret-requests/q1': {} })
    const foreign = { ...card, names: ['JIRA_TOKEN'], foreign: true }
    render(<SecretCard m={m} card={foreign} />)
    fireEvent.click(screen.getByRole('button', { name: '填写密钥' }))
    const dialog = await screen.findByRole('dialog', { name: '填写密钥' })
    const allow = within(dialog).getByLabelText('允许在他人机器上的 Bot 使用') as HTMLInputElement
    expect(allow.checked).toBe(true)
    expect(within(dialog).getByText(/机器主人能读到 Bot 进程的环境变量/)).toBeTruthy()
    fireEvent.change(within(dialog).getByLabelText('JIRA_TOKEN'), { target: { value: 'jira_12345678' } })
    fireEvent.click(within(dialog).getByRole('button', { name: '保存' }))
    await waitFor(() =>
      expect(calls).toContainEqual({
        method: 'POST',
        path: '/secret-requests/q1',
        body: { values: { JIRA_TOKEN: 'jira_12345678' }, allowForeignMachines: true },
      }),
    )
  })

  it('has no other-machines switch when the bot runs on my own machine', async () => {
    render(<SecretCard m={m} card={{ ...card, foreign: false }} />)
    fireEvent.click(screen.getByRole('button', { name: '填写密钥' }))
    const dialog = await screen.findByRole('dialog', { name: '填写密钥' })
    expect(within(dialog).queryByLabelText('允许在他人机器上的 Bot 使用')).toBeNull()
  })

  it('keeps my unfilled cards atop the chat until they are filled', async () => {
    let pending: Card[] = [{ ...card, names: ['JIRA_TOKEN'], foreign: true }]
    const calls = mockApi({
      'GET /groups/g1/secret-requests': () => pending,
      'POST /secret-requests/q1': () => {
        pending = []
        return {}
      },
    })
    render(<SecretBanner groupId="g1" />)
    expect(await screen.findByText('你有 1 个密钥待填写')).toBeTruthy()
    fireEvent.click(screen.getByRole('button', { name: '填写密钥' }))
    const dialog = await screen.findByRole('dialog', { name: '填写密钥' })
    fireEvent.change(within(dialog).getByLabelText('JIRA_TOKEN'), { target: { value: 'jira_12345678' } })
    fireEvent.click(within(dialog).getByRole('button', { name: '保存' }))
    await waitFor(() => expect(screen.queryByText('你有 1 个密钥待填写')).toBeNull())
    expect(calls).toContainEqual({
      method: 'POST',
      path: '/secret-requests/q1',
      body: { values: { JIRA_TOKEN: 'jira_12345678' }, allowForeignMachines: true },
    })
  })

  it('only shows the state to everyone else on an origin card', () => {
    render(<SecretCard m={m} card={{ ...card, userId: 'u2' }} />)
    expect(screen.queryByRole('button', { name: '填写密钥' })).toBeNull()
    expect(screen.getByText('等待填写')).toBeTruthy()
  })

  it('offers an admins card to a group admin and shows the server refusal', async () => {
    mockApi({ 'POST /secret-requests/q1': apiError(403, 'forbidden', '需要团队管理员') })
    const admins = { ...card, names: ['NPM_TOKEN'], audience: 'admins' as const, userId: null }
    render(<SecretCard m={m} card={admins} />)
    fireEvent.click(screen.getByRole('button', { name: '填写密钥' }))
    const dialog = await screen.findByRole('dialog', { name: '填写密钥' })
    fireEvent.change(within(dialog).getByLabelText('NPM_TOKEN'), { target: { value: 'npm_12345678' } })
    fireEvent.click(within(dialog).getByRole('button', { name: '保存' }))
    expect(await within(dialog).findByText('需要团队管理员')).toBeTruthy()
  })

  it('hides the button of an admins card from plain members', () => {
    useWorkspace.setState({
      groups: [group({ members: [{ userId: 'u1', name: '王磊', avatar: null, isAdmin: false }] })],
    })
    useSession.setState({ tenancy: null })
    render(<SecretCard m={m} card={{ ...card, audience: 'admins', userId: null }} />)
    expect(screen.queryByRole('button', { name: '填写密钥' })).toBeNull()
  })

  it('shows a filled card as filled', () => {
    render(<SecretCard m={m} card={{ ...card, filled: true }} />)
    expect(screen.getByText('已填写')).toBeTruthy()
    expect(screen.queryByRole('button', { name: '填写密钥' })).toBeNull()
  })
})

describe('/secret-requests/:id (opened from Feishu)', () => {
  const req: SecretRequestDto = {
    id: 'q1',
    names: ['JIRA_TOKEN'],
    audience: 'origin',
    userId: 'u1',
    filled: false,
    foreign: true,
    groupId: 'g1',
    bot: '构建Bot',
  }
  const page = () =>
    render(
      <MemoryRouter initialEntries={['/secret-requests/q1']}>
        <Routes>
          <Route path="/secret-requests/:id" element={<SecretRequestPage />} />
          <Route path="/g/:groupId" element={<div>群聊页</div>} />
        </Routes>
      </MemoryRouter>,
    )

  it('opens the fill dialog at once and says to go back to Feishu once filled', async () => {
    const calls = mockApi({ 'GET /secret-requests/q1': req, 'POST /secret-requests/q1': {} })
    page()
    const dialog = await screen.findByRole('dialog', { name: '填写密钥' })
    expect(within(dialog).getByLabelText('允许在他人机器上的 Bot 使用')).toBeTruthy()
    fireEvent.change(within(dialog).getByLabelText('JIRA_TOKEN'), { target: { value: 'jira_12345678' } })
    fireEvent.click(within(dialog).getByRole('button', { name: '保存' }))
    expect(await screen.findByText('已填写，可以回到飞书')).toBeTruthy()
    expect(calls).toContainEqual({
      method: 'POST',
      path: '/secret-requests/q1',
      body: { values: { JIRA_TOKEN: 'jira_12345678' }, allowForeignMachines: true },
    })
  })

  it('shows a filled card as filled without the dialog', async () => {
    mockApi({ 'GET /secret-requests/q1': { ...req, filled: true } })
    page()
    expect(await screen.findByText('已填写，可以回到飞书')).toBeTruthy()
    expect(screen.queryByRole('dialog')).toBeNull()
  })

  it("does not offer someone else's card", async () => {
    mockApi({ 'GET /secret-requests/q1': { ...req, userId: 'u2' } })
    page()
    expect(await screen.findByText('只有发起人本人可以填写这些密钥')).toBeTruthy()
    expect(screen.queryByRole('dialog')).toBeNull()
  })

  it('goes to the group when the dialog is closed', async () => {
    mockApi({ 'GET /secret-requests/q1': req })
    page()
    const dialog = await screen.findByRole('dialog', { name: '填写密钥' })
    fireEvent.click(within(dialog).getByRole('button', { name: '取消' }))
    expect(await screen.findByText('群聊页')).toBeTruthy()
  })

  it('shows why the card cannot be opened', async () => {
    mockApi({ 'GET /secret-requests/q1': apiError(404, 'not_found', '群不存在或你已不在群内') })
    page()
    expect(await screen.findByText('群不存在或你已不在群内')).toBeTruthy()
  })
})
