import type {
  GroupDto,
  InstallRequestDto,
  MarketListingDetailDto,
  MarketListingDto,
  MyListingDto,
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
import { MarketPage } from '../src/features/market/MarketPage'
import { MarketReviewList } from '../src/features/market/ReviewList'
import { useToasts } from '../src/ui'
import { apiError, mockApi } from './mockApi'

const me = { id: 'u1', name: '姜维川', role: 'member' } as UserDto
const team = (o: Partial<TeamDto>): TeamDto => ({
  id: 't1',
  name: '支付组',
  avatar: null,
  role: 'admin',
  archivedAt: null,
  createdAt: '2026-01-01T00:00:00Z',
  unread: 0,
  ...o,
})
const TEAMS = [team({}), team({ id: 't2', name: '运营组', role: 'member' })]
const group = (id: string, name: string, admin: boolean) =>
  ({
    id,
    teamId: 't1',
    name,
    kind: 'group',
    members: [{ userId: 'u1', name: '姜维川', avatar: null, isAdmin: admin }],
  }) as unknown as GroupDto

const listing = (o: Partial<MarketListingDto> = {}): MarketListingDto => ({
  id: 'l1',
  type: 'skill',
  name: 'review-pr',
  title: 'review-pr',
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
  updatedAt: '2026-11-01T00:00:00Z',
  ...o,
})
const LISTINGS = [
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
  }),
]
const detail = (o: Partial<MarketListingDetailDto> = {}): MarketListingDetailDto => ({
  ...listing(),
  readme: '# 审查 PR\n\n按规范逐条检查。',
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

function Where() {
  const l = useLocation()
  return <div data-testid="where">{l.pathname}</div>
}

const renderPage = (url = '/market') =>
  render(
    <MemoryRouter initialEntries={[url]}>
      <MarketPage />
    </MemoryRouter>,
  )

beforeEach(() => {
  localStorage.setItem('gg.locale', 'zh')
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

describe('市场 in the app rail', () => {
  it('opens the market page', async () => {
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
})

describe('市场 page', () => {
  it('lists listings as cards and filters by search, type and source', async () => {
    const calls = mockApi({
      'GET /market': LISTINGS,
      'GET /market?q=review': [LISTINGS[0]],
      'GET /market?type=plugin': [LISTINGS[1]],
      'GET /market?type=plugin&source=official': [LISTINGS[1]],
    })
    renderPage()
    const grid = await screen.findByRole('list', { name: '市场' })
    const card = within(grid).getByText('review-pr').closest('li') as HTMLElement
    expect(card.textContent).toContain('Skill')
    expect(card.textContent).toContain('陈晨 · 支付组')
    expect(card.textContent).toContain('按团队规范审查 diff')
    expect(card.textContent).toContain('claude')
    expect(card.textContent).toContain('codex')
    expect(card.textContent).toContain('12 次引入')
    expect((within(grid).getByText('幻灯片').closest('li') as HTMLElement).textContent).toContain('官方')

    fireEvent.change(screen.getByRole('searchbox', { name: '搜索市场' }), { target: { value: 'review' } })
    await waitFor(() => expect(calls.some((c) => c.path === '/market?q=review')).toBe(true))
    fireEvent.change(screen.getByRole('searchbox', { name: '搜索市场' }), { target: { value: '' } })
    fireEvent.click(
      within(screen.getByRole('radiogroup', { name: '类型' })).getByRole('radio', { name: '插件' }),
    )
    await waitFor(() => expect(calls.some((c) => c.path === '/market?type=plugin')).toBe(true))
    fireEvent.click(
      within(screen.getByRole('radiogroup', { name: '来源' })).getByRole('radio', { name: '官方' }),
    )
    await waitFor(() =>
      expect(calls.some((c) => c.path === '/market?type=plugin&source=official')).toBe(true),
    )
  })

  it('opens a listing: readme, files, version history with changelogs and the GitHub source', async () => {
    mockApi({ 'GET /market': LISTINGS, 'GET /market/l1': detail() })
    renderPage()
    fireEvent.click(await screen.findByRole('button', { name: '查看 review-pr' }))
    const drawer = await screen.findByRole('dialog', { name: 'review-pr' })
    expect(await within(drawer).findByRole('heading', { name: '审查 PR' })).toBeTruthy()
    expect(within(drawer).getByRole('treeitem', { name: /run\.sh/ })).toBeTruthy()
    expect(within(drawer).getByText('支持 monorepo')).toBeTruthy()
    expect(within(drawer).getByText('首个版本')).toBeTruthy()
    expect(within(drawer).getByText('待审核')).toBeTruthy()
    expect(within(drawer).getByText('已通过')).toBeTruthy()
    const gh = within(drawer).getByRole('link', { name: /github\.com\/acme\/skills/ })
    expect(gh.getAttribute('href')).toBe('https://github.com/acme/skills')
    expect(within(drawer).getByText(/abc1234/)).toBeTruthy()
  })

  it('shows its files as a tree and opens one beside it', async () => {
    const calls = mockApi({
      'GET /market': LISTINGS,
      'GET /market/l1': detail(),
      'GET /market/l1/files/text?path=scripts%2Frun.sh': {
        path: 'scripts/run.sh',
        size: 10,
        binary: false,
        mime: 'application/x-sh',
        text: 'echo hello',
      },
    })
    renderPage()
    fireEvent.click(await screen.findByRole('button', { name: '查看 review-pr' }))
    const drawer = await screen.findByRole('dialog', { name: 'review-pr' })
    const tree = await within(drawer).findByRole('tree', { name: '文件' })
    expect(
      within(tree)
        .getAllByRole('treeitem')
        .map((x) => x.textContent),
    ).toEqual([
      expect.stringContaining('scripts'),
      expect.stringContaining('run.sh'),
      expect.stringContaining('SKILL.md'),
    ])
    fireEvent.click(within(tree).getByRole('treeitem', { name: /run\.sh/ }))
    expect(await within(drawer).findByText(/echo hello/)).toBeTruthy()
    expect(calls.some((c) => c.path === '/market/l1/files/text?path=scripts%2Frun.sh')).toBe(true)
    fireEvent.click(within(tree).getByRole('treeitem', { name: /scripts/ }))
    expect(within(tree).queryByRole('treeitem', { name: /run\.sh/ })).toBeNull()
  })

  it("hides SKILL.md's front matter in the readme", async () => {
    mockApi({
      'GET /market': LISTINGS,
      'GET /market/l1': detail({ readme: '---\nname: review-pr\ndescription: 审查\n---\n\n# 审查 PR\n' }),
    })
    renderPage()
    fireEvent.click(await screen.findByRole('button', { name: '查看 review-pr' }))
    const drawer = await screen.findByRole('dialog', { name: 'review-pr' })
    expect(await within(drawer).findByRole('heading', { name: '审查 PR' })).toBeTruthy()
    expect(within(drawer).queryByText(/name: review-pr/)).toBeNull()
  })

  it('sorts by installs and clears filters from the empty state', async () => {
    mockApi({ 'GET /market': LISTINGS, 'GET /market?type=plugin&source=team': [] })
    renderPage()
    const grid = await screen.findByRole('list', { name: '市场' })
    expect(within(grid).getAllByRole('listitem')[0]!.textContent).toContain('review-pr')
    fireEvent.click(screen.getByRole('button', { name: '排序' }))
    fireEvent.click(await screen.findByRole('menuitemcheckbox', { name: '引入最多' }))
    expect(within(grid).getAllByRole('listitem')[0]!.textContent).toContain('幻灯片')

    fireEvent.click(
      within(screen.getByRole('radiogroup', { name: '类型' })).getByRole('radio', { name: '插件' }),
    )
    fireEvent.click(
      within(screen.getByRole('radiogroup', { name: '来源' })).getByRole('radio', { name: '本团队' }),
    )
    fireEvent.click(await screen.findByRole('button', { name: '清除筛选' }))
    expect(await screen.findByRole('list', { name: '市场' })).toBeTruthy()
  })
})

describe('引入到… dialog', () => {
  const repo = { id: 'r1', name: 'core', key: 'git.example.com/pay/core' } as RepoDto
  const open = async () => {
    fireEvent.click(await screen.findByRole('button', { name: '查看 review-pr' }))
    const drawer = await screen.findByRole('dialog', { name: 'review-pr' })
    fireEvent.click(await within(drawer).findByRole('button', { name: '引入到…' }))
    return screen.findByRole('dialog', { name: '引入「review-pr」' })
  }

  it('installs into groups and teams I administer and their repos; follows latest or pins the listed version', async () => {
    const calls = mockApi({
      'GET /market': LISTINGS,
      'GET /market/l1': detail(),
      'GET /teams/t1/repos': [repo],
      'GET /teams/t2/repos': [],
      'PUT /groups/g1/installs/l1': {},
      'PUT /teams/t1/installs/l1': {},
      'PUT /teams/t1/repos/r1/installs/l1': {},
    })
    renderPage()
    let dialog = await open()
    expect(within(dialog).getByRole('radio', { name: '支付核心群' })).toBeTruthy()
    fireEvent.click(within(dialog).getByRole('radio', { name: '支付核心群' }))
    fireEvent.click(within(dialog).getByRole('button', { name: '引入' }))
    await waitFor(() =>
      expect(calls.find((c) => c.path === '/groups/g1/installs/l1')?.body).toEqual({
        enabled: true,
        pinVersionId: null,
      }),
    )
    await waitFor(() => expect(screen.queryByRole('dialog', { name: '引入「review-pr」' })).toBeNull())

    dialog = await open()
    fireEvent.click(
      within(within(dialog).getByRole('radiogroup', { name: '引入到' })).getByRole('radio', { name: '团队' }),
    )
    expect(within(dialog).getByRole('radio', { name: '支付组' })).toBeTruthy()
    fireEvent.click(within(dialog).getByRole('radio', { name: '支付组' }))
    fireEvent.click(within(dialog).getByRole('radio', { name: '锁定当前版本 r3' }))
    fireEvent.click(within(dialog).getByRole('button', { name: '引入' }))
    await waitFor(() =>
      expect(calls.find((c) => c.path === '/teams/t1/installs/l1')?.body).toEqual({
        enabled: true,
        pinVersionId: 'pv3',
      }),
    )
    await waitFor(() => expect(screen.queryByRole('dialog', { name: '引入「review-pr」' })).toBeNull())

    dialog = await open()
    fireEvent.click(
      within(within(dialog).getByRole('radiogroup', { name: '引入到' })).getByRole('radio', { name: '仓库' }),
    )
    fireEvent.click(await within(dialog).findByRole('radio', { name: '支付组 / core' }))
    fireEvent.click(within(dialog).getByRole('button', { name: '引入' }))
    await waitFor(() => expect(calls.some((c) => c.path === '/teams/t1/repos/r1/installs/l1')).toBe(true))
  })

  it('installs into my personal layer, open to anyone', async () => {
    useWorkspace.setState({ groups: [] })
    useSession.setState({
      tenancy: { ...useSession.getState().tenancy!, teams: [team({ role: 'member' })] },
    })
    const calls = mockApi({ 'GET /market': LISTINGS, 'GET /market/l1': detail(), 'PUT /me/installs/l1': {} })
    renderPage()
    const dialog = await open()
    fireEvent.click(
      within(within(dialog).getByRole('radiogroup', { name: '引入到' })).getByRole('radio', {
        name: '我的个人',
      }),
    )
    fireEvent.click(within(dialog).getByRole('radio', { name: '锁定当前版本 r3' }))
    fireEvent.click(within(dialog).getByRole('button', { name: '引入' }))
    await waitFor(() =>
      expect(calls.find((c) => c.path === '/me/installs/l1')?.body).toEqual({
        enabled: true,
        pinVersionId: 'pv3',
      }),
    )
  })

  it('disables the personal target for a plugin', async () => {
    mockApi({
      'GET /market': LISTINGS,
      'GET /market/l2': detail({ id: 'l2', type: 'plugin', name: 'slides', title: '幻灯片' }),
      'GET /teams/t1/repos': [],
    })
    renderPage()
    fireEvent.click(await screen.findByRole('button', { name: '查看 幻灯片' }))
    const drawer = await screen.findByRole('dialog', { name: '幻灯片' })
    fireEvent.click(await within(drawer).findByRole('button', { name: '引入到…' }))
    const dialog = await screen.findByRole('dialog', { name: '引入「幻灯片」' })
    const personal = within(within(dialog).getByRole('radiogroup', { name: '引入到' })).getByRole('radio', {
      name: '我的个人',
    }) as HTMLButtonElement
    expect(personal.disabled).toBe(true)
    expect(within(dialog).getByText('插件不能引入到个人')).toBeTruthy()
  })

  it('shows the server message on a 409 conflict', async () => {
    mockApi({
      'GET /market': LISTINGS,
      'GET /market/l1': detail(),
      'GET /teams/t1/repos': [],
      'PUT /groups/g1/installs/l1': apiError(409, 'conflict', '同名 Skill 已存在'),
    })
    renderPage()
    const dialog = await open()
    fireEvent.click(within(dialog).getByRole('radio', { name: '支付核心群' }))
    fireEvent.click(within(dialog).getByRole('button', { name: '引入' }))
    expect(await within(dialog).findByText('同名 Skill 已存在')).toBeTruthy()
  })
})

const mine = (o: Partial<MyListingDto> = {}): MyListingDto => ({
  id: 'l9',
  type: 'skill',
  name: 'deploy-check',
  title: 'deploy-check',
  description: '发布前检查',
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

describe('我的发布', () => {
  const openMine = async () => {
    renderPage()
    fireEvent.click(screen.getByRole('tab', { name: '我的发布' }))
  }

  it('lists my listings with the latest version status and rejection reason', async () => {
    mockApi({
      'GET /market': [],
      'GET /market/mine': [
        mine(),
        mine({
          id: 'l8',
          name: 'lint-fix',
          title: 'lint-fix',
          listedVersionId: 'v7',
          latest: { ...mine().latest, id: 'v8', reviewStatus: 'rejected', reviewNote: '缺少使用说明' },
        }),
      ],
    })
    await openMine()
    const draft = (await screen.findByText('deploy-check')).closest('.cfg__item') as HTMLElement
    expect(draft.textContent).toContain('草稿')
    expect(draft.textContent).toContain('未上架')
    const rejected = screen.getByText('lint-fix').closest('.cfg__item') as HTMLElement
    expect(rejected.textContent).toContain('已驳回')
    expect(rejected.textContent).toContain('驳回原因：缺少使用说明')
    expect(rejected.textContent).toContain('已上架')
  })

  it('publishes from a GitHub link, shows warnings, then submits for review with a changelog', async () => {
    const res: PublishRes = {
      listing: mine({ ghSource: { url: 'https://github.com/acme/s', ref: null, path: '', commit: 'c1' } }),
      warnings: ['SKILL.md 第 3 行疑似密钥 sk-…'],
    }
    const calls = mockApi({
      'GET /market': [],
      'GET /market/mine': [],
      'POST /market/import/github': res,
      'POST /market/l9/versions/v9/submit': {},
    })
    await openMine()
    fireEvent.click(await screen.findByRole('button', { name: '发布…' }))
    const dialog = await screen.findByRole('dialog', { name: '发布到市场' })
    fireEvent.click(within(dialog).getByRole('radio', { name: '公开' }))
    fireEvent.click(within(dialog).getByRole('radio', { name: 'GitHub 链接' }))
    fireEvent.change(within(dialog).getByRole('textbox', { name: 'GitHub 链接' }), {
      target: { value: 'https://github.com/acme/s' },
    })
    fireEvent.click(within(dialog).getByRole('button', { name: '保存草稿' }))
    await waitFor(() =>
      expect(calls.find((c) => c.path === '/market/import/github')?.body).toEqual({
        teamId: 't1',
        visibility: 'public',
        url: 'https://github.com/acme/s',
      }),
    )
    expect(await within(dialog).findByText('SKILL.md 第 3 行疑似密钥 sk-…')).toBeTruthy()
    fireEvent.change(within(dialog).getByRole('textbox', { name: '更新说明' }), { target: { value: '首发' } })
    fireEvent.click(within(dialog).getByRole('button', { name: '提交审核' }))
    await waitFor(() =>
      expect(calls.find((c) => c.path === '/market/l9/versions/v9/submit')?.body).toEqual({
        changelog: '首发',
      }),
    )
  })

  it('publishes a pasted SKILL.md to a chosen team', async () => {
    const calls = mockApi({
      'GET /market': [],
      'GET /market/mine': [],
      'POST /market': { listing: mine(), warnings: [] },
    })
    await openMine()
    fireEvent.click(await screen.findByRole('button', { name: '发布…' }))
    const dialog = await screen.findByRole('dialog', { name: '发布到市场' })
    fireEvent.click(within(dialog).getByRole('radio', { name: '运营组' }))
    fireEvent.click(within(dialog).getByRole('radio', { name: '粘贴 SKILL.md' }))
    const text = '---\nname: x\ndescription: y\n---\n正文'
    fireEvent.change(within(dialog).getByRole('textbox', { name: 'SKILL.md' }), { target: { value: text } })
    fireEvent.click(within(dialog).getByRole('button', { name: '保存草稿' }))
    await waitFor(() =>
      expect(calls.find((c) => c.method === 'POST' && c.path === '/market')?.body).toEqual({
        teamId: 't2',
        visibility: 'team',
        files: [{ path: 'SKILL.md', content: text, encoding: 'utf8' }],
      }),
    )
    expect(await within(dialog).findByRole('button', { name: '提交审核' })).toBeTruthy()
  })

  it('submits a draft, checks upstream, unlists, and locks the visibility once listed', async () => {
    const gh = mine({
      listedVersionId: 'v8',
      ghSource: { url: 'https://github.com/acme/s', ref: null, path: '', commit: 'c1' },
    })
    const calls = mockApi({
      'GET /market': [],
      'GET /market/mine': [gh],
      'POST /market/l9/versions/v9/submit': {},
      'POST /market/l9/check-upstream': { changed: false, commit: 'c1' },
      'PATCH /market/l9': {},
    })
    await openMine()
    const row = (await screen.findByText('deploy-check')).closest('.cfg__item') as HTMLElement
    fireEvent.click(within(row).getByRole('button', { name: '提交审核' }))
    const dialog = await screen.findByRole('dialog', { name: '提交审核 deploy-check' })
    fireEvent.change(within(dialog).getByRole('textbox', { name: '更新说明' }), { target: { value: '修复' } })
    fireEvent.click(within(dialog).getByRole('button', { name: '提交审核' }))
    await waitFor(() =>
      expect(calls.find((c) => c.path === '/market/l9/versions/v9/submit')?.body).toEqual({
        changelog: '修复',
      }),
    )

    fireEvent.click(within(row).getByRole('button', { name: '检查上游更新' }))
    await waitFor(() =>
      expect(useToasts.getState().items.some((i) => String(i.message).includes('上游没有变化'))).toBe(true),
    )

    fireEvent.click(within(row).getByRole('button', { name: '下架' }))
    await waitFor(() => expect(calls.find((c) => c.method === 'PATCH')?.body).toEqual({ status: 'unlisted' }))
    expect(within(row).queryByRole('button', { name: '设为公开' })).toBeNull()
  })

  it('filters by status and opens a listing from its row', async () => {
    mockApi({
      'GET /market': [],
      'GET /market/mine': [
        mine(),
        mine({
          id: 'l8',
          name: 'lint-fix',
          title: 'lint-fix',
          latest: { ...mine().latest, reviewStatus: 'pending' },
        }),
      ],
      'GET /market/l9': detail({ id: 'l9', title: 'deploy-check' }),
    })
    await openMine()
    await screen.findByText('lint-fix')
    fireEvent.click(screen.getByRole('radio', { name: '待审核 1' }))
    expect(screen.queryByText('deploy-check')).toBeNull()
    fireEvent.click(screen.getByRole('radio', { name: '待处理 1' }))
    const row = screen.getByText('deploy-check').closest('.cfg__item') as HTMLElement
    fireEvent.click(within(row).getByRole('button', { name: '详情' }))
    expect(await screen.findByRole('dialog', { name: 'deploy-check' })).toBeTruthy()
  })

  it('reports a changed upstream as a new draft', async () => {
    mockApi({
      'GET /market': [],
      'GET /market/mine': [
        mine({ ghSource: { url: 'https://github.com/acme/s', ref: null, path: '', commit: 'c1' } }),
      ],
      'POST /market/l9/check-upstream': { changed: true, commit: 'c2abcdef' },
    })
    await openMine()
    fireEvent.click(await screen.findByRole('button', { name: '检查上游更新' }))
    await waitFor(() =>
      expect(useToasts.getState().items.some((i) => String(i.message).includes('已生成新草稿'))).toBe(true),
    )
  })
})

describe('审核', () => {
  const item: ReviewItemDto = {
    listing: { ...listing(), listedVersionId: null, listedRevision: null },
    version: detail().versions[0]!,
  }

  it('approves a pending version after viewing it', async () => {
    const calls = mockApi({
      'GET /market/reviews?teamId=t1': [item],
      'GET /market/l1?versionId=pv4': detail(),
      'POST /market/l1/versions/pv4/review': {},
    })
    render(<MarketReviewList path="/market/reviews?teamId=t1" />)
    const row = (await screen.findByText('review-pr')).closest('.cfg__item') as HTMLElement
    expect(row.textContent).toContain('支持 monorepo')
    fireEvent.click(within(row).getByRole('button', { name: '审核' }))
    const dialog = await screen.findByRole('dialog', { name: '审核 review-pr r4' })
    expect(await within(dialog).findByRole('heading', { name: '审查 PR' })).toBeTruthy()
    fireEvent.click(within(dialog).getByRole('button', { name: '通过' }))
    await waitFor(() =>
      expect(calls.find((c) => c.path === '/market/l1/versions/pv4/review')?.body).toEqual({
        approve: true,
        note: '',
      }),
    )
  })

  it('rejects only with a reason', async () => {
    const calls = mockApi({
      'GET /market/reviews': [item],
      'GET /market/l1?versionId=pv4': detail(),
      'POST /market/l1/versions/pv4/review': {},
    })
    render(<MarketReviewList path="/market/reviews" />)
    fireEvent.click(await screen.findByRole('button', { name: '审核' }))
    const dialog = await screen.findByRole('dialog', { name: '审核 review-pr r4' })
    const reject = within(dialog).getByRole('button', { name: '驳回' }) as HTMLButtonElement
    expect(reject.disabled).toBe(true)
    fireEvent.change(within(dialog).getByRole('textbox', { name: '审核意见' }), {
      target: { value: '缺少说明' },
    })
    expect(reject.disabled).toBe(false)
    fireEvent.click(reject)
    await waitFor(() =>
      expect(calls.find((c) => c.path === '/market/l1/versions/pv4/review')?.body).toEqual({
        approve: false,
        note: '缺少说明',
      }),
    )
  })

  it('says when nothing waits for review', async () => {
    mockApi({ 'GET /market/reviews': [] })
    render(<MarketReviewList path="/market/reviews" />)
    expect(await screen.findByText('没有待审核的版本')).toBeTruthy()
  })
})

describe('M4 审核 diff', () => {
  const item: ReviewItemDto = {
    listing: { ...listing(), listedVersionId: null, listedRevision: null },
    version: detail().versions[0]!,
  }
  const diff: VersionDiffDto = {
    base: { versionId: 'pv3', revision: 3 },
    files: [
      {
        path: 'SKILL.md',
        status: 'modified',
        binary: false,
        before: '标题\n旧的一行\n',
        after: '标题\n新的一行\n',
      },
      { path: 'assets/logo.png', status: 'modified', binary: true, before: null, after: null },
    ],
  }

  it('shows the version against the last approved one, file by file, binaries as changed only', async () => {
    mockApi({
      'GET /market/reviews': [item],
      'GET /market/l1?versionId=pv4': detail(),
      'GET /market/l1/versions/pv4/diff': diff,
    })
    render(<MarketReviewList path="/market/reviews" />)
    fireEvent.click(await screen.findByRole('button', { name: '审核' }))
    const dialog = await screen.findByRole('dialog', { name: '审核 review-pr r4' })
    expect(await within(dialog).findByText('对比 r3 的变更')).toBeTruthy()
    // Word marks split the edited line into spans.
    expect(dialog.textContent).toContain('旧的一行')
    expect(dialog.textContent).toContain('新的一行')
    expect(within(dialog).getByText('assets/logo.png')).toBeTruthy()
    expect(within(dialog).getByText('二进制文件已变化')).toBeTruthy()
  })

  it('says a first version adds every file', async () => {
    mockApi({
      'GET /market/reviews': [item],
      'GET /market/l1?versionId=pv4': detail(),
      'GET /market/l1/versions/pv4/diff': {
        base: null,
        files: [{ path: 'SKILL.md', status: 'added', binary: false, before: null, after: '全新\n' }],
      },
    })
    render(<MarketReviewList path="/market/reviews" />)
    fireEvent.click(await screen.findByRole('button', { name: '审核' }))
    const dialog = await screen.findByRole('dialog', { name: '审核 review-pr r4' })
    expect(await within(dialog).findByText('首个版本，全部为新增')).toBeTruthy()
    expect(dialog.textContent).toContain('全新')
  })
})

describe('M4 封禁', () => {
  const openDetail = async () => {
    renderPage()
    fireEvent.click(await screen.findByRole('button', { name: '查看 review-pr' }))
    return screen.findByRole('dialog', { name: 'review-pr' })
  }

  it('lets a reviewer ban a listing with a reason', async () => {
    const calls = mockApi({
      'GET /market': LISTINGS,
      'GET /market/l1': detail({ canReview: true }),
      'POST /market/l1/ban': {},
    })
    const drawer = await openDetail()
    fireEvent.click(await within(drawer).findByRole('button', { name: '封禁' }))
    const dialog = await screen.findByRole('dialog', { name: '封禁「review-pr」' })
    const ban = within(dialog).getByRole('button', { name: '封禁' }) as HTMLButtonElement
    expect(ban.disabled).toBe(true)
    fireEvent.change(within(dialog).getByRole('textbox', { name: '封禁原因' }), {
      target: { value: '含恶意脚本' },
    })
    expect(ban.disabled).toBe(false)
    fireEvent.click(ban)
    await waitFor(() =>
      expect(calls.find((c) => c.path === '/market/l1/ban')?.body).toEqual({ reason: '含恶意脚本' }),
    )
  })

  it('shows the ban reason and unbans', async () => {
    const calls = mockApi({
      'GET /market': LISTINGS,
      'GET /market/l1': detail({ canReview: true, status: 'banned', banReason: '含恶意脚本' }),
      'DELETE /market/l1/ban': {},
    })
    const drawer = await openDetail()
    expect(await within(drawer).findByText('封禁原因：含恶意脚本')).toBeTruthy()
    expect(within(drawer).queryByRole('button', { name: '引入到…' })).toBeNull()
    fireEvent.click(within(drawer).getByRole('button', { name: '解封' }))
    await waitFor(() =>
      expect(calls.some((c) => c.method === 'DELETE' && c.path === '/market/l1/ban')).toBe(true),
    )
  })

  it('has no ban for a non-reviewer', async () => {
    mockApi({ 'GET /market': LISTINGS, 'GET /market/l1': detail() })
    const drawer = await openDetail()
    await within(drawer).findByRole('button', { name: '引入到…' })
    expect(within(drawer).queryByRole('button', { name: '封禁' })).toBeNull()
  })

  it('shows the ban reason in 我的发布', async () => {
    mockApi({
      'GET /market/mine': [{ ...mine({ status: 'banned', listedVersionId: 'v8' }), banReason: '违规内容' }],
    })
    renderPage('/market?tab=mine')
    const row = (await screen.findByText('deploy-check')).closest('.cfg__item') as HTMLElement
    expect(row.textContent).toContain('已封禁')
    expect(row.textContent).toContain('封禁原因：违规内容')
  })
})

describe('M4 申请引入', () => {
  const open = async () => {
    fireEvent.click(await screen.findByRole('button', { name: '查看 review-pr' }))
    const drawer = await screen.findByRole('dialog', { name: 'review-pr' })
    fireEvent.click(await within(drawer).findByRole('button', { name: '引入到…' }))
    return screen.findByRole('dialog', { name: '引入「review-pr」' })
  }

  it('asks the admins of a group I am only a member of, with a note', async () => {
    const calls = mockApi({
      'GET /market': LISTINGS,
      'GET /market/l1': detail(),
      'GET /teams/t1/repos': [],
      'GET /teams/t2/repos': [],
      'POST /install-requests': {},
    })
    renderPage()
    const dialog = await open()
    fireEvent.click(within(dialog).getByRole('radio', { name: '闲聊群' }))
    expect(within(dialog).queryByRole('button', { name: '引入' })).toBeNull()
    fireEvent.change(within(dialog).getByRole('textbox', { name: '申请说明' }), {
      target: { value: '群里要用' },
    })
    fireEvent.click(within(dialog).getByRole('button', { name: '申请引入' }))
    await waitFor(() =>
      expect(calls.find((c) => c.path === '/install-requests')?.body).toEqual({
        listingId: 'l1',
        scope: 'group',
        scopeId: 'g2',
        pinVersionId: null,
        note: '群里要用',
      }),
    )
    await waitFor(() => expect(screen.queryByRole('dialog', { name: '引入「review-pr」' })).toBeNull())
  })

  it('asks for a team and a repo of a team I am a member of', async () => {
    const repo = { id: 'r2', name: 'ops', key: 'git.example.com/ops' } as RepoDto
    const calls = mockApi({
      'GET /market': LISTINGS,
      'GET /market/l1': detail(),
      'GET /teams/t1/repos': [],
      'GET /teams/t2/repos': [repo],
      'POST /install-requests': {},
    })
    renderPage()
    let dialog = await open()
    const kinds = within(dialog).getByRole('radiogroup', { name: '引入到' })
    fireEvent.click(within(kinds).getByRole('radio', { name: '团队' }))
    fireEvent.click(within(dialog).getByRole('radio', { name: '运营组' }))
    fireEvent.click(within(dialog).getByRole('radio', { name: '锁定当前版本 r3' }))
    fireEvent.click(within(dialog).getByRole('button', { name: '申请引入' }))
    await waitFor(() =>
      expect(calls.find((c) => c.path === '/install-requests')?.body).toEqual({
        listingId: 'l1',
        scope: 'team',
        scopeId: 't2',
        pinVersionId: 'pv3',
        note: '',
      }),
    )
    await waitFor(() => expect(screen.queryByRole('dialog', { name: '引入「review-pr」' })).toBeNull())

    dialog = await open()
    fireEvent.click(
      within(within(dialog).getByRole('radiogroup', { name: '引入到' })).getByRole('radio', { name: '仓库' }),
    )
    fireEvent.click(await within(dialog).findByRole('radio', { name: '运营组 / ops' }))
    fireEvent.click(within(dialog).getByRole('button', { name: '申请引入' }))
    await waitFor(() =>
      expect(calls.filter((c) => c.path === '/install-requests').at(-1)?.body).toMatchObject({
        scope: 'repo',
        scopeId: 'r2',
      }),
    )
  })
})

const request = (o: Partial<InstallRequestDto> = {}): InstallRequestDto => ({
  id: 'q1',
  listing: listing(),
  scope: 'group',
  scopeId: 'g1',
  targetLabel: '支付核心群',
  pinVersionId: null,
  note: '想在群里审 PR',
  status: 'pending',
  requester: '陈晨',
  decidedBy: null,
  decisionNote: null,
  createdAt: '2026-11-03T00:00:00Z',
  decidedAt: null,
  ...o,
})

describe('M4 引入申请 tab', () => {
  it('opens from ?tab=requests: approves or rejects (with a reason) what waits for me', async () => {
    const calls = mockApi({
      'GET /install-requests?view=todo': [request(), request({ id: 'q2', requester: '王磊' })],
      'GET /install-requests?view=mine': [],
      'POST /install-requests/q1/decide': {},
      'POST /install-requests/q2/decide': {},
    })
    renderPage('/market?tab=requests')
    expect(screen.getByRole('tab', { name: '引入申请' }).getAttribute('aria-selected')).toBe('true')
    const todo = await screen.findByRole('region', { name: '待我处理' })
    const first = (await within(todo).findByText(/陈晨/)).closest('.cfg__item') as HTMLElement
    expect(first.textContent).toContain('review-pr')
    expect(first.textContent).toContain('支付核心群')
    expect(first.textContent).toContain('想在群里审 PR')
    fireEvent.click(within(first).getByRole('button', { name: '通过' }))
    await waitFor(() =>
      expect(calls.find((c) => c.path === '/install-requests/q1/decide')?.body).toEqual({
        approve: true,
        note: '',
      }),
    )

    const second = within(todo).getByText(/王磊/).closest('.cfg__item') as HTMLElement
    fireEvent.click(within(second).getByRole('button', { name: '拒绝' }))
    const dialog = await screen.findByRole('dialog', { name: '拒绝引入申请' })
    const reject = within(dialog).getByRole('button', { name: '拒绝' }) as HTMLButtonElement
    expect(reject.disabled).toBe(true)
    fireEvent.change(within(dialog).getByRole('textbox', { name: '拒绝原因' }), {
      target: { value: '已有同类' },
    })
    fireEvent.click(reject)
    await waitFor(() =>
      expect(calls.find((c) => c.path === '/install-requests/q2/decide')?.body).toEqual({
        approve: false,
        note: '已有同类',
      }),
    )
  })

  it('lists my requests with status and result, and withdraws a pending one', async () => {
    const calls = mockApi({
      'GET /install-requests?view=todo': [],
      'GET /install-requests?view=mine': [
        request(),
        request({ id: 'q3', targetLabel: '闲聊群', status: 'rejected', decisionNote: '已有同类' }),
      ],
      'DELETE /install-requests/q1': undefined,
    })
    renderPage('/market?tab=requests')
    expect(await screen.findByText('没有待你处理的申请')).toBeTruthy()
    const mineList = await screen.findByRole('region', { name: '我的申请' })
    const rejected = within(mineList)
      .getByText(/闲聊群/)
      .closest('.cfg__item') as HTMLElement
    expect(rejected.textContent).toContain('已拒绝')
    expect(rejected.textContent).toContain('已有同类')
    expect(within(rejected).queryByRole('button', { name: '撤回' })).toBeNull()
    const pending = within(mineList)
      .getByText(/支付核心群/)
      .closest('.cfg__item') as HTMLElement
    expect(pending.textContent).toContain('待处理')
    fireEvent.click(within(pending).getByRole('button', { name: '撤回' }))
    await waitFor(() =>
      expect(calls.some((c) => c.method === 'DELETE' && c.path === '/install-requests/q1')).toBe(true),
    )
  })

  it('opens 我的发布 from ?tab=mine', async () => {
    const calls = mockApi({ 'GET /market/mine': [] })
    renderPage('/market?tab=mine')
    expect(await screen.findByText('还没有发布过 Skill 或插件')).toBeTruthy()
    expect(calls.some((c) => c.path === '/market')).toBe(false)
  })
})
