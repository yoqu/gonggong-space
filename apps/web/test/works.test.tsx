import type { ArtifactCard, UserDto, WorkDto } from '@gonggong/protocol'
import { fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import { MemoryRouter, Route, Routes, useLocation } from 'react-router'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { AppRail } from '../src/app/AppRail'
import { AppShell } from '../src/app/AppShell'
import { useSession } from '../src/app/session'
import { useWorkspace } from '../src/app/workspace'
import { ArtifactCardView } from '../src/features/artifacts/ArtifactCard'
import { useCreation } from '../src/features/plugins/store'
import { resetWorks, WorksPage } from '../src/features/works/WorksPage'
import { mockApi } from './mockApi'

const me = { id: 'u1', name: '姜维川', role: 'member' } as UserDto

const work = (o: Partial<WorkDto>): WorkDto => ({
  id: 'a1',
  groupId: 'g1',
  groupTitle: '麓客产品群',
  title: '湖畔露营地预约',
  pluginTitle: '产品原型',
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
    groupTitle: '市场群',
    title: '品牌官网',
    visibility: 'all',
    createdBy: 'u3',
    creatorName: '王芳',
    access: 'view',
  }),
  work({
    id: 'a2',
    groupId: 'g2',
    groupTitle: '运营群',
    title: '双十一活动汇报',
    pluginTitle: '幻灯片',
    visibility: 'team',
    createdBy: 'u2',
    creatorName: '李建国',
    thumbnailUrl: null,
    access: 'view',
  }),
]
const GROUPS = [
  { id: 'g1', title: '麓客产品群' },
  { id: 'g3', title: '设计群' },
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
  useSession.setState({ user: me, status: 'ready' })
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
      'GET /works': [work({ visibility: 'all', access: 'view', createdBy: 'u2' })],
    })
    renderAt('/')
    expect(await screen.findByRole('button', { name: '作品' })).toBeTruthy()
  })
})

describe('作品 page', () => {
  it('lists what I may open and filters it', async () => {
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
    expect(within(grid).getAllByRole('listitem')[1]!.textContent).toContain('全员可见')
    expect(within(grid).getAllByRole('listitem')[2]!.textContent).toContain('团队可见')
    expect(within(grid).getAllByRole('listitem')[2]!.textContent).toContain('只读')

    fireEvent.click(screen.getByRole('radio', { name: '我创建的' }))
    expect(within(grid).getAllByRole('listitem')).toHaveLength(1)
    fireEvent.click(screen.getByRole('radio', { name: '已共享' }))
    expect(
      within(grid)
        .getAllByRole('listitem')
        .map((x) => x.textContent),
    ).toEqual([expect.stringContaining('品牌官网'), expect.stringContaining('双十一活动汇报')])
    fireEvent.click(screen.getByRole('radio', { name: '全部' }))
    fireEvent.change(screen.getByRole('searchbox', { name: '搜索作品' }), { target: { value: '露营' } })
    expect(within(grid).getAllByRole('listitem')).toHaveLength(1)
  })

  it('filters by group, sorts by name and clears filters from the empty state', async () => {
    mockApi({ 'GET /works/groups': GROUPS, 'GET /works': [...WORKS].reverse() })
    renderAt('/works')
    const grid = await screen.findByRole('list', { name: '作品' })
    fireEvent.click(screen.getByRole('button', { name: '来自群' }))
    fireEvent.click(await screen.findByRole('menuitemcheckbox', { name: '运营群' }))
    expect(
      within(grid)
        .getAllByRole('listitem')
        .map((x) => x.textContent),
    ).toEqual([expect.stringContaining('双十一活动汇报')])
    fireEvent.change(screen.getByRole('searchbox', { name: '搜索作品' }), { target: { value: '露营' } })
    expect(screen.getByText('没有符合条件的作品')).toBeTruthy()
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

  it('opens an editable one in its group, a read-only one in the viewer', async () => {
    const calls = mockApi({
      'GET /works/groups': GROUPS,
      'GET /works': WORKS,
      'POST /artifacts/a2/preview': {
        previewId: 'p2',
        origin: 'https://p2.preview.test',
        url: '/api/previews/p2/open',
      },
    })
    renderAt('/works')
    fireEvent.click(await screen.findByRole('button', { name: '打开 双十一活动汇报' }))
    await waitFor(() => expect(where()).toContain('/works/a2'))
    const frame = (await screen.findByTitle('双十一活动汇报')) as HTMLIFrameElement
    expect(frame.getAttribute('src')).toBe('/api/previews/p2/open')
    expect(screen.getByText('只读 · 进入「运营群」后可修改')).toBeTruthy()
    expect(calls.filter((c) => c.path === '/artifacts/a2/preview')).toHaveLength(1)

    fireEvent.click(screen.getByRole('button', { name: '返回作品' }))
    fireEvent.click(await screen.findByRole('button', { name: '打开 湖畔露营地预约' }))
    await waitFor(() => expect(where()).toContain('/g/g1?artifact=a1'))
  })

  it('starts a new creation in a group I pick: creation stays in the chat', async () => {
    mockApi({ 'GET /works/groups': GROUPS, 'GET /works': [] })
    renderAt('/works')
    await screen.findByText('还没有作品')
    fireEvent.click(screen.getByRole('button', { name: '新建' }))
    fireEvent.click(await screen.findByRole('menuitem', { name: '设计群' }))
    await waitFor(() => expect(where()).toContain('/g/g3'))
    expect(useCreation.getState().open).toEqual({ groupId: 'g3' })
  })

  it('explains how to turn creation on when no group has a creation plugin, with a way to the market', async () => {
    mockApi({ 'GET /works/groups': [], 'GET /works': WORKS })
    renderAt('/works')
    await screen.findByText('湖畔露营地预约')
    fireEvent.click(screen.getByRole('button', { name: '新建' }))
    const dialog = await screen.findByRole('dialog', { name: '还没有开启创作插件的群' })
    expect(within(dialog).getByText(/群管理员在「群设置 · 插件」里开启/)).toBeTruthy()
    fireEvent.click(within(dialog).getByRole('button', { name: '去市场找插件' }))
    await waitFor(() => expect(where()).toContain('/market'))
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
