import type {
  AnnotationDto,
  ArtifactDto,
  ArtifactVersionDto,
  BotDto,
  GroupDto,
  MessageDto,
  UserDto,
} from '@gonggong/protocol'
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
import { apiError, type Call, mockApi } from './mockApi'

// R3 of docs/plan/原型编辑器-Stitch对标-开发计划.md: Direct Edit, Mark, selection as chat context, AI commands.

const at = '2026-10-29T10:00:00Z'
const ORIGIN = 'https://a1.preview.test'
const TOKENS = `:root {
  --color-primary: #155332;
  --color-surface: #FFFFFF;
  --rounded-sm: 8px;
}`
const version = (n: number, o: Partial<ArtifactVersionDto> = {}): ArtifactVersionDto => ({
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
  ...o,
})
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
const bodies = (calls: Call[], method: string, path: string) =>
  calls.filter((c) => c.method === method && c.path === path).map((c) => c.body)

const fromScreen = (data: Record<string, unknown>, title = '首页') => {
  const iframe = screen.getByTitle(title) as HTMLIFrameElement
  act(() => {
    window.dispatchEvent(
      new MessageEvent('message', {
        data: { source: 'gg-bridge', file: 'screens/home.html', ...data },
        origin: ORIGIN,
        source: iframe.contentWindow,
      }),
    )
  })
}
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
const popover = () => screen.getByRole('dialog', { name: '编辑元素' })
const action = (name: RegExp) => within(popover()).getByRole('button', { name })
const item = (menu: HTMLElement, name: RegExp) => {
  const m = within(menu)
  const [hit] = [...m.queryAllByRole('menuitem', { name }), ...m.queryAllByRole('menuitemcheckbox', { name })]
  if (!hit) throw new Error(`no menu item ${name}`)
  return hit
}

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
  it('hides the popover while its element is panned out of view, and brings it back (T07)', async () => {
    vi.spyOn(HTMLElement.prototype, 'clientWidth', 'get').mockReturnValue(900)
    vi.spyOn(HTMLElement.prototype, 'clientHeight', 'get').mockReturnValue(700)
    mockApi(routes())
    await renderTab()
    key('e')
    select()
    expect(popover()).toBeTruthy()
    for (let i = 0; i < 4; i++) key('ArrowLeft', { shiftKey: true })
    expect(screen.queryByRole('dialog', { name: '编辑元素' })).toBeNull()
    for (let i = 0; i < 4; i++) key('ArrowRight', { shiftKey: true })
    expect(popover()).toBeTruthy()
  })

  it('edits the text of a text-only element in place: one text op', async () => {
    const calls = mockApi(routes())
    await renderTab()
    key('e')
    select()
    fireEvent.click(action(/编辑文字/))
    fireEvent.change(within(popover()).getByRole('textbox', { name: '文字' }), {
      target: { value: '本月共读' },
    })
    fireEvent.click(within(popover()).getByRole('button', { name: '保存' }))
    await waitFor(() =>
      expect(bodies(calls, 'POST', '/artifacts/a1/edits')).toEqual([
        {
          baseVersionId: 'v2',
          ops: [{ kind: 'text', file: 'screens/home.html', ggId: '120', text: '本月共读' }],
        },
      ]),
    )
    await waitFor(() => expect(screen.queryByRole('dialog', { name: '编辑元素' })).toBeNull())
  })

  it('leaves an element with children to the AI, and a script-made one to annotations', async () => {
    mockApi(routes())
    await renderTab()
    key('e')
    select({ textOnly: false })
    expect(action(/编辑文字/).hasAttribute('disabled')).toBe(true)
    expect(action(/编辑文字/).textContent).toContain('含子元素，交给 AI 修改')
    expect(action(/用 AI 修改/).hasAttribute('disabled')).toBe(false)
    select({ ggId: null })
    for (const name of [/编辑文字/, /用 AI 修改/, /属性/, /删除/])
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

  it('asks for a new screen linked from the element, with the bot picked among several', async () => {
    setBots(['b1', 'b2'])
    const calls = mockApi(routes())
    await renderTab()
    key('e')
    select()
    fireEvent.click(action(/连到新屏/))
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
    select()
    fireEvent.click(action(/编辑文字/))
    fireEvent.change(within(popover()).getByRole('textbox', { name: '文字' }), { target: { value: 'x' } })
    fireEvent.click(within(popover()).getByRole('button', { name: '保存' }))
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
    fireEvent.click(action(/属性/))
    return screen.getByTestId('art-element-panel')
  }

  it('shows the tag and the selector’s last parts', async () => {
    mockApi(routes())
    const panel = await openPanel()
    expect(panel.textContent).toContain('<h1>')
    expect(panel.textContent).toContain('…')
    expect(panel.textContent).toContain('section:nth-of-type(2)')
  })

  it('picks colours from the --color-* tokens only, and saves every change as one version', async () => {
    const calls = mockApi(routes())
    await openPanel({ inlineStyle: 'padding: 8px' })
    fireEvent.click(screen.getByRole('button', { name: '文字颜色' }))
    const options = screen.getAllByRole('menuitemcheckbox').map((o) => o.textContent)
    expect(options).toEqual(['默认', 'primary', 'surface'])
    fireEvent.click(screen.getByRole('menuitemcheckbox', { name: 'primary' }))
    fireEvent.change(screen.getByRole('textbox', { name: '字号' }), { target: { value: '18px' } })
    fireEvent.change(screen.getByRole('textbox', { name: '内边距' }), { target: { value: '' } })
    fireEvent.click(screen.getByRole('button', { name: '点击跳转到' }))
    fireEvent.click(screen.getByRole('menuitemcheckbox', { name: '书籍详情' }))
    fireEvent.click(screen.getByRole('button', { name: '转场' }))
    fireEvent.click(screen.getByRole('menuitemcheckbox', { name: '推回' }))
    fireEvent.change(screen.getByRole('textbox', { name: '文字' }), { target: { value: '本月共读' } })
    fireEvent.click(screen.getByRole('button', { name: '保存' }))
    const at = { file: 'screens/home.html', ggId: '120' }
    await waitFor(() =>
      expect(bodies(calls, 'POST', '/artifacts/a1/edits')).toEqual([
        {
          baseVersionId: 'v2',
          ops: [
            { kind: 'text', ...at, text: '本月共读' },
            { kind: 'attr', ...at, name: 'data-gg-link', value: 'detail' },
            { kind: 'attr', ...at, name: 'data-gg-transition', value: 'push-back' },
            {
              kind: 'style',
              ...at,
              props: { color: 'var(--color-primary)', 'font-size': '18px', padding: '' },
            },
          ],
        },
      ]),
    )
  })

  it('refuses free colours and unsafe values: saving stays off', async () => {
    mockApi(routes())
    await openPanel()
    const save = screen.getByRole('button', { name: '保存' })
    expect(save.hasAttribute('disabled')).toBe(true)
    fireEvent.change(screen.getByRole('textbox', { name: '字号' }), { target: { value: 'url(x)' } })
    expect(save.hasAttribute('disabled')).toBe(true)
    expect(screen.getByText(/只能填数值加单位/)).toBeTruthy()
    fireEvent.change(screen.getByRole('textbox', { name: '字号' }), { target: { value: 'var(--text-lg)' } })
    expect(save.hasAttribute('disabled')).toBe(false)
  })

  it('disables the text of an element with children', async () => {
    mockApi(routes())
    await openPanel({ textOnly: false })
    expect(screen.getByRole('textbox', { name: '文字' }).hasAttribute('disabled')).toBe(true)
  })

  it('uploads a replacement image, then saves it as an asset op; 取消 drops everything', async () => {
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
    fireEvent.click(screen.getByRole('button', { name: '保存' }))
    await waitFor(() =>
      expect(bodies(calls, 'POST', '/artifacts/a1/edits')).toEqual([
        {
          baseVersionId: 'v2',
          ops: [{ kind: 'asset', file: 'screens/home.html', ggId: '120', uploadId: 'up1' }],
        },
      ]),
    )
  })

  it('edits a link’s href and drops it with 取消', async () => {
    const calls = mockApi(routes())
    await openPanel({ tag: 'a', href: 'https://a.test' })
    fireEvent.change(screen.getByRole('textbox', { name: '链接' }), {
      target: { value: 'javascript:alert(1)' },
    })
    expect(screen.getByRole('button', { name: '保存' }).hasAttribute('disabled')).toBe(true)
    fireEvent.click(screen.getByRole('button', { name: '取消' }))
    expect(screen.queryByTestId('art-element-panel')).toBeNull()
    expect(bodies(calls, 'POST', '/artifacts/a1/edits')).toEqual([])
  })

  it('previews style values on the element as they are set, and puts its style back on 取消 (P2-07)', async () => {
    mockApi(routes())
    await renderTab()
    fromScreen({ type: 'ready', width: 390, height: 800 })
    const frame = (screen.getByTitle('首页') as HTMLIFrameElement).contentWindow as Window
    const post = vi.spyOn(frame, 'postMessage').mockImplementation(() => {})
    key('e')
    select({ inlineStyle: 'padding: 8px' })
    fireEvent.click(action(/属性/))
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
    fireEvent.click(screen.getByRole('button', { name: '取消' }))
    expect(previews().at(-1)?.props).toBeNull()
    for (const m of previews()) expect(BridgeToShell.safeParse(m).success).toBe(true)
  })

  it('pans the element out from under the panel when the panel opens (P2-08)', async () => {
    vi.spyOn(HTMLElement.prototype, 'clientWidth', 'get').mockReturnValue(900)
    vi.spyOn(HTMLElement.prototype, 'clientHeight', 'get').mockReturnValue(700)
    mockApi(routes())
    await renderTab()
    const world = () => {
      const m = /translate\((-?[\d.]+)px, (-?[\d.]+)px\) scale\(([\d.]+)\)/.exec(
        (document.querySelector('.art-world') as HTMLElement).style.transform,
      )
      return { x: Number(m?.[1]), z: Number(m?.[3]) }
    }
    const right = () => {
      const { x, z } = world()
      return x + (Number.parseFloat(node('detail').style.left) + 300 + 60) * z
    }
    key('e')
    fromScreen(
      {
        type: 'select',
        ggId: '130',
        selector: 'body > button',
        rect: { x: 300, y: 20, w: 60, h: 30 },
        tag: 'button',
        text: '加入',
        textOnly: true,
        computed: {},
        inlineStyle: '',
        src: null,
        href: null,
        link: null,
        file: 'screens/detail.html',
      },
      '书籍详情',
    )
    expect(right()).toBeGreaterThan(900 - 360 - 24)
    fireEvent.click(action(/属性/))
    expect(screen.getByTestId('art-element-panel')).toBeTruthy()
    expect(right()).toBeLessThanOrEqual(900 - 360 - 24 + 0.5)
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

  it('lists the annotations, sends the ticked ones (all open by default) to the bot, resolves, and deletes the author’s own', async () => {
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
    fireEvent.click(screen.getByRole('button', { name: '批注' }))
    const list = await screen.findByTestId('art-annotations')
    const rows = within(list).getAllByRole('listitem')
    expect(rows[0]?.textContent).toContain('王磊')
    expect(rows[0]?.textContent).toContain('标题再大一点')
    expect(rows[0]?.textContent).toContain('待处理')
    expect(within(rows[1] as HTMLElement).queryByRole('button', { name: '删除' })).toBeNull()
    // Every open note starts ticked (P2-03); unticking leaves one out.
    expect(screen.getByRole('button', { name: '发给 @设计助手（2）' })).toBeTruthy()
    fireEvent.click(within(rows[0] as HTMLElement).getByRole('checkbox'))
    fireEvent.change(screen.getByRole('textbox', { name: '补充说明' }), { target: { value: '尽快' } })
    fireEvent.click(screen.getByRole('button', { name: '发给 @设计助手（1）' }))
    await waitFor(() =>
      expect(bodies(calls, 'POST', '/artifacts/a1/annotations/send')).toEqual([
        { annotationIds: ['n2'], botId: 'b1', extra: '尽快' },
      ]),
    )
    fireEvent.click(within(rows[1] as HTMLElement).getByRole('button', { name: '解决' }))
    fireEvent.click(within(rows[0] as HTMLElement).getByRole('button', { name: '删除' }))
    await waitFor(() => {
      expect(bodies(calls, 'PATCH', '/annotations/n2')).toEqual([{ status: 'resolved' }])
      expect(calls.some((c) => c.method === 'DELETE' && c.path === '/annotations/n1')).toBe(true)
    })
  })
})

describe('AI commands', () => {
  const commands = (calls: Call[]) => bodies(calls, 'POST', '/artifacts/a1/commands')

  it('sends every Generate item for the selected screens, all of them when several are selected', async () => {
    const calls = mockApi(routes())
    await renderTab()
    fireEvent.click(node('home'))
    fireEvent.click(node('detail'), { shiftKey: true })
    const expected: [RegExp, string][] = [
      [/即时原型/, 'instant-prototype'],
      [/^变体/, 'variations'],
      [/重新生成/, 'regenerate'],
      [/桌面网页版/, 'desktop-version'],
      [/补全状态/, 'missing-states'],
      [/动效/, 'animate'],
      [/应用商店素材/, 'app-store-assets'],
      [/网页素材/, 'web-assets'],
      [/营销物料/, 'marketing-kit'],
      [/无障碍检查/, 'accessibility-audit'],
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
    expect(it.getAttribute('title')).toBe('群里没有 Bot')
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
        <UserMessage m={m('标题再大点', ['b1'])} names={['设计助手', '前端']} />
      </MemoryRouter>,
    )
    expect(screen.getByText('发给 @设计助手')).toBeTruthy()
    unmount()
    const again = render(
      <MemoryRouter>
        <UserMessage m={m('@设计助手 标题再大点', ['b1'])} names={['设计助手', '前端']} />
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
        <UserMessage m={m('标题再大点', ['b1'], 'd1')} names={['设计助手']} />
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

  it('points to open annotations left on another version, and shows that version (R05)', async () => {
    mockApi(
      routes({
        'GET /artifacts/a1/annotations': [
          note({ versionId: 'v1' }),
          note({ id: 'n2', versionId: 'v1' }),
          note({ id: 'n3', versionId: 'v1', status: 'resolved' }),
        ],
        'GET /artifacts/a1/annotations?version=v1': [note({ versionId: 'v1' })],
      }),
    )
    await renderTab()
    fireEvent.click(screen.getByRole('button', { name: '批注' }))
    expect(await screen.findByText('还没有批注')).toBeTruthy()
    const hint = await screen.findByTestId('art-notes-elsewhere')
    expect(hint.textContent).toContain('v1 上还有 2 条未处理批注')
    fireEvent.click(within(hint).getByRole('button', { name: '查看' }))
    expect(await screen.findByText('正在查看 v1（只读）')).toBeTruthy()
  })
})
