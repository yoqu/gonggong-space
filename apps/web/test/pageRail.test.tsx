import type { ArtifactEditOp, ArtifactHistoryItem, GgArtifactManifest } from '@gonggong/protocol'
import { fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import { MemoryRouter } from 'react-router'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { PageRail } from '../src/features/artifacts/PageRail'
import {
  addGroup,
  deleteGroup,
  insertGroup,
  moveGroup,
  moveScreen,
  pageTree,
  shiftGroup,
  shiftScreen,
} from '../src/features/artifacts/pageTree'
import { mockApi } from './mockApi'

// The canvas's left rail: pages (画布, nested), each its own canvas, and 命令记录.

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

afterEach(async () => {
  ;(await import('../src/features/artifacts/page')).setArtifactPage('a1', null)
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

  it('adds a page above or below another, and moves pages and screens up and down', () => {
    const three: GgArtifactManifest = {
      ...M,
      groups: [
        { id: 'a', title: 'A' },
        { id: 'a1', title: 'A1', parent: 'a' },
        { id: 'b', title: 'B' },
      ],
    }
    expect(insertGroup(three, 'N', 'b', 'above').groups.map((g) => g.id)).toEqual(['a', 'a1', 'g-1', 'b'])
    expect(insertGroup(three, 'N', 'a1', 'below').groups.at(-2)).toEqual({
      id: 'g-1',
      title: 'N',
      parent: 'a',
    })
    expect(insertGroup(three, 'N', 'a', 'below').groups.map((g) => g.id)).toEqual(['a', 'g-1', 'a1', 'b'])
    expect(shiftGroup(three, 'b', -1)?.groups.map((g) => g.id)).toEqual(['b', 'a', 'a1'])
    expect(shiftGroup(three, 'a', 1)?.groups.map((g) => g.id)).toEqual(['a1', 'b', 'a'])
    expect(shiftGroup(three, 'a', -1)).toBeNull()
    expect(shiftGroup(three, 'a1', 1)).toBeNull()
    // A page dropped on another's edge lands beside it, among its siblings.
    expect(moveGroup(three, 'a1', undefined, 'a')?.groups).toEqual([
      { id: 'a1', title: 'A1' },
      { id: 'a', title: 'A' },
      { id: 'b', title: 'B' },
    ])
    expect(shiftScreen(M, 'me', -1)?.screens.map((s) => s.id)).toEqual(['me', 'home', 'cart', 'paid'])
    expect(shiftScreen(M, 'home', 1)?.screens.map((s) => s.id)).toEqual(['cart', 'paid', 'me', 'home'])
    expect(shiftScreen(M, 'cart', 1)).toBeNull()
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

    fireEvent.click(screen.getByRole('button', { name: '新建画布' }))
    const name = screen.getByRole('textbox', { name: '画布名称' }) as HTMLInputElement
    name.value = '个人中心'
    fireEvent.blur(name)
    await waitFor(() => expect(onEdit).toHaveBeenLastCalledWith([addGroup(M, '个人中心')]))
  })

  it('drags its right edge to resize the rail and remembers the width', () => {
    renderRail()
    const rail = screen.getByTestId('art-rail')
    expect(rail.style.width).toBe('248px')
    const edge = screen.getByRole('separator', { name: '调整宽度' })
    edge.setPointerCapture = () => {}
    fireEvent.pointerDown(edge, { pointerId: 1, clientX: 248 })
    fireEvent.pointerMove(window, { clientX: 348 })
    expect(rail.style.width).toBe('348px')
    fireEvent.pointerMove(window, { clientX: 2000 })
    expect(rail.style.width).toBe('480px')
    fireEvent.pointerUp(window)
    expect(localStorage.getItem('gg.art.railWidth')).toBe('480')
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

  it('opens 全部页面 by default, one page (画布) per click, and a screen on its own page', async () => {
    mockApi({ 'GET /artifacts/a1/history': [] })
    const { artifactPage } = await import('../src/features/artifacts/page')
    renderRail()
    const all = screen.getByRole('button', { name: /全部页面/ })
    expect(all.closest('li')?.className).toContain('is-current')
    fireEvent.click(screen.getByRole('button', { name: '支付' }))
    expect(artifactPage('a1')).toBe('pay')
    expect(screen.getByRole('button', { name: '支付' }).closest('div')?.className).toContain('is-current')
    fireEvent.click(screen.getByRole('button', { name: '购物车' }))
    expect(artifactPage('a1')).toBe('order')
    fireEvent.click(all)
    expect(artifactPage('a1')).toBeNull()
  })

  it('adds pages above, below and inside a page, and moves it up and down', async () => {
    mockApi({ 'GET /artifacts/a1/history': [] })
    const onEdit = renderRail()
    const menu = (page: string, item: string) => {
      const row = screen.getByRole('button', { name: page }).closest('div')!
      fireEvent.click(within(row).getByRole('button', { name: '画布操作' }))
      fireEvent.click(screen.getByRole('menuitem', { name: item }))
    }
    const type = async (value: string) => {
      const input = screen.getByRole('textbox', { name: '画布名称' }) as HTMLInputElement
      input.value = value
      fireEvent.blur(input)
    }
    menu('下单', '上方添加画布')
    await type('首页')
    await waitFor(() => expect(onEdit).toHaveBeenLastCalledWith([insertGroup(M, '首页', 'order', 'above')]))
    menu('支付', '下方添加画布')
    await type('退款')
    await waitFor(() => expect(onEdit).toHaveBeenLastCalledWith([insertGroup(M, '退款', 'pay', 'below')]))
    menu('下单', '添加子画布')
    await type('地址')
    await waitFor(() => expect(onEdit).toHaveBeenLastCalledWith([addGroup(M, '地址', 'order')]))
    menu('支付', '移到顶层')
    await waitFor(() => expect(onEdit).toHaveBeenLastCalledWith([moveGroup(M, 'pay', undefined)]))
    const row = screen.getByRole('button', { name: '下单' }).closest('div')!
    fireEvent.click(within(row).getByRole('button', { name: '画布操作' }))
    expect((screen.getByRole('menuitem', { name: '上移' }) as HTMLButtonElement).disabled).toBe(true)
  })

  it('hides the command log from visitors', () => {
    const calls = mockApi({})
    renderRail({ canEdit: false })
    expect(screen.queryByText('命令记录')).toBeNull()
    expect(screen.queryByRole('button', { name: '新建画布' })).toBeNull()
    expect(calls).toEqual([])
  })
})
