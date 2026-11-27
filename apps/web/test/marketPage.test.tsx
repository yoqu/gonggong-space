import type {
  GroupDto,
  InstallRequestDto,
  MarketInstalledDto,
  MarketListingDetailDto,
  MarketListingDto,
  MarketReadinessDto,
  MyListingDto,
  PublishPreflightRes,
  PublishRes,
  RepoDto,
  ReviewItemDto,
  TeamDto,
  UserDto,
  VersionDiffDto,
} from '@gonggong/protocol'
import { fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import { MemoryRouter, Route, Routes, useLocation } from 'react-router'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { AppRail } from '../src/app/AppRail'
import { AppShell } from '../src/app/AppShell'
import { useSession } from '../src/app/session'
import { useWorkspace } from '../src/app/workspace'
import { draftKey } from '../src/features/chat/MessageComposer'
import { MarketPage } from '../src/features/market/MarketPage'
import type { MarketListingView } from '../src/features/market/meta'
import { MarketReviewList } from '../src/features/market/ReviewList'
import { useToasts } from '../src/ui'
import { apiError, mockApi } from './mockApi'

const me = { id: 'u1', name: '姜维川', role: 'member' } as UserDto
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
const TEAMS = [team(), team({ id: 't2', name: '运营组', role: 'member' })]
const group = (id: string, name: string, admin: boolean) =>
  ({
    id,
    teamId: 't1',
    name,
    kind: 'group',
    members: [{ userId: 'u1', name: '姜维川', avatar: null, isAdmin: admin }],
  }) as unknown as GroupDto

const listing = (o: Partial<MarketListingView> = {}): MarketListingView => ({
  id: 'l1',
  type: 'skill',
  name: 'review-pr',
  title: '代码评审助手',
  description: '按团队规范审查 diff',
  layer: 'team',
  status: 'listed',
  versionId: 'pv4',
  revision: 4,
  source: 'team',
  visibility: 'team',
  teamId: 't1',
  teamName: '支付组',
  author: '陈晨',
  agents: ['claude', 'codex'],
  listedVersionId: 'pv3',
  listedRevision: 3,
  installs: 12,
  scene: 'dev',
  capabilities: ['do'],
  readiness: 'ready',
  teamGroupsCount: 4,
  updatedAt: '2026-11-01T00:00:00Z',
  ...o,
})

const LISTINGS: MarketListingView[] = [
  listing(),
  listing({
    id: 'l2',
    type: 'plugin',
    name: 'slides',
    title: '幻灯片',
    description: '生成演示文稿',
    source: 'official',
    layer: 'platform',
    teamId: null,
    teamName: null,
    author: null,
    agents: ['claude'],
    installs: 40,
    teamGroupsCount: 10,
    icon: 'assets/icon.svg',
    category: 'deck',
    scene: 'create',
    capabilities: ['create'],
    readiness: 'ready',
    featured: true,
    updatedAt: '2026-11-05T00:00:00Z',
  }),
  listing({
    id: 'l3',
    type: 'plugin',
    name: 'feishu',
    title: '飞书协同',
    description: '查云文档、约日程、发任务',
    source: 'official',
    layer: 'platform',
    teamId: null,
    teamName: null,
    author: null,
    installs: 28,
    teamGroupsCount: 7,
    category: 'connector',
    scene: 'connect',
    capabilities: ['connect', 'do'],
    readiness: 'needs-account',
    featured: true,
    updatedAt: '2026-11-04T00:00:00Z',
  }),
]

const detail = (o: Partial<MarketListingDetailDto> = {}): MarketListingDetailDto => ({
  ...listing(),
  readme: '---\nname: review-pr\ndescription: 审查\n---\n\n# 审查规范\n\n按规范逐条检查。',
  permissions: [],
  mcp: [{ name: 'git', transport: 'http', url: 'https://git.example.com/mcp', headers: {} }],
  secretSpecs: [],
  files: [
    { path: 'SKILL.md', size: 320 },
    { path: 'scripts/run.sh', size: 1024 },
  ],
  versions: [
    {
      id: 'pv4',
      revision: 4,
      reviewStatus: 'pending',
      changelog: '支持 monorepo',
      reviewNote: null,
      createdBy: '陈晨',
      createdAt: '2026-11-02T00:00:00Z',
    },
    {
      id: 'pv3',
      revision: 3,
      reviewStatus: 'approved',
      changelog: '首个版本',
      reviewNote: null,
      createdBy: '陈晨',
      createdAt: '2026-11-01T00:00:00Z',
    },
  ],
  ghSource: { url: 'https://github.com/acme/skills', ref: 'main', path: 'review-pr', commit: 'abc1234def' },
  canEdit: false,
  ...o,
})

const emptyInstalled: MarketInstalledDto = {
  todoCount: 0,
  pendingUpdates: 0,
  mine: [],
  groups: [],
  team: [],
}

const readyRes = (o: Partial<MarketReadinessDto> = {}): MarketReadinessDto => ({
  listingId: 'l1',
  title: '代码评审助手',
  versionId: 'pv3',
  scope: 'group',
  scopeId: 'g1',
  targetLabel: '支付核心群',
  ready: true,
  pendingSteps: 0,
  secrets: [],
  reusedSecrets: [],
  connector: null,
  trusts: null,
  tryPrompts: ['帮我审查一下最近的提交'],
  ...o,
})

const mine = (o: Partial<MyListingDto> = {}): MyListingDto => ({
  id: 'l9',
  type: 'skill',
  name: 'deploy-check',
  title: '发布前检查',
  description: '上线前自动核查清单',
  layer: 'team',
  status: 'listed',
  versionId: 'v9',
  revision: 2,
  visibility: 'team',
  teamId: 't1',
  latest: {
    id: 'v9',
    revision: 2,
    reviewStatus: 'draft',
    changelog: '',
    reviewNote: null,
    createdBy: '姜维川',
    createdAt: '2026-11-03T00:00:00Z',
  },
  listedVersionId: null,
  ghSource: null,
  banReason: null,
  ...o,
})

const request = (o: Partial<InstallRequestDto> = {}): InstallRequestDto => ({
  id: 'q1',
  listing: listing(),
  scope: 'group',
  scopeId: 'g1',
  targetLabel: '支付核心群',
  pinVersionId: null,
  note: '想在群里审代码',
  status: 'pending',
  requester: '陈晨',
  decidedBy: null,
  decisionNote: null,
  createdAt: '2026-11-03T00:00:00Z',
  decidedAt: null,
  ...o,
})

function Where() {
  const l = useLocation()
  return <div data-testid="where">{`${l.pathname}${l.search}`}</div>
}

const renderPage = (url = '/market') =>
  render(
    <MemoryRouter initialEntries={[url]}>
      <MarketPage />
      <Where />
    </MemoryRouter>,
  )

beforeEach(() => {
  localStorage.setItem('gg.locale', 'zh')
  sessionStorage.clear()
  useSession.setState({
    user: me,
    status: 'ready',
    tenancy: {
      teams: TEAMS,
      singleTeamMode: false,
      canCreateTeam: true,
      demoMode: false,
      pluginsEnabled: true,
    },
  })
  useWorkspace.setState({
    notifCount: 0,
    groups: [group('g1', '支付核心群', true), group('g2', '闲聊群', false)],
  })
  useToasts.setState({ items: [] })
})
afterEach(() => vi.unstubAllGlobals())

describe('市场导航与权限可见性', () => {
  it('shows 市场 in AppRail to regular non-builder members and navigates to /market', async () => {
    useSession.setState({
      tenancy: { ...useSession.getState().tenancy!, teams: [team({ role: 'member' })] },
    })
    useWorkspace.setState({ groups: [group('g2', '闲聊群', false)] })
    mockApi({ 'GET /works/groups': [], 'GET /works': [] })
    render(
      <MemoryRouter initialEntries={['/']}>
        <Routes>
          <Route element={<AppShell />}>
            <Route path="*" element={<AppRail />} />
          </Route>
        </Routes>
        <Where />
      </MemoryRouter>,
    )
    fireEvent.click(screen.getByRole('button', { name: '市场' }))
    await waitFor(() => expect(screen.getByTestId('where').textContent).toBe('/market'))
  })

  it('renders Discovery, 5 Scenarios, and My sections in sidebar; hides 上架审核 from non-reviewers', async () => {
    useSession.setState({
      tenancy: { ...useSession.getState().tenancy!, teams: [team({ role: 'member' })] },
    })
    useWorkspace.setState({ groups: [group('g2', '闲聊群', false)] })
    mockApi({
      'GET /market': LISTINGS,
      'GET /market/installed': emptyInstalled,
      'GET /install-requests?view=todo': [],
    })
    renderPage()
    const nav = await screen.findByRole('navigation', { name: '插件分类' })
    for (const label of [
      '精选推荐',
      '全部插件',
      '连接外部系统',
      '专业创作',
      '办公与协作',
      '研发与数据',
      '效率工具',
      '已添加',
      '申请与审批',
      '我的发布',
    ]) {
      expect(within(nav).getByText(label)).toBeTruthy()
    }
    expect(within(nav).queryByText('上架审核')).toBeNull()
    // Non-admin member sees 申请添加 on plugin cards instead of 添加.
    expect((await screen.findAllByRole('button', { name: '申请添加' })).length).toBeGreaterThan(0)
  })
})

describe('市场首页与分类浏览（无术语、无系统预设）', () => {
  it('renders featured hero cards and 3 shelves without MCP/Skill/ACP jargon, hiding agent/provider presets', async () => {
    const withPresets: MarketListingView[] = [
      ...LISTINGS,
      listing({ id: 'a1', type: 'plugin', name: 'claude-agent', title: 'Claude 引擎', category: 'agent' }),
      listing({
        id: 'p1',
        type: 'plugin',
        name: 'openai-preset',
        title: 'OpenAI 预设',
        category: 'provider',
      }),
    ]
    mockApi({
      'GET /market': withPresets,
      'GET /market/installed': emptyInstalled,
      'GET /install-requests?view=todo': [],
      'GET /market/reviews?teamId=t1': [],
    })
    renderPage()

    expect(await screen.findByRole('region', { name: '连接你的常用工具' })).toBeTruthy()
    expect(screen.getByRole('region', { name: '本团队正在用' })).toBeTruthy()
    expect(screen.getByRole('region', { name: '最新上架' })).toBeTruthy()

    // System presets must never appear in Plugin Market.
    expect(screen.queryByText('Claude 引擎')).toBeNull()
    expect(screen.queryByText('OpenAI 预设')).toBeNull()

    // Zero MCP / Skill / ACP jargon outside 开发者信息.
    const text = document.body.textContent ?? ''
    expect(text).not.toMatch(/\b(MCP|Skill|ACP)\b/)

    // Custom plugin icon uses the version raw URL; skill uses icon glyph.
    const slidesImg = document.querySelector('img.mkt-icon')
    expect(slidesImg?.getAttribute('src')).toBe(
      '/api/market/l2/files/raw?path=assets%2Ficon.svg&versionId=pv4',
    )
  })

  it('filters catalog by scene, legacy ?shelf=connector, search, source, capability, sort, and clears empty search', async () => {
    mockApi({
      'GET /market': LISTINGS,
      'GET /market/installed': emptyInstalled,
      'GET /install-requests?view=todo': [],
      'GET /market/reviews?teamId=t1': [],
    })
    renderPage('/market?shelf=connector')

    const list = await screen.findByRole('list', { name: '插件列表' })
    expect(within(list).getAllByRole('listitem')).toHaveLength(1)
    expect(within(list).getByText('飞书协同')).toBeTruthy()

    // Switch to 全部插件 and filter by capability & source
    fireEvent.click(screen.getByText('全部插件'))
    await waitFor(() =>
      expect(within(screen.getByRole('list', { name: '插件列表' })).getAllByRole('listitem')).toHaveLength(3),
    )

    fireEvent.click(
      within(screen.getByRole('radiogroup', { name: '来源筛选' })).getByRole('radio', { name: '本团队' }),
    )
    expect(within(screen.getByRole('list', { name: '插件列表' })).getAllByRole('listitem')).toHaveLength(1)
    expect(within(screen.getByRole('list', { name: '插件列表' })).getByText('代码评审助手')).toBeTruthy()

    fireEvent.click(
      within(screen.getByRole('radiogroup', { name: '来源筛选' })).getByRole('radio', { name: '全部来源' }),
    )
    fireEvent.click(
      within(screen.getByRole('radiogroup', { name: '能力筛选' })).getByRole('radio', { name: '能创作' }),
    )
    expect(within(screen.getByRole('list', { name: '插件列表' })).getAllByRole('listitem')).toHaveLength(1)
    expect(within(screen.getByRole('list', { name: '插件列表' })).getByText('幻灯片')).toBeTruthy()

    // Sort by installs after clearing capability filter
    fireEvent.click(
      within(screen.getByRole('radiogroup', { name: '能力筛选' })).getByRole('radio', { name: '全部能力' }),
    )
    fireEvent.click(screen.getByRole('button', { name: '排序' }))
    fireEvent.click(await screen.findByRole('menuitemcheckbox', { name: '最多添加' }))
    expect(
      within(screen.getByRole('list', { name: '插件列表' })).getAllByRole('listitem')[0]!.textContent,
    ).toContain('幻灯片')

    // Search with no results shows empty state + 清除筛选看全部
    fireEvent.change(screen.getByRole('searchbox', { name: '搜索插件' }), {
      target: { value: '不存在的插件xyz' },
    })
    expect(await screen.findByText('没有找到与「不存在的插件xyz」匹配的插件')).toBeTruthy()
    fireEvent.click(screen.getByRole('button', { name: '清除筛选看全部' }))
    await waitFor(() =>
      expect(within(screen.getByRole('list', { name: '插件列表' })).getAllByRole('listitem')).toHaveLength(3),
    )
  })

  it('shows error state and retries loading /market', async () => {
    let fail = true
    mockApi({
      'GET /market': () => (fail ? apiError(500, 'internal', '服务暂时不可用') : LISTINGS),
      'GET /market/installed': emptyInstalled,
      'GET /install-requests?view=todo': [],
      'GET /market/reviews?teamId=t1': [],
    })
    renderPage()
    expect(await screen.findByText('服务暂时不可用')).toBeTruthy()
    fail = false
    fireEvent.click(screen.getByRole('button', { name: '重试' }))
    expect(await screen.findByRole('region', { name: '本团队正在用' })).toBeTruthy()
  })
})

describe('插件详情（概览 / 更新记录 / 开发者信息）与封禁', () => {
  it('renders plain-language overview, try-prompt jump, changelog diff, and isolates MCP/Skill/files in 开发者信息', async () => {
    const calls = mockApi({
      'GET /market': LISTINGS,
      'GET /market/installed': emptyInstalled,
      'GET /install-requests?view=todo': [],
      'GET /market/reviews?teamId=t1': [],
      'GET /market/l1': detail({
        canReview: true,
        installedIn: [{ scope: 'group', scopeId: 'g1', label: '支付核心群' }],
        connector: { examples: ['帮我审一下今天的 PR'], docs: 'https://docs.example.com' },
      }),
      'GET /market/l1/files/text?path=scripts%2Frun.sh&versionId=pv4': {
        path: 'scripts/run.sh',
        size: 10,
        binary: false,
        mime: 'application/x-sh',
        text: 'echo hello',
      },
      'GET /market/l1/versions/pv4/diff': {
        base: { versionId: 'pv3', revision: 3 },
        files: [{ path: 'SKILL.md', status: 'modified', binary: false, before: '旧行\n', after: '新行\n' }],
      } satisfies VersionDiffDto,
    })

    renderPage('/market?listing=l1')
    expect(await screen.findByRole('heading', { name: '审查规范' })).toBeTruthy()
    // Frontmatter hidden & zero MCP/Skill jargon on Overview tab
    expect(screen.queryByText(/name: review-pr/)).toBeNull()
    expect(document.body.textContent ?? '').not.toMatch(/\b(MCP|Skill|ACP)\b/)

    // Changelog tab shows versions & file diff dialog
    fireEvent.click(screen.getByRole('tab', { name: /更新记录/ }))
    const log = await screen.findByRole('region', { name: '更新记录' })
    expect(within(log).getByText('支持 monorepo')).toBeTruthy()
    expect(within(log).getByText('首个版本')).toBeTruthy()
    fireEvent.click(within(log).getAllByRole('button', { name: '查看变更' })[0]!)
    const diffDialog = await screen.findByRole('dialog', { name: '代码评审助手 r4 的变更' })
    expect(await within(diffDialog).findByText('对比 r3 的变更')).toBeTruthy()
    fireEvent.keyDown(document, { key: 'Escape' })

    // Developer info tab shows Skill / MCP / GitHub / interactive file tree
    fireEvent.click(screen.getByRole('tab', { name: '开发者信息' }))
    const dev = await screen.findByRole('region', { name: '开发者信息' })
    expect(within(dev).getByText(/1 个 MCP 服务/)).toBeTruthy()
    expect(
      within(dev)
        .getByRole('link', { name: /github\.com\/acme\/skills/ })
        .getAttribute('href'),
    ).toBe('https://github.com/acme/skills')
    const tree = within(dev).getByRole('tree', { name: '文件' })
    fireEvent.click(within(tree).getByRole('treeitem', { name: /run\.sh/ }))
    expect(await within(dev).findByText(/echo hello/)).toBeTruthy()
    expect(calls.some((c) => c.path === '/market/l1/files/text?path=scripts%2Frun.sh&versionId=pv4')).toBe(
      true,
    )

    // Back to Overview and click 去试试 -> seeds draft and navigates to installed group
    fireEvent.click(screen.getByRole('tab', { name: '概览' }))
    fireEvent.click(await screen.findByRole('button', { name: '去试试' }))
    expect(sessionStorage.getItem(draftKey('g1'))).toBe('帮我审一下今天的 PR')
    await waitFor(() => expect(screen.getByTestId('where').textContent).toBe('/g/g1'))
  })

  it('allows reviewer to ban with reason and unban a listing', async () => {
    const calls = mockApi({
      'GET /market': LISTINGS,
      'GET /market/installed': emptyInstalled,
      'GET /install-requests?view=todo': [],
      'GET /market/reviews?teamId=t1': [],
      'GET /market/l1': detail({ canReview: true }),
      'POST /market/l1/ban': {},
    })
    const { unmount } = renderPage('/market?listing=l1')
    fireEvent.click(await screen.findByRole('button', { name: '管理 review-pr' }))
    fireEvent.click(await screen.findByRole('menuitem', { name: '封禁' }))
    const dlg = await screen.findByRole('dialog', { name: '封禁「代码评审助手」' })
    const banBtn = within(dlg).getByRole('button', { name: '封禁' }) as HTMLButtonElement
    expect(banBtn.disabled).toBe(true)
    fireEvent.change(within(dlg).getByRole('textbox', { name: '封禁原因' }), {
      target: { value: '含恶意脚本' },
    })
    fireEvent.click(banBtn)
    await waitFor(() =>
      expect(calls.find((c) => c.path === '/market/l1/ban')?.body).toEqual({ reason: '含恶意脚本' }),
    )
    unmount()

    const unbanCalls = mockApi({
      'GET /market': LISTINGS,
      'GET /market/installed': emptyInstalled,
      'GET /install-requests?view=todo': [],
      'GET /market/reviews?teamId=t1': [],
      'GET /market/l1': detail({ canReview: true, status: 'banned', banReason: '含恶意脚本' }),
      'DELETE /market/l1/ban': {},
    })
    renderPage('/market?listing=l1')
    expect(await screen.findByText('封禁原因：含恶意脚本')).toBeTruthy()
    expect(screen.queryByRole('button', { name: '添加到…' })).toBeNull()
    fireEvent.click(screen.getByRole('button', { name: '解封' }))
    await waitFor(() =>
      expect(unbanCalls.some((c) => c.method === 'DELETE' && c.path === '/market/l1/ban')).toBe(true),
    )
  })
})

describe('两步添加弹窗与原地准备（InstallTargetDialog + InstallReadyStep）', () => {
  const repo = { id: 'r1', name: 'core', key: 'git.example.com/pay/core' } as RepoDto

  it('defaults to fromGroup, hides 仅我使用 for plugins, auto-pins exec plugins, and submits non-admin request', async () => {
    const calls = mockApi({
      'GET /market': LISTINGS,
      'GET /market/installed': emptyInstalled,
      'GET /install-requests?view=todo': [],
      'GET /market/reviews?teamId=t1': [],
      'GET /market/l2': detail({
        ...LISTINGS[1]!,
        type: 'plugin',
        permissions: ['exec'],
        listedVersionId: 'pv4',
        listedRevision: 4,
      }),
      'GET /teams/t1/repos': [repo],
      'GET /teams/t2/repos': [],
      'PUT /groups/g1/installs/l2': {},
      'GET /market/l2/readiness?scope=group&scopeId=g1': readyRes({
        listingId: 'l2',
        title: '幻灯片',
        versionId: 'pv4',
      }),
      'POST /install-requests': {},
    })

    renderPage('/market?listing=l2&fromGroup=g1')
    fireEvent.click(await screen.findByRole('button', { name: '添加到…' }))
    const dialog = await screen.findByRole('dialog', { name: /添加 幻灯片/ })

    // Plugins do NOT show 仅我使用; g1 is pre-selected with 当前群 tag; auto-pin notice shown (no manual pin control).
    expect(within(dialog).queryByText('仅我使用')).toBeNull()
    expect(within(dialog).getByText('当前群')).toBeTruthy()
    expect(within(dialog).getByText(/系统将自动固定在当前已审核版本 r4/)).toBeTruthy()

    // Selecting non-admin group switches CTA to 提交申请 + shows optional reason.
    fireEvent.click(within(dialog).getByLabelText(/闲聊群/))
    expect(within(dialog).queryByRole('button', { name: '添加' })).toBeNull()
    fireEvent.change(within(dialog).getByRole('textbox', { name: '申请说明' }), {
      target: { value: '周会要做汇报' },
    })
    fireEvent.click(within(dialog).getByRole('button', { name: '提交申请' }))
    await waitFor(() =>
      expect(calls.find((c) => c.path === '/install-requests')?.body).toEqual({
        listingId: 'l2',
        scope: 'group',
        scopeId: 'g2',
        pinVersionId: 'pv4',
        note: '周会要做汇报',
      }),
    )

    // Re-open and install into g1 (admin) -> auto-pins pv4 and transitions to Step 2 ready state.
    fireEvent.click(await screen.findByRole('button', { name: '添加到…' }))
    const dlg2 = await screen.findByRole('dialog', { name: /添加 幻灯片/ })
    fireEvent.click(within(dlg2).getByRole('button', { name: '添加' }))
    await waitFor(() =>
      expect(calls.find((c) => c.path === '/groups/g1/installs/l2')?.body).toEqual({
        enabled: true,
        pinVersionId: 'pv4',
      }),
    )
    expect(await within(dlg2).findByText('已就绪，可以用了')).toBeTruthy()
  })

  it('shows 仅我使用 for skills, disables installed/conflict/requested targets, expands admin scopes, and handles 409', async () => {
    const calls = mockApi({
      'GET /market': LISTINGS,
      'GET /market/installed': emptyInstalled,
      'GET /install-requests?view=todo': [],
      'GET /market/reviews?teamId=t1': [],
      'GET /market/l1': detail({
        installedIn: [{ scope: 'group', scopeId: 'g1', label: '支付核心群' }],
        requestedIn: [{ scope: 'group', scopeId: 'g2', requester: '米娅', mine: false }],
        nameTakenIn: [{ scope: 'user', scopeId: 'u1' }],
      }),
      'GET /teams/t1/repos': [repo],
      'GET /teams/t2/repos': [],
      'PUT /teams/t1/repos/r1/installs/l1': apiError(409, 'conflict', '同名插件已存在'),
    })

    renderPage('/market?listing=l1')
    fireEvent.click(await screen.findByRole('button', { name: '添加到…' }))
    const dialog = await screen.findByRole('dialog', { name: /添加 代码评审助手/ })
    expect((within(dialog).getByLabelText(/仅我使用/) as HTMLInputElement).disabled).toBe(true)
    expect((within(dialog).getByLabelText(/支付核心群/) as HTMLInputElement).disabled).toBe(true)
    expect((within(dialog).getByLabelText(/闲聊群/) as HTMLInputElement).disabled).toBe(true)
    expect(within(dialog).getByText('同名冲突')).toBeTruthy()
    expect(within(dialog).getByText('已申请')).toBeTruthy()

    // Expand admin scopes -> select repo -> 409 error displayed cleanly
    fireEvent.click(within(dialog).getByRole('button', { name: /更多范围（管理员）/ }))
    fireEvent.click(await within(dialog).findByLabelText(/支付组 \/ core/))
    fireEvent.click(within(dialog).getByRole('button', { name: '添加' }))
    expect(await within(dialog).findByText('同名插件已存在')).toBeTruthy()
    expect(calls.some((c) => c.path === '/teams/t1/repos/r1/installs/l1')).toBe(true)
  })

  it('deep-links ?configure=l3&scope=group&scopeId=g1 straight into Step 2 for trust & connector actions', async () => {
    let trusted = false
    const calls = mockApi({
      'GET /market': LISTINGS,
      'GET /market/installed': emptyInstalled,
      'GET /install-requests?view=todo': [],
      'GET /market/reviews?teamId=t1': [],
      'GET /market/l3/readiness?scope=group&scopeId=g1': () =>
        readyRes({
          listingId: 'l3',
          title: '飞书协同',
          ready: false,
          pendingSteps: 2,
          connector: {
            kind: 'login',
            driver: null,
            loginPrompt: '请由电脑主人登录飞书账号',
            ready: false,
            groupId: 'g1',
            machines: [
              {
                machineId: 'm2',
                machineName: '陈晨的 Mac',
                ownerId: 'u2',
                ownerName: '陈晨',
                own: false,
                online: true,
                hasConnectorsFeature: true,
                state: 'needs_login',
                account: null,
                botIds: ['b2'],
                botNames: ['飞书助手'],
              },
            ],
          },
          trusts: {
            codeEnabled: true,
            ready: trusted,
            machines: [
              {
                machineId: 'm1',
                machineName: '我的 MacBook',
                ownerId: 'u1',
                ownerName: '姜维川',
                own: true,
                online: true,
                trustId: null,
                status: trusted ? 'allowed' : 'unrequested',
                botIds: ['b1'],
                botNames: ['研效 Bot'],
              },
            ],
          },
        }),
      'POST /market/l3/readiness/action': (body: unknown) => {
        if ((body as { action?: string })?.action === 'allow_trust') trusted = true
        return { ok: true }
      },
    })

    renderPage('/market?configure=l3&scope=group&scopeId=g1')
    const dialog = await screen.findByRole('dialog', { name: /添加 飞书协同/ })
    expect(await within(dialog).findByText('允许 Bot 所在的电脑使用这个插件')).toBeTruthy()

    fireEvent.click(within(dialog).getByRole('button', { name: '立即允许' }))
    await waitFor(() =>
      expect(calls.find((c) => c.path === '/market/l3/readiness/action')?.body).toMatchObject({
        action: 'allow_trust',
        machineId: 'm1',
        scope: 'group',
        scopeId: 'g1',
      }),
    )
    await waitFor(() => expect(within(dialog).queryByRole('button', { name: '立即允许' })).toBeNull())

    fireEvent.click(within(dialog).getByRole('button', { name: '通知陈晨连接' }))
    await waitFor(() =>
      expect(
        calls.some(
          (c) =>
            c.path === '/market/l3/readiness/action' &&
            (c.body as { action?: string })?.action === 'notify_connector',
        ),
      ).toBe(true),
    )
    expect(await within(dialog).findByRole('button', { name: '已提醒' })).toBeTruthy()
  })
})

describe('已添加集中管理（InstalledView）', () => {
  it('renders pending banner + 3 groups (我的插件 / 我所在群的插件 / 团队统一插件) with toggle, upgrade, remove & configure', async () => {
    const installedData: MarketInstalledDto = {
      todoCount: 1,
      pendingUpdates: 1,
      mine: [
        {
          listing: listing({ revision: 5 }),
          scene: 'dev',
          capabilities: ['do'],
          readiness: 'ready',
          source: 'team',
          teamName: '支付组',
          author: '陈晨',
          enabled: true,
          pinVersionId: 'pv3',
          resolvedVersionId: 'pv3',
          resolvedRevision: 3,
          latestRevision: 5,
          hasUpdate: true,
          health: 'update-available',
          healthDetail: null,
          banReason: null,
          updatedAt: '2026-11-01T00:00:00Z',
        },
      ],
      groups: [
        {
          listing: LISTINGS[2]!,
          scene: 'connect',
          capabilities: ['connect'],
          readiness: 'needs-account',
          source: 'official',
          teamName: null,
          latestRevision: 4,
          hasUpdate: false,
          health: 'needs-account',
          healthDetail: '待连接飞书账号',
          banReason: null,
          groups: [
            {
              groupId: 'g1',
              groupName: '支付核心群',
              canManage: true,
              enabled: true,
              pinVersionId: null,
              resolvedVersionId: 'pv4',
              resolvedRevision: 4,
              hasUpdate: false,
              health: 'needs-account',
              healthDetail: '待连接飞书账号',
            },
          ],
        },
      ],
      team: [
        {
          listing: LISTINGS[1]!,
          scene: 'create',
          capabilities: ['create'],
          readiness: 'ready',
          source: 'official',
          scope: 'team',
          scopeId: 't1',
          teamId: 't1',
          targetLabel: '支付组',
          groupsCount: 5,
          canManage: true,
          enabled: true,
          pinVersionId: null,
          resolvedVersionId: 'pv4',
          resolvedRevision: 4,
          latestRevision: 4,
          hasUpdate: false,
          health: 'ready',
          healthDetail: null,
          banReason: null,
          updatedAt: '2026-11-05T00:00:00Z',
        },
      ],
    }

    const calls = mockApi({
      'GET /market': LISTINGS,
      'GET /market/installed': installedData,
      'GET /install-requests?view=todo': [],
      'GET /market/reviews?teamId=t1': [],
      'PUT /me/installs/l1': {},
      'DELETE /me/installs/l1': undefined,
      'GET /market/l3/readiness?scope=group&scopeId=g1': readyRes({ listingId: 'l3', title: '飞书协同' }),
    })

    renderPage('/market?tab=installed')
    expect(await screen.findByText('1 个插件还要配置')).toBeTruthy()
    expect(screen.getByText('1 个插件有新版本')).toBeTruthy()
    expect(screen.getByRole('region', { name: '我的插件' })).toBeTruthy()
    expect(screen.getByRole('region', { name: '我所在群的插件' })).toBeTruthy()
    expect(screen.getByRole('region', { name: '团队统一插件' })).toBeTruthy()

    // Upgrade personal plugin
    fireEvent.click(screen.getByRole('button', { name: '升级' }))
    await waitFor(() =>
      expect(calls.find((c) => c.method === 'PUT' && c.path === '/me/installs/l1')?.body).toEqual({
        enabled: true,
        pinVersionId: 'pv4',
      }),
    )

    // Click 去配置 -> opens Step 2 modal for g1
    fireEvent.click(screen.getByRole('button', { name: '去配置' }))
    expect(await screen.findByRole('dialog', { name: /添加 飞书协同/ })).toBeTruthy()
    fireEvent.keyDown(document, { key: 'Escape' })

    // Remove personal plugin via confirm dialog
    const mineSection = screen.getByRole('region', { name: '我的插件' })
    fireEvent.click(within(mineSection).getByRole('button', { name: '移除' }))
    const confirm = await screen.findByRole('alertdialog')
    fireEvent.click(within(confirm).getByRole('button', { name: '移除' }))
    await waitFor(() =>
      expect(calls.some((c) => c.method === 'DELETE' && c.path === '/me/installs/l1')).toBe(true),
    )
  })
})

describe('申请与审批（InstallRequests）', () => {
  it('fetches todo once, approves/rejects requests with reason, and withdraws my own pending request', async () => {
    const calls = mockApi({
      'GET /market': LISTINGS,
      'GET /market/installed': emptyInstalled,
      'GET /market/reviews?teamId=t1': [],
      'GET /install-requests?view=todo': [request(), request({ id: 'q2', requester: '王磊' })],
      'GET /install-requests?view=mine': [
        request({ id: 'q8' }),
        request({ id: 'q9', targetLabel: '闲聊群', status: 'rejected', decisionNote: '已有同类' }),
      ],
      'POST /install-requests/q1/decide': {},
      'POST /install-requests/q2/decide': {},
      'DELETE /install-requests/q8': undefined,
    })

    renderPage('/market?tab=requests')
    const todo = await screen.findByRole('region', { name: '待我审批' })
    expect(await within(todo).findByText(/陈晨/)).toBeTruthy()
    // P1-2: single todo fetch shared between sidebar badge and InstallRequests view
    expect(calls.filter((c) => c.path === '/install-requests?view=todo')).toHaveLength(1)

    fireEvent.click(within(todo).getAllByRole('button', { name: '同意并添加' })[0]!)
    await waitFor(() =>
      expect(calls.find((c) => c.path === '/install-requests/q1/decide')?.body).toEqual({
        approve: true,
        note: '',
      }),
    )

    fireEvent.click(within(todo).getAllByRole('button', { name: '拒绝' })[1]!)
    const rejDlg = await screen.findByRole('dialog', { name: '拒绝添加申请' })
    const confirmRej = within(rejDlg).getByRole('button', { name: '拒绝' }) as HTMLButtonElement
    expect(confirmRej.disabled).toBe(true)
    fireEvent.change(within(rejDlg).getByRole('textbox', { name: '拒绝原因' }), {
      target: { value: '已有同类' },
    })
    fireEvent.click(confirmRej)
    await waitFor(() =>
      expect(calls.find((c) => c.path === '/install-requests/q2/decide')?.body).toEqual({
        approve: false,
        note: '已有同类',
      }),
    )

    const mineSec = await screen.findByRole('region', { name: '我的申请' })
    expect(within(mineSec).getByText(/已有同类/)).toBeTruthy()
    fireEvent.click(within(mineSec).getByRole('button', { name: '撤回申请' }))
    await waitFor(() =>
      expect(calls.some((c) => c.method === 'DELETE' && c.path === '/install-requests/q8')).toBe(true),
    )
  })
})

describe('我的发布与双轨发布（MyListings）', () => {
  it('lists published items with filter, upstream check, submit draft, and unlist confirm', async () => {
    const gh = mine({
      listedVersionId: 'v8',
      ghSource: { url: 'https://github.com/acme/s', ref: null, path: '', commit: 'c1' },
    })
    const calls = mockApi({
      'GET /market': [],
      'GET /market/installed': emptyInstalled,
      'GET /install-requests?view=todo': [],
      'GET /market/reviews?teamId=t1': [],
      'GET /market/mine': [
        gh,
        mine({
          id: 'l8',
          title: 'lint-fix',
          latest: { ...mine().latest, id: 'v8', reviewStatus: 'pending' },
        }),
      ],
      'GET /market/mine/upstream': [{ listingId: 'l9', commit: 'c2abcdef' }],
      'POST /market/l9/check-upstream': { changed: true, drafted: true, commit: 'c2abcdef' },
      'POST /market/l9/versions/v9/submit': {},
      'PATCH /market/l9': {},
    })

    renderPage('/market?tab=mine')
    expect(await screen.findByText('发布前检查')).toBeTruthy()
    expect(await screen.findByText('上游有更新')).toBeTruthy()

    // Filter by status
    fireEvent.click(screen.getByRole('radio', { name: '待审核 1' }))
    expect(screen.queryByText('发布前检查')).toBeNull()
    expect(screen.getByText('lint-fix')).toBeTruthy()
    fireEvent.click(screen.getByRole('radio', { name: '全部 2' }))

    // Sync upstream
    fireEvent.click(screen.getByRole('button', { name: '同步上游更新' }))
    await waitFor(() => expect(calls.some((c) => c.path === '/market/l9/check-upstream')).toBe(true))

    // Submit draft
    fireEvent.click(screen.getByRole('button', { name: '提交审核' }))
    const subDlg = await screen.findByRole('dialog', { name: '提交审核 发布前检查' })
    fireEvent.change(within(subDlg).getByRole('textbox', { name: '更新说明' }), {
      target: { value: '修复问题' },
    })
    fireEvent.click(within(subDlg).getByRole('button', { name: '提交审核' }))
    await waitFor(() =>
      expect(calls.find((c) => c.path === '/market/l9/versions/v9/submit')?.body).toEqual({
        changelog: '修复问题',
      }),
    )

    // Unlist confirmation
    fireEvent.click(screen.getByRole('button', { name: '下架' }))
    const confirm = await screen.findByRole('alertdialog')
    fireEvent.click(within(confirm).getByRole('button', { name: '下架' }))
    await waitFor(() => expect(calls.find((c) => c.method === 'PATCH')?.body).toEqual({ status: 'unlisted' }))
  })

  it('publishes via guided lightweight wizard with live store card preview & preflight, and supports GitHub track', async () => {
    const pre: PublishPreflightRes = {
      type: 'skill',
      name: 'contract-review',
      title: '合同风险初审',
      description: '按法务清单标出违约风险',
      kind: 'new',
      revision: 1,
      visibility: 'team',
      warnings: [],
    }
    const pubRes: PublishRes = { listing: mine({ title: '合同风险初审' }), warnings: [], unchanged: false }
    const calls = mockApi({
      'GET /market': [],
      'GET /market/installed': emptyInstalled,
      'GET /install-requests?view=todo': [],
      'GET /market/reviews?teamId=t1': [],
      'GET /market/mine': [],
      'POST /market/preflight': pre,
      'POST /market': pubRes,
      'POST /market/l9/versions/v9/submit': {},
      'POST /market/import/github': pubRes,
    })

    renderPage('/market?tab=mine&publish=1')
    const preview = await screen.findByRole('complementary', { name: '商店卡片预览' })

    fireEvent.change(screen.getByLabelText('插件名称'), { target: { value: '合同风险初审' } })
    fireEvent.change(screen.getByLabelText('一句话简介（展示在市场卡片）'), {
      target: { value: '按法务清单标出违约风险' },
    })
    fireEvent.change(screen.getByLabelText('试试这样问（选填，让同事一看就会用）'), {
      target: { value: '帮我审一下这份合同' },
    })

    expect(within(preview).getByText('合同风险初审')).toBeTruthy()
    expect(within(preview).getByText('按法务清单标出违约风险')).toBeTruthy()
    expect(within(preview).getByText('已提供「试试这样问」示例')).toBeTruthy()

    await screen.findByText('将新建插件「合同风险初审」，保存为草稿 r1')
    fireEvent.click(screen.getByRole('button', { name: '保存并提交审核' }))
    await waitFor(() => expect(calls.some((c) => c.method === 'POST' && c.path === '/market')).toBe(true))
    await waitFor(() => expect(calls.some((c) => c.path === '/market/l9/versions/v9/submit')).toBe(true))

    // Track 2: GitHub import
    fireEvent.click((await screen.findAllByRole('button', { name: '发布新插件' }))[0]!)
    fireEvent.click(screen.getByRole('radio', { name: /完整插件包 \/ GitHub/ }))
    fireEvent.click(
      within(screen.getByRole('radiogroup', { name: '来源' })).getByRole('radio', { name: 'GitHub 链接' }),
    )
    fireEvent.change(screen.getByLabelText('GitHub 链接'), { target: { value: 'https://github.com/acme/s' } })
    fireEvent.click(screen.getByRole('button', { name: '存为草稿' }))
    await waitFor(() =>
      expect(calls.find((c) => c.path === '/market/import/github')?.body).toEqual({
        teamId: 't1',
        visibility: 'team',
        url: 'https://github.com/acme/s',
      }),
    )
  })
})

describe('上架审核工作台（MarketReviewList）', () => {
  const item: ReviewItemDto = {
    listing: { ...(listing() as MarketListingDto), listedVersionId: null, listedRevision: null },
    version: detail().versions[0]!,
  }
  const diff: VersionDiffDto = {
    base: { versionId: 'pv3', revision: 3 },
    files: [
      { path: 'SKILL.md', status: 'modified', binary: false, before: '旧行\n', after: '新行\n' },
      { path: 'assets/logo.png', status: 'modified', binary: true, before: null, after: null },
    ],
  }

  it('shows 2-pane workbench with audit cards, file diff, required reject reason, and approve action', async () => {
    const calls = mockApi({
      'GET /market/reviews?teamId=t1': [item],
      'GET /market/l1?versionId=pv4': detail({ permissions: ['exec'] }),
      'GET /market/l1/versions/pv4/diff': diff,
      'POST /market/l1/versions/pv4/review': {},
    })

    const { unmount } = render(
      <MemoryRouter>
        <MarketReviewList path="/market/reviews?teamId=t1" queueLabel="支付组" />
      </MemoryRouter>,
    )

    expect(await screen.findByRole('region', { name: '上架审核工作台' })).toBeTruthy()
    expect(await screen.findByText('会在电脑上运行代码（需机主确认）')).toBeTruthy()
    expect(await screen.findByText('对比 r3 的变更')).toBeTruthy()
    expect(screen.getByText('二进制文件已变化')).toBeTruthy()

    const rejectBtn = screen.getByRole('button', { name: '驳回' }) as HTMLButtonElement
    expect(rejectBtn.disabled).toBe(true)
    fireEvent.change(screen.getByRole('textbox', { name: '审核意见' }), { target: { value: '缺少说明' } })
    expect(rejectBtn.disabled).toBe(false)
    fireEvent.click(rejectBtn)
    await waitFor(() =>
      expect(calls.find((c) => c.path === '/market/l1/versions/pv4/review')?.body).toEqual({
        approve: false,
        note: '缺少说明',
      }),
    )
    unmount()

    const approveCalls = mockApi({
      'GET /market/reviews': [item],
      'GET /market/l1?versionId=pv4': detail(),
      'GET /market/l1/versions/pv4/diff': diff,
      'POST /market/l1/versions/pv4/review': {},
    })
    render(
      <MemoryRouter>
        <MarketReviewList path="/market/reviews" />
      </MemoryRouter>,
    )
    fireEvent.click(await screen.findByRole('button', { name: '通过并上架' }))
    await waitFor(() =>
      expect(approveCalls.find((c) => c.path === '/market/l1/versions/pv4/review')?.body).toEqual({
        approve: true,
        note: '',
      }),
    )
  })

  it('shows empty review message for standalone vs market queue', async () => {
    mockApi({ 'GET /market/reviews': [] })
    const { unmount } = render(
      <MemoryRouter>
        <MarketReviewList path="/market/reviews" />
      </MemoryRouter>,
    )
    expect(await screen.findByText('没有待审核的版本')).toBeTruthy()
    unmount()

    render(
      <MemoryRouter>
        <MarketReviewList path="/market/reviews" onBackMarket={() => {}} />
      </MemoryRouter>,
    )
    expect(await screen.findByText('待审核队列已清空')).toBeTruthy()
  })
})
