import type {
  BotDto,
  SecretCard as Card,
  GroupDto,
  MessageDto,
  SecretNeedDto,
  UserDto,
} from '@gonggong/protocol'
import { fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { useSession } from '../src/app/session'
import { useWorkspace } from '../src/app/workspace'
import { SecretBanner } from '../src/features/secrets/SecretBanner'
import { SecretCard } from '../src/features/secrets/SecretCard'
import { mockApi } from './mockApi'

const me = { id: 'u1', name: '王磊', role: 'member' } as UserDto
const group = {
  id: 'g1',
  teamId: 't1',
  kind: 'group',
  members: [{ userId: 'u1', name: '王磊', avatar: null, isAdmin: true }],
  botIds: ['b1'],
} as unknown as GroupDto

const need = (o: Partial<SecretNeedDto> & { name: string }): SecretNeedDto => {
  const { name, ...rest } = o
  return {
    skill: 'dw-query',
    skillVersionId: 'v1',
    personalSkill: false,
    spec: { name, description: '', mode: 'personal', required: true },
    status: 'unfilled',
    def: { id: `d-${name}`, scope: 'group', mode: 'personal', description: '', hasValue: false },
    mine: null,
    action: 'fill_personal',
    ...rest,
  }
}

const dwKey = need({
  name: 'DW_KEY',
  spec: {
    name: 'DW_KEY',
    title: '数仓 Key（正式）',
    description: '在 Manager 个人中心签发',
    url: 'https://dw.example.com/keys',
    placeholder: 'dwk_…',
    mode: 'personal',
    required: true,
  },
})
const testKey = need({
  name: 'DW_TEST_KEY',
  spec: { name: 'DW_TEST_KEY', description: '', mode: 'personal', required: false },
})
const shared = need({
  name: 'DW_SHARED',
  spec: { name: 'DW_SHARED', description: '', mode: 'shared', required: true },
  def: { id: 'd-shared', scope: 'group', mode: 'shared', description: '', hasValue: false },
  action: 'fill_shared',
})
const missing = need({
  name: 'DW_ADMIN',
  spec: { name: 'DW_ADMIN', title: '管理 Key', description: '运维签发', mode: 'shared', required: true },
  status: 'missing_def',
  def: null,
  target: { scope: 'group', teamId: 't1', groupId: 'g1', mode: 'shared' },
  action: 'create',
})

beforeEach(() => {
  localStorage.clear()
  localStorage.setItem('gg.locale', 'zh')
  useSession.setState({ user: me, status: 'ready' })
  useWorkspace.setState({
    bots: [{ id: 'b1', name: '构建Bot', ownerId: 'u9' } as BotDto],
    groups: [group],
  })
})
afterEach(() => vi.unstubAllGlobals())

describe('secret needs banner', () => {
  it('counts the required ones I can act on and fills them by kind in one dialog', async () => {
    let needs = [dwKey, testKey, shared, missing]
    const calls = mockApi({
      'GET /groups/g1/secret-requests': [],
      'GET /groups/g1/secret-needs': () => needs,
      'PUT /me/secrets/d-DW_KEY': {},
      'PATCH /secrets/d-shared': {},
      'POST /groups/g1/secrets': {},
    })
    render(<SecretBanner groupId="g1" />)
    expect(await screen.findByText('本群有 3 个密钥待你配置')).toBeTruthy()
    fireEvent.click(screen.getByRole('button', { name: '去配置' }))
    const dialog = await screen.findByRole('dialog', { name: '配置密钥' })
    expect(within(dialog).getByText('dw-query')).toBeTruthy()
    expect(within(dialog).getByText('前往 dw.example.com 申请').getAttribute('href')).toBe(
      'https://dw.example.com/keys',
    )
    expect(within(dialog).getByText('可选配置（1）')).toBeTruthy()
    expect(within(dialog).getByText(/本群 构建Bot 运行在其他成员的电脑上/)).toBeTruthy()
    const key = within(dialog).getByLabelText('DW_KEY') as HTMLInputElement
    expect(key.placeholder).toBe('dwk_…')
    fireEvent.change(key, { target: { value: 'dwk_12345678' } })
    fireEvent.change(within(dialog).getByLabelText('DW_SHARED'), { target: { value: 'shared_12345678' } })
    fireEvent.click(within(dialog).getByLabelText('允许在他人电脑上的 Bot 使用'))
    needs = []
    fireEvent.click(within(dialog).getByRole('button', { name: '保存' }))
    await waitFor(() => expect(screen.queryByTestId('secret-banner')).toBeNull())
    expect(calls).toContainEqual({
      method: 'POST',
      path: '/groups/g1/secrets',
      body: {
        name: 'DW_ADMIN',
        description: '管理 Key：运维签发',
        mode: 'shared',
        botIds: null,
        enabled: true,
        expiresAt: null,
      },
    })
    expect(calls).toContainEqual({
      method: 'PUT',
      path: '/me/secrets/d-DW_KEY',
      body: { value: 'dwk_12345678', allowForeignMachines: true },
    })
    expect(calls).toContainEqual({
      method: 'PATCH',
      path: '/secrets/d-shared',
      body: { value: 'shared_12345678' },
    })
  })

  it("fills my personal skill's secret through the endpoint that makes its definition", async () => {
    const mine = need({
      name: 'DW_KEY',
      personalSkill: true,
      status: 'missing_def',
      def: null,
      target: { scope: 'team', teamId: 't1', groupId: null, mode: 'personal' },
      action: 'fill_new',
    })
    const calls = mockApi({
      'GET /groups/g1/secret-requests': [],
      'GET /groups/g1/secret-needs': [mine],
      'POST /groups/g1/secret-needs/personal': {},
    })
    render(<SecretBanner groupId="g1" />)
    fireEvent.click(await screen.findByRole('button', { name: '去配置' }))
    const dialog = await screen.findByRole('dialog', { name: '配置密钥' })
    fireEvent.change(within(dialog).getByLabelText('DW_KEY'), { target: { value: 'dwk_12345678' } })
    fireEvent.click(within(dialog).getByRole('button', { name: '保存' }))
    await waitFor(() =>
      expect(calls).toContainEqual({
        method: 'POST',
        path: '/groups/g1/secret-needs/personal',
        body: { name: 'DW_KEY', value: 'dwk_12345678', allowForeignMachines: false },
      }),
    )
  })

  it('snoozes for 24 hours until the set of missing names changes', async () => {
    let needs = [dwKey]
    mockApi({ 'GET /groups/g1/secret-requests': [], 'GET /groups/g1/secret-needs': () => needs })
    const { unmount } = render(<SecretBanner groupId="g1" />)
    fireEvent.click(await screen.findByRole('button', { name: '24 小时内不再提醒' }))
    expect(screen.queryByTestId('secret-banner')).toBeNull()
    unmount()
    render(<SecretBanner groupId="g1" />)
    await new Promise((r) => setTimeout(r, 20))
    expect(screen.queryByTestId('secret-banner')).toBeNull()
    needs = [dwKey, shared]
    render(<SecretBanner groupId="g1" />)
    expect(await screen.findByText('本群有 2 个密钥待你配置')).toBeTruthy()
  })

  it('stays away when nothing is left for me to do', async () => {
    mockApi({
      'GET /groups/g1/secret-requests': [],
      'GET /groups/g1/secret-needs': [
        { ...dwKey, status: 'ok', action: null },
        testKey,
        { ...missing, action: null },
      ],
    })
    render(<SecretBanner groupId="g1" />)
    await new Promise((r) => setTimeout(r, 20))
    expect(screen.queryByTestId('secret-banner')).toBeNull()
  })
})

describe('define card', () => {
  const card: Card = {
    id: 'q9',
    names: ['DW_KEY'],
    audience: 'define',
    userId: null,
    filled: false,
    define: {
      skill: 'dw-query',
      versionId: 'v1',
      layer: { scope: 'group', teamId: 't1', groupId: 'g1' },
      specs: [
        { name: 'DW_KEY', title: '数仓 Key', description: '个人中心签发', mode: 'personal', required: true },
      ],
      admins: ['王磊', '李建国'],
    },
  }
  const m = {
    id: 'm9',
    groupId: 'g1',
    kind: 'event',
    body: '构建Bot 请管理员按 Skill「dw-query」的声明创建密钥：DW_KEY',
    secretCard: card,
  } as MessageDto

  it('lets an admin create what the skill declares', async () => {
    const calls = mockApi({ 'POST /secret-requests/q9': {} })
    render(<SecretCard m={m} card={card} />)
    fireEvent.click(screen.getByRole('button', { name: '按声明创建' }))
    const dialog = await screen.findByRole('dialog', { name: '按声明创建密钥' })
    expect(within(dialog).getByText('个人中心签发')).toBeTruthy()
    expect(within(dialog).getByText('每人自填')).toBeTruthy()
    fireEvent.click(within(dialog).getByRole('button', { name: '创建' }))
    await waitFor(() =>
      expect(calls).toContainEqual({ method: 'POST', path: '/secret-requests/q9', body: { values: {} } }),
    )
    expect(await screen.findByText('已创建')).toBeTruthy()
  })

  it('names who can create it to everyone else', () => {
    useWorkspace.setState({
      groups: [{ ...group, members: [{ userId: 'u1', name: '王磊', avatar: null, isAdmin: false }] }],
    })
    useSession.setState({ tenancy: null })
    render(<SecretCard m={m} card={card} />)
    expect(screen.getByText('等待 王磊、李建国 创建')).toBeTruthy()
  })
})
