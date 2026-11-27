import type {
  ArtifactCard,
  BotDto,
  GroupDto,
  TeamDto,
  UserDto,
  WorkDto,
  WorkGroupDto,
} from '@gonggong/protocol'
import { fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import { MemoryRouter, Route, Routes, useLocation } from 'react-router'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { AppRail } from '../src/app/AppRail'
import { AppShell } from '../src/app/AppShell'
import { useSession } from '../src/app/session'
import { useWorkspace } from '../src/app/workspace'
import { ArtifactCardView } from '../src/features/artifacts/ArtifactCard'
import { resetWorks, WorksPage } from '../src/features/works/WorksPage'
import { mockApi } from './mockApi'

vi.mock('../src/features/artifacts/ArtifactTab', async (importOriginal) => {
  const { useArtifactPage } = await import('../src/features/artifacts/host')
  const { useArtifact } = await import('../src/features/artifacts/store')
  return {
    ...(await importOriginal<typeof import('../src/features/artifacts/ArtifactTab')>()),
    ArtifactTab: ({ tab }: { tab: { artifactId: string } }) => {
      const page = useArtifactPage()
      const a = useArtifact(tab.artifactId)?.artifact
      return (
        <div>
          {page?.back ? (
            <button type="button" aria-label="返回作品" onClick={page.back}>
              作品
            </button>
          ) : null}
          {page?.onShareToGroup ? (
            <button type="button" disabled={!a} onClick={page.onShareToGroup}>
              发送到群
            </button>
          ) : null}
          <div data-testid="editor">{tab.artifactId}</div>
        </div>
      )
    },
  }
})

const me = { id: 'u1', name: '姜维川', role: 'member' } as UserDto

const team = (o: Partial<TeamDto> = {}): TeamDto => ({
  id: 't1',
  name: '产品研发团队',
  avatar: null,
  role: 'member',
  archivedAt: null,
  createdAt: '2026-01-01T00:00:00Z',
  unread: 0,
  ...o,
})

const work = (o: Partial<WorkDto>): WorkDto => ({
  id: 'a1',
  groupId: 'g1',
  groupTitle: '麓客产品群',
  groupKind: 'group',
  groupVisibility: 'private',
  title: '湖畔露营地预约',
  pluginTitle: '产品原型',
  site: false,
  type: 'prototype',
  createdAt: '2026-10-30T05:28:00.000Z',
  visibility: 'group',
  createdBy: 'u1',
  creatorName: '姜维川',
  thumbnailUrl: '/api/artifacts/a1/versions/v1/thumbnail',
  updatedAt: '2026-10-31T05:28:00.000Z',
  access: 'edit',
  ...o,
})
const WORKS = [
  work({}),
  work({
    id: 'a3',
    groupId: 'g4',
    groupTitle: '',
    groupKind: 'dm',
    groupVisibility: 'private',
    title: '品牌官网',
    site: true,
    pluginTitle: null,
    visibility: 'team',
    createdBy: 'u3',
    creatorName: '王芳',
    access: 'view',
  }),
  work({
    id: 'a2',
    groupId: 'g2',
    groupTitle: '运营群',
    groupKind: 'group',
    groupVisibility: 'public',
    title: '双十一活动汇报',
    pluginTitle: '幻灯片',
    visibility: 'team',
    createdBy: 'u2',
    creatorName: '李建国',
    thumbnailUrl: null,
    access: 'view',
  }),
]
const GROUPS: WorkGroupDto[] = [
  { id: 'g1', title: '麓客产品群', kind: 'group' },
  { id: 'g3', title: '设计群', kind: 'group' },
]

function Where() {
  const l = useLocation()
  return <div data-testid="where">{l.pathname + l.search}</div>
}

const renderAt = (path: string) =>
  render(
    <MemoryRouter initialEntries={[path]}>
      <Routes>
        <Route element={<AppShell />}>
          <Route path="works" element={<WorksPage />} />
          <Route path="works/:artifactId" element={<WorksPage />} />
          <Route
            path="*"
            element={
              <>
                <AppRail />
                <Where />
              </>
            }
          />
        </Route>
      </Routes>
      <Where />
    </MemoryRouter>,
  )

beforeEach(() => {
  localStorage.clear()
  localStorage.setItem('gg.locale', 'zh')
  useSession.setState({ user: me, tenancy: null, status: 'ready' })
  useWorkspace.setState({ notifCount: 0, groups: [] })
  resetWorks()
})
afterEach(() => vi.unstubAllGlobals())

const where = () => screen.getAllByTestId('where').map((x) => x.textContent)

describe('作品 in the app rail', () => {
  it('shows once one of my groups has a creation plugin on, and opens 作品', async () => {
    mockApi({ 'GET /works/groups': GROUPS })
    renderAt('/')
    fireEvent.click(await screen.findByRole('button', { name: '作品' }))
    await waitFor(() => expect(where()).toContain('/works'))
  })

  it('stays hidden without one, unless a work is shared with me', async () => {
    const calls = mockApi({ 'GET /works/groups': [], 'GET /works': [] })
    const { unmount } = renderAt('/')
    await waitFor(() => expect(calls.some((c) => c.path === '/works')).toBe(true))
    expect(screen.queryByRole('button', { name: '作品' })).toBeNull()
    unmount()
    resetWorks()
    mockApi({
      'GET /works/groups': [],
      'GET /works': [work({ visibility: 'team', access: 'view', createdBy: 'u2' })],
    })
    renderAt('/')
    expect(await screen.findByRole('button', { name: '作品' })).toBeTruthy()
  })
})

describe('作品 page', () => {
  it('lists what I may open, masks shared DM source, and filters it', async () => {
    mockApi({ 'GET /works/groups': GROUPS, 'GET /works': WORKS })
    renderAt('/works')
    const grid = await screen.findByRole('list', { name: '作品' })
    expect(
      within(grid)
        .getAllByRole('listitem')
        .map((x) => x.textContent),
    ).toEqual([
      expect.stringContaining('湖畔露营地预约'),
      expect.stringContaining('品牌官网'),
      expect.stringContaining('双十一活动汇报'),
    ])
    expect(within(grid).getAllByRole('listitem')[1]!.querySelector('.works__source')?.textContent).toBe(
      '私聊',
    )
    expect(
      within(grid).getAllByRole('listitem')[1]!.querySelector('.works__badge--creator')?.textContent,
    ).toBe('王芳')
    expect(within(grid).getAllByRole('listitem')[1]!.textContent).toContain('团队可见')
    expect(within(grid).getAllByRole('listitem')[2]!.textContent).toContain('团队可见')
    expect(within(grid).getAllByRole('listitem')[2]!.textContent).toContain('只读')

    fireEvent.click(screen.getByRole('radio', { name: '我创建的' }))
    expect(within(grid).getAllByRole('listitem')).toHaveLength(1)
    fireEvent.click(screen.getByRole('radio', { name: '团队共享' }))
    expect(
      within(grid)
        .getAllByRole('listitem')
        .map((x) => x.textContent),
    ).toEqual([expect.stringContaining('品牌官网'), expect.stringContaining('双十一活动汇报')])
    fireEvent.click(screen.getByRole('radio', { name: '全部' }))
    fireEvent.change(screen.getByRole('searchbox', { name: '搜索作品' }), { target: { value: '露营' } })
    expect(within(grid).getAllByRole('listitem')).toHaveLength(1)
  })

  it('shows TeamSwitcher in multi-team mode and keeps /works when switching teams', async () => {
    const assign = vi.fn()
    vi.stubGlobal('location', { ...window.location, assign })
    localStorage.setItem('gg.team', 't1')
    useSession.setState({
      user: me,
      tenancy: {
        teams: [team(), team({ id: 't2', name: '设计团队' })],
        singleTeamMode: false,
        canCreateTeam: false,
        demoMode: false,
        pluginsEnabled: true,
      },
      status: 'ready',
    })
    mockApi({ 'GET /works/groups': GROUPS, 'GET /works': WORKS })
    renderAt('/works')
    fireEvent.click(await screen.findByRole('button', { name: '切换团队，当前：产品研发团队' }))
    fireEvent.click(within(screen.getByRole('menu')).getByText('设计团队'))
    expect(localStorage.getItem('gg.team')).toBe('t2')
    expect(assign).toHaveBeenCalledWith('/works')
  })

  it('shows 仅自己可见 for my own DM work with legacy group visibility and accurate empty state for 团队共享', async () => {
    mockApi({
      'GET /works/groups': GROUPS,
      'GET /works': [
        work({
          id: 'dm1',
          groupId: 'g-dm',
          groupTitle: '小王的 Claude',
          groupKind: 'dm',
          visibility: 'group',
          access: 'edit',
        }),
      ],
    })
    renderAt('/works')
    const grid = await screen.findByRole('list', { name: '作品' })
    expect(within(grid).getByRole('listitem').textContent).toContain('仅自己可见')
    fireEvent.click(screen.getByRole('radio', { name: '团队共享' }))
    expect(screen.getByText('还没有团队共享的作品')).toBeTruthy()
    expect(screen.getByText('团队内设为「团队可见」的作品会出现在这里')).toBeTruthy()
  })

  it('splits works by type in the sidebar, sorts by creation and shows a list layout', async () => {
    localStorage.removeItem('gg.works.layout')
    mockApi({
      'GET /works/groups': GROUPS,
      'GET /works': [
        work({
          id: 'a1',
          title: '露营原型',
          updatedAt: '2026-10-31T05:00:00.000Z',
          createdAt: '2026-10-01T00:00:00.000Z',
        }),
        work({
          id: 'a2',
          title: '季度汇报',
          type: 'slides',
          updatedAt: '2026-10-30T05:00:00.000Z',
          createdAt: '2026-10-20T00:00:00.000Z',
        }),
        work({ id: 'a3', title: '官网', type: 'site', site: true, createdAt: '2026-10-10T00:00:00.000Z' }),
        work({ id: 'a4', title: '流程白板', type: 'whiteboard', createdAt: '2026-10-05T00:00:00.000Z' }),
      ],
    })
    renderAt('/works')
    const nav = await screen.findByRole('navigation', { name: '作品分类' })
    const rows = () =>
      within(screen.getByRole('list', { name: '作品' }))
        .getAllByRole('listitem')
        .map((li) => li.textContent)
    expect(within(nav).getByText('白板')).toBeTruthy()
    expect(within(nav).queryByText('动效')).toBeNull()
    fireEvent.click(within(nav).getByText('幻灯片'))
    expect(rows()).toHaveLength(1)
    expect(rows()[0]).toContain('季度汇报')
    fireEvent.click(within(nav).getByText('全部作品'))
    fireEvent.click(screen.getByRole('button', { name: '排序' }))
    fireEvent.click(await screen.findByRole('menuitemcheckbox', { name: '最近创建' }))
    expect(rows().map((r) => r?.match(/露营原型|季度汇报|官网|流程白板/)?.[0])).toEqual([
      '季度汇报',
      '官网',
      '流程白板',
      '露营原型',
    ])
    fireEvent.click(screen.getByRole('radio', { name: '列表' }))
    expect(document.querySelector('.works__list')).toBeTruthy()
    expect(localStorage.getItem('gg.works.layout')).toBe('list')
    localStorage.removeItem('gg.works.layout')
  })

  it('tags a hosted site as such', async () => {
    mockApi({
      'GET /works/groups': GROUPS,
      'GET /works': [work({ pluginTitle: null, site: true, title: '活动官网' })],
    })
    renderAt('/works')
    const grid = await screen.findByRole('list', { name: '作品' })
    expect(within(grid).getByRole('listitem').textContent).toContain('托管网页')
  })

  it('shows the creator over the cover and the relative time inside .works__meta', async () => {
    mockApi({
      'GET /works/groups': GROUPS,
      'GET /works': [
        work({ id: 'a1', title: '活动官网', groupTitle: '麓客产品群', creatorName: '姜维川', site: true }),
        work({ id: 'a2', title: '无来源作品', groupTitle: '', creatorName: null }),
      ],
    })
    renderAt('/works')
    const grid = await screen.findByRole('list', { name: '作品' })
    const items = within(grid).getAllByRole('listitem')
    const meta0 = items[0]!.querySelector('.works__meta')!
    expect(meta0.querySelector('.works__source')?.textContent).toBe('麓客产品群')
    expect(items[0]!.querySelector('.works__shot .works__badge--creator')?.textContent).toBe('姜维川')
    expect(items[1]!.querySelector('.works__badge--creator')).toBeNull()
    expect(meta0.querySelector('.works__sep')?.textContent).toBe('·')
    expect(meta0.querySelector('time.works__time')?.getAttribute('datetime')).toBe('2026-10-31T05:28:00.000Z')
    expect(items[0]!.querySelector('.works__tags time')).toBeNull()

    const meta1 = items[1]!.querySelector('.works__meta')!
    expect(meta1.querySelector('.works__source')).toBeNull()
    expect(meta1.querySelector('.works__sep')).toBeNull()
    expect(meta1.querySelector('time.works__time')).toBeTruthy()
  })

  it('filters by source (including grouped shared DMs), sorts by name and clears filters from the empty state', async () => {
    mockApi({ 'GET /works/groups': GROUPS, 'GET /works': [...WORKS].reverse() })
    renderAt('/works')
    const grid = await screen.findByRole('list', { name: '作品' })
    fireEvent.click(screen.getByRole('button', { name: '来源' }))
    fireEvent.click(await screen.findByRole('menuitemcheckbox', { name: '来自私聊' }))
    expect(
      within(grid)
        .getAllByRole('listitem')
        .map((x) => x.textContent),
    ).toEqual([expect.stringContaining('品牌官网')])
    fireEvent.click(screen.getByRole('button', { name: '来源' }))
    fireEvent.click(await screen.findByRole('menuitemcheckbox', { name: '运营群' }))
    expect(
      within(grid)
        .getAllByRole('listitem')
        .map((x) => x.textContent),
    ).toEqual([expect.stringContaining('双十一活动汇报')])
    fireEvent.change(screen.getByRole('searchbox', { name: '搜索作品' }), { target: { value: '露营' } })
    expect(screen.getByText('没有找到「露营」相关作品')).toBeTruthy()
    fireEvent.click(screen.getByRole('button', { name: '清除筛选' }))
    fireEvent.click(screen.getByRole('button', { name: '排序' }))
    fireEvent.click(await screen.findByRole('menuitemcheckbox', { name: '按名称' }))
    expect(
      within(await screen.findByRole('list', { name: '作品' }))
        .getAllByRole('listitem')
        .map((x) => x.textContent),
    ).toEqual([
      expect.stringContaining('湖畔露营地预约'),
      expect.stringContaining('品牌官网'),
      expect.stringContaining('双十一活动汇报'),
    ])
  })

  it('opens an editable one in its editor after joining, and tailors read-only viewer notes for public/private groups and DMs', async () => {
    let joined = false
    const privateGroupWork = work({
      id: 'a4',
      groupId: 'g5',
      groupTitle: '核心架构群',
      groupKind: 'group',
      groupVisibility: 'private',
      title: '架构图',
      visibility: 'team',
      createdBy: 'u2',
      creatorName: '李建国',
      access: 'view',
    })
    const calls = mockApi({
      'GET /works/groups': GROUPS,
      'GET /works': () =>
        [...WORKS, privateGroupWork].map((w) => (joined && w.id === 'a2' ? { ...w, access: 'edit' } : w)),
      'POST /artifacts/a2/preview': {
        previewId: 'p2',
        origin: 'https://p2.preview.test',
        url: '/api/previews/p2/open',
      },
      'POST /artifacts/a3/preview': {
        previewId: 'p3',
        origin: 'https://p3.preview.test',
        url: '/api/previews/p3/open',
      },
      'POST /artifacts/a4/preview': {
        previewId: 'p4',
        origin: 'https://p4.preview.test',
        url: '/api/previews/p4/open',
      },
      'POST /groups/g2/join': () => {
        joined = true
        return {
          id: 'g2',
          name: '运营群',
          members: [],
          unread: 0,
          mentionCount: 0,
          liveRuns: [],
        } as unknown as GroupDto
      },
    })
    renderAt('/works')
    // Public group: shows public-group note and 加入群并编辑 button.
    fireEvent.click(await screen.findByRole('button', { name: '打开 双十一活动汇报' }))
    await waitFor(() => expect(where()).toContain('/works/a2'))
    const frame = (await screen.findByTitle('双十一活动汇报')) as HTMLIFrameElement
    expect(frame.getAttribute('src')).toBe('/api/previews/p2/open')
    expect(screen.getByText('只读 · 来自公开群「运营群」，加入后可修改')).toBeTruthy()
    expect(calls.filter((c) => c.path === '/artifacts/a2/preview')).toHaveLength(1)

    // Shared DM: hides original DM title and offers no join button.
    fireEvent.click(screen.getByRole('button', { name: '返回作品' }))
    fireEvent.click(await screen.findByRole('button', { name: '打开 品牌官网' }))
    await screen.findByTitle('品牌官网')
    expect(screen.getByText('只读 · 来自 王芳 的私聊')).toBeTruthy()
    expect(screen.queryByRole('button', { name: '加入群并编辑' })).toBeNull()

    // Private group: states only group members can change, offers no join button.
    fireEvent.click(screen.getByRole('button', { name: '返回作品' }))
    fireEvent.click(await screen.findByRole('button', { name: '打开 架构图' }))
    await screen.findByTitle('架构图')
    expect(screen.getByText('只读 · 来自「核心架构群」（仅群成员可修改）')).toBeTruthy()
    expect(screen.queryByRole('button', { name: '加入群并编辑' })).toBeNull()

    // Public group join-and-edit joins the group and opens the work's editor on the same page.
    fireEvent.click(screen.getByRole('button', { name: '返回作品' }))
    fireEvent.click(await screen.findByRole('button', { name: '打开 双十一活动汇报' }))
    fireEvent.click(await screen.findByRole('button', { name: '加入群并编辑' }))
    await waitFor(() =>
      expect(calls.some((c) => c.method === 'POST' && c.path === '/groups/g2/join')).toBe(true),
    )
    expect((await screen.findByTestId('editor')).textContent).toBe('a2')
    expect(where()).toContain('/works/a2')
  })

  it('opens an editable work straight in its editor, without its group chat', async () => {
    mockApi({ 'GET /works/groups': GROUPS, 'GET /works': WORKS })
    renderAt('/works')
    fireEvent.click(await screen.findByRole('button', { name: '打开 湖畔露营地预约' }))
    expect((await screen.findByTestId('editor')).textContent).toBe('a1')
    expect(where()).toContain('/works/a1')
    fireEvent.click(screen.getByRole('button', { name: '返回作品' }))
    await screen.findByRole('button', { name: '打开 湖畔露营地预约' })
  })

  it('shares an editable work into a group chat, widening it to the team for another group', async () => {
    useWorkspace.setState({
      groups: [
        { id: 'g1', name: '麓客产品群', kind: 'group', members: [] },
        { id: 'g3', name: '设计群', kind: 'group', members: [] },
      ] as unknown as GroupDto[],
    })
    const calls = mockApi({
      'GET /works/groups': GROUPS,
      'GET /works': WORKS,
      'GET /artifacts/a1': {
        id: 'a1',
        groupId: 'g1',
        title: '湖畔露营地预约',
        createdBy: 'u1',
        visibility: 'group',
      },
      'GET /artifacts/a1/versions': [],
      'PUT /artifacts/a1/visibility': {
        id: 'a1',
        groupId: 'g1',
        title: '湖畔露营地预约',
        visibility: 'team',
      },
      'POST /artifacts/a1/post': undefined,
    })
    renderAt('/works/a1')
    const share = await screen.findByRole('button', { name: '发送到群' })
    await waitFor(() => expect((share as HTMLButtonElement).disabled).toBe(false))
    fireEvent.click(share)
    const dialog = await screen.findByRole('dialog')
    fireEvent.click(within(dialog).getByRole('button', { name: '发送到' }))
    expect(screen.getAllByRole('menuitemcheckbox').map((o) => o.textContent)).toEqual([
      '麓客产品群（作品所在群）',
      '设计群',
    ])
    fireEvent.click(screen.getByRole('menuitemcheckbox', { name: '设计群' }))
    expect(within(dialog).getByText(/会把作品设为「团队可见」/)).toBeTruthy()
    fireEvent.click(within(dialog).getByRole('button', { name: '发送' }))
    await waitFor(() =>
      expect(calls.find((c) => c.method === 'POST' && c.path === '/artifacts/a1/post')?.body).toEqual({
        groupId: 'g3',
      }),
    )
    expect(calls.find((c) => c.method === 'PUT')?.body).toEqual({ visibility: 'team' })
  })

  it('switches teams when opening /works/:id belonging to another of my teams', async () => {
    const assign = vi.fn()
    vi.stubGlobal('location', { ...window.location, assign })
    localStorage.setItem('gg.team', 't1')
    mockApi({
      'GET /works/groups': GROUPS,
      'GET /works': [],
      'GET /artifacts/a9': {
        id: 'a9',
        groupId: 'g9',
        teamId: 't2',
        access: 'view',
      },
    })
    renderAt('/works/a9')
    await waitFor(() => expect(assign).toHaveBeenCalledWith('/works/a9'))
    expect(localStorage.getItem('gg.team')).toBe('t2')
  })

  const STARTERS = [
    { type: 'prototype', pluginId: 'p1', pluginTitle: '产品原型', templates: [] },
    {
      type: 'slides',
      pluginId: 'p2',
      pluginTitle: '幻灯片',
      templates: [
        { id: 'html-ppt', title: '演示工作室', description: '', group: '通用', preview: null },
        { id: 'weekly', title: '数据周报', description: '', group: '汇报', preview: null },
      ],
    },
  ]

  it('新建 asks the type, then opens an empty prototype on its canvas with the last AI picked there', async () => {
    const bot = (id: string, name: string) => ({ id, name }) as BotDto
    useWorkspace.setState({
      bots: [bot('b1', '蒋庆的 Codex'), bot('b2', '姜维川的 Claude Code'), bot('b3', '共字君')],
    })
    localStorage.setItem('gg.works.newBot', 'b2')
    const calls = mockApi({
      'GET /works/groups': GROUPS,
      'GET /works': [],
      'GET /works/starters': STARTERS,
      'POST /works': { artifactId: 'a9' },
    })
    renderAt('/works')
    fireEvent.click(await screen.findByRole('button', { name: '新建' }))
    const dialog = await screen.findByRole('dialog', { name: '新建作品' })
    expect(
      within(dialog)
        .getByRole('radio', { name: /产品原型/ })
        .getAttribute('aria-checked'),
    ).toBe('true')
    fireEvent.click(await within(dialog).findByRole('button', { name: '创建' }))
    await waitFor(() => expect(where()).toContain('/works/a9'))
    expect(calls.find((c) => c.method === 'POST')).toMatchObject({
      path: '/works',
      body: { botId: 'b2', type: 'prototype' },
    })
    expect(localStorage.getItem('gg.canvasBot.a9')).toBe('b2')
  })

  it('新建 幻灯片 starts from the picked template, with the first AI open for works', async () => {
    const bot = (id: string, name: string) => ({ id, name }) as BotDto
    useWorkspace.setState({ bots: [bot('b1', '蒋庆的 Codex'), bot('b3', '共字君')] })
    const calls = mockApi({
      'GET /works/groups': GROUPS,
      'GET /works': [],
      'GET /works/starters': STARTERS,
      'POST /works': { artifactId: 'a9' },
    })
    renderAt('/works')
    fireEvent.click(await screen.findByRole('button', { name: '新建' }))
    const dialog = await screen.findByRole('dialog', { name: '新建作品' })
    fireEvent.click(within(dialog).getByRole('radio', { name: /幻灯片/ }))
    fireEvent.click(await within(dialog).findByRole('button', { name: '数据周报' }))
    fireEvent.click(within(dialog).getByRole('button', { name: '创建' }))
    await waitFor(() => expect(where()).toContain('/works/a9'))
    expect(calls.find((c) => c.method === 'POST')?.body).toEqual({
      botId: 'b3',
      type: 'slides',
      templateId: 'weekly',
    })
  })

  it('新建 网页 explains hosting from a preview instead of creating', async () => {
    mockApi({ 'GET /works/groups': GROUPS, 'GET /works': [], 'GET /works/starters': STARTERS })
    renderAt('/works')
    fireEvent.click(await screen.findByRole('button', { name: '新建' }))
    const dialog = await screen.findByRole('dialog', { name: '新建作品' })
    fireEvent.click(within(dialog).getByRole('radio', { name: /网页/ }))
    expect(within(dialog).getByText('点预览卡上的「托管到服务器」')).toBeTruthy()
    expect(within(dialog).queryByRole('button', { name: '创建' })).toBeNull()
  })

  it('says so when neither AI is in the team', async () => {
    useWorkspace.setState({ bots: [] })
    const calls = mockApi({ 'GET /works/groups': GROUPS, 'GET /works': [], 'GET /works/starters': STARTERS })
    renderAt('/works')
    fireEvent.click(await screen.findByRole('button', { name: '新建' }))
    fireEvent.click(await within(await screen.findByRole('dialog')).findByRole('button', { name: '创建' }))
    expect(await screen.findByText('当前团队暂无可用于创作作品的 Bot')).toBeTruthy()
    expect(calls.some((c) => c.method === 'POST')).toBe(false)
  })
})

describe('a private artifact card', () => {
  const card: ArtifactCard = {
    type: 'artifact',
    artifactId: 'a1',
    title: '湖畔露营地预约',
    versionN: 1,
    status: 'ready',
    thumbnailUrl: '/api/artifacts/a1/versions/v1/thumbnail',
    issueCount: 0,
    visibility: 'private',
    createdBy: 'u2',
  }
  it('hides its shot from other members and says why', () => {
    render(<ArtifactCardView card={card} groupId="g1" />)
    expect(screen.queryByRole('img')).toBeNull()
    expect(screen.getByText('仅创建人可见')).toBeTruthy()
  })
  it('stays as it is for its creator', () => {
    render(<ArtifactCardView card={{ ...card, createdBy: 'u1' }} groupId="g1" />)
    expect(screen.getByRole('img')).toBeTruthy()
    expect(screen.getByText('仅自己可见')).toBeTruthy()
  })
})

describe('作品 page loading', () => {
  it('shows placeholder cards in the grid until the works arrive, then staggers them in', async () => {
    let release = () => {}
    const held = new Promise<void>((r) => {
      release = r
    })
    mockApi({
      'GET /works/groups': GROUPS,
      'GET /works': async () => {
        await held
        return WORKS
      },
    })
    renderAt('/works')
    expect(screen.getByRole('status', { name: '加载中' }).classList.contains('works__grid')).toBe(true)
    release()
    const grid = await screen.findByRole('list', { name: '作品' })
    expect(within(grid).getAllByRole('listitem')[2]!.style.getPropertyValue('--i')).toBe('2')
    expect(screen.queryByRole('status', { name: '加载中' })).toBeNull()
  })
})
