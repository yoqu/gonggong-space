import type { ArtifactEditOp, ArtifactHistoryItem, GgArtifactManifest, MessageDto } from '@gonggong/protocol'
import { act, fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import { MemoryRouter } from 'react-router'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { useWorkspace } from '../src/app/workspace'
import { PageRail } from '../src/features/artifacts/PageRail'
import {
  addGroup,
  deleteGroup,
  indentScreen,
  insertGroup,
  moveGroup,
  moveScreen,
  outdentScreen,
  pageTree,
  shiftGroup,
  shiftScreen,
  shownScreens,
  subpages,
} from '../src/features/artifacts/pageTree'
import { group } from './gitFixtures'
import { mockApi } from './mockApi'

// The canvas's left rail: pages (文件夹, nested), each its own canvas, and the AI 对话 / 命令记录 below.

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
  const page = await import('../src/features/artifacts/page')
  page.setArtifactPage('a1', null)
  page.setCanvasScreen('a1', null)
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

const reply = (id: string, seq: number, kind: 'user' | 'bot', body: string): MessageDto => ({
  id,
  seq,
  groupId: 'g1',
  kind,
  authorId: kind === 'user' ? 'u1' : 'b1',
  authorName: kind === 'user' ? '蒋庆' : '共字君',
  body,
  mentions: [],
  runId: null,
  createdAt: new Date().toISOString(),
  attachments: [],
  quote: null,
})
/** The artifact's 画布 AI 对话: its root (an event no one sees) and `replies`. */
const chatRoutes = (replies: MessageDto[]) => ({
  'POST /artifacts/a1/chat': { rootId: 'root1' },
  'GET /messages/root1/thread?limit=50': {
    root: { ...reply('root1', 1, 'user', '画布 AI 对话'), kind: 'event', threadRootId: 'root1' },
    replies,
    runs: [],
    state: { rootId: 'root1', groupId: 'g1', following: false, lastReadSeq: 0, unread: 0, mentioned: false },
  },
})

function renderRail(
  o: { canEdit?: boolean; versionId?: string; narrow?: boolean; manifest?: GgArtifactManifest } = {},
) {
  const onPicked = vi.fn()
  const onClose = vi.fn()
  const onEdit = vi.fn<(ops: ArtifactEditOp[]) => Promise<unknown>>(async () => {})
  render(
    <MemoryRouter>
      <PageRail
        artifactId="a1"
        groupId="g1"
        manifest={o.manifest ?? M}
        readOnly={false}
        canEdit={o.canEdit ?? true}
        narrow={o.narrow}
        refreshKey="v1"
        onEdit={onEdit}
        onClose={onClose}
        versionId={o.versionId ?? null}
        onPicked={onPicked}
      />
    </MemoryRouter>,
  )
  return Object.assign(onEdit, { onPicked, onClose })
}

describe('subpages (页面下挂子页面)', () => {
  const sub = (id: string, parent: string) => ({ id, title: id, file: `screens/${id}.html`, parent })
  const N: GgArtifactManifest = {
    ...M,
    screens: [...M.screens, sub('detail', 'cart'), sub('spec', 'detail')],
  }

  it('lists subpages under their page, not at their folder level, and shows them with their folder', () => {
    expect(pageTree(N).groups[0]?.screens.map((s) => s.id)).toEqual(['cart'])
    expect(subpages(N, 'cart').map((s) => s.id)).toEqual(['detail'])
    expect(shownScreens(N, 'order').map((s) => s.id)).toEqual(['cart', 'detail', 'spec'])
    expect(shownScreens(N, 'detail').map((s) => s.id)).toEqual(['detail'])
    expect(shownScreens(N, null)).toHaveLength(6)
  })

  it('moves a page under another, many levels deep, but never under itself', () => {
    expect(moveScreen(N, 'me', undefined, undefined, 'spec')?.screens.at(-1)).toEqual({
      id: 'me',
      parent: 'spec',
    })
    expect(moveScreen(N, 'cart', undefined, undefined, 'spec')).toBeNull()
    expect(moveScreen(N, 'cart', undefined, undefined, 'cart')).toBeNull()
    // Into a folder: no longer a subpage.
    expect(moveScreen(N, 'detail', 'pay')?.screens.find((s) => s.id === 'detail')).toEqual({
      id: 'detail',
      group: 'pay',
    })
    expect(indentScreen(N, 'me')?.screens.find((s) => s.id === 'me')).toEqual({ id: 'me', parent: 'home' })
    expect(indentScreen(N, 'home')).toBeNull()
    const out = outdentScreen(N, 'spec')?.screens
    expect(out?.find((s) => s.id === 'spec')).toEqual({ id: 'spec', parent: 'cart' })
    expect(out?.map((s) => s.id).indexOf('spec')).toBe((out?.map((s) => s.id).indexOf('detail') ?? 0) + 1)
  })

  it('drags a page onto the middle of another to make it a subpage, folds it away and shows one page alone', async () => {
    mockApi({ 'GET /artifacts/a1/history': [] })
    const { artifactPage } = await import('../src/features/artifacts/page')
    const onEdit = renderRail({ manifest: N })
    expect(screen.getByRole('button', { name: 'spec' })).toBeTruthy()
    const dataTransfer = { setData: () => {}, effectAllowed: '' }
    const row = screen.getByRole('button', { name: '我的' }).closest('li')!
    fireEvent.dragStart(row, { dataTransfer })
    const target = screen.getByRole('button', { name: /^首页/ }).closest('li')!
    vi.spyOn(target, 'getBoundingClientRect').mockReturnValue({ top: 0, height: 28 } as DOMRect)
    fireEvent.dragOver(target, { dataTransfer, clientY: 14 })
    fireEvent.drop(target, { dataTransfer, clientY: 14 })
    await waitFor(() =>
      expect(onEdit).toHaveBeenCalledWith([moveScreen(N, 'me', undefined, undefined, 'home')]),
    )

    fireEvent.click(screen.getAllByRole('button', { name: '收起子页面' })[0]!)
    expect(screen.queryByRole('button', { name: 'detail' })).toBeNull()
    fireEvent.click(screen.getByRole('button', { name: '展开子页面' }))
    fireEvent.click(screen.getByRole('button', { name: 'detail' }))
    expect(artifactPage('a1')).toBe('detail')
  })
})

describe('page rail', () => {
  it('lists groups and pages, and shows each command with its run result', async () => {
    mockApi({ 'GET /artifacts/a1/history': history, ...chatRoutes([]) })
    renderRail()
    const rail = screen.getByTestId('art-rail')
    expect(within(rail).getByText('下单')).toBeTruthy()
    expect(within(rail).getByText('支付成功')).toBeTruthy()
    fireEvent.click(screen.getByRole('tab', { name: '命令记录' }))
    const log = await screen.findByTestId('art-log')
    expect(within(log).getByText('@共字君 首页加个搜索框')).toBeTruthy()
    expect(within(log).getByText('首页顶部加了搜索框')).toBeTruthy()
    expect(within(log).getByRole('button', { name: 'v2' })).toBeTruthy()
  })

  it("shows the canvas's AI 对话: what was asked on the canvas and AI's answer, not the group's messages", async () => {
    useWorkspace.setState({ groups: [group({ members: [] })], bots: [] })
    const asked = { ...reply('m2', 2, 'user', '首页改成深色'), threadRootId: 'root1' }
    const answered = { ...reply('m3', 3, 'bot', '已改成深色'), threadRootId: 'root1' }
    mockApi(chatRoutes([asked, answered]))
    renderRail()
    expect(screen.getByRole('tab', { name: 'AI 对话' }).getAttribute('aria-selected')).toBe('true')
    const chat = await screen.findByTestId('art-chat')
    await waitFor(() => expect(within(chat).getByText('首页改成深色')).toBeTruthy())
    expect(within(chat).getByText('已改成深色')).toBeTruthy()
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

    fireEvent.click(screen.getByRole('button', { name: '新建文件夹' }))
    const name = screen.getByRole('textbox', { name: '文件夹名称' }) as HTMLInputElement
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

  it('opens 全部页面 by default, a folder per click, and a page on its own', async () => {
    mockApi({ 'GET /artifacts/a1/history': [] })
    const { artifactPage } = await import('../src/features/artifacts/page')
    renderRail()
    const all = screen.getByRole('button', { name: /全部页面/ })
    expect(all.closest('li')?.className).toContain('is-current')
    fireEvent.click(screen.getByRole('button', { name: '支付' }))
    expect(artifactPage('a1')).toBe('pay')
    expect(screen.getByRole('button', { name: '支付' }).closest('div')?.className).toContain('is-current')
    fireEvent.click(screen.getByRole('button', { name: '购物车' }))
    expect(artifactPage('a1')).toBe('cart')
    expect(screen.getByRole('button', { name: '购物车' }).closest('li')?.className).toContain('is-current')
    fireEvent.click(all)
    expect(artifactPage('a1')).toBeNull()
  })

  it('marks the screen selected on the canvas as current, and follows the selection', async () => {
    mockApi({ 'GET /artifacts/a1/history': [] })
    const { setCanvasScreen } = await import('../src/features/artifacts/page')
    renderRail()
    const row = (name: string | RegExp) => screen.getByRole('button', { name }).closest('li')?.className ?? ''
    expect(row('购物车')).not.toContain('is-current')
    act(() => setCanvasScreen('a1', 'cart'))
    expect(row('购物车')).toContain('is-current')
    act(() => setCanvasScreen('a1', 'me'))
    expect(row('购物车')).not.toContain('is-current')
    expect(row('我的')).toContain('is-current')
    act(() => setCanvasScreen('a1', null))
    expect(row('我的')).not.toContain('is-current')
    fireEvent.click(screen.getByRole('button', { name: /^首页/ }))
    expect(row(/^首页/)).toContain('is-current')
  })

  it('adds pages above, below and inside a page, and moves it up and down', async () => {
    mockApi({ 'GET /artifacts/a1/history': [] })
    const onEdit = renderRail()
    const menu = (page: string, item: string) => {
      const row = screen.getByRole('button', { name: page }).closest('div')!
      fireEvent.click(within(row).getByRole('button', { name: '文件夹操作' }))
      fireEvent.click(screen.getByRole('menuitem', { name: item }))
    }
    const type = async (value: string) => {
      const input = screen.getByRole('textbox', { name: '文件夹名称' }) as HTMLInputElement
      input.value = value
      fireEvent.blur(input)
    }
    menu('下单', '上方添加文件夹')
    await type('首页')
    await waitFor(() => expect(onEdit).toHaveBeenLastCalledWith([insertGroup(M, '首页', 'order', 'above')]))
    menu('支付', '下方添加文件夹')
    await type('退款')
    await waitFor(() => expect(onEdit).toHaveBeenLastCalledWith([insertGroup(M, '退款', 'pay', 'below')]))
    menu('下单', '添加子文件夹')
    await type('地址')
    await waitFor(() => expect(onEdit).toHaveBeenLastCalledWith([addGroup(M, '地址', 'order')]))
    menu('支付', '移到顶层')
    await waitFor(() => expect(onEdit).toHaveBeenLastCalledWith([moveGroup(M, 'pay', undefined)]))
    const row = screen.getByRole('button', { name: '下单' }).closest('div')!
    fireEvent.click(within(row).getByRole('button', { name: '文件夹操作' }))
    expect((screen.getByRole('menuitem', { name: '上移' }) as HTMLButtonElement).disabled).toBe(true)
  })

  it('hides the command log from visitors', () => {
    const calls = mockApi({})
    renderRail({ canEdit: false })
    expect(screen.queryByText('命令记录')).toBeNull()
    expect(screen.queryByRole('button', { name: '新建文件夹' })).toBeNull()
    expect(calls).toEqual([])
  })

  it('omits the horizontal resize handle and closes on Escape in narrow drawer mode', () => {
    localStorage.setItem('gg.art.railWidth', '480')
    const { onClose } = renderRail({ narrow: true })
    const rail = screen.getByTestId('art-rail')
    expect(rail.style.width).toBe('')
    expect(screen.queryByRole('separator', { name: '调整宽度' })).toBeNull()
    fireEvent.keyDown(window, { key: 'Escape' })
    expect(onClose).toHaveBeenCalledTimes(1)
  })
})
