import type {
  GroupDto,
  MarketListingDetailDto,
  MarketListingDto,
  MyListingDto,
  PublishRes,
  RepoDto,
  ReviewItemDto,
  TeamDto,
  UserDto,
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
    render(<MarketPage />)
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
    render(<MarketPage />)
    fireEvent.click(await screen.findByRole('button', { name: '查看 review-pr' }))
    const drawer = await screen.findByRole('dialog', { name: 'review-pr' })
    expect(await within(drawer).findByRole('heading', { name: '审查 PR' })).toBeTruthy()
    expect(within(drawer).getByText('scripts/run.sh')).toBeTruthy()
    expect(within(drawer).getByText('支持 monorepo')).toBeTruthy()
    expect(within(drawer).getByText('首个版本')).toBeTruthy()
    expect(within(drawer).getByText('待审核')).toBeTruthy()
    expect(within(drawer).getByText('已通过')).toBeTruthy()
    const gh = within(drawer).getByRole('link', { name: /github\.com\/acme\/skills/ })
    expect(gh.getAttribute('href')).toBe('https://github.com/acme/skills')
    expect(within(drawer).getByText(/abc1234/)).toBeTruthy()
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

  it('lists only groups and teams I administer and their repos; follows latest or pins the listed version', async () => {
    const calls = mockApi({
      'GET /market': LISTINGS,
      'GET /market/l1': detail(),
      'GET /teams/t1/repos': [repo],
      'PUT /groups/g1/installs/l1': {},
      'PUT /teams/t1/installs/l1': {},
      'PUT /teams/t1/repos/r1/installs/l1': {},
    })
    render(<MarketPage />)
    let dialog = await open()
    expect(within(dialog).getByRole('radio', { name: '支付核心群' })).toBeTruthy()
    expect(within(dialog).queryByRole('radio', { name: '闲聊群' })).toBeNull()
    expect(calls.some((c) => c.path === '/teams/t2/repos')).toBe(false)
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
    expect(within(dialog).queryByRole('radio', { name: '运营组' })).toBeNull()
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
    render(<MarketPage />)
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
    render(<MarketPage />)
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
    render(<MarketPage />)
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
  ...o,
})

describe('我的发布', () => {
  const openMine = async () => {
    render(<MarketPage />)
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
