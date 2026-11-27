import type { AnnotationDto, ArtifactDto, BotDto, GroupDto, MessageDto, UserDto } from '@gonggong/protocol'
import { BridgeToShell } from '@gonggong/protocol'
import { act, fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import { MemoryRouter } from 'react-router'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { useSession } from '../src/app/session'
import { useWorkbench } from '../src/app/workbench'
import { useWorkspace } from '../src/app/workspace'
import { ArtifactTab } from '../src/features/artifacts/ArtifactTab'
import { linkSpots } from '../src/features/artifacts/bridge'
import { artifactContextOf, clearContext, useCanvasContext } from '../src/features/artifacts/context'
import { elementBox, styleChanges } from '../src/features/artifacts/elements'
import { linkPaths } from '../src/features/artifacts/Links'
import { screenSection } from '../src/features/artifacts/notes'
import { resetArtifacts } from '../src/features/artifacts/store'
import { MessageComposer } from '../src/features/chat/MessageComposer'
import { UserMessage } from '../src/features/chat/TimelineItems'
import { realtime } from '../src/lib/realtime'
import { useToasts } from '../src/ui'
import { bodies, fromFrame, item, ORIGIN, versionAt } from './artifactFixtures'
import { apiError, type Call, mockApi } from './mockApi'
import { PROTO_COMMANDS } from './protoCommands'

// R3 of docs/archive/2026-11/原型编辑器-Stitch对标-开发计划.md: Direct Edit, Mark, selection as chat context, AI commands.

const at = '2026-10-29T10:00:00Z'
const TOKENS = `:root {
  --color-primary: #155332;
  --color-surface: #FFFFFF;
  --rounded-sm: 8px;
}`
const version = versionAt(at)
const manifest = {
  title: '读书会小程序',
  device: 'mobile' as const,
  entry: 'home',
  screens: [
    { id: 'home', title: '首页', file: 'screens/home.html' },
    { id: 'detail', title: '书籍详情', file: 'screens/detail.html' },
  ],
}
const { files: _, ...head } = version(2)
const artifact = (o: Partial<ArtifactDto> = {}): ArtifactDto => ({
  id: 'a1',
  favorites: [],
  botId: null,
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
  queued: false,
  queuedRunCount: 0,
  visibility: 'group',
  createdBy: null,
  kind: 'prototype',
  ...o,
})
const file = (path: string, hash = 'b') => ({ path, hash: hash.repeat(64), size: 10 })
const detail = (n: number, files = [file('tokens.css'), file('screens/home.html')]) => ({
  ...version(n, { files, authorName: n === 1 ? '王磊' : '设计助手' }),
  manifest,
  links: [],
})
const note = (o: Partial<AnnotationDto> = {}): AnnotationDto => ({
  id: 'n1',
  artifactId: 'a1',
  versionId: 'v2',
  file: 'screens/home.html',
  ggId: '120',
  selector: 'body > h1',
  rect: { x: 10, y: 20, w: 100, h: 30 },
  snippet: '<h1> 本周共读',
  note: '标题再大一点',
  authorId: 'u1',
  authorName: '王磊',
  status: 'open',
  createdAt: at,
  ...o,
})
const routes = (o: Record<string, unknown> = {}) => ({
  'GET /artifacts/a1': artifact(),
  'GET /artifacts/a1/versions': [version(1), version(2)],
  'GET /artifacts/a1/versions/v2': detail(2),
  'GET /artifacts/a1/versions/v1': detail(1),
  'GET /artifacts/a1/files/tokens.css?version=v2': () => new Response(TOKENS),
  'GET /artifacts/a1/annotations?version=v2': [],
  'POST /artifacts/a1/preview': { previewId: 'pw1', origin: ORIGIN, url: '/api/previews/pw1/open' },
  'POST /artifacts/a1/edits': artifact(),
  'POST /artifacts/a1/commands': { id: 'm1' },
  'GET /artifacts/a1/commands': PROTO_COMMANDS,
  ...o,
})

const me = { id: 'u1', name: '王磊', role: 'member' } as UserDto
const bots = [
  { id: 'b1', name: '设计助手', presence: 'online' },
  { id: 'b2', name: '前端', presence: 'running' },
] as BotDto[]
const setBots = (ids: string[]) =>
  useWorkspace.setState({
    groups: [{ id: 'g1', kind: 'group', members: [], botIds: ids } as unknown as GroupDto],
    bots,
  })

const tab = { kind: 'artifact' as const, artifactId: 'a1', title: '读书会小程序' }
const renderTab = async () => {
  render(<ArtifactTab tab={tab} tabKey="artifact:a1" active />)
  await screen.findByTitle('首页')
  // The design-system node appears with tokens.css.
  await screen.findByTestId('art-node-@system')
}
const canvas = () => screen.getByRole('application', { name: '画布' })
const node = (id: string) => screen.getByTestId(`art-node-${id}`)
const key = (k: string, o: Record<string, unknown> = {}) => fireEvent.keyDown(canvas(), { key: k, ...o })

const fromScreen = (data: Record<string, unknown>, title = '首页') =>
  fromFrame(screen.getByTitle(title) as HTMLIFrameElement, 'screens/home.html', data)
const select = (o: Record<string, unknown> = {}) =>
  fromScreen({
    type: 'select',
    ggId: '120',
    selector: 'body > section:nth-of-type(2) > div > h1',
    rect: { x: 10, y: 20, w: 100, h: 30 },
    tag: 'h1',
    text: '本周共读',
    textOnly: true,
    computed: { color: 'rgb(0, 0, 0)', 'font-size': '16px' },
    inlineStyle: '',
    src: null,
    href: null,
    link: null,
    ...o,
  })
const popover = () => screen.getByRole('region', { name: '模块操作' })
const action = (name: RegExp) => within(popover()).getByRole('button', { name })

class NoopSocket {
  close() {}
}
beforeEach(() => {
  localStorage.clear()
  resetArtifacts()
  clearContext()
  useToasts.setState({ items: [] })
  vi.stubGlobal('WebSocket', NoopSocket)
  vi.spyOn(realtime, 'subscribe').mockImplementation(() => () => {})
  useWorkbench.setState({ groupId: 'g1', open: false, mode: 'split', previous: 'split', benches: {} })
  useSession.setState({ user: me, status: 'ready' })
  setBots(['b1'])
})
afterEach(() => {
  vi.unstubAllGlobals()
  vi.restoreAllMocks()
})

describe('direct edit (E)', () => {
  it('puts the element’s actions in the 属性面板, by tab, not over the canvas', async () => {
    mockApi(routes())
    await renderTab()
    key('e')
    select()
    expect(screen.queryByRole('dialog', { name: '编辑元素' })).toBeNull()
    const inspector = screen.getByTestId('art-inspector')
    expect(inspector.contains(popover())).toBe(true)
    const names = () =>
      within(popover())
        .getAllByRole('button')
        .map((b) => b.textContent)
    expect(names()).toEqual(['编辑文字', '用 AI 修改', '删除'])
    fireEvent.click(within(inspector).getByRole('tab', { name: '交互' }))
    expect(names()).toEqual(['构想新屏', '添加规则'])
    // Panning the canvas leaves them where they are.
    for (let i = 0; i < 4; i++) key('ArrowLeft', { shiftKey: true })
    expect(popover()).toBeTruthy()
  })

  it('edits text in the screen itself: 编辑文字 asks the screen, what it posts back is one text op', async () => {
    const calls = mockApi(routes())
    await renderTab()
    fromScreen({ type: 'ready', width: 390, height: 800 })
    const frame = (screen.getByTitle('首页') as HTMLIFrameElement).contentWindow as Window
    const post = vi.spyOn(frame, 'postMessage').mockImplementation(() => {})
    key('e')
    select()
    fireEvent.click(action(/编辑文字/))
    expect(post.mock.calls.map(([m]) => m).at(-1)).toEqual({
      source: 'gg-host',
      type: 'edit-text',
      ggId: '120',
    })
    fromScreen({ type: 'text-edit', state: 'editing', ggId: '120', text: null })
    expect(within(popover()).getByRole('status').textContent).toBe('直接输入，回车保存，Esc 取消')
    expect(action(/编辑文字/).getAttribute('aria-pressed')).toBe('true')
    fromScreen({ type: 'text-edit', state: 'done', ggId: '120', text: '本月共读' })
    await waitFor(() =>
      expect(bodies(calls, 'POST', '/artifacts/a1/edits')).toEqual([
        {
          baseVersionId: 'v2',
          ops: [{ kind: 'text', file: 'screens/home.html', ggId: '120', text: '本月共读' }],
        },
      ]),
    )
    await waitFor(() => expect(screen.queryByRole('region', { name: '模块操作' })).toBeNull())
  })

  it('an element with children has its texts picked in the screen; unchanged or cancelled text saves nothing', async () => {
    const calls = mockApi(routes())
    await renderTab()
    key('e')
    select({ textOnly: false })
    expect(action(/编辑文字/).hasAttribute('disabled')).toBe(false)
    fireEvent.click(action(/编辑文字/))
    fromScreen({ type: 'text-edit', state: 'picking', ggId: null, text: null })
    expect(within(popover()).getByRole('status').textContent).toBe('点选要改的文字，Esc 退出')
    fromScreen({ type: 'text-edit', state: 'done', ggId: null, text: null })
    expect(within(popover()).queryByRole('status')).toBeNull()
    fromScreen({ type: 'text-edit', state: 'done', ggId: '120', text: null })
    expect(bodies(calls, 'POST', '/artifacts/a1/edits')).toEqual([])
    // Junk from a screen is dropped.
    fromScreen({ type: 'text-edit', state: 'done', ggId: '../x', text: 'x' })
    expect(bodies(calls, 'POST', '/artifacts/a1/edits')).toEqual([])
  })

  it('a double click in the screen edits without the menu', async () => {
    mockApi(routes())
    await renderTab()
    key('e')
    select()
    fromScreen({ type: 'text-edit', state: 'editing', ggId: '120', text: null })
    expect(screen.queryByRole('dialog', { name: '编辑元素' })).toBeNull()
  })

  it('reloads the screen when its typed text cannot be saved', async () => {
    mockApi(routes({ 'POST /artifacts/a1/edits': () => apiError(400, 'invalid', '元素包含子元素') }))
    await renderTab()
    fromScreen({ type: 'ready', width: 390, height: 800 })
    const frame = (screen.getByTitle('首页') as HTMLIFrameElement).contentWindow as Window
    const post = vi.spyOn(frame, 'postMessage').mockImplementation(() => {})
    key('e')
    fromScreen({ type: 'text-edit', state: 'done', ggId: '120', text: 'x' })
    await waitFor(() =>
      expect(post.mock.calls.map(([m]) => m).at(-1)).toEqual({ source: 'gg-host', type: 'reload' }),
    )
  })

  it('replaces an image by its address or an uploaded file', async () => {
    const calls = mockApi(
      routes({ 'POST /artifacts/a1/uploads': { uploadId: 'u'.repeat(64), path: 'assets/u.png' } }),
    )
    await renderTab()
    key('e')
    select({ tag: 'img', text: '', src: '../assets/cover.png' })
    expect(within(popover()).queryByRole('button', { name: /编辑文字/ })).toBeNull()
    fireEvent.click(action(/输入图片地址/))
    const url = within(popover()).getByRole('textbox', { name: '图片地址' }) as HTMLInputElement
    expect(url.value).toBe('../assets/cover.png')
    const apply = () => within(popover()).getByRole('button', { name: '应用' })
    expect(apply().hasAttribute('disabled')).toBe(true)
    fireEvent.change(url, { target: { value: 'http://x.test/a.png' } })
    expect(apply().hasAttribute('disabled')).toBe(true)
    expect(popover().textContent).toContain('只支持 https 地址或产物里的文件路径')
    fireEvent.change(url, { target: { value: 'https://x.test/a.png' } })
    fireEvent.click(apply())
    await waitFor(() =>
      expect(bodies(calls, 'POST', '/artifacts/a1/edits')).toEqual([
        {
          baseVersionId: 'v2',
          ops: [
            {
              kind: 'attr',
              file: 'screens/home.html',
              ggId: '120',
              name: 'src',
              value: 'https://x.test/a.png',
            },
          ],
        },
      ]),
    )
    await waitFor(() => expect(within(popover()).queryByRole('textbox', { name: '图片地址' })).toBeNull())

    select({ tag: 'img', text: '', src: '../assets/cover.png' })
    fireEvent.change(screen.getByTestId('art-pop-image'), {
      target: { files: [new File(['png'], 'b.png', { type: 'image/png' })] },
    })
    await waitFor(() =>
      expect(bodies(calls, 'POST', '/artifacts/a1/edits').at(-1)).toEqual({
        baseVersionId: 'v2',
        ops: [{ kind: 'asset', file: 'screens/home.html', ggId: '120', uploadId: 'u'.repeat(64) }],
      }),
    )
  })

  it('leaves a script-made element to annotations', async () => {
    mockApi(routes())
    await renderTab()
    key('e')
    select({ ggId: null })
    for (const name of [/编辑文字/, /用 AI 修改/, /删除/])
      expect(action(name).hasAttribute('disabled')).toBe(true)
  })

  it('deletes the element after confirming: one delete op', async () => {
    const calls = mockApi(routes())
    await renderTab()
    key('e')
    select()
    fireEvent.click(action(/删除/))
    const dialog = await screen.findByRole('alertdialog')
    expect(dialog.textContent).toContain('首页 › h1「本周共读」')
    fireEvent.click(within(dialog).getByRole('button', { name: '删除' }))
    await waitFor(() =>
      expect(bodies(calls, 'POST', '/artifacts/a1/edits')).toEqual([
        { baseVersionId: 'v2', ops: [{ kind: 'delete', file: 'screens/home.html', ggId: '120' }] },
      ]),
    )
  })

  it('hands the element to the group’s only bot with Edit With AI', async () => {
    const calls = mockApi(routes())
    await renderTab()
    key('e')
    select()
    fireEvent.click(action(/用 AI 修改/))
    fireEvent.change(within(popover()).getByRole('textbox', { name: '修改要求' }), {
      target: { value: '换成深色背景' },
    })
    fireEvent.click(within(popover()).getByRole('button', { name: '发给 @设计助手' }))
    await waitFor(() =>
      expect(bodies(calls, 'POST', '/artifacts/a1/commands')).toEqual([
        {
          command: 'edit-with-ai',
          botId: 'b1',
          ggIds: [{ file: 'screens/home.html', ggId: '120' }],
          text: '换成深色背景',
        },
      ]),
    )
    expect(useToasts.getState().items.map((x) => x.message)).toContain('已交给 @设计助手')
  })

  it('connects the element to a screen picked by hand under 交互: a link op, no AI', async () => {
    const calls = mockApi(routes())
    await renderTab()
    key('e')
    select()
    fireEvent.click(screen.getByRole('tab', { name: '交互' }))
    fireEvent.click(screen.getByRole('button', { name: '点击跳转到' }))
    fireEvent.click(screen.getByRole('menuitemcheckbox', { name: '书籍详情' }))
    // Applied by itself, no 保存.
    await waitFor(() =>
      expect(bodies(calls, 'POST', '/artifacts/a1/edits')).toEqual([
        {
          baseVersionId: 'v2',
          ops: [
            { kind: 'attr', file: 'screens/home.html', ggId: '120', name: 'data-gg-link', value: 'detail' },
          ],
        },
      ]),
    )
    expect(bodies(calls, 'POST', '/artifacts/a1/commands')).toEqual([])
  })

  it('asks for a new screen linked from the element, with the bot picked among several', async () => {
    setBots(['b1', 'b2'])
    const calls = mockApi(routes())
    await renderTab()
    key('e')
    select()
    fireEvent.click(screen.getByRole('tab', { name: '交互' }))
    fireEvent.click(action(/构想新屏/))
    fireEvent.change(within(popover()).getByRole('textbox', { name: '新屏描述' }), {
      target: { value: '书评列表' },
    })
    fireEvent.click(within(popover()).getByRole('button', { name: '交给' }))
    fireEvent.click(screen.getByRole('menuitemcheckbox', { name: '@前端' }))
    fireEvent.click(within(popover()).getByRole('button', { name: '发给 @前端' }))
    await waitFor(() =>
      expect(bodies(calls, 'POST', '/artifacts/a1/commands')).toEqual([
        {
          command: 'connect-element',
          botId: 'b2',
          ggIds: [{ file: 'screens/home.html', ggId: '120' }],
          text: '书评列表',
        },
      ]),
    )
  })

  it('says the artifact moved on when a save gets 409, and reloads it', async () => {
    const calls = mockApi(
      routes({ 'POST /artifacts/a1/edits': () => apiError(409, 'conflict', '产物已有新版本，请刷新后重做') }),
    )
    await renderTab()
    const loads = () => calls.filter((c) => c.method === 'GET' && c.path === '/artifacts/a1').length
    const before = loads()
    key('e')
    fromScreen({ type: 'text-edit', state: 'done', ggId: '120', text: 'x' })
    await waitFor(() =>
      expect(useToasts.getState().items).toEqual([
        expect.objectContaining({
          type: 'warning',
          title: '产物已更新，已刷新',
          message: '产物已有新版本，请刷新后重做',
        }),
      ]),
    )
    expect(loads()).toBeGreaterThan(before)
  })
})

describe('element panel', () => {
  const openPanel = async (o: Record<string, unknown> = {}) => {
    await renderTab()
    key('e')
    select(o)
    return screen.getByTestId('art-element-panel')
  }

  it('shows the tag and the selector’s last parts under 交互', async () => {
    mockApi(routes())
    await openPanel()
    fireEvent.click(screen.getByRole('tab', { name: '交互' }))
    const panel = screen.getByTestId('art-element-panel')
    expect(panel.textContent).toContain('<h1>')
    expect(panel.textContent).toContain('…')
    expect(panel.textContent).toContain('section:nth-of-type(2)')
  })

  it('picks colours from the --color-* tokens or any hex, and saves 外观 and 交互 as one version', async () => {
    const calls = mockApi(routes())
    await openPanel({ inlineStyle: 'padding: 8px' })
    fireEvent.click(screen.getByRole('button', { name: '文字颜色' }))
    const options = screen.getAllByRole('menuitemcheckbox').map((o) => o.textContent)
    expect(options).toEqual(['默认', 'primary', 'surface'])
    fireEvent.click(screen.getByRole('menuitemcheckbox', { name: 'primary' }))
    fireEvent.change(screen.getByRole('textbox', { name: '字号' }), { target: { value: '18px' } })
    fireEvent.change(screen.getByRole('textbox', { name: '内边距' }), { target: { value: '' } })
    fireEvent.input(screen.getByLabelText('背景：任意颜色'), { target: { value: '#1a73e8' } })
    fireEvent.click(screen.getByRole('button', { name: '斜体' }))
    fireEvent.change(screen.getByRole('slider', { name: '不透明度' }), { target: { value: '50' } })
    // 交互: the same draft.
    fireEvent.click(screen.getByRole('tab', { name: '交互' }))
    fireEvent.click(screen.getByRole('button', { name: '点击跳转到' }))
    fireEvent.click(screen.getByRole('menuitemcheckbox', { name: '书籍详情' }))
    fireEvent.click(screen.getByRole('button', { name: '转场' }))
    fireEvent.click(screen.getByRole('menuitemcheckbox', { name: '推回' }))
    const at = { file: 'screens/home.html', ggId: '120' }
    await waitFor(() =>
      expect(bodies(calls, 'POST', '/artifacts/a1/edits')).toEqual([
        {
          baseVersionId: 'v2',
          ops: [
            { kind: 'attr', ...at, name: 'data-gg-link', value: 'detail' },
            { kind: 'attr', ...at, name: 'data-gg-transition', value: 'push-back' },
            {
              kind: 'style',
              ...at,
              props: {
                color: 'var(--color-primary)',
                'font-size': '18px',
                padding: '',
                'background-color': '#1a73e8',
                'font-style': 'italic',
                opacity: '0.5',
              },
            },
          ],
        },
      ]),
    )
  })

  it('saves by itself once the member leaves a field, never an unsafe value', async () => {
    const calls = mockApi(routes())
    await openPanel()
    const size = screen.getByRole('textbox', { name: '字号' })
    act(() => size.focus())
    fireEvent.change(size, { target: { value: 'url(x)' } })
    expect(screen.getByText(/只能填数值加单位/)).toBeTruthy()
    act(() => size.blur())
    await new Promise((r) => setTimeout(r, 700))
    expect(bodies(calls, 'POST', '/artifacts/a1/edits')).toEqual([])
    // Typing: nothing saves until the field is left (Enter leaves it).
    act(() => size.focus())
    fireEvent.change(size, { target: { value: 'var(--text-lg)' } })
    await new Promise((r) => setTimeout(r, 700))
    expect(bodies(calls, 'POST', '/artifacts/a1/edits')).toEqual([])
    fireEvent.keyDown(size, { key: 'Enter' })
    await waitFor(() =>
      expect(bodies(calls, 'POST', '/artifacts/a1/edits')).toEqual([
        {
          baseVersionId: 'v2',
          ops: [
            {
              kind: 'style',
              file: 'screens/home.html',
              ggId: '120',
              props: { 'font-size': 'var(--text-lg)' },
            },
          ],
        },
      ]),
    )
    expect(screen.getByText('改完自动保存，可用撤销退回')).toBeTruthy()
  })

  it('edits text on the page itself (编辑文字), not in the panel', async () => {
    mockApi(routes())
    await openPanel({ textOnly: false })
    expect(screen.queryByRole('textbox', { name: '文字' })).toBeNull()
    expect(
      within(popover())
        .getByRole('button', { name: /编辑文字/ })
        .hasAttribute('disabled'),
    ).toBe(false)
  })

  it('uploads a replacement image, then saves it as an asset op by itself', async () => {
    const calls = mockApi(
      routes({ 'POST /artifacts/a1/uploads': { uploadId: 'up1', path: 'assets/up1.png' } }),
    )
    await openPanel({ tag: 'img', src: 'assets/cover.png', text: '', href: null })
    const image = new File([new Uint8Array([137, 80, 78, 71])], 'new.png', { type: 'image/png' })
    fireEvent.change(screen.getByTestId('art-element-image'), { target: { files: [image] } })
    await screen.findByText('new.png')
    const [upload] = calls.filter((c) => c.path === '/artifacts/a1/uploads')
    expect(upload?.method).toBe('POST')
    expect(upload?.body).toBe(image)
    await waitFor(() =>
      expect(bodies(calls, 'POST', '/artifacts/a1/edits')).toEqual([
        {
          baseVersionId: 'v2',
          ops: [{ kind: 'asset', file: 'screens/home.html', ggId: '120', uploadId: 'up1' }],
        },
      ]),
    )
  })

  it('never saves an unsafe href, and closing drops the draft', async () => {
    const calls = mockApi(routes())
    await openPanel({ tag: 'a', href: 'https://a.test' })
    fireEvent.click(screen.getByRole('tab', { name: '交互' }))
    fireEvent.change(screen.getByRole('textbox', { name: '链接' }), {
      target: { value: 'javascript:alert(1)' },
    })
    await new Promise((r) => setTimeout(r, 700))
    fireEvent.click(within(screen.getByTestId('art-inspector')).getByRole('button', { name: '关闭' }))
    expect(screen.queryByTestId('art-element-panel')).toBeNull()
    expect(bodies(calls, 'POST', '/artifacts/a1/edits')).toEqual([])
  })

  it('previews style values on the element as they are set, and puts its style back when closed unsaved (P2-07)', async () => {
    mockApi(routes())
    await renderTab()
    fromScreen({ type: 'ready', width: 390, height: 800 })
    const frame = (screen.getByTitle('首页') as HTMLIFrameElement).contentWindow as Window
    const post = vi.spyOn(frame, 'postMessage').mockImplementation(() => {})
    key('e')
    select({ inlineStyle: 'padding: 8px' })
    const previews = () =>
      post.mock.calls
        .map(([m]) => m as { type: string; ggId: string; props: unknown })
        .filter((m) => m.type === 'preview-style')
    fireEvent.change(screen.getByRole('textbox', { name: '字号' }), { target: { value: '18px' } })
    fireEvent.change(screen.getByRole('textbox', { name: '外边距' }), { target: { value: 'url(x)' } })
    expect(previews().at(-1)).toEqual({
      source: 'gg-host',
      type: 'preview-style',
      ggId: '120',
      props: { 'font-size': '18px' },
    })
    fireEvent.change(screen.getByRole('textbox', { name: '内边距' }), { target: { value: '' } })
    expect(previews().at(-1)?.props).toEqual({ 'font-size': '18px', padding: '' })
    fireEvent.click(within(screen.getByTestId('art-inspector')).getByRole('button', { name: '关闭' }))
    expect(previews().at(-1)?.props).toBeNull()
    for (const m of previews()) expect(BridgeToShell.safeParse(m).success).toBe(true)
  })

  it('docks the 属性面板 beside the canvas, and picks elements from 图层 (墨刀 layout)', async () => {
    mockApi(routes())
    await renderTab()
    fromScreen({ type: 'ready', width: 390, height: 800 })
    const frame = (screen.getByTitle('首页') as HTMLIFrameElement).contentWindow as Window
    const post = vi.spyOn(frame, 'postMessage').mockImplementation(() => {})
    const sent = () => post.mock.calls.map(([m]) => m as { type: string; ggId?: string })
    const inspector = screen.getByTestId('art-inspector')
    expect(canvas().contains(inspector)).toBe(false)
    expect(within(inspector).getByTestId('art-canvas-props')).toBeTruthy()
    expect(within(inspector).getByRole('tab', { name: '画布' }).getAttribute('aria-selected')).toBe('true')
    fireEvent.click(node('home'))
    const page = within(inspector).getByTestId('art-page-settings')
    expect((within(page).getByRole('textbox', { name: '页面名称' }) as HTMLInputElement).value).toBe('首页')

    fireEvent.click(within(inspector).getByRole('tab', { name: '图层' }))
    expect(sent().filter((m) => m.type === 'layers')).toHaveLength(1)
    fromScreen({
      type: 'layers',
      items: [
        { ggId: '110', tag: 'section', name: '', depth: 0 },
        { ggId: '120', tag: 'h1', name: '本周共读', depth: 1 },
        { ggId: '130', tag: 'img', name: '', depth: 1, hidden: true },
      ],
    })
    const row = (name: RegExp) => within(screen.getByTestId('art-layers')).getByRole('button', { name })
    expect(row(/^section$/)).toBeTruthy()
    expect(row(/img/).classList.contains('art-layers__row--hidden')).toBe(true)
    // Picked outside 直接编辑: it turns on, then the screen selects the element.
    fireEvent.click(row(/本周共读/))
    expect(screen.getByRole('button', { name: '选择' }).getAttribute('aria-pressed')).toBe('true')
    expect(sent().filter((m) => m.type === 'pick')).toEqual([
      expect.objectContaining({ type: 'pick', ggId: '120' }),
    ])
    select()
    expect(row(/本周共读/).getAttribute('aria-current')).toBe('true')
    // In edit mode a layer is picked at once.
    fireEvent.click(row(/^section$/))
    expect(
      sent()
        .filter((m) => m.type === 'pick')
        .at(-1),
    ).toMatchObject({ ggId: '110' })

    fireEvent.click(within(inspector).getByRole('tab', { name: '外观' }))
    expect(within(inspector).getByTestId('art-element-panel')).toBeTruthy()
    // Folded away and back: the choice is kept.
    fireEvent.click(screen.getByRole('button', { name: '收起属性面板' }))
    expect(screen.queryByTestId('art-inspector')).toBeNull()
    expect(localStorage.getItem('gg.art.inspector')).toBe('off')
    fireEvent.click(screen.getByRole('button', { name: '展开属性面板' }))
    expect(screen.getByTestId('art-inspector')).toBeTruthy()
  })

  it('画布设置: the selected page’s name, size, background and 热区, and drawing a new 热区', async () => {
    const calls = mockApi(routes())
    await renderTab()
    fromScreen({ type: 'ready', width: 390, height: 800 })
    fireEvent.click(node('home'))
    fromScreen({
      type: 'layers',
      items: [{ ggId: '300', tag: 'a', name: '热区', depth: 0, link: 'detail', hotspot: true }],
      body: { ggId: '40', background: 'rgb(255, 255, 255)' },
    })
    const inspector = screen.getByTestId('art-inspector')
    expect(within(inspector).getByRole('button', { name: '跳到 书籍详情' })).toBeTruthy()
    fireEvent.input(within(inspector).getByLabelText('背景：任意颜色'), { target: { value: '#f5f5f5' } })
    await waitFor(() =>
      expect(bodies(calls, 'POST', '/artifacts/a1/edits').at(-1)).toMatchObject({
        ops: [
          { kind: 'style', file: 'screens/home.html', ggId: '40', props: { 'background-color': '#f5f5f5' } },
        ],
      }),
    )
    const name = within(inspector).getByRole('textbox', { name: '页面名称' })
    fireEvent.change(name, { target: { value: '首页 2' } })
    fireEvent.blur(name)
    await waitFor(() =>
      expect(bodies(calls, 'POST', '/artifacts/a1/edits').at(-1)).toMatchObject({
        ops: [{ kind: 'manifest', op: 'rename', screenId: 'home', title: '首页 2' }],
      }),
    )

    fireEvent.click(within(inspector).getByRole('button', { name: '添加热区' }))
    expect(screen.getByRole('button', { name: '热区' }).getAttribute('aria-pressed')).toBe('true')
    expect(within(inspector).getByTestId('art-hotspot').textContent).toContain('按住拖动')
    fromScreen({ type: 'mark-rect', rect: { x: 12.4, y: 300, w: 120, h: 48 }, ggIds: [] })
    expect(within(inspector).getByTestId('art-hotspot').textContent).toContain('120 × 48')
    fireEvent.click(within(inspector).getByRole('button', { name: '保存' }))
    await waitFor(() =>
      expect(bodies(calls, 'POST', '/artifacts/a1/edits').at(-1)).toMatchObject({
        ops: [
          {
            kind: 'hotspot',
            file: 'screens/home.html',
            rect: { x: 12, y: 300, w: 120, h: 48 },
            to: 'detail',
            transition: 'push',
          },
        ],
      }),
    )
  })

  it('keeps only changed style props', () => {
    expect(styleChanges({ color: 'var(--color-a)' }, { color: 'var(--color-a)', padding: '' })).toEqual({})
    expect(styleChanges({ padding: '4px' }, { padding: ' 8px ' })).toEqual({ padding: '8px' })
  })
})

describe('mark (M)', () => {
  it('annotates the clicked element of the shown version', async () => {
    const calls = mockApi(routes({ 'POST /artifacts/a1/annotations': note() }))
    await renderTab()
    key('m')
    select()
    const pop = screen.getByRole('dialog', { name: '批注' })
    fireEvent.change(within(pop).getByRole('textbox', { name: '意见' }), {
      target: { value: '标题再大一点' },
    })
    fireEvent.click(within(pop).getByRole('button', { name: '添加批注' }))
    await waitFor(() =>
      expect(bodies(calls, 'POST', '/artifacts/a1/annotations')).toEqual([
        {
          versionId: 'v2',
          file: 'screens/home.html',
          ggId: '120',
          selector: 'body > section:nth-of-type(2) > div > h1',
          rect: { x: 10, y: 20, w: 100, h: 30 },
          snippet: '<h1> 本周共读',
          note: '标题再大一点',
        },
      ]),
    )
    await waitFor(() => expect(screen.queryByRole('dialog', { name: '批注' })).toBeNull())
    expect(calls.filter((c) => c.path === '/artifacts/a1/annotations?version=v2').length).toBe(2)
  })

  it('numbers the annotations on the canvas where their elements are, following pan and zoom', async () => {
    mockApi(
      routes({ 'GET /artifacts/a1/annotations?version=v2': [note(), note({ id: 'n2', status: 'sent' })] }),
    )
    await renderTab()
    key('m')
    const bubble = await screen.findByTestId('art-bubble-n1')
    expect(bubble.textContent).toBe('1')
    expect(screen.getByTestId('art-bubble-n2').className).toContain('art-bubble--sent')
    const before = bubble.style.left
    key('ArrowLeft')
    expect(bubble.style.left).not.toBe(before)
  })

  it('maps an element rect to the canvas', () => {
    expect(elementBox({ x: 840, y: 0 }, { x: 10, y: 20, w: 100, h: 30 }, { x: 50, y: 40, z: 0.5 })).toEqual({
      left: 50 + 850 * 0.5,
      top: 40 + 20 * 0.5,
      width: 50,
      height: 15,
    })
  })

  it('shows a page’s annotations in its 页面文档: hands the open ones to the bot, resolves, deletes the author’s own', async () => {
    const calls = mockApi(
      routes({
        'GET /artifacts/a1/annotations?version=v2': [
          note(),
          note({ id: 'n2', authorId: 'u2', authorName: '李建国', note: '按钮改圆角' }),
        ],
        'POST /artifacts/a1/annotations/send': { id: 'm2' },
        'PATCH /annotations/n2': note({ id: 'n2', status: 'resolved' }),
        'DELETE /annotations/n1': undefined,
      }),
    )
    await renderTab()
    expect(screen.queryByRole('tab', { name: '批注' })).toBeNull()
    const doc = await screen.findByTestId('art-pagedoc-home')
    const rows = within(doc).getAllByRole('listitem')
    expect(rows[0]?.textContent).toContain('标题再大一点')
    expect(rows[0]?.textContent).toContain('王磊 · 待处理')
    expect(within(rows[1] as HTMLElement).queryByRole('button', { name: '删除' })).toBeNull()
    fireEvent.click(within(doc).getByRole('button', { name: '交给 AI 处理' }))
    await waitFor(() =>
      expect(bodies(calls, 'POST', '/artifacts/a1/annotations/send')).toEqual([
        { annotationIds: ['n1', 'n2'], botId: 'b1' },
      ]),
    )
    fireEvent.click(within(rows[1] as HTMLElement).getByRole('button', { name: '标为已解决' }))
    fireEvent.click(within(rows[0] as HTMLElement).getByRole('button', { name: '删除' }))
    // Deleting asks first: nothing goes until confirmed.
    expect(calls.some((c) => c.method === 'DELETE')).toBe(false)
    fireEvent.click(within(rows[0] as HTMLElement).getByRole('button', { name: '确认删除' }))
    await waitFor(() => {
      expect(bodies(calls, 'PATCH', '/annotations/n2')).toEqual([{ status: 'resolved' }])
      expect(calls.some((c) => c.method === 'DELETE' && c.path === '/annotations/n1')).toBe(true)
    })
  })

  it('页面文档: 编写页面文档 beside a page’s name opens one to type in, saved as docs/<id>.md; AI 帮我写 asks the bot', async () => {
    const calls = mockApi(routes())
    await renderTab()
    expect(screen.queryByTestId('art-pagedoc-home')).toBeNull()
    const title = screen.getByRole('button', { name: '首页' }).closest('.art-title') as HTMLElement
    fireEvent.click(within(title).getByRole('button', { name: '编写页面文档' }))
    const doc = screen.getByTestId('art-pagedoc-home')
    // The page after it makes way for it.
    const left = (id: string) => Number.parseFloat(node(id).style.left)
    expect(left('pagedoc:home')).toBeGreaterThan(left('home'))
    expect(left('detail')).toBeGreaterThan(left('pagedoc:home') + 400)
    const box = within(doc).getByRole('textbox', { name: '页面文档' })
    fireEvent.change(box, { target: { value: '# 首页\n\n- 本周共读入口' } })
    fireEvent.blur(box)
    await waitFor(() =>
      expect(bodies(calls, 'POST', '/artifacts/a1/edits')).toEqual([
        {
          baseVersionId: 'v2',
          ops: [{ kind: 'file', path: 'docs/home.md', content: '# 首页\n\n- 本周共读入口' }],
        },
      ]),
    )
    fireEvent.click(within(doc).getByRole('button', { name: 'AI 帮我写' }))
    await waitFor(() =>
      expect(bodies(calls, 'POST', '/artifacts/a1/commands')).toContainEqual(
        expect.objectContaining({ command: 'write-doc', botId: 'b1', screenIds: ['home'] }),
      ),
    )
  })
})

describe('AI commands', () => {
  const commands = (calls: Call[]) => bodies(calls, 'POST', '/artifacts/a1/commands')

  it("sends every Generate item, the platform's and the artifact plugin's, for the selected screens", async () => {
    const calls = mockApi(routes())
    await renderTab()
    await waitFor(() => expect(calls.some((c) => c.path === '/artifacts/a1/commands')).toBe(true))
    fireEvent.click(node('home'))
    fireEvent.click(node('detail'), { shiftKey: true })
    const expected: [RegExp, string][] = [
      [/^变体/, 'variations'],
      [/重新生成/, 'regenerate'],
      [/动效/, 'animate'],
      ...PROTO_COMMANDS.map((c): [RegExp, string] => [new RegExp(c.title), c.name]),
    ]
    for (const [name] of expected) {
      fireEvent.click(screen.getByRole('button', { name: '生成' }))
      fireEvent.click(item(screen.getByRole('menu'), name))
    }
    await waitFor(() =>
      expect(commands(calls)).toEqual(
        expected.map(([, command]) => ({ command, botId: 'b1', screenIds: ['home', 'detail'] })),
      ),
    )
  })

  it('makes variations along a dimension from the context menu, and custom ones with ⇧V', async () => {
    const calls = mockApi(routes())
    await renderTab()
    fireEvent.click(node('home'))
    fireEvent.contextMenu(node('home'))
    fireEvent.click(item(screen.getByRole('menu'), /^变体/))
    fireEvent.click(item(screen.getAllByRole('menu').at(-1) as HTMLElement, /布局/))
    await waitFor(() =>
      expect(commands(calls)).toEqual([
        { command: 'variations', botId: 'b1', screenIds: ['home'], count: 3, text: '维度：布局' },
      ]),
    )
    key('V', { shiftKey: true })
    const dialog = await screen.findByRole('dialog', { name: '自定义变体' })
    fireEvent.change(within(dialog).getByRole('textbox', { name: '变体方向' }), {
      target: { value: '更活泼' },
    })
    fireEvent.change(within(dialog).getByRole('spinbutton'), { target: { value: '2' } })
    fireEvent.blur(within(dialog).getByRole('spinbutton'))
    fireEvent.click(within(dialog).getByRole('button', { name: '发给 @设计助手' }))
    await waitFor(() =>
      expect(commands(calls)[1]).toEqual({
        command: 'variations',
        botId: 'b1',
        screenIds: ['home'],
        count: 2,
        text: '更活泼',
      }),
    )
  })

  it('regenerates with ⇧R; without bots the items are off', async () => {
    const calls = mockApi(routes())
    await renderTab()
    fireEvent.click(node('home'))
    key('R', { shiftKey: true })
    await waitFor(() =>
      expect(commands(calls)).toEqual([{ command: 'regenerate', botId: 'b1', screenIds: ['home'] }]),
    )
    act(() => setBots([]))
    fireEvent.click(screen.getByRole('button', { name: '生成' }))
    const it = item(screen.getByRole('menu'), /重新生成/)
    expect(it.hasAttribute('disabled')).toBe(true)
    expect(it.getAttribute('title')).toBe('暂无可用 Bot')
  })
})

describe('selection as chat context', () => {
  const group = { id: 'g1', kind: 'group', members: [], botIds: ['b1'] } as unknown as GroupDto

  it('follows the selection: a screen, then an element; × removes it', async () => {
    mockApi(routes())
    await renderTab()
    fireEvent.click(node('home'))
    const items = () => useCanvasContext.getState().context?.items.map((i) => i.key)
    expect(items()).toEqual(['screen:home'])
    key('e')
    select()
    expect(items()).toEqual(['el:screens/home.html#120'])
    act(() => key('Escape'))
    expect(items()).toEqual(['screen:home'])
    key('v')
    fireEvent.click(screen.getByTestId('art-plane'))
    expect(useCanvasContext.getState().context).toBeNull()
  })

  it('pins with ⌘L and 添加到对话 until removed', async () => {
    mockApi(routes())
    await renderTab()
    fireEvent.click(node('home'))
    key('l', { metaKey: true })
    fireEvent.click(node('detail'))
    expect(useCanvasContext.getState().context?.items.map((i) => [i.key, i.pinned])).toEqual([
      ['screen:home', true],
      ['screen:detail', false],
    ])
    fireEvent.contextMenu(node('detail'))
    fireEvent.click(item(screen.getByRole('menu'), /添加到对话/))
    fireEvent.click(screen.getByTestId('art-plane'))
    expect(useCanvasContext.getState().context?.items.map((i) => i.key)).toEqual([
      'screen:home',
      'screen:detail',
    ])
  })

  it('shows chips above the composer, sends them with the message, and drops them on another group', async () => {
    const calls = mockApi(routes({ 'POST /groups/g1/messages': { id: 'm1' } }))
    await renderTab()
    fireEvent.click(node('home'))
    key('e')
    select()
    key('l', { metaKey: true })
    const { unmount } = render(<MessageComposer group={group} onSent={() => {}} />)
    const chips = screen.getByTestId('art-context-chips')
    expect(chips.textContent).toContain('首页 › h1「本周共读」')
    fireEvent.change(screen.getByRole('combobox'), { target: { value: '@设计助手 改大一点' } })
    fireEvent.keyDown(screen.getByRole('combobox'), { key: 'Enter' })
    await waitFor(() => expect(bodies(calls, 'POST', '/groups/g1/messages').length).toBe(1))
    expect(
      (bodies(calls, 'POST', '/groups/g1/messages')[0] as Record<string, unknown>).artifactContext,
    ).toEqual({
      artifactId: 'a1',
      elements: [{ file: 'screens/home.html', ggId: '120', label: 'h1「本周共读」' }],
    })
    await waitFor(() => expect(screen.queryByTestId('art-context-chips')).toBeNull())
    unmount()

    fireEvent.click(node('detail'))
    expect(useCanvasContext.getState().context?.groupId).toBe('g1')
    render(<MessageComposer group={{ ...group, id: 'g2' }} onSent={() => {}} />)
    expect(useCanvasContext.getState().context).toBeNull()
    expect(screen.queryByTestId('art-context-chips')).toBeNull()
  })

  it('says who a message without an @ goes to, and switches the bot with an @ (A02)', async () => {
    setBots(['b1', 'b2'])
    const calls = mockApi(
      routes({ 'GET /artifacts/a1': artifact({ botId: 'b1' }), 'POST /groups/g1/messages': { id: 'm1' } }),
    )
    await renderTab()
    fireEvent.click(node('home'))
    render(<MessageComposer group={{ ...group, botIds: ['b1', 'b2'] }} onSent={() => {}} />)
    const input = screen.getByRole('combobox')
    expect(input.getAttribute('placeholder')).toBe('描述要怎么改，发给 @设计助手')
    expect(screen.getByTestId('art-context-to').textContent).toContain('发给 @设计助手')
    expect(screen.queryByText(/未 @ 的消息不会触发 Bot/)).toBeNull()
    fireEvent.change(input, { target: { value: '标题再大点' } })
    fireEvent.click(screen.getByRole('button', { name: '换 Bot' }))
    fireEvent.click(screen.getByRole('menuitem', { name: '@前端' }))
    expect((input as HTMLTextAreaElement).value).toBe('@前端 标题再大点')
    // An explicit @ wins: no implicit target any more.
    expect(screen.queryByTestId('art-context-to')).toBeNull()
    expect(input.getAttribute('placeholder')).not.toContain('发给')
    fireEvent.keyDown(input, { key: 'Enter' })
    await waitFor(() => expect(bodies(calls, 'POST', '/groups/g1/messages').length).toBe(1))
  })

  it('keeps the plain hint when the artifact’s bot is not in the group', async () => {
    mockApi(routes({ 'GET /artifacts/a1': artifact({ botId: 'gone' }) }))
    await renderTab()
    fireEvent.click(node('home'))
    render(<MessageComposer group={group} onSent={() => {}} />)
    expect(screen.queryByTestId('art-context-to')).toBeNull()
    fireEvent.change(screen.getByRole('combobox'), { target: { value: '标题再大点' } })
    expect(screen.getByText('未 @ 的消息不会触发 Bot，会作为背景补充给下一次任务')).toBeTruthy()
  })

  it('labels a sent message with the bots it went to without an @', () => {
    setBots(['b1', 'b2'])
    const m = (body: string, mentions: string[], groupId = 'g1') =>
      ({
        id: `m-${body}`,
        seq: 1,
        groupId,
        kind: 'user',
        authorId: 'u1',
        authorName: '王磊',
        body,
        mentions,
        runId: null,
        createdAt: at,
        attachments: [],
        quote: null,
        reactions: [],
      }) as MessageDto
    const { unmount } = render(
      <MemoryRouter>
        <UserMessage
          m={m('标题再大点', ['b1'])}
          targets={[
            { id: 'b1', name: '设计助手' },
            { id: 'b2', name: '前端' },
          ]}
        />
      </MemoryRouter>,
    )
    expect(screen.getByText('发给 @设计助手')).toBeTruthy()
    unmount()
    const again = render(
      <MemoryRouter>
        <UserMessage
          m={m('@设计助手 标题再大点', ['b1'])}
          targets={[
            { id: 'b1', name: '设计助手' },
            { id: 'b2', name: '前端' },
          ]}
        />
      </MemoryRouter>,
    )
    expect(screen.queryByText('发给 @设计助手')).toBeNull()
    again.unmount()
    useWorkspace.setState({
      groups: [{ id: 'd1', kind: 'dm', members: [], botIds: ['b1'] } as unknown as GroupDto],
      bots,
    })
    render(
      <MemoryRouter>
        <UserMessage m={m('标题再大点', ['b1'], 'd1')} targets={[{ id: 'b1', name: '设计助手' }]} />
      </MemoryRouter>,
    )
    expect(screen.queryByText('发给 @设计助手')).toBeNull()
  })

  it('removes a chip with ×', async () => {
    mockApi(routes())
    await renderTab()
    fireEvent.click(node('home'))
    render(<MessageComposer group={group} onSent={() => {}} />)
    expect(screen.getByTestId('art-context-chips').textContent).toContain('读书会小程序 · 首页')
    fireEvent.click(screen.getByRole('button', { name: '移除 读书会小程序 · 首页' }))
    expect(screen.queryByTestId('art-context-chips')).toBeNull()
  })

  it('turns the context into the message’s artifactContext', () => {
    expect(
      artifactContextOf({
        groupId: 'g1',
        artifactId: 'a1',
        title: 'x',
        botId: null,
        items: [
          { key: 'screen:home', screenId: 'home', screenTitle: '首页', pinned: false },
          {
            key: 'el:screens/home.html#1',
            screenId: 'home',
            screenTitle: '首页',
            element: { file: 'screens/home.html', ggId: '1', label: 'h1' },
            pinned: true,
          },
        ],
      }),
    ).toEqual({
      artifactId: 'a1',
      screenIds: ['home'],
      elements: [{ file: 'screens/home.html', ggId: '1', label: 'h1' }],
    })
  })
})

describe('view details', () => {
  it('shows the version that last changed the screen and its design notes', async () => {
    const brief = '# 读书会\n\n## 首页\n今日金句与本周共读卡片。\n\n## 书籍详情\n封面与简介。\n'
    mockApi(
      routes({
        'GET /artifacts/a1/versions/v2': detail(2, [
          file('tokens.css'),
          file('screens/home.html'),
          file('brief.md'),
        ]),
        'GET /artifacts/a1/files/brief.md?version=v2': () => new Response(brief),
      }),
    )
    await renderTab()
    fireEvent.click(node('home'))
    key('i')
    expect((await screen.findByTestId('art-details-origin')).textContent).toMatch(/^v1 · 王磊 · /)
    expect(screen.getByTestId('art-details-note').textContent).toBe('今日金句与本周共读卡片。')
  })

  it('hides the notes without a brief, and stops at the version that changed the file', async () => {
    mockApi(
      routes({
        'GET /artifacts/a1/versions/v1': detail(1, [file('screens/home.html', 'c')]),
      }),
    )
    await renderTab()
    fireEvent.click(node('home'))
    key('i')
    expect((await screen.findByTestId('art-details-origin')).textContent).toMatch(/^v2 · 设计助手/)
    expect(screen.queryByTestId('art-details-note')).toBeNull()
  })

  it('shows the screen itself as the thumbnail, and the design system by its DESIGN.md name (E01)', async () => {
    mockApi(
      routes({
        'GET /artifacts/a1/versions/v2': detail(2, [
          file('tokens.css'),
          file('DESIGN.md'),
          file('screens/home.html'),
        ]),
        'GET /artifacts/a1/files/DESIGN.md?version=v2': () =>
          new Response('---\nname: 暖色书房\n---\n# 设计\n'),
      }),
    )
    await renderTab()
    fireEvent.click(node('home'))
    key('i')
    const panel = await screen.findByRole('complementary', { name: '首页' })
    const shot = within(panel).getByTestId('art-details-shot') as HTMLIFrameElement
    expect(decodeURIComponent(shot.getAttribute('src') ?? '')).toContain('/screens/home.html')
    expect(shot.tabIndex).toBe(-1)
    expect(shot.style.width).toBe('390px')
    expect(await within(panel).findByRole('button', { name: '暖色书房' })).toBeTruthy()
    expect(within(panel).queryByText('tokens.css')).toBeNull()
  })

  it('finds a screen’s section by its title or id', () => {
    const md = '## Home (home)\nA\n### Sub\nB\n## Detail\nC'
    expect(screenSection(md, { id: 'home', title: '首页' })).toBe('A\n### Sub\nB')
    expect(screenSection(md, { id: 'x', title: 'Detail' })).toBe('C')
    expect(screenSection(md, { id: 'none', title: '无' })).toBeNull()
  })
})

describe('link arrows', () => {
  it('start at the linking element the screen reported', () => {
    const nodes = [
      {
        id: 'home',
        kind: 'screen' as const,
        title: '首页',
        file: 'screens/home.html',
        x: 0,
        y: 0,
        w: 390,
        h: 800,
      },
      {
        id: 'detail',
        kind: 'screen' as const,
        title: '详情',
        file: 'screens/detail.html',
        x: 510,
        y: 0,
        w: 390,
        h: 800,
      },
    ]
    const links = [{ from: 'home', to: 'detail', ggId: '120', text: '' }]
    const view = { x: 0, y: 0, z: 1 }
    const spots = linkSpots([
      { ggId: '120', screen: 'detail', rect: { x: 20, y: 300, w: 100, h: 40 } },
      { ggId: 'bad', screen: 'x', rect: { x: 'no' } },
    ])
    expect(spots).toEqual([{ ggId: '120', screen: 'detail', rect: { x: 20, y: 300, w: 100, h: 40 } }])
    expect(linkPaths(nodes, links, view, { 'screens/home.html': spots ?? [] })[0]?.d).toMatch(/^M120 320 /)
    expect(linkPaths(nodes, links, view)[0]?.d).toMatch(/^M390 96 /)
  })
})

describe('Stitch round 2 fixes', () => {
  const offline = () =>
    useWorkspace.setState({
      groups: [{ id: 'g1', kind: 'group', members: [], botIds: ['b1'] } as unknown as GroupDto],
      bots: [{ id: 'b1', name: '设计助手', presence: 'offline' } as BotDto],
    })

  it('says an offline bot runs the request once it is back, and queues it (R04)', async () => {
    offline()
    const calls = mockApi(routes({ 'GET /artifacts/a1': artifact({ botId: 'b1' }) }))
    await renderTab()
    fireEvent.click(node('home'))
    fireEvent.click(screen.getByRole('button', { name: '生成' }))
    const menu = screen.getByRole('menu')
    expect(menu.textContent).toContain('@设计助手 离线，上线后执行')
    const regen = item(menu, /重新生成/)
    expect(regen.hasAttribute('disabled')).toBe(false)
    expect(regen.getAttribute('title')).toBe('@设计助手 离线，上线后执行')
    fireEvent.click(regen)
    await waitFor(() => expect(bodies(calls, 'POST', '/artifacts/a1/commands')).toHaveLength(1))
    expect(useToasts.getState().items.map((x) => x.message)).toContain('已排队，@设计助手 上线后执行')
    const group = { id: 'g1', kind: 'group', members: [], botIds: ['b1'] } as unknown as GroupDto
    render(<MessageComposer group={group} onSent={() => {}} />)
    expect(screen.getByTestId('art-context-to').textContent).toBe('@设计助手 离线，上线后执行')
    // Direct edit: Edit with AI still goes, saying so.
    key('e')
    select()
    const ai = action(/用 AI 修改/)
    expect(ai.hasAttribute('disabled')).toBe(false)
    expect(ai.textContent).toContain('@设计助手 离线，上线后执行')
    fireEvent.click(ai)
    expect(within(popover()).getByRole('note').textContent).toBe('@设计助手 离线，上线后执行')
  })
})
