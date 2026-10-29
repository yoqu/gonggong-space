import type { ArtifactVersionDto, BotDto, GroupDto, UserDto } from '@gonggong/protocol'
import { act, fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { useSession } from '../src/app/session'
import { useWorkbench } from '../src/app/workbench'
import { useWorkspace } from '../src/app/workspace'
import { ArtifactTab } from '../src/features/artifacts/ArtifactTab'
import { clearContext } from '../src/features/artifacts/context'
import { GUIDE_KEY, navReducer, startNav } from '../src/features/artifacts/prototype'
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

/** Renders the tab and opens the prototype editor with 演示. */
const openEditor = async () => {
  render(<ArtifactTab tab={tab} tabKey="artifact:a1" active />)
  await screen.findByTitle('首页')
  await waitFor(() =>
    expect(screen.getByRole('button', { name: '演示' }).hasAttribute('disabled')).toBe(false),
  )
  fireEvent.click(screen.getByRole('button', { name: '演示' }))
  await screen.findByRole('region', { name: '原型编辑器' })
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

  it('shows the guide once', async () => {
    localStorage.removeItem(GUIDE_KEY)
    mockApi(routes())
    await openEditor()
    const guide = screen.getByRole('dialog', { name: '原型编辑器引导' })
    fireEvent.click(within(guide).getByRole('button', { name: '开始体验' }))
    expect(screen.queryByRole('dialog', { name: '原型编辑器引导' })).toBeNull()
    expect(localStorage.getItem(GUIDE_KEY)).toBe('1')
  })

  it('highlights hotspots on demand, and labels them connected in edit mode', async () => {
    mockApi(routes())
    await openEditor()
    ready(
      [{ ggId: '120', screen: 'detail', rect: { x: 10, y: 300, w: 200, h: 40 } }],
      [{ ggId: '80', rect: { x: 0, y: 0, w: 40, h: 40 } }],
    )
    const hots = () => screen.getByTestId('proto-hots')
    expect(hots().children).toHaveLength(0)
    const toggle = screen.getByRole('button', { name: '高亮热点' })
    fireEvent.click(toggle)
    expect(toggle.getAttribute('aria-pressed')).toBe('true')
    expect(hots().children).toHaveLength(2)
    expect((hots().children[0] as HTMLElement).style.top).toBe('300px')
    expect(within(hots()).queryByText('已连接')).toBeNull()
    fireEvent.click(toggle)
    expect(hots().children).toHaveLength(0)
    editMode()
    expect(within(hots()).getByText('已连接')).toBeTruthy()
    expect(within(hots()).getByText('返回')).toBeTruthy()
    // The screen's document height sizes the frame.
    expect((screen.getByTitle('首页') as HTMLElement).style.height).toBe('1200px')
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
      within(screen.getByRole('dialog', { name: '编辑元素' })).getByRole('button', { name: /连到屏幕/ }),
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

  it('edits text and hands elements and whole screens to the AI', async () => {
    const calls = mockApi(routes())
    await openEditor()
    editMode()
    select()
    const menu = () => screen.getByRole('dialog', { name: '编辑元素' })
    fireEvent.click(within(menu()).getByRole('button', { name: /编辑文字/ }))
    fireEvent.change(within(menu()).getByRole('textbox', { name: '文字' }), { target: { value: '立即加入' } })
    fireEvent.click(within(menu()).getByRole('button', { name: '保存' }))
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

    // The pencil: a request about the whole screen goes out as an @bot message about it.
    fireEvent.click(screen.getByRole('button', { name: '用 AI 修改这屏' }))
    fireEvent.change(screen.getByRole('textbox', { name: '修改要求' }), { target: { value: '整体换成深色' } })
    fireEvent.click(screen.getByRole('button', { name: '发给 @设计助手' }))
    await waitFor(() => expect(bodies(calls, 'POST', '/groups/g1/messages')).toHaveLength(1))
    expect(bodies(calls, 'POST', '/groups/g1/messages')[0]).toMatchObject({
      body: '@设计助手 整体换成深色',
      artifactContext: { artifactId: 'a1', screenIds: ['home'] },
    })
  })

  it('imagines a new screen from the list without a selection', async () => {
    const calls = mockApi(routes())
    await openEditor()
    fireEvent.click(screen.getByRole('button', { name: /构想新屏/ }))
    fireEvent.change(screen.getByRole('textbox', { name: '新屏描述' }), { target: { value: '个人中心' } })
    fireEvent.click(screen.getByRole('button', { name: '发给 @设计助手' }))
    await waitFor(() =>
      expect(bodies(calls, 'POST', '/groups/g1/messages')[0]).toMatchObject({
        body: '@设计助手 新建一屏：个人中心',
        artifactContext: { artifactId: 'a1', screenIds: ['home'] },
      }),
    )
  })

  it('asks to turn sharing on before showing a QR code', async () => {
    const calls = mockApi(routes())
    await openEditor()
    fireEvent.click(screen.getByRole('button', { name: '扫码查看' }))
    const dialog = await screen.findByRole('dialog', { name: '扫码查看' })
    await within(dialog).findByText('先开启分享')
    expect(screen.queryByTestId('art-qr')).toBeNull()
    fireEvent.click(within(dialog).getByRole('button', { name: '开启分享' }))
    await screen.findByTestId('art-qr')
    expect(bodies(calls, 'POST', '/artifacts/a1/share')).toEqual([{ enabled: true }])
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
    expect(screen.queryByRole('region', { name: '原型编辑器' })).toBeNull()
    running = false
    await act(() => loadArtifact('a1'))
    await screen.findByRole('region', { name: '原型编辑器' })
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
    // The panel's primary button is the last 导出.
    const primary = screen.getAllByRole('button', { name: '导出' }).at(-1) as HTMLElement
    fireEvent.click(primary)
    expect(click).toHaveBeenCalled()
    expect((click.mock.contexts.at(-1) as HTMLAnchorElement).getAttribute('href')).toBe(
      '/api/artifacts/a1/export.zip?version=v2',
    )

    // Copy code takes the selected screens.
    fireEvent.click(screen.getByTestId('art-node-home'))
    expect(screen.getByTestId('art-export').textContent).toMatch('所选的 1 个屏幕')
    fireEvent.click(screen.getByRole('radio', { name: '复制代码' }))
    fireEvent.click(screen.getByRole('button', { name: '复制' }))
    await waitFor(() => expect(writeText).toHaveBeenCalledWith('<!-- screens/home.html -->\n<h1>首页</h1>'))

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
    const copy = within(dialog).getByRole('button', { name: '复制链接' })
    expect(copy.hasAttribute('disabled')).toBe(true)
    const toggle = within(dialog).getByRole('switch', { name: '开启分享' })
    await waitFor(() => expect(toggle.hasAttribute('disabled')).toBe(false))
    fireEvent.click(toggle)
    await within(dialog).findByText(ON.url)
    expect(bodies(calls, 'POST', '/artifacts/a1/share')).toEqual([{ enabled: true }])
    fireEvent.click(copy)
    await waitFor(() => expect(writeText).toHaveBeenCalledWith(ON.url))
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
