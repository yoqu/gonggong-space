import type { ArtifactVersionDto, BotDto, GroupDto, UserDto } from '@gonggong/protocol'
import { act, fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { useSession } from '../src/app/session'
import { useWorkbench } from '../src/app/workbench'
import { useWorkspace } from '../src/app/workspace'
import { ArtifactTab } from '../src/features/artifacts/ArtifactTab'
import { clearContext } from '../src/features/artifacts/context'
import { GUIDE_KEY, linkHost, menuPlace, navReducer, startNav } from '../src/features/artifacts/prototype'
import { resetShares } from '../src/features/artifacts/share'
import { loadArtifact, resetArtifacts } from '../src/features/artifacts/store'
import { realtime } from '../src/lib/realtime'
import { useToasts } from '../src/ui'
import { type Call, mockApi } from './mockApi'

// R5 of docs/plan/原型编辑器-Stitch对标-开发计划.md: the prototype editor, export, share and QR.

const at = '2026-10-30T10:00:00Z'
const ORIGIN = 'https://a1.preview.test'
const version = (n: number): ArtifactVersionDto => ({
  id: `v${n}`,
  artifactId: 'a1',
  n,
  parentVersionId: n > 1 ? `v${n - 1}` : null,
  source: 'run',
  runId: 'r1',
  userId: null,
  files: [],
  digest: 'a'.repeat(64),
  thumbnailUrl: null,
  stale: false,
  issues: [],
  createdAt: at,
  authorName: '设计助手',
})
const manifest = {
  title: '读书会小程序',
  device: 'mobile' as const,
  entry: 'home',
  screens: [
    { id: 'home', title: '首页', file: 'screens/home.html', prompt: '首页：每日金句与本周共读' },
    { id: 'detail', title: '书籍详情', file: 'screens/detail.html' },
    { id: 'shelf', title: '书架', file: 'screens/shelf.html' },
  ],
}
const { files: _, ...head } = version(2)
const artifact = (o: Record<string, unknown> = {}) => ({
  id: 'a1',
  favorites: [],
  groupId: 'g1',
  title: '读书会小程序',
  dir: 'design/app-screens-ab12',
  pluginId: 'p1',
  pluginVersionId: 'pv1',
  designSystemId: null,
  headVersionId: 'v2',
  head,
  manifest,
  undoVersionId: 'v1',
  redoVersionId: null,
  createdAt: at,
  updatedAt: at,
  archivedAt: null,
  running: false,
  botId: 'b1',
  visibility: 'group',
  createdBy: null,
  ...o,
})
const file = (path: string) => ({ path, hash: 'b'.repeat(64), size: 10 })
const detail = { ...version(2), files: [file('screens/home.html')], manifest, links: [] }
const OFF = { enabled: false, url: null, expiresAt: null }
const ON = {
  enabled: true,
  url: 'https://a1.preview.test/__gg/share/ps_x',
  expiresAt: '2026-11-06T10:00:00Z',
}
const routes = (o: Record<string, unknown> = {}) => ({
  'GET /artifacts/a1': artifact(),
  'GET /artifacts/a1/versions': [version(1), version(2)],
  'GET /artifacts/a1/versions/v2': detail,
  'GET /artifacts/a1/annotations?version=v2': [],
  'POST /artifacts/a1/preview': { previewId: 'pw1', origin: ORIGIN, url: '/api/previews/pw1/open' },
  'POST /artifacts/a1/edits': artifact(),
  'POST /artifacts/a1/commands': { id: 'm1' },
  'POST /groups/g1/messages': { id: 'm2' },
  'GET /artifacts/a1/share': OFF,
  'POST /artifacts/a1/share': (b: unknown) => ((b as { enabled: boolean }).enabled ? ON : OFF),
  ...o,
})

const me = { id: 'u1', name: '王磊', role: 'member' } as UserDto
const bots = [
  { id: 'b1', name: '设计助手', ownerId: 'u1' },
  { id: 'b2', name: '前端', ownerId: 'u2' },
] as BotDto[]
const setGroup = (botIds: string[], admin = false) =>
  useWorkspace.setState({
    groups: [
      {
        id: 'g1',
        kind: 'group',
        members: admin ? [{ userId: 'u1', isAdmin: true }] : [],
        botIds,
      } as unknown as GroupDto,
    ],
    bots,
  })

const tab = { kind: 'artifact' as const, artifactId: 'a1', title: '读书会小程序' }
const bodies = (calls: Call[], method: string, path: string) =>
  calls.filter((c) => c.method === method && c.path === path).map((c) => c.body)

/** Renders the tab and opens the prototype editor with 预览. */
const openEditor = async () => {
  render(<ArtifactTab tab={tab} tabKey="artifact:a1" active />)
  await screen.findByTitle('首页')
  await waitFor(() =>
    expect(screen.getByRole('button', { name: '预览原型' }).hasAttribute('disabled')).toBe(false),
  )
  expect(screen.getByRole('button', { name: '预览原型' }).textContent).toBe('预览')
  fireEvent.click(screen.getByRole('button', { name: '预览原型' }))
  await screen.findByRole('region', { name: '原型预览' })
}
const shown = () => screen.getByTestId('proto-screen')
const fromScreen = (data: Record<string, unknown>) => {
  const s = shown().dataset.screen as string
  const title = manifest.screens.find((x) => x.id === s)?.title as string
  const iframe = screen.getByTitle(title) as HTMLIFrameElement
  act(() => {
    window.dispatchEvent(
      new MessageEvent('message', {
        data: { source: 'gg-bridge', file: `screens/${s}.html`, ...data },
        origin: ORIGIN,
        source: iframe.contentWindow,
      }),
    )
  })
}
const ready = (links: unknown[] = [], back: unknown[] = []) =>
  fromScreen({ type: 'ready', width: 390, height: 1200, links, back })
const select = (o: Record<string, unknown> = {}) =>
  fromScreen({
    type: 'select',
    ggId: '120',
    selector: 'body > button',
    rect: { x: 10, y: 300, w: 200, h: 40 },
    tag: 'button',
    text: '加入本周共读',
    textOnly: true,
    computed: {},
    inlineStyle: '',
    src: null,
    href: null,
    link: null,
    transition: null,
    snippet: '<button>加入本周共读</button>',
    ...o,
  })
const editMode = () => fireEvent.click(screen.getByRole('radio', { name: '编辑' }))
const pick = (label: string, option: string) => {
  fireEvent.click(screen.getByRole('button', { name: label }))
  fireEvent.click(screen.getByRole('menuitemcheckbox', { name: option }))
}

class NoopSocket {
  close() {}
}
beforeEach(() => {
  localStorage.clear()
  localStorage.setItem(GUIDE_KEY, '1')
  resetArtifacts()
  resetShares()
  clearContext()
  useToasts.setState({ items: [] })
  vi.stubGlobal('WebSocket', NoopSocket)
  vi.spyOn(realtime, 'subscribe').mockImplementation(() => () => {})
  useWorkbench.setState({ groupId: 'g1', open: false, mode: 'split', previous: 'split', benches: {} })
  useSession.setState({ user: me, status: 'ready' })
  setGroup(['b1'])
})
afterEach(() => {
  vi.unstubAllGlobals()
  vi.restoreAllMocks()
})

describe('navigation', () => {
  it('pushes on links, pops on back with the reverse transition, and jumps from the list', () => {
    let s = startNav('home')
    s = navReducer(s, { type: 'go', screen: 'detail', transition: 'slide-up' })
    expect(s.stack.map((x) => x.screen)).toEqual(['home', 'detail'])
    expect(s.enter).toBe('slide-up')
    s = navReducer(s, { type: 'go', screen: 'shelf' })
    expect(s.enter).toBe('push')
    s = navReducer(s, { type: 'back' })
    expect(s.enter).toBe('push-back')
    s = navReducer(s, { type: 'back' })
    expect(s).toMatchObject({ enter: 'slide-down', stack: [{ screen: 'home' }] })
    // Nothing to go back to.
    expect(navReducer(s, { type: 'back' })).toBe(s)
    expect(navReducer(s, { type: 'jump', screen: 'shelf' }).stack).toEqual([{ screen: 'shelf', via: 'none' }])
    // Restart: back to the entry, the way it came undone.
    const deep = navReducer(navReducer(s, { type: 'go', screen: 'detail' }), { type: 'go', screen: 'shelf' })
    expect(navReducer(deep, { type: 'restart', screen: 'home' })).toMatchObject({
      stack: [{ screen: 'home', via: 'none' }],
      enter: 'push-back',
      step: deep.step + 1,
    })
  })
})

describe('placing the element menu', () => {
  const pop = { w: 248, h: 190 }
  const room = { width: 1000, height: 600 }
  const edges = { left: 236, right: 68 }
  it('goes under the element, above it when short of room, else as low as fits', () => {
    expect(menuPlace({ x: 400, y: 100, w: 50, h: 20 }, pop, room, edges)).toEqual({ left: 400, top: 128 })
    expect(menuPlace({ x: 400, y: 500, w: 50, h: 20 }, pop, room, edges)).toEqual({ left: 400, top: 302 })
    expect(menuPlace({ x: 400, y: 100, w: 50, h: 450 }, pop, room, edges).top).toBe(402)
    expect(menuPlace({ x: 900, y: 100, w: 50, h: 20 }, pop, room, edges).left).toBe(1000 - 68 - 248)
    expect(menuPlace({ x: 0, y: 100, w: 50, h: 20 }, pop, room, edges).left).toBe(236)
  })
  it('finds the smallest connected element holding a rect', () => {
    const spots = [
      { ggId: '1', screen: 'a', rect: { x: 0, y: 0, w: 390, h: 800 } },
      { ggId: '2', screen: 'b', rect: { x: 0, y: 100, w: 390, h: 100 } },
      { ggId: null, screen: 'c', rect: { x: 0, y: 120, w: 390, h: 20 } },
    ]
    expect(linkHost(spots, { x: 10, y: 120, w: 50, h: 20 })?.ggId).toBe('2')
    expect(linkHost(spots.slice(1), { x: 10, y: 300, w: 50, h: 20 })).toBeNull()
  })
})

describe('prototype editor', () => {
  it('opens on the entry screen; preview follows nav and back with transitions', async () => {
    mockApi(routes())
    await openEditor()
    expect(shown().dataset.screen).toBe('home')
    expect(shown().className).not.toMatch(/proto-enter/)
    fromScreen({ type: 'nav', screen: 'detail', transition: 'fade' })
    expect(shown().dataset.screen).toBe('detail')
    expect(shown().classList.contains('proto-enter--fade')).toBe(true)
    fromScreen({ type: 'nav', screen: 'shelf' })
    expect(shown().classList.contains('proto-enter--push')).toBe(true)
    fromScreen({ type: 'back' })
    expect(shown().dataset.screen).toBe('detail')
    expect(shown().classList.contains('proto-enter--push-back')).toBe(true)
    fromScreen({ type: 'back' })
    expect(shown().dataset.screen).toBe('home')
    // A link to a screen that is not there stays put and says so.
    fromScreen({ type: 'nav', screen: 'nope' })
    expect(shown().dataset.screen).toBe('home')
    expect(useToasts.getState().items.at(-1)?.message).toBe('没有屏幕「nope」')
    // The list jumps; the current screen is marked.
    fireEvent.click(screen.getByRole('button', { name: /书架/ }))
    expect(shown().dataset.screen).toBe('shelf')
    expect(screen.getByRole('button', { name: /书架/ }).getAttribute('aria-current')).toBe('page')
    // Back to the canvas.
    fireEvent.click(screen.getByRole('button', { name: /读书会小程序/ }))
    expect(screen.getByRole('application', { name: '画布' })).toBeTruthy()
  })

  it('ignores nav in edit mode, where clicks select elements', async () => {
    mockApi(routes())
    await openEditor()
    editMode()
    fromScreen({ type: 'nav', screen: 'detail' })
    expect(shown().dataset.screen).toBe('home')
  })

  it('shows the guide once as a hint over the stage, gone once a hotspot is used', async () => {
    localStorage.removeItem(GUIDE_KEY)
    mockApi(routes())
    await openEditor()
    const hint = () => screen.queryByRole('status', { name: '原型预览引导' })
    // Inside the stage, above the device, not a dialog over it.
    expect(screen.getByTestId('proto-stage').contains(hint())).toBe(true)
    expect(hint()?.textContent).toMatch(/点屏幕里的按钮就能跳转体验/)
    fromScreen({ type: 'nav', screen: 'detail' })
    expect(hint()).toBeNull()
    expect(localStorage.getItem(GUIDE_KEY)).toBe('1')
  })

  it('closes the guide on a mode switch or Escape', async () => {
    localStorage.removeItem(GUIDE_KEY)
    mockApi(routes())
    await openEditor()
    editMode()
    expect(screen.queryByRole('status', { name: '原型预览引导' })).toBeNull()
    expect(localStorage.getItem(GUIDE_KEY)).toBe('1')
    localStorage.removeItem(GUIDE_KEY)
    fireEvent.click(screen.getByRole('button', { name: /读书会小程序/ }))
    fireEvent.click(screen.getByRole('button', { name: '预览原型' }))
    await screen.findByRole('status', { name: '原型预览引导' })
    fireEvent.keyDown(window, { key: 'Escape' })
    expect(screen.queryByRole('status', { name: '原型预览引导' })).toBeNull()
    expect(localStorage.getItem(GUIDE_KEY)).toBe('1')
  })

  it('keeps the design clean in preview, flashes hotspots on a miss, and outlines them in edit mode', async () => {
    mockApi(routes())
    await openEditor()
    ready(
      [{ ggId: '120', screen: 'detail', rect: { x: 10, y: 300, w: 200, h: 40 } }],
      [{ ggId: '80', rect: { x: 0, y: 0, w: 40, h: 40 } }],
    )
    const hots = () => screen.getByTestId('proto-hots')
    const toggle = screen.getByRole('button', { name: '高亮热点' })
    expect(toggle.getAttribute('aria-pressed')).toBe('false')
    expect(hots().children).toHaveLength(0)
    // A click beside the hotspots flashes them for a moment.
    vi.useFakeTimers()
    fromScreen({ type: 'miss' })
    expect(hots().children).toHaveLength(2)
    expect(hots().classList.contains('proto-hots--flash')).toBe(true)
    act(() => vi.advanceTimersByTime(800))
    expect(hots().children).toHaveLength(0)
    vi.useRealTimers()
    fireEvent.click(toggle)
    expect(toggle.getAttribute('aria-pressed')).toBe('true')
    expect(hots().children).toHaveLength(2)
    expect(hots().classList.contains('proto-hots--flash')).toBe(false)
    expect((hots().children[0] as HTMLElement).style.top).toBe('300px')
    expect(hots().querySelector('.proto-hot__tag')).toBeNull()
    fireEvent.click(toggle)
    expect(hots().children).toHaveLength(0)
    editMode()
    // Edit mode outlines every hotspot, without a tag until the pointer is over it.
    expect(hots().children).toHaveLength(2)
    expect(hots().querySelector('.proto-hot__tag')).toBeNull()
    expect(within(hots()).queryByText('已连接')).toBeNull()
    fromScreen({ type: 'hover', ggId: '121', rect: { x: 20, y: 305, w: 50, h: 20 } })
    expect(within(hots()).getByText('→ 书籍详情')).toBeTruthy()
    expect(within(hots()).queryByText('← 返回')).toBeNull()
    fromScreen({ type: 'hover', ggId: '80', rect: { x: 0, y: 0, w: 40, h: 40 } })
    expect(within(hots()).queryByText('→ 书籍详情')).toBeNull()
    // Tags sit outside the element (P2-21): above it, or below when the screen's top leaves no room.
    expect(within(hots()).getByText('← 返回').classList.contains('proto-hot__tag--below')).toBe(true)
    fromScreen({ type: 'hover', ggId: null, rect: null })
    expect(hots().querySelector('.proto-hot__tag')).toBeNull()
    // A selected connected element names where it goes.
    select({ rect: { x: 10, y: 300, w: 200, h: 40 }, link: 'detail' })
    expect(within(hots()).getByText('→ 书籍详情').classList.contains('proto-hot__tag--below')).toBe(false)
    // The frame keeps the device's height and scrolls itself; the overlays follow its scroll.
    expect((screen.getByTitle('首页') as HTMLElement).style.height).toBe('844px')
    fromScreen({ type: 'scroll', scrollX: 0, scrollY: 120 })
    expect((hots().children[0] as HTMLElement).style.top).toBe('180px')
    expect((hots().children[1] as HTMLElement).style.top).toBe('-120px')
  })

  it('keeps a selected element on its spot as the screen scrolls', async () => {
    mockApi(routes())
    await openEditor()
    editMode()
    fromScreen({ type: 'scroll', scrollX: 0, scrollY: 100 })
    // Picked in viewport coordinates at scroll 100…
    select({ rect: { x: 10, y: 50, w: 200, h: 40 } })
    const picked = () =>
      within(screen.getByTestId('proto-hots')).getByText('已选中').parentElement as HTMLElement
    expect(picked().style.top).toBe('50px')
    // …and moved up by the next 60px of scroll.
    fromScreen({ type: 'scroll', scrollX: 0, scrollY: 160 })
    expect(picked().style.top).toBe('-10px')
  })

  it('switches devices', async () => {
    mockApi(routes())
    await openEditor()
    const device = () => screen.getByTestId('proto-device')
    expect(device().dataset.device).toBe('mobile')
    fireEvent.click(screen.getByRole('button', { name: '设备：手机' }))
    fireEvent.click(screen.getByRole('menuitemcheckbox', { name: /平板/ }))
    expect(device().dataset.device).toBe('tablet')
    expect(device().style.width).toBe('788px')
    fireEvent.click(screen.getByRole('button', { name: '设备：平板' }))
    fireEvent.click(screen.getByRole('menuitemcheckbox', { name: /桌面/ }))
    expect(device().dataset.device).toBe('desktop')
  })

  it('connects an element to a screen with a transition, and disconnects it', async () => {
    const calls = mockApi(routes())
    await openEditor()
    editMode()
    select()
    const menu = screen.getByRole('dialog', { name: '编辑元素' })
    expect(within(screen.getByTestId('proto-hots')).getByText('已选中')).toBeTruthy()
    fireEvent.click(within(menu).getByRole('button', { name: /连到屏幕/ }))
    const panel = screen.getByTestId('proto-connect')
    const apply = screen.getByRole('button', { name: '应用连接' })
    expect(apply.hasAttribute('disabled')).toBe(true)
    expect(screen.queryByRole('button', { name: '断开连接' })).toBeNull()
    // The current screen is not a target.
    fireEvent.click(within(panel).getByRole('button', { name: '连到屏幕' }))
    expect(screen.queryByRole('menuitemcheckbox', { name: '首页' })).toBeNull()
    fireEvent.click(screen.getByRole('menuitemcheckbox', { name: '书籍详情' }))
    pick('转场', '上滑')
    fireEvent.click(apply)
    await waitFor(() =>
      expect(bodies(calls, 'POST', '/artifacts/a1/edits')).toEqual([
        {
          baseVersionId: 'v2',
          ops: [
            { kind: 'attr', file: 'screens/home.html', ggId: '120', name: 'data-gg-link', value: 'detail' },
            {
              kind: 'attr',
              file: 'screens/home.html',
              ggId: '120',
              name: 'data-gg-transition',
              value: 'slide-up',
            },
          ],
        },
      ]),
    )
    await waitFor(() => expect(screen.queryByTestId('proto-connect')).toBeNull())

    // A linked element starts from its link and transition, and can be disconnected.
    select({ link: 'detail', transition: 'fade' })
    fireEvent.click(
      within(screen.getByRole('dialog', { name: '编辑元素' })).getByRole('button', { name: /编辑连接/ }),
    )
    expect(
      within(screen.getByTestId('proto-connect')).getByRole('button', { name: '转场' }).textContent,
    ).toMatch('淡入')
    fireEvent.click(screen.getByRole('button', { name: '断开连接' }))
    await waitFor(() => expect(bodies(calls, 'POST', '/artifacts/a1/edits')).toHaveLength(2))
    expect(bodies(calls, 'POST', '/artifacts/a1/edits')[1]).toEqual({
      baseVersionId: 'v2',
      ops: [
        { kind: 'attr', file: 'screens/home.html', ggId: '120', name: 'data-gg-link', value: null },
        { kind: 'attr', file: 'screens/home.html', ggId: '120', name: 'data-gg-transition', value: null },
      ],
    })
  })

  it('closes the connect panel with Escape, and makes room under the device for the change bar (P05, P07)', async () => {
    mockApi(routes())
    await openEditor()
    editMode()
    select()
    fireEvent.click(
      within(screen.getByRole('dialog', { name: '编辑元素' })).getByRole('button', { name: /连到屏幕/ }),
    )
    expect(screen.getByTestId('proto-connect')).toBeTruthy()
    fireEvent.keyDown(document.body, { key: 'Escape' })
    expect(screen.queryByTestId('proto-connect')).toBeNull()
    const stage = screen.getByTestId('proto-device').closest('.proto-stage') as HTMLElement
    expect(stage.style.paddingBottom).toBe('')
    fireEvent.click(screen.getByRole('button', { name: 'AI 改这屏' }))
    expect(stage.style.paddingBottom).toBe('200px')
  })

  it('edits text and hands elements and whole screens to the AI', async () => {
    const calls = mockApi(routes())
    await openEditor()
    editMode()
    select()
    const menu = () => screen.getByRole('dialog', { name: '编辑元素' })
    ready()
    const frame = (screen.getByTitle('首页') as HTMLIFrameElement).contentWindow as Window
    const post = vi.spyOn(frame, 'postMessage').mockImplementation(() => {})
    fireEvent.click(within(menu()).getByRole('button', { name: /编辑文字/ }))
    expect(post.mock.calls.map(([m]) => m).at(-1)).toEqual({
      source: 'gg-host',
      type: 'edit-text',
      ggId: '120',
    })
    fromScreen({ type: 'text-edit', state: 'editing', ggId: '120', text: null })
    expect(within(menu()).getByRole('status').textContent).toBe('直接输入，回车保存，Esc 取消')
    fromScreen({ type: 'text-edit', state: 'done', ggId: '120', text: '立即加入' })
    await waitFor(() =>
      expect(bodies(calls, 'POST', '/artifacts/a1/edits')).toEqual([
        {
          baseVersionId: 'v2',
          ops: [{ kind: 'text', file: 'screens/home.html', ggId: '120', text: '立即加入' }],
        },
      ]),
    )

    select()
    fireEvent.click(within(menu()).getByRole('button', { name: /构想新屏/ }))
    fireEvent.change(within(menu()).getByRole('textbox', { name: '新屏描述' }), {
      target: { value: '报名成功页' },
    })
    fireEvent.click(within(menu()).getByRole('button', { name: '发给 @设计助手' }))
    await waitFor(() =>
      expect(bodies(calls, 'POST', '/artifacts/a1/commands')).toEqual([
        {
          command: 'connect-element',
          botId: 'b1',
          ggIds: [{ file: 'screens/home.html', ggId: '120' }],
          text: '报名成功页',
        },
      ]),
    )

    // The pencil: Edit With AI on the whole screen.
    fireEvent.click(screen.getByRole('button', { name: 'AI 改这屏' }))
    fireEvent.change(screen.getByRole('textbox', { name: '修改要求' }), { target: { value: '整体换成深色' } })
    fireEvent.click(screen.getByRole('button', { name: '发给 @设计助手' }))
    await waitFor(() => expect(bodies(calls, 'POST', '/artifacts/a1/commands')).toHaveLength(2))
    expect(bodies(calls, 'POST', '/artifacts/a1/commands')[1]).toEqual({
      command: 'edit-with-ai',
      botId: 'b1',
      screenIds: ['home'],
      text: '整体换成深色',
    })
    expect(bodies(calls, 'POST', '/groups/g1/messages')).toHaveLength(0)
  })

  it('imagines a new screen from the list without a selection', async () => {
    const calls = mockApi(routes())
    await openEditor()
    editMode()
    fireEvent.click(screen.getByRole('button', { name: /构想新屏/ }))
    fireEvent.change(screen.getByRole('textbox', { name: '新屏描述' }), { target: { value: '个人中心' } })
    fireEvent.click(screen.getByRole('button', { name: '发给 @设计助手' }))
    await waitFor(() =>
      expect(bodies(calls, 'POST', '/artifacts/a1/commands')).toEqual([
        { command: 'connect-element', botId: 'b1', screenIds: ['home'], text: '个人中心' },
      ]),
    )
    expect(bodies(calls, 'POST', '/groups/g1/messages')).toHaveLength(0)
  })

  it('turns sharing on in place to show a QR code', async () => {
    const calls = mockApi(routes())
    await openEditor()
    fireEvent.click(screen.getByRole('button', { name: '扫码查看' }))
    const dialog = await screen.findByRole('dialog', { name: '扫码查看' })
    const turnOn = await within(dialog).findByRole('button', { name: '开启分享并生成二维码' })
    expect(screen.queryByTestId('art-qr')).toBeNull()
    await waitFor(() => expect(turnOn.hasAttribute('disabled')).toBe(false))
    fireEvent.click(turnOn)
    await within(dialog).findByTestId('art-qr')
    expect(bodies(calls, 'POST', '/artifacts/a1/share')).toEqual([{ enabled: true }])
  })

  it('says why the QR code cannot be turned on', async () => {
    mockApi(routes({ 'GET /artifacts/a1': artifact({ botId: 'b2' }) }))
    setGroup(['b1', 'b2'])
    await openEditor()
    fireEvent.click(screen.getByRole('button', { name: '扫码查看' }))
    const dialog = await screen.findByRole('dialog', { name: '扫码查看' })
    expect(within(dialog).getByText('只有 Bot 主人或群管理员能开关分享')).toBeTruthy()
    expect(
      within(dialog).getByRole('button', { name: '开启分享并生成二维码' }).hasAttribute('disabled'),
    ).toBe(true)
  })

  it('opens itself once Instant Prototype’s run ends', async () => {
    let running = false
    const calls = mockApi(routes({ 'GET /artifacts/a1': () => artifact({ running }) }))
    render(<ArtifactTab tab={tab} tabKey="artifact:a1" active />)
    await screen.findByTitle('首页')
    fireEvent.click(screen.getByTestId('art-node-home'))
    fireEvent.click(screen.getByRole('button', { name: '生成' }))
    fireEvent.click(screen.getByRole('menuitem', { name: '即时原型' }))
    await waitFor(() => expect(bodies(calls, 'POST', '/artifacts/a1/commands')).toHaveLength(1))
    running = true
    await act(() => loadArtifact('a1'))
    expect(screen.queryByRole('region', { name: '原型预览' })).toBeNull()
    running = false
    await act(() => loadArtifact('a1'))
    await screen.findByRole('region', { name: '原型预览' })
  })

  describe('the element menu on the stage (P1-N1)', () => {
    const sized = (width: number, height: number) => {
      vi.spyOn(HTMLElement.prototype, 'clientWidth', 'get').mockReturnValue(width)
      vi.spyOn(HTMLElement.prototype, 'clientHeight', 'get').mockReturnValue(height)
    }
    const menu = () => screen.getByRole('dialog', { name: '编辑元素' })
    const px = (v: string) => Number.parseFloat(v)

    it('opens above a tab bar at the device’s bottom, outside the device’s clip', async () => {
      sized(1200, 900)
      mockApi(routes())
      await openEditor()
      editMode()
      select({ rect: { x: 0, y: 790, w: 390, h: 54 }, text: '我的' })
      expect(menu().closest('[data-testid="proto-clip"]')).toBeNull()
      expect(menu().parentElement).toBe(screen.getByTestId('proto-stage'))
      // Mobile 390×844 in a 10px bezel, scaled to the stage's height less its 96px.
      const scale = Math.min(1, (1200 - 236 - 68) / 410, (900 - 96) / 864)
      const tabTop = (900 - 864 * scale) / 2 + (10 + 790) * scale
      expect(px(menu().style.top) + 190 + 8).toBeCloseTo(tabTop)
      expect(px(menu().style.top)).toBeGreaterThanOrEqual(8)
      // An element high on the screen keeps its menu under it.
      select({ rect: { x: 0, y: 100, w: 390, h: 40 } })
      expect(px(menu().style.top)).toBeCloseTo((900 - 864 * scale) / 2 + (10 + 140) * scale + 8)
    })

    it('keeps clear of the screen list and the rail', async () => {
      sized(800, 900)
      mockApi(routes())
      await openEditor()
      editMode()
      select({ rect: { x: 380, y: 100, w: 10, h: 20 } })
      expect(px(menu().style.left) + 248).toBeLessThanOrEqual(800 - 68)
      select({ rect: { x: 0, y: 100, w: 10, h: 20 } })
      expect(px(menu().style.left)).toBeGreaterThanOrEqual(236)
    })
  })

  it('picks the connected element a click lands in, to edit or remove its connection (G19)', async () => {
    const calls = mockApi(routes())
    await openEditor()
    editMode()
    ready([{ ggId: '200', screen: 'detail', rect: { x: 0, y: 280, w: 390, h: 120 }, transition: 'fade' }])
    // The card's title, inside the card that links to 书籍详情.
    select({ ggId: '201', rect: { x: 16, y: 300, w: 200, h: 20 }, tag: 'h3', text: '本周共读' })
    const picked = screen.getByTestId('proto-hots').querySelector('.proto-hot--selected') as HTMLElement
    expect(within(picked).getByText('→ 书籍详情')).toBeTruthy()
    expect(picked.style.top).toBe('280px')
    expect(picked.style.height).toBe('120px')
    const m = screen.getByRole('dialog', { name: '编辑元素' })
    expect(within(m).queryByRole('button', { name: /连到屏幕/ })).toBeNull()
    fireEvent.click(within(m).getByRole('button', { name: /编辑连接/ }))
    expect(
      within(screen.getByTestId('proto-connect')).getByRole('button', { name: '转场' }).textContent,
    ).toMatch('淡入')
    fireEvent.keyDown(document.body, { key: 'Escape' })

    select({ ggId: '201', rect: { x: 16, y: 300, w: 200, h: 20 }, tag: 'h3', text: '本周共读' })
    const remove = within(screen.getByRole('dialog', { name: '编辑元素' })).getByRole('button', {
      name: /移除连接/,
    })
    expect(remove.className).toContain('art-pop__action--danger')
    fireEvent.click(remove)
    await waitFor(() =>
      expect(bodies(calls, 'POST', '/artifacts/a1/edits')).toEqual([
        {
          baseVersionId: 'v2',
          ops: [
            { kind: 'attr', file: 'screens/home.html', ggId: '200', name: 'data-gg-link', value: null },
            { kind: 'attr', file: 'screens/home.html', ggId: '200', name: 'data-gg-transition', value: null },
          ],
        },
      ]),
    )
    await waitFor(() => expect(screen.queryByRole('dialog', { name: '编辑元素' })).toBeNull())
    // Elements outside any link connect as before.
    select({ rect: { x: 10, y: 600, w: 100, h: 20 } })
    expect(
      within(screen.getByRole('dialog', { name: '编辑元素' })).getByRole('button', { name: /连到屏幕/ }),
    ).toBeTruthy()
  })
})

describe('export', () => {
  it('downloads the zip, copies code, asks for a brief and copies the share link', async () => {
    const writeText = vi.fn(async () => {})
    vi.stubGlobal('navigator', { ...navigator, clipboard: { writeText } })
    const click = vi.spyOn(HTMLAnchorElement.prototype, 'click').mockImplementation(() => {})
    const calls = mockApi(
      routes({
        'GET /artifacts/a1/files/screens/home.html?version=v2': () => new Response('<h1>首页</h1>'),
      }),
    )
    render(<ArtifactTab tab={tab} tabKey="artifact:a1" active />)
    await screen.findByTitle('首页')
    fireEvent.click(screen.getByRole('button', { name: '导出' }))
    const panel = screen.getByTestId('art-export')
    // Nothing selected: the whole artifact.
    expect(panel.textContent).toMatch('未选择屏幕时导出整个产物（全部 3 个屏幕）')
    // The zip plays from file:// (P2-13): no server needed.
    expect(panel.textContent).toMatch('解压后双击 index.html 即可演示')
    // The panel's primary button is the last 导出.
    const primary = screen.getAllByRole('button', { name: '导出' }).at(-1) as HTMLElement
    fireEvent.click(primary)
    expect(click).toHaveBeenCalled()
    expect((click.mock.contexts.at(-1) as HTMLAnchorElement).getAttribute('href')).toBe(
      '/api/artifacts/a1/export.zip?version=v2',
    )

    // Copy code takes the selected screens.
    fireEvent.click(screen.getByTestId('art-node-home'))
    // The zip is the whole version whatever is selected.
    expect(screen.getByTestId('art-export').textContent).toMatch('导出整个版本（全部 3 个屏幕），与选中无关')
    fireEvent.click(screen.getByRole('radio', { name: '复制代码' }))
    expect(screen.getByTestId('art-export').textContent).toMatch('所选的 1 个屏幕')
    fireEvent.click(screen.getByRole('button', { name: '复制' }))
    await waitFor(() => expect(writeText).toHaveBeenCalledWith('<!-- screens/home.html -->\n<h1>首页</h1>'))
    // Said over the canvas, like the canvas's own copies (P2-18).
    expect((await screen.findByTestId('art-notice')).textContent).toBe('已复制 1 个屏幕的代码')

    fireEvent.click(screen.getByRole('radio', { name: '项目简报' }))
    fireEvent.click(screen.getByRole('button', { name: '生成项目简报' }))
    await waitFor(() =>
      expect(bodies(calls, 'POST', '/artifacts/a1/commands')).toEqual([
        { command: 'project-brief', botId: 'b1' },
      ]),
    )

    fireEvent.click(screen.getByRole('radio', { name: '分享链接' }))
    fireEvent.click(screen.getByRole('button', { name: '开启并复制链接' }))
    await waitFor(() => expect(writeText).toHaveBeenLastCalledWith(ON.url))
    await waitFor(() => expect(screen.getByTestId('art-notice').textContent).toBe('链接已复制'))
    expect(useToasts.getState().items.map((i) => i.message)).not.toContain('链接已复制')
    expect(bodies(calls, 'POST', '/artifacts/a1/share')).toEqual([{ enabled: true }])
  })
})

describe('share', () => {
  it('turns the link on and copies it', async () => {
    const writeText = vi.fn(async () => {})
    vi.stubGlobal('navigator', { ...navigator, clipboard: { writeText } })
    const calls = mockApi(routes())
    render(<ArtifactTab tab={tab} tabKey="artifact:a1" active />)
    await screen.findByTitle('首页')
    fireEvent.click(screen.getByRole('button', { name: '分享' }))
    const dialog = await screen.findByRole('dialog', { name: '分享产物' })
    expect(within(dialog).getByText('未开启，只有群成员能查看')).toBeTruthy()
    expect(dialog.textContent).not.toMatch('关闭后链接立即失效')
    const turnOn = within(dialog).getByRole('button', { name: '开启并复制链接' })
    await waitFor(() => expect(turnOn.hasAttribute('disabled')).toBe(false))
    fireEvent.click(turnOn)
    await within(dialog).findByText(ON.url)
    expect(bodies(calls, 'POST', '/artifacts/a1/share')).toEqual([{ enabled: true }])
    await waitFor(() => expect(writeText).toHaveBeenCalledWith(ON.url))
    await waitFor(() => expect(useToasts.getState().items.map((i) => i.message)).toContain('链接已复制'))
    expect(within(dialog).getByText('任何拿到链接的人都能查看')).toBeTruthy()
    fireEvent.click(within(dialog).getByRole('button', { name: '复制链接' }))
    await waitFor(() => expect(writeText).toHaveBeenCalledTimes(2))
    const toggle = within(dialog).getByRole('switch', { name: '开启分享' })
    fireEvent.click(toggle)
    await waitFor(() => expect(bodies(calls, 'POST', '/artifacts/a1/share')).toHaveLength(2))
    expect(bodies(calls, 'POST', '/artifacts/a1/share')[1]).toEqual({ enabled: false })
  })

  it('is read-only to members who do not manage the bot', async () => {
    mockApi(routes({ 'GET /artifacts/a1': artifact({ botId: 'b2' }) }))
    setGroup(['b1', 'b2'])
    render(<ArtifactTab tab={tab} tabKey="artifact:a1" active />)
    await screen.findByTitle('首页')
    fireEvent.click(screen.getByRole('button', { name: '分享' }))
    const dialog = await screen.findByRole('dialog', { name: '分享产物' })
    expect(within(dialog).getByText('只有 Bot 主人或群管理员能开关分享')).toBeTruthy()
    expect(within(dialog).getByRole('switch', { name: '开启分享' }).hasAttribute('disabled')).toBe(true)
    expect(within(dialog).getByRole('button', { name: '开启并复制链接' }).hasAttribute('disabled')).toBe(true)
  })

  it('lets a group admin manage it', async () => {
    mockApi(routes({ 'GET /artifacts/a1': artifact({ botId: 'b2' }) }))
    setGroup(['b1', 'b2'], true)
    render(<ArtifactTab tab={tab} tabKey="artifact:a1" active />)
    await screen.findByTitle('首页')
    fireEvent.click(screen.getByRole('button', { name: '分享' }))
    const dialog = await screen.findByRole('dialog', { name: '分享产物' })
    expect(within(dialog).queryByText('只有 Bot 主人或群管理员能开关分享')).toBeNull()
  })
})

describe('visibility', () => {
  it('lets its creator choose who sees it', async () => {
    const calls = mockApi(
      routes({
        'GET /artifacts/a1': artifact({ botId: 'b2', createdBy: 'u1' }),
        'PUT /artifacts/a1/visibility': artifact({ botId: 'b2', createdBy: 'u1', visibility: 'team' }),
      }),
    )
    setGroup(['b1', 'b2'])
    render(<ArtifactTab tab={tab} tabKey="artifact:a1" active />)
    await screen.findByTitle('首页')
    fireEvent.click(screen.getByRole('button', { name: '分享' }))
    const dialog = await screen.findByRole('dialog', { name: '分享产物' })
    const scope = within(dialog).getByRole('radiogroup', { name: '可见范围' })
    expect(within(scope).getByRole('radio', { name: '本群' }).getAttribute('aria-checked')).toBe('true')
    fireEvent.click(within(scope).getByRole('radio', { name: '团队' }))
    await waitFor(() =>
      expect(bodies(calls, 'PUT', '/artifacts/a1/visibility')).toEqual([{ visibility: 'team' }]),
    )
    await within(dialog).findByText('团队成员都能查看和演示，进群后才能修改')
    fireEvent.click(within(scope).getByRole('radio', { name: '全员' }))
    await waitFor(() =>
      expect(bodies(calls, 'PUT', '/artifacts/a1/visibility').at(-1)).toEqual({ visibility: 'all' }),
    )
    await within(dialog).findByText('所有登录用户都能查看和演示，只有群成员能修改')
  })

  it('is fixed for members who did not create it and do not manage it', async () => {
    mockApi(routes({ 'GET /artifacts/a1': artifact({ botId: 'b2', createdBy: 'u9' }) }))
    setGroup(['b1', 'b2'])
    render(<ArtifactTab tab={tab} tabKey="artifact:a1" active />)
    await screen.findByTitle('首页')
    fireEvent.click(screen.getByRole('button', { name: '分享' }))
    const dialog = await screen.findByRole('dialog', { name: '分享产物' })
    const scope = within(dialog).getByRole('radiogroup', { name: '可见范围' })
    for (const r of within(scope).getAllByRole('radio')) expect(r.hasAttribute('disabled')).toBe(true)
  })
})

describe('R5 contract on the canvas', () => {
  it('hands AI commands to the artifact’s own bot by default', async () => {
    const calls = mockApi(routes({ 'GET /artifacts/a1': artifact({ botId: 'b2' }) }))
    setGroup(['b1', 'b2'])
    render(<ArtifactTab tab={tab} tabKey="artifact:a1" active />)
    await screen.findByTitle('首页')
    fireEvent.click(screen.getByTestId('art-node-home'))
    expect(screen.getByRole('button', { name: /@前端/ })).toBeTruthy()
    fireEvent.click(screen.getByRole('button', { name: '生成' }))
    fireEvent.click(screen.getByRole('menuitem', { name: /^重新生成/ }))
    await waitFor(() =>
      expect(bodies(calls, 'POST', '/artifacts/a1/commands')).toEqual([
        { command: 'regenerate', botId: 'b2', screenIds: ['home'] },
      ]),
    )
  })

  it('falls back to the first bot when the artifact’s bot left the group', async () => {
    mockApi(routes({ 'GET /artifacts/a1': artifact({ botId: 'gone' }) }))
    setGroup(['b1', 'b2'])
    render(<ArtifactTab tab={tab} tabKey="artifact:a1" active />)
    await screen.findByTitle('首页')
    fireEvent.click(screen.getByTestId('art-node-home'))
    expect(screen.getByRole('button', { name: /@设计助手/ })).toBeTruthy()
  })

  it('shows the manifest’s prompt as the design notes', async () => {
    mockApi(routes())
    render(<ArtifactTab tab={tab} tabKey="artifact:a1" active />)
    await screen.findByTitle('首页')
    fireEvent.click(screen.getByTestId('art-node-home'))
    fireEvent.keyDown(screen.getByRole('application', { name: '画布' }), { key: 'i' })
    expect((await screen.findByTestId('art-details-note')).textContent).toBe('首页：每日金句与本周共读')
  })

  it('keeps the bridge’s snippet on an annotation', async () => {
    const calls = mockApi(
      routes({
        'POST /artifacts/a1/annotations': (b: unknown) => ({ ...(b as object), id: 'n1', status: 'open' }),
      }),
    )
    render(<ArtifactTab tab={tab} tabKey="artifact:a1" active />)
    await screen.findByTitle('首页')
    fireEvent.keyDown(screen.getByRole('application', { name: '画布' }), { key: 'm' })
    const iframe = screen.getByTitle('首页') as HTMLIFrameElement
    act(() => {
      window.dispatchEvent(
        new MessageEvent('message', {
          data: {
            source: 'gg-bridge',
            file: 'screens/home.html',
            type: 'select',
            ggId: '120',
            selector: 'body > h1',
            rect: { x: 0, y: 0, w: 10, h: 10 },
            tag: 'h1',
            text: '本周共读',
            textOnly: true,
            computed: {},
            inlineStyle: '',
            src: null,
            href: null,
            link: null,
            transition: null,
            snippet: '<h1 class="t-title">本周共读</h1>',
          },
          origin: ORIGIN,
          source: iframe.contentWindow,
        }),
      )
    })
    fireEvent.change(screen.getByRole('textbox', { name: '意见' }), { target: { value: '大一点' } })
    fireEvent.click(screen.getByRole('button', { name: '添加批注' }))
    await waitFor(() => expect(bodies(calls, 'POST', '/artifacts/a1/annotations')).toHaveLength(1))
    expect(bodies(calls, 'POST', '/artifacts/a1/annotations')[0]).toMatchObject({
      snippet: '<h1 class="t-title">本周共读</h1>',
    })
  })
})

describe('Stitch round 4 fixes (prototype)', () => {
  it('moves the device clear of the connect panel while it is open (P1-03)', async () => {
    vi.spyOn(HTMLElement.prototype, 'clientWidth', 'get').mockReturnValue(900)
    vi.spyOn(HTMLElement.prototype, 'clientHeight', 'get').mockReturnValue(2000)
    mockApi(routes())
    await openEditor()
    const stage = screen.getByTestId('proto-stage')
    const width = () => Number.parseFloat(screen.getByTestId('proto-device').style.transform.slice(6))
    const before = width()
    expect(stage.style.paddingRight).toBe('68px')
    editMode()
    select()
    fireEvent.click(
      within(screen.getByRole('dialog', { name: '编辑元素' })).getByRole('button', { name: /连到屏幕/ }),
    )
    expect(screen.getByTestId('proto-connect')).toBeTruthy()
    expect(stage.style.paddingRight).toBe('380px')
    expect(stage.style.paddingLeft).toBe('236px')
    // The device shrinks to the room left between the screen list and the panel.
    expect(width()).toBeLessThan(before)
    fireEvent.click(
      within(screen.getByRole('complementary', { name: '连接元素' })).getByRole('button', { name: '关闭' }),
    )
    expect(stage.style.paddingRight).toBe('68px')
  })

  it('matches the shell’s device: a mini program at 375×812 with its status bar, capsule and home indicator', async () => {
    const mini = {
      ...manifest,
      device: 'miniprogram' as const,
      screens: manifest.screens.map((s) => (s.id === 'home' ? { ...s, statusBar: 'light' as const } : s)),
    }
    mockApi(
      routes({
        'GET /artifacts/a1': artifact({ manifest: mini }),
        'GET /artifacts/a1/versions/v2': { ...detail, manifest: mini },
      }),
    )
    await openEditor()
    const device = screen.getByTestId('proto-device')
    expect(device.style.width).toBe('395px')
    expect(device.style.height).toBe('832px')
    const chrome = screen.getByTestId('proto-chrome')
    expect(within(chrome).getByText('9:41')).toBeTruthy()
    expect(within(chrome).getByTestId('proto-capsule')).toBeTruthy()
    // Drawn over the screen, never under the hotspots' coordinates: the screen's content keeps its place.
    expect(chrome.closest('[data-testid="proto-screen"]')).toBeNull()
    expect(chrome.className).toContain('proto-chrome--light')
    fromScreen({ type: 'nav', screen: 'detail' })
    expect(screen.getByTestId('proto-chrome').className).not.toContain('proto-chrome--light')
    fireEvent.click(screen.getByRole('button', { name: '设备：手机' }))
    expect(screen.getByRole('menuitemcheckbox', { name: '手机 375×812' })).toBeTruthy()
    fireEvent.click(screen.getByRole('menuitemcheckbox', { name: '桌面 1440×900' }))
    expect(device.style.width).toBe('1460px')
    expect(screen.queryByTestId('proto-chrome')).toBeNull()
  })

  it('frames a mobile app at 390×844 with a status bar but no capsule', async () => {
    mockApi(routes())
    await openEditor()
    expect(screen.getByTestId('proto-device').style.width).toBe('410px')
    const chrome = screen.getByTestId('proto-chrome')
    expect(within(chrome).getByText('9:41')).toBeTruthy()
    expect(within(chrome).queryByTestId('proto-capsule')).toBeNull()
  })

  it('fills a narrow stage: the list starts as a pill, the rail lies along the bottom (P0 layout)', async () => {
    vi.spyOn(HTMLElement.prototype, 'clientWidth', 'get').mockReturnValue(660)
    vi.spyOn(HTMLElement.prototype, 'clientHeight', 'get').mockReturnValue(900)
    mockApi(routes())
    await openEditor()
    expect(screen.queryByRole('complementary', { name: '原型中的屏幕' })).toBeNull()
    expect(screen.getByRole('button', { name: /原型中的屏幕/ })).toBeTruthy()
    const stage = screen.getByTestId('proto-stage')
    expect(stage.style.paddingLeft).toBe('12px')
    expect(stage.style.paddingRight).toBe('12px')
    expect(stage.style.paddingBottom).toBe('68px')
    const rail = screen.getByRole('toolbar', { name: '原型工具' })
    expect(rail.getAttribute('aria-orientation')).toBe('horizontal')
    expect(rail.classList.contains('proto-rail--bottom')).toBe(true)
    const scale = Number.parseFloat(screen.getByTestId('proto-device').style.transform.slice(6))
    expect(scale).toBeCloseTo((900 - 96 - 68) / 864)
    // The element menu follows the device where it now sits.
    editMode()
    select({ rect: { x: 0, y: 100, w: 10, h: 20 } })
    const left = Number.parseFloat(screen.getByRole('dialog', { name: '编辑元素' }).style.left)
    expect(left).toBeCloseTo(12 + (660 - 12 - 12 - 410 * scale) / 2 + 10 * scale)
    // The AI pill sits above the rail.
    expect(screen.getByRole('button', { name: 'AI 改这屏' }).closest('.proto-pencil--raised')).toBeTruthy()
    // Opening the list makes room for it on the left.
    fireEvent.click(screen.getByRole('button', { name: /原型中的屏幕/ }))
    expect(stage.style.paddingLeft).toBe('236px')
  })

  it('puts the guide under the screens pill on a narrow stage', async () => {
    vi.spyOn(HTMLElement.prototype, 'clientWidth', 'get').mockReturnValue(390)
    vi.spyOn(HTMLElement.prototype, 'clientHeight', 'get').mockReturnValue(700)
    localStorage.removeItem(GUIDE_KEY)
    mockApi(routes())
    await openEditor()
    const hint = screen.getByRole('status', { name: '原型预览引导' })
    expect(hint.classList.contains('proto-guide--narrow')).toBe(true)
  })

  it('slides screens inside a fixed clip, so a transition never shows past the device (P1-04)', async () => {
    mockApi(routes())
    await openEditor()
    ready([{ ggId: '120', screen: 'detail', rect: { x: 0, y: 0, w: 10, h: 10 } }])
    fromScreen({ type: 'nav', screen: 'detail', transition: 'slide-up' })
    const moving = shown()
    expect(moving.className).toContain('proto-enter--slide-up')
    expect(moving.parentElement).toBe(screen.getByTestId('proto-clip'))
    expect(screen.getByTestId('proto-clip').className).toBe('proto-clip')
  })
})

describe('prototype preview walkthrough fixes (2026-11-09)', () => {
  it('keeps edit entries out of preview: add screen, imagine and the AI pill show in edit mode only', async () => {
    mockApi(routes())
    await openEditor()
    expect(screen.queryByRole('button', { name: /添加屏幕/ })).toBeNull()
    expect(screen.queryByRole('button', { name: /构想新屏/ })).toBeNull()
    expect(screen.queryByRole('button', { name: 'AI 改这屏' })).toBeNull()
    editMode()
    expect(screen.getByRole('button', { name: /添加屏幕/ })).toBeTruthy()
    expect(screen.getByRole('button', { name: /构想新屏/ })).toBeTruthy()
    const pill = screen.getByRole('button', { name: 'AI 改这屏' })
    expect(pill.textContent).toBe('AI 改这屏')
    // Back to preview closes the open request bar too.
    fireEvent.click(pill)
    expect(screen.getByRole('textbox', { name: '修改要求' })).toBeTruthy()
    fireEvent.click(screen.getByRole('radio', { name: '预览' }))
    expect(screen.queryByRole('textbox', { name: '修改要求' })).toBeNull()
  })

  it('says where the preview is, and goes back or starts over from the bar and the keyboard', async () => {
    mockApi(routes())
    await openEditor()
    const where = () => screen.getByTestId('proto-where').textContent
    const back = () => screen.queryByRole('button', { name: '返回' })
    const restart = () => screen.getByRole('button', { name: '重新开始' })
    expect(where()).toBe('首页 · 1/3')
    expect(back()).toBeNull()
    expect(restart().hasAttribute('disabled')).toBe(true)
    fromScreen({ type: 'nav', screen: 'shelf' })
    fromScreen({ type: 'nav', screen: 'detail' })
    expect(where()).toBe('书籍详情 · 2/3')
    fireEvent.click(back() as HTMLElement)
    expect(shown().dataset.screen).toBe('shelf')
    fireEvent.keyDown(window, { key: 'ArrowLeft' })
    expect(shown().dataset.screen).toBe('home')
    // A screen picked from the list is not the entry: starting over goes back to it.
    fireEvent.click(screen.getByRole('button', { name: /书架/ }))
    expect(restart().hasAttribute('disabled')).toBe(false)
    fireEvent.click(restart())
    expect(shown().dataset.screen).toBe('home')
    fromScreen({ type: 'nav', screen: 'detail' })
    fireEvent.keyDown(window, { key: 'Home' })
    expect(shown().dataset.screen).toBe('home')
    // Not while typing, nor in edit mode.
    fromScreen({ type: 'nav', screen: 'detail' })
    const input = document.createElement('input')
    document.body.appendChild(input)
    fireEvent.keyDown(input, { key: 'ArrowLeft' })
    expect(shown().dataset.screen).toBe('detail')
    input.remove()
    editMode()
    expect(screen.queryByTestId('proto-where')).toBeNull()
    fireEvent.keyDown(window, { key: 'Home' })
    expect(shown().dataset.screen).toBe('detail')
  })

  it('labels the device with its width, and reloads and highlights from the keyboard', async () => {
    mockApi(routes())
    await openEditor()
    const device = screen.getByRole('button', { name: '设备：手机' })
    expect(device.textContent).toBe('390')
    const frame = screen.getByTitle('首页')
    fireEvent.keyDown(window, { key: 'r' })
    expect(screen.getByTitle('首页')).not.toBe(frame)
    const toggle = screen.getByRole('button', { name: '高亮热点' })
    fireEvent.keyDown(window, { key: 'h' })
    expect(toggle.getAttribute('aria-pressed')).toBe('true')
    // Shortcuts are named in the tooltips.
    const tipOf = (b: HTMLElement) =>
      document.getElementById(b.getAttribute('aria-describedby') as string)?.textContent
    expect(tipOf(toggle)).toBe('高亮热点H')
    expect(tipOf(screen.getByRole('button', { name: '重新加载' }))).toBe('重新加载R')
  })

  it('shows the server’s screenshots in the screen list, a live page only where there is none', async () => {
    mockApi(
      routes({
        'GET /artifacts/a1/versions/v2': {
          ...detail,
          screenThumbs: [{ screenId: 'home', url: '/api/artifacts/a1/versions/v2/screens/home/thumbnail' }],
        },
      }),
    )
    await openEditor()
    const list = screen.getByRole('complementary', { name: '原型中的屏幕' })
    const shot = await within(list).findByRole('img', { name: '首页 缩略图' })
    expect(shot.getAttribute('src')).toBe('/api/artifacts/a1/versions/v2/screens/home/thumbnail')
    expect(within(list).queryByTitle('首页 缩略图')).toBe(null)
    expect(within(list).getByTitle('书架 缩略图').tagName).toBe('IFRAME')
  })
})
