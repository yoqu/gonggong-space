import type { ArtifactEditOp, ArtifactHistoryItem, GgArtifactManifest } from '@gonggong/protocol'
import { fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import { MemoryRouter } from 'react-router'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { PageRail } from '../src/features/artifacts/PageRail'
import { addGroup, deleteGroup, moveGroup, moveScreen, pageTree } from '../src/features/artifacts/pageTree'
import { mockApi } from './mockApi'

// The canvas's left rail: 多级分类 page list and 命令记录.

const sc = (id: string, title: string, group?: string) => ({
  id,
  title,
  file: `screens/${id}.html`,
  ...(group && { group }),
})
const M: GgArtifactManifest = {
  title: '外卖',
  device: 'mobile',
  entry: 'home',
  groups: [
    { id: 'order', title: '下单' },
    { id: 'pay', title: '支付', parent: 'order' },
  ],
  screens: [
    sc('home', '首页'),
    sc('cart', '购物车', 'order'),
    sc('paid', '支付成功', 'pay'),
    sc('me', '我的'),
  ],
}

afterEach(() => {
  vi.unstubAllGlobals()
  vi.restoreAllMocks()
  localStorage.clear()
})

describe('page tree', () => {
  it('nests groups and keeps pages in manifest order per level', () => {
    const tree = pageTree(M)
    expect(tree.screens.map((s) => s.id)).toEqual(['home', 'me'])
    expect(tree.groups[0]?.screens.map((s) => s.id)).toEqual(['cart'])
    expect(tree.groups[0]?.groups[0]?.screens.map((s) => s.id)).toEqual(['paid'])
  })

  it('builds pages ops for groups and moves', () => {
    expect(addGroup(M, '我的', 'order').groups.at(-1)).toEqual({ id: 'g-1', title: '我的', parent: 'order' })
    // Deleting a group moves its subgroups and pages up a level.
    expect(deleteGroup(M, 'order')).toEqual({
      kind: 'pages',
      groups: [{ id: 'pay', title: '支付' }],
      screens: [{ id: 'home' }, { id: 'cart' }, { id: 'paid', group: 'pay' }, { id: 'me' }],
    })
    expect(moveScreen(M, 'me', 'order')?.screens).toEqual([
      { id: 'home' },
      { id: 'cart', group: 'order' },
      { id: 'me', group: 'order' },
      { id: 'paid', group: 'pay' },
    ])
    expect(moveScreen(M, 'me', undefined, 'home')?.screens.map((s) => s.id)).toEqual([
      'me',
      'home',
      'cart',
      'paid',
    ])
    expect(moveScreen(M, 'home', undefined, 'home')).toBeNull()
    // A group cannot go into its own subgroup.
    expect(moveGroup(M, 'order', 'pay')).toBeNull()
    expect(moveGroup(M, 'pay', undefined)?.groups).toEqual([
      { id: 'order', title: '下单' },
      { id: 'pay', title: '支付' },
    ])
  })
})

const history: ArtifactHistoryItem[] = [
  {
    messageId: 'm1',
    authorName: '蒋庆',
    body: '@共字君 首页加个搜索框',
    createdAt: new Date().toISOString(),
    screens: [{ id: 'home', title: '首页' }],
    runs: [
      {
        id: 'r1',
        botName: '共字君',
        status: 'completed',
        summary: '首页顶部加了搜索框',
        startedAt: null,
        endedAt: null,
        versions: [{ id: 'v2', n: 2, candidate: false }],
      },
    ],
  },
]

function renderRail(o: { canEdit?: boolean; versionId?: string } = {}) {
  const onPicked = vi.fn()
  const onEdit = vi.fn<(ops: ArtifactEditOp[]) => Promise<unknown>>(async () => {})
  render(
    <MemoryRouter>
      <PageRail
        artifactId="a1"
        groupId="g1"
        manifest={M}
        readOnly={false}
        canEdit={o.canEdit ?? true}
        refreshKey="v1"
        onEdit={onEdit}
        onClose={() => {}}
        versionId={o.versionId ?? null}
        onPicked={onPicked}
      />
    </MemoryRouter>,
  )
  return Object.assign(onEdit, { onPicked })
}

describe('page rail', () => {
  it('lists groups and pages, and shows each command with its run result', async () => {
    mockApi({ 'GET /artifacts/a1/history': history })
    renderRail()
    const rail = screen.getByTestId('art-rail')
    expect(within(rail).getByText('下单')).toBeTruthy()
    expect(within(rail).getByText('支付成功')).toBeTruthy()
    const log = await screen.findByTestId('art-log')
    expect(within(log).getByText('@共字君 首页加个搜索框')).toBeTruthy()
    expect(within(log).getByText('首页顶部加了搜索框')).toBeTruthy()
    expect(within(log).getByRole('button', { name: 'v2' })).toBeTruthy()
  })

  it('renames a page inline and creates a group', async () => {
    mockApi({ 'GET /artifacts/a1/history': [] })
    const onEdit = renderRail()
    fireEvent.doubleClick(screen.getByRole('button', { name: /^首页/ }))
    const input = screen.getByRole('textbox', { name: '页面名称' }) as HTMLInputElement
    input.value = '主页'
    fireEvent.blur(input)
    await waitFor(() =>
      expect(onEdit).toHaveBeenCalledWith([
        { kind: 'manifest', op: 'rename', screenId: 'home', title: '主页' },
      ]),
    )

    fireEvent.click(screen.getByRole('button', { name: '新建分类' }))
    const name = screen.getByRole('textbox', { name: '分类名称' }) as HTMLInputElement
    name.value = '个人中心'
    fireEvent.blur(name)
    await waitFor(() => expect(onEdit).toHaveBeenLastCalledWith([addGroup(M, '个人中心')]))
  })

  it('drags a page into a group', async () => {
    mockApi({ 'GET /artifacts/a1/history': [] })
    const onEdit = renderRail()
    const row = screen.getByRole('button', { name: '我的' }).closest('li')!
    const dataTransfer = { setData: () => {}, effectAllowed: '' }
    fireEvent.dragStart(row, { dataTransfer })
    const group = screen.getByText('下单').closest('div')!
    fireEvent.dragOver(group, { dataTransfer })
    fireEvent.drop(group, { dataTransfer })
    await waitFor(() => expect(onEdit).toHaveBeenCalledWith([moveScreen(M, 'me', 'order')]))
  })

  it('keeps a past version on when picking a page, and says it was picked', async () => {
    mockApi({ 'GET /artifacts/a1/history': [] })
    const { onPicked } = renderRail({ versionId: 'v3' })
    const { useArtifactFocus } = await import('../src/features/artifacts/store')
    let focus: ReturnType<typeof useArtifactFocus>
    function Probe() {
      focus = useArtifactFocus('a1')
      return null
    }
    render(<Probe />)
    fireEvent.click(screen.getByRole('button', { name: '我的' }))
    await waitFor(() => expect(focus).toMatchObject({ screenIds: ['me'], versionId: 'v3' }))
    expect(onPicked).toHaveBeenCalled()
  })

  it('hides the command log from visitors', () => {
    const calls = mockApi({})
    renderRail({ canEdit: false })
    expect(screen.queryByText('命令记录')).toBeNull()
    expect(screen.queryByRole('button', { name: '新建分类' })).toBeNull()
    expect(calls).toEqual([])
  })
})
