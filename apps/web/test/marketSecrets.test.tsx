import type {
  GroupDto,
  InstallDto,
  MarketListingDetailDto,
  MarketReadinessDto,
  ReusedSecretDto,
  SecretRequirement,
  TeamDto,
  UserDto,
} from '@gonggong/protocol'
import { act, fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import { MemoryRouter } from 'react-router'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { useSession } from '../src/app/session'
import { useWorkspace } from '../src/app/workspace'
import { InstallList } from '../src/features/market/InstallList'
import { InstallTargetDialog } from '../src/features/market/InstallTargetDialog'
import { ListingDetail } from '../src/features/market/ListingDetail'
import { useToasts } from '../src/ui/toast'
import { mockApi } from './mockApi'

const KEY: SecretRequirement = {
  name: 'DW_KEY',
  title: '数仓 Key',
  description: '个人中心签发',
  url: 'https://manager.example.com/keys',
  mode: 'personal',
  required: true,
}
const TEST_KEY: SecretRequirement = {
  name: 'DW_TEST_KEY',
  title: '测试库 Key',
  description: '群内共用凭据',
  mode: 'shared',
  required: false,
}

const detail = (o: Partial<MarketListingDetailDto> = {}): MarketListingDetailDto => ({
  id: 'l1',
  type: 'skill',
  name: 'dw-query',
  title: '数仓查询',
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
  agents: ['claude'],
  listedVersionId: 'pv3',
  listedRevision: 3,
  installs: 0,
  updatedAt: '2026-11-01T00:00:00Z',
  readme: '按规范查询数仓表。',
  permissions: [],
  mcp: [],
  secretSpecs: [KEY, TEST_KEY],
  files: [{ path: 'SKILL.md', size: 120 }],
  versions: [],
  ghSource: null,
  canEdit: false,
  ...o,
})

const readiness = (o: Partial<MarketReadinessDto> = {}): MarketReadinessDto => ({
  listingId: 'l1',
  title: '数仓查询',
  versionId: 'pv3',
  scope: 'group',
  scopeId: 'g1',
  targetLabel: '支付核心群',
  ready: false,
  pendingSteps: 1,
  secrets: [
    {
      name: 'DW_KEY',
      title: '数仓 Key',
      description: '个人中心签发',
      url: 'https://manager.example.com/keys',
      placeholder: null,
      mode: 'personal',
      required: true,
      status: 'unfilled',
      reason: null,
      defId: 's1',
      defScope: 'team',
      action: 'fill_personal',
      reused: false,
      viaConnector: false,
    },
  ],
  reusedSecrets: [],
  connector: null,
  trusts: null,
  tryPrompts: ['查一下昨天的支付订单量'],
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
  useToasts.setState({ items: [] })
})
afterEach(() => vi.unstubAllGlobals())

describe('凭据准备与同名复用提示隔离', () => {
  it('shows plain preparation hints in 概览 and isolates env names + reused-secret notice strictly inside 开发者信息', async () => {
    const reused: ReusedSecretDto[] = [
      { name: 'DW_KEY', existingScope: 'team', existingScopeLabel: '支付组' },
    ]
    mockApi({ 'GET /market/l1': { ...detail(), reusedSecrets: reused } })
    render(
      <MemoryRouter>
        <ListingDetail id="l1" standalone />
      </MemoryRouter>,
    )

    // Overview tab: plain language only — NO env var name and NO secret conflict reuse notice!
    expect(await screen.findByText('填写数仓 Key')).toBeTruthy()
    expect(screen.getByText('每人填自己的，加密保存')).toBeTruthy()
    expect(screen.queryByText('DW_KEY')).toBeNull()
    expect(screen.queryByText(/沿用已有定义/)).toBeNull()
    const howLink = screen.getByRole('link', { name: /^如何获取/ })
    expect(howLink.getAttribute('href')).toBe('https://manager.example.com/keys')

    // Developer info tab: env var details AND silent reuse notice appear here ONLY.
    fireEvent.click(screen.getByRole('tab', { name: '开发者信息' }))
    const devPanel = await screen.findByRole('region', { name: '开发者信息' })
    expect(within(devPanel).getByText('DW_KEY')).toBeTruthy()
    expect(within(devPanel).getByText('DW_TEST_KEY')).toBeTruthy()
    expect(
      within(devPanel).getByText('已有同名凭据 DW_KEY（支付组），添加时沿用已有定义，没有覆盖。'),
    ).toBeTruthy()
    expect(
      within(devPanel)
        .getByRole('link', { name: /前往 manager\.example\.com 申请/ })
        .getAttribute('href'),
    ).toBe('https://manager.example.com/keys')
  })

  it('installs silently without conflict dialog, forwards reusedSecrets metadata, and lets user fill personal secret in Step 2', async () => {
    let filled = false
    const reused: ReusedSecretDto[] = [
      { name: 'DW_KEY', existingScope: 'team', existingScopeLabel: '支付组' },
    ]
    const calls = mockApi({
      'PUT /groups/g1/installs/l1': { reusedSecrets: reused },
      'GET /market/l1/readiness?scope=group&scopeId=g1': () =>
        filled
          ? readiness({ ready: true, pendingSteps: 0, secrets: [] })
          : readiness({ reusedSecrets: reused }),
      'PUT /me/secrets/s1': () => {
        filled = true
        return {}
      },
    })
    const reported: ReusedSecretDto[][] = []
    const d = detail()
    render(
      <MemoryRouter>
        <InstallTargetDialog
          listing={{ ...d, listedVersionId: 'pv3', listedRevision: 3 }}
          sourceGroupId="g1"
          onReusedSecrets={(items) => reported.push(items)}
          onClose={() => {}}
        />
      </MemoryRouter>,
    )

    const dialog = screen.getByRole('dialog', { name: /添加 数仓查询/ })
    // Step 1 never asks user to resolve secret conflicts manually.
    expect(within(dialog).queryByText(/取消引入/)).toBeNull()
    expect(within(dialog).queryByText(/沿用已有定义/)).toBeNull()

    fireEvent.click(within(dialog).getByRole('button', { name: '添加' }))
    await waitFor(() =>
      expect(calls.find((c) => c.path === '/groups/g1/installs/l1')?.body).toEqual({
        enabled: true,
        pinVersionId: null,
      }),
    )
    expect(reported).toEqual([reused])

    // Step 2: in-place readiness checklist — STILL does NOT show reused-secret notice!
    expect(await within(dialog).findByText('已添加到「支付核心群」，还差 1 步就能用')).toBeTruthy()
    expect(within(dialog).queryByText(/沿用已有定义/)).toBeNull()

    const input = within(dialog).getByLabelText('数仓 Key')
    fireEvent.change(input, { target: { value: 'short' } })
    fireEvent.click(within(dialog).getByRole('button', { name: '保存' }))
    expect(await within(dialog).findByText('数仓 Key 至少需要 8 个字符')).toBeTruthy()

    fireEvent.change(input, { target: { value: 'dw-secret-123456' } })
    expect(within(dialog).queryByText('数仓 Key 至少需要 8 个字符')).toBeNull()
    fireEvent.click(within(dialog).getByRole('checkbox', { name: '允许在他人的电脑上使用我的凭据' }))
    fireEvent.click(within(dialog).getByRole('button', { name: '保存' }))

    await waitFor(() =>
      expect(calls.find((c) => c.path === '/me/secrets/s1')?.body).toEqual({
        value: 'dw-secret-123456',
        allowForeignMachines: true,
      }),
    )

    // Celebratory ready state with clickable prompt
    expect(await within(dialog).findByText('已就绪，可以用了')).toBeTruthy()
    expect(within(dialog).getByText('“查一下昨天的支付订单量”')).toBeTruthy()
  })

  it('supports fill_shared, create_and_fill, and ask_admin readiness actions in Step 2', async () => {
    const calls = mockApi({
      'GET /market/l1/readiness?scope=group&scopeId=g1': readiness({
        pendingSteps: 3,
        secrets: [
          {
            name: 'SHARED_KEY',
            title: '共用 Key',
            description: '',
            url: null,
            placeholder: null,
            mode: 'shared',
            required: true,
            status: 'unfilled',
            reason: null,
            defId: 's2',
            defScope: 'group',
            action: 'fill_shared',
            reused: false,
            viaConnector: false,
          },
          {
            name: 'NEW_SHARED',
            title: '新建共用凭据',
            description: '自动创建并填写',
            url: null,
            placeholder: null,
            mode: 'shared',
            required: true,
            status: 'missing_def',
            reason: null,
            defId: null,
            defScope: null,
            action: 'create_and_fill',
            reused: false,
            viaConnector: false,
          },
          {
            name: 'ADMIN_KEY',
            title: '团队凭据',
            description: '',
            url: null,
            placeholder: null,
            mode: 'personal',
            required: true,
            status: 'blocked',
            reason: '需团队管理员先定义这项凭据',
            defId: null,
            defScope: null,
            action: 'ask_admin',
            reused: false,
            viaConnector: false,
          },
        ],
      }),
      'PATCH /secrets/s2': {},
      'POST /groups/g1/secrets': { id: 's3' },
    })

    const d = detail()
    render(
      <MemoryRouter>
        <InstallTargetDialog
          listing={{ ...d, listedVersionId: 'pv3', listedRevision: 3 }}
          initialReadyTarget={{ scope: 'group', scopeId: 'g1', label: '支付核心群' }}
          onClose={() => {}}
        />
      </MemoryRouter>,
    )

    const dialog = screen.getByRole('dialog', { name: /添加 数仓查询/ })
    expect(await within(dialog).findByText('需团队管理员先定义这项凭据')).toBeTruthy()

    const sharedInput = within(dialog).getByLabelText('共用 Key')
    fireEvent.change(sharedInput, { target: { value: 'shared-val-999' } })
    const saveBtns = within(dialog).getAllByRole('button', { name: '保存' })
    fireEvent.click(saveBtns[0]!)
    await waitFor(() =>
      expect(calls.find((c) => c.method === 'PATCH' && c.path === '/secrets/s2')?.body).toEqual({
        value: 'shared-val-999',
      }),
    )

    const createInput = within(dialog).getByLabelText('新建共用凭据')
    fireEvent.change(createInput, { target: { value: 'created-val-888' } })
    fireEvent.click(saveBtns[1]!)
    await waitFor(() =>
      expect(calls.find((c) => c.method === 'POST' && c.path === '/groups/g1/secrets')?.body).toMatchObject({
        name: 'NEW_SHARED',
        mode: 'shared',
        value: 'created-val-888',
      }),
    )
  })

  it('posts missing_def personal secret to /groups/:id/secret-needs/personal, creates repo secrets under /teams/:teamId/secrets, and shows codeEnabled=false blocker', async () => {
    const groupCalls = mockApi({
      'GET /market/l1/readiness?scope=group&scopeId=g1': readiness({
        pendingSteps: 2,
        secrets: [
          {
            name: 'DW_KEY',
            title: '数仓 Key',
            description: '个人中心签发',
            url: null,
            placeholder: null,
            mode: 'personal',
            required: true,
            status: 'missing_def',
            reason: null,
            defId: null,
            defScope: null,
            action: 'fill_personal',
            reused: false,
            viaConnector: false,
          },
        ],
        trusts: { codeEnabled: false, ready: false, machines: [] },
      }),
      'POST /groups/g1/secret-needs/personal': {},
    })
    const d = detail()
    const { unmount } = render(
      <MemoryRouter>
        <InstallTargetDialog
          listing={{ ...d, listedVersionId: 'pv3', listedRevision: 3 }}
          initialReadyTarget={{ scope: 'group', scopeId: 'g1', label: '支付核心群', teamId: 't1' }}
          onClose={() => {}}
        />
      </MemoryRouter>,
    )
    const dlg = screen.getByRole('dialog', { name: /添加 数仓查询/ })
    expect(await within(dlg).findByText('需管理员开启「插件运行本机程序」')).toBeTruthy()
    fireEvent.change(within(dlg).getByLabelText('数仓 Key'), { target: { value: 'personal-key-1234' } })
    fireEvent.click(within(dlg).getByRole('button', { name: '保存' }))
    await waitFor(() =>
      expect(groupCalls.find((c) => c.path === '/groups/g1/secret-needs/personal')?.body).toEqual({
        name: 'DW_KEY',
        value: 'personal-key-1234',
        allowForeignMachines: false,
      }),
    )
    unmount()

    const repoCalls = mockApi({
      'GET /market/l1/readiness?scope=repo&scopeId=r1': readiness({
        scope: 'repo',
        scopeId: 'r1',
        targetLabel: '支付组 / core',
        pendingSteps: 1,
        secrets: [
          {
            name: 'REPO_TOKEN',
            title: '仓库凭据',
            description: '团队共用',
            url: null,
            placeholder: null,
            mode: 'shared',
            required: true,
            status: 'missing_def',
            reason: null,
            defId: null,
            defScope: null,
            action: 'create_and_fill',
            reused: false,
            viaConnector: false,
          },
        ],
      }),
      'POST /teams/t1/secrets': { id: 's9' },
    })
    render(
      <MemoryRouter>
        <InstallTargetDialog
          listing={{ ...d, listedVersionId: 'pv3', listedRevision: 3 }}
          initialReadyTarget={{ scope: 'repo', scopeId: 'r1', label: '支付组 / core', teamId: 't1' }}
          onClose={() => {}}
        />
      </MemoryRouter>,
    )
    const repoDlg = screen.getByRole('dialog', { name: /添加 数仓查询/ })
    fireEvent.change(await within(repoDlg).findByLabelText('仓库凭据'), {
      target: { value: 'repo-secret-9999' },
    })
    fireEvent.click(within(repoDlg).getByRole('button', { name: '保存' }))
    await waitFor(() =>
      expect(
        repoCalls.find((c) => c.method === 'POST' && c.path === '/teams/t1/secrets')?.body,
      ).toMatchObject({
        name: 'REPO_TOKEN',
        mode: 'shared',
        value: 'repo-secret-9999',
      }),
    )
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

describe('两步添加文案与自动刷新（UX 回归 11-27）', () => {
  const sharedItem = (o: Partial<MarketReadinessDto['secrets'][number]> = {}) => ({
    name: 'SHARED_KEY',
    title: '共用 Key',
    description: '',
    url: null,
    placeholder: null,
    mode: 'shared' as const,
    required: true,
    status: 'unfilled' as const,
    reason: null,
    defId: 's2',
    defScope: 'team' as const,
    action: 'fill_shared' as const,
    reused: false,
    viaConnector: false,
    ...o,
  })

  it('does not promise 无需手动配置 in Step 1 when the plugin still needs credentials', () => {
    mockApi({})
    const d = detail()
    render(
      <MemoryRouter>
        <InstallTargetDialog
          listing={{ ...d, listedVersionId: 'pv3', listedRevision: 3 }}
          sourceGroupId="g1"
          onClose={() => {}}
        />
      </MemoryRouter>,
    )
    const dialog = screen.getByRole('dialog', { name: /添加 数仓查询/ })
    expect(within(dialog).queryByText(/无需手动配置/)).toBeNull()
    expect(within(dialog).getByText('会自动保持最新版本，添加后会列出还差的准备步骤。')).toBeTruthy()
  })

  it('sends a team-scope request note to team admins, not group admins', () => {
    useSession.setState({
      tenancy: {
        teams: [{ id: 't1', name: '支付组', role: 'member' } as TeamDto],
        singleTeamMode: false,
        canCreateTeam: true,
        demoMode: false,
        pluginsEnabled: true,
      },
    })
    mockApi({ 'GET /teams/t1/repos': [] })
    const d = detail()
    render(
      <MemoryRouter>
        <InstallTargetDialog
          listing={{ ...d, listedVersionId: 'pv3', listedRevision: 3 }}
          onClose={() => {}}
        />
      </MemoryRouter>,
    )
    const dialog = screen.getByRole('dialog', { name: /添加 数仓查询/ })
    fireEvent.click(within(dialog).getByRole('button', { name: /更多范围（管理员）/ }))
    fireEvent.click(within(dialog).getByLabelText(/^支付组/))
    expect(within(dialog).getByPlaceholderText('说一句为什么需要（选填），会发给团队管理员')).toBeTruthy()
  })

  it('names shared team credentials and the team target plainly in Step 2', async () => {
    mockApi({
      'GET /market/l1/readiness?scope=team&scopeId=t1': readiness({
        scope: 'team',
        scopeId: 't1',
        targetLabel: '支付组',
        secrets: [sharedItem()],
      }),
    })
    const d = detail()
    render(
      <MemoryRouter>
        <InstallTargetDialog
          listing={{ ...d, listedVersionId: 'pv3', listedRevision: 3 }}
          initialReadyTarget={{ scope: 'team', scopeId: 't1', label: '支付组', teamId: 't1' }}
          onClose={() => {}}
        />
      </MemoryRouter>,
    )
    const dialog = screen.getByRole('dialog', { name: /添加 数仓查询/ })
    expect(await within(dialog).findByText('填写 共用 Key')).toBeTruthy()
    expect(within(dialog).queryByText(/填写你的/)).toBeNull()
    expect(within(dialog).getByText(/团队共用凭据，加密保存。/)).toBeTruthy()
    expect(within(dialog).queryByText(/群内共用凭据/)).toBeNull()
    expect(within(dialog).getByText('团队所有群默认可用，群管理员可单独关闭')).toBeTruthy()
    expect(within(dialog).queryByText('群里所有 Bot 都能用')).toBeNull()
  })

  it('calls a personal add 「我的插件」 in Step 2, matching the rest of the market', async () => {
    mockApi({
      'PUT /me/installs/l1': {},
      'GET /market/l1/readiness?scope=user&scopeId=u1': readiness({
        scope: 'user',
        scopeId: 'u1',
        targetLabel: '',
        ready: true,
        pendingSteps: 0,
        secrets: [],
      }),
    })
    const d = detail()
    render(
      <MemoryRouter>
        <InstallTargetDialog
          listing={{ ...d, listedVersionId: 'pv3', listedRevision: 3 }}
          onClose={() => {}}
        />
      </MemoryRouter>,
    )
    const dialog = screen.getByRole('dialog', { name: /添加 数仓查询/ })
    fireEvent.click(within(dialog).getByLabelText(/仅我使用/))
    fireEvent.click(within(dialog).getByRole('button', { name: '添加' }))
    expect(
      await within(dialog).findByText('「数仓查询」已添加到「我的插件」，现在就可以开始使用'),
    ).toBeTruthy()
  })

  it("re-checks readiness on its own while steps are pending, so others' approvals tick off", async () => {
    vi.useFakeTimers({ shouldAdvanceTime: true })
    try {
      const calls = mockApi({ 'GET /market/l1/readiness?scope=group&scopeId=g1': readiness() })
      const d = detail()
      render(
        <MemoryRouter>
          <InstallTargetDialog
            listing={{ ...d, listedVersionId: 'pv3', listedRevision: 3 }}
            initialReadyTarget={{ scope: 'group', scopeId: 'g1', label: '支付核心群' }}
            onClose={() => {}}
          />
        </MemoryRouter>,
      )
      const dialog = screen.getByRole('dialog', { name: /添加 数仓查询/ })
      await within(dialog).findByText('已添加到「支付核心群」，还差 1 步就能用')
      // findByText resolves on commit; flush passive effects so the poll interval exists before advancing.
      await act(async () => {})
      const gets = () => calls.filter((c) => c.path.startsWith('/market/l1/readiness')).length
      const before = gets()
      await act(async () => {
        vi.advanceTimersByTime(10_000)
      })
      await waitFor(() => expect(gets()).toBe(before + 1))
    } finally {
      vi.useRealTimers()
    }
  })
})
