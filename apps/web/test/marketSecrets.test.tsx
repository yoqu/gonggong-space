import type {
  GroupDto,
  InstallDto,
  MarketListingDetailDto,
  SecretDto,
  SecretRequirement,
  TeamDto,
  UserDto,
} from '@gonggong/protocol'
import { fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { useSession } from '../src/app/session'
import { useWorkspace } from '../src/app/workspace'
import { InstallList } from '../src/features/market/InstallList'
import { InstallTargetDialog } from '../src/features/market/InstallTargetDialog'
import { ListingDetail } from '../src/features/market/ListingDetail'
import { useToasts } from '../src/ui/toast'
import { apiError, mockApi } from './mockApi'

const KEY: SecretRequirement = {
  name: 'DW_KEY',
  title: '数仓 Key',
  description: '个人中心签发',
  url: 'https://manager.example.com/keys',
  mode: 'personal',
  required: true,
}
const TEST_KEY: SecretRequirement = { name: 'DW_TEST_KEY', description: '', mode: 'shared', required: false }

const detail = (o: Partial<MarketListingDetailDto> = {}): MarketListingDetailDto => ({
  id: 'l1',
  type: 'skill',
  name: 'dw-query',
  title: 'dw-query',
  description: '查数仓',
  layer: 'team',
  status: 'listed',
  versionId: 'pv3',
  revision: 3,
  source: 'team',
  visibility: 'team',
  teamId: 't1',
  teamName: '支付组',
  author: '陈晨',
  agents: [],
  listedVersionId: 'pv3',
  listedRevision: 3,
  installs: 0,
  updatedAt: '2026-11-01T00:00:00Z',
  readme: '',
  permissions: [],
  mcp: [],
  secretSpecs: [KEY, TEST_KEY],
  files: [],
  versions: [],
  ghSource: null,
  canEdit: false,
  ...o,
})

const def = (o: Partial<SecretDto>): SecretDto => ({
  id: 's1',
  scope: 'team',
  teamId: 't1',
  groupId: null,
  name: 'DW_KEY',
  description: '数仓 Key：个人中心签发',
  mode: 'personal',
  botIds: null,
  enabled: true,
  expiresAt: null,
  value: null,
  personalFilled: [],
  updatedAt: '2026-11-01T00:00:00Z',
  ...o,
})

beforeEach(() => {
  localStorage.setItem('gg.locale', 'zh')
  useSession.setState({
    user: { id: 'u1', name: '姜维川', role: 'member' } as UserDto,
    status: 'ready',
    tenancy: {
      teams: [{ id: 't1', name: '支付组', role: 'admin' } as TeamDto],
      singleTeamMode: false,
      canCreateTeam: true,
      demoMode: false,
      pluginsEnabled: true,
    },
  })
  useWorkspace.setState({
    groups: [
      {
        id: 'g1',
        teamId: 't1',
        name: '支付核心群',
        kind: 'group',
        members: [{ userId: 'u1', name: '姜维川', avatar: null, isAdmin: true }],
      } as unknown as GroupDto,
    ],
  })
})
afterEach(() => vi.unstubAllGlobals())

const openDialog = () => {
  const d = detail()
  render(
    <InstallTargetDialog listing={{ ...d, listedVersionId: 'pv3', listedRevision: 3 }} onClose={() => {}} />,
  )
  return screen.getByRole('dialog', { name: '引入「dw-query」' })
}

describe('需要的密钥', () => {
  it('lists the declared secrets in the listing detail', async () => {
    mockApi({ 'GET /market/l1': detail() })
    render(<ListingDetail id="l1" />)
    const section = await screen.findByRole('region', { name: '需要的密钥' })
    expect(within(section).getByText('数仓 Key')).toBeTruthy()
    expect(within(section).getByText('DW_KEY')).toBeTruthy()
    expect(within(section).getByText('必需')).toBeTruthy()
    expect(within(section).getByText('可选')).toBeTruthy()
    expect(within(section).getByText('建议：每人自填')).toBeTruthy()
    expect(within(section).getByText('个人中心签发')).toBeTruthy()
    const link = within(section).getByRole('link', { name: /前往 manager\.example\.com 申请/ })
    expect(link.getAttribute('href')).toBe('https://manager.example.com/keys')
  })

  it('creates the missing definitions after installing: per-member ones in the team, shared ones in the group', async () => {
    const calls = mockApi({
      'GET /teams/t1/repos': [],
      'GET /groups/g1/secrets': [],
      'PUT /groups/g1/installs/l1': {},
      'POST /teams/t1/secrets': apiError(409, 'conflict'),
      'POST /groups/g1/secrets': {},
    })
    const dialog = openDialog()
    fireEvent.click(within(dialog).getByRole('radio', { name: '支付核心群' }))
    const team = (await within(dialog).findByRole('checkbox', {
      name: '在本团队创建定义',
    })) as HTMLInputElement
    const group = within(dialog).getByRole('checkbox', { name: '在本群创建定义' }) as HTMLInputElement
    expect([team.checked, group.checked]).toEqual([true, true])
    fireEvent.click(group)
    fireEvent.click(within(dialog).getByRole('button', { name: '引入' }))
    await waitFor(() => expect(calls.some((c) => c.method === 'POST')).toBe(true))
    const posts = calls.filter((c) => c.method === 'POST')
    expect(posts.map((c) => c.path)).toEqual(['/teams/t1/secrets'])
    expect(posts[0]!.body).toEqual({
      name: 'DW_KEY',
      description: '数仓 Key：个人中心签发',
      mode: 'personal',
      botIds: null,
      enabled: true,
      expiresAt: null,
    })
    const put = calls.findIndex((c) => c.method === 'PUT')
    expect(put).toBeGreaterThan(-1)
    expect(put).toBeLessThan(calls.findIndex((c) => c.method === 'POST'))
  })

  it('offers reusing a team definition, flagging a different purpose', async () => {
    const calls = mockApi({
      'GET /teams/t1/repos': [],
      'GET /groups/g1/secrets': [def({ name: 'DW_TEST_KEY', description: '别的用途', mode: 'shared' })],
      'PUT /groups/g1/installs/l1': {},
      'POST /groups/g1/secrets': {},
    })
    const dialog = openDialog()
    fireEvent.click(within(dialog).getByRole('radio', { name: '支付核心群' }))
    const reuse = (await within(dialog).findByRole('radio', {
      name: '复用团队层现有定义',
    })) as HTMLInputElement
    expect(within(dialog).getByText('用途可能不一致')).toBeTruthy()
    expect(within(dialog).getByText('别的用途')).toBeTruthy()
    expect(reuse.getAttribute('aria-checked') ?? String(reuse.checked)).toBe('true')
    fireEvent.click(within(dialog).getByRole('checkbox', { name: '在本团队创建定义' }))
    fireEvent.click(within(dialog).getByRole('button', { name: '引入' }))
    await waitFor(() => expect(calls.some((c) => c.method === 'PUT')).toBe(true))
    expect(calls.some((c) => c.method === 'POST')).toBe(false)
  })

  it('leaves per-member definitions to team admins when I only run the group', async () => {
    useSession.setState({
      tenancy: {
        ...useSession.getState().tenancy!,
        teams: [{ id: 't1', name: '支付组', role: 'member' } as TeamDto],
      },
    })
    const calls = mockApi({
      'GET /teams/t1/repos': [],
      'GET /groups/g1/secrets': [],
      'PUT /groups/g1/installs/l1': {},
      'POST /groups/g1/secrets': {},
    })
    const dialog = openDialog()
    fireEvent.click(within(dialog).getByRole('radio', { name: '支付核心群' }))
    expect((await within(dialog).findAllByText(/每人自填的密钥建在团队层，一个团队只建一次/)).length).toBe(2)
    expect(within(dialog).queryByRole('checkbox', { name: '在本团队创建定义' })).toBeNull()
    fireEvent.click(within(dialog).getByRole('button', { name: '引入' }))
    await waitFor(() => expect(calls.some((c) => c.method === 'POST')).toBe(true))
    expect(calls.filter((c) => c.method === 'POST').map((c) => c.path)).toEqual(['/groups/g1/secrets'])
  })

  it('keeps a group admin who does not run the team from switching a group definition to 每人自填', async () => {
    useSession.setState({
      tenancy: {
        ...useSession.getState().tenancy!,
        teams: [{ id: 't1', name: '支付组', role: 'member' } as TeamDto],
      },
    })
    mockApi({ 'GET /teams/t1/repos': [], 'GET /groups/g1/secrets': [] })
    const dialog = openDialog()
    fireEvent.click(within(dialog).getByRole('radio', { name: '支付核心群' }))
    const modes = await within(dialog).findByRole('radiogroup', { name: 'DW_TEST_KEY 的模式' })
    const personal = within(modes).getByRole('radio', { name: '每人自填' }) as HTMLInputElement
    expect(personal.disabled).toBe(true)
    expect(within(modes).getByRole('radio', { name: '统一值' })).toBeTruthy()
    expect(within(dialog).getAllByText(/每人自填的密钥建在团队层/).length).toBe(2)
  })

  it('does not report full success when a definition could not be made', async () => {
    useToasts.setState({ items: [] })
    let closed = false
    mockApi({
      'GET /teams/t1/repos': [],
      'GET /groups/g1/secrets': [],
      'PUT /groups/g1/installs/l1': {},
      'POST /teams/t1/secrets': apiError(403, 'forbidden', '仅团队管理员可操作'),
      'POST /groups/g1/secrets': {},
    })
    const d = detail()
    render(
      <InstallTargetDialog
        listing={{ ...d, listedVersionId: 'pv3', listedRevision: 3 }}
        onClose={() => {
          closed = true
        }}
      />,
    )
    const dialog = screen.getByRole('dialog', { name: '引入「dw-query」' })
    fireEvent.click(within(dialog).getByRole('radio', { name: '支付核心群' }))
    await within(dialog).findByRole('checkbox', { name: '在本团队创建定义' })
    fireEvent.click(within(dialog).getByRole('button', { name: '引入' }))
    await waitFor(() => expect(closed).toBe(true))
    const items = useToasts.getState().items
    expect(items.some((x) => x.type === 'success')).toBe(false)
    const err = items.find((x) => x.type === 'error')
    expect(err?.title).toBe('已引入到「支付核心群」，但有密钥定义没建好')
    expect(err?.message).toBe('DW_KEY：仅团队管理员可操作')
  })

  it('disables installing when the same-layer definition is answered with 取消引入', async () => {
    mockApi({
      'GET /teams/t1/repos': [],
      'GET /teams/t1/secrets': [def({})],
    })
    const dialog = openDialog()
    fireEvent.click(
      within(within(dialog).getByRole('radiogroup', { name: '引入到' })).getByRole('radio', { name: '团队' }),
    )
    fireEvent.click(within(dialog).getByRole('radio', { name: '支付组' }))
    await within(dialog).findByRole('radio', { name: '共用现有定义（说明和模式不变）' })
    const install = within(dialog).getByRole('button', { name: '引入' }) as HTMLButtonElement
    expect(install.disabled).toBe(false)
    fireEvent.click(within(dialog).getByRole('radio', { name: '取消引入' }))
    expect(install.disabled).toBe(true)
  })

  it('blocks install on secret load failure with retry, retries failed repo loads, clears errors on edits, and disables personal over team secret', async () => {
    let failSecrets = true
    let failRepos = true
    mockApi({
      'GET /teams/t1/repos': () =>
        failRepos
          ? apiError(500, 'internal', '仓库列表失败')
          : [{ id: 'r1', name: 'core', key: 'git.example.com/pay/core' }],
      'GET /groups/g1/secrets': () =>
        failSecrets
          ? apiError(500, 'internal', '密钥接口挂了')
          : [def({ name: 'DW_TEST_KEY', description: '别的用途', mode: 'shared', scope: 'team' })],
    })
    const dialog = openDialog()

    // Repos error shows retry button and recovers on click.
    fireEvent.click(
      within(within(dialog).getByRole('radiogroup', { name: '引入到' })).getByRole('radio', { name: '仓库' }),
    )
    expect(await within(dialog).findByText('仓库列表失败')).toBeTruthy()
    failRepos = false
    fireEvent.click(within(dialog).getByRole('button', { name: '重试' }))
    expect(await within(dialog).findByRole('radio', { name: '支付组 / core' })).toBeTruthy()

    // Switch to group: secrets fail → blocks 引入 and offers Retry.
    fireEvent.click(
      within(within(dialog).getByRole('radiogroup', { name: '引入到' })).getByRole('radio', { name: '群' }),
    )
    fireEvent.click(within(dialog).getByRole('radio', { name: '支付核心群' }))
    expect(await within(dialog).findByText('密钥接口挂了')).toBeTruthy()
    const installBtn = within(dialog).getByRole('button', { name: '引入' }) as HTMLButtonElement
    expect(installBtn.disabled).toBe(true)

    // Retry loads secrets: install becomes enabled; overriding team-level secret disables 每人自填.
    failSecrets = false
    const secretsRegion = within(dialog).getByRole('region', { name: '需要的密钥' })
    fireEvent.click(within(secretsRegion).getByRole('button', { name: '重试' }))
    const override = await within(secretsRegion).findByRole('radio', {
      name: '在本群新建同名定义（仅本群生效，覆盖团队层）',
    })
    expect(installBtn.disabled).toBe(false)
    fireEvent.click(override)
    const modes = within(secretsRegion).getByRole('radiogroup', { name: 'DW_TEST_KEY 的模式' })
    expect((within(modes).getByRole('radio', { name: '每人自填' }) as HTMLInputElement).disabled).toBe(true)

    // Validation error clears when editing secret input.
    const valInput = within(secretsRegion).getByLabelText('DW_TEST_KEY 的统一值')
    fireEvent.change(valInput, { target: { value: 'short' } })
    fireEvent.click(installBtn)
    expect(await within(dialog).findByText('DW_TEST_KEY 的统一值至少 8 个字符')).toBeTruthy()
    fireEvent.change(valInput, { target: { value: '12345678' } })
    expect(within(dialog).queryByText('DW_TEST_KEY 的统一值至少 8 个字符')).toBeNull()
  })
})

describe('upgrading an install', () => {
  it('names the required secrets the newer version adds', async () => {
    const install: InstallDto = {
      listing: {
        id: 'l1',
        type: 'skill',
        name: 'dw-query',
        title: 'dw-query',
        description: '查数仓',
        layer: 'team',
        status: 'listed',
        versionId: 'pv5',
        revision: 5,
      },
      scope: 'group',
      enabled: true,
      pinVersionId: 'pv3',
      resolvedVersionId: 'pv3',
      resolvedRevision: 3,
      banReason: null,
      updatedBy: null,
      updatedAt: '2026-11-01T00:00:00Z',
    }
    mockApi({
      'GET /groups/g1/installs': [install],
      'GET /market/l1?versionId=pv3': detail({ secretSpecs: [TEST_KEY] }),
      'GET /market/l1?versionId=pv5': detail({ secretSpecs: [KEY, { ...TEST_KEY, required: true }] }),
    })
    render(<InstallList base="/groups/g1" />)
    expect(
      await screen.findByText('r5 新增必需密钥：DW_KEY、DW_TEST_KEY，升级后需建好定义并填写'),
    ).toBeTruthy()
  })
})
