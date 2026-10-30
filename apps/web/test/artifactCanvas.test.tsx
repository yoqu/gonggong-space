import type { ArtifactDto, ArtifactVersionDto } from '@gonggong/protocol'
import { act, fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import { MemoryRouter } from 'react-router'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { useWorkbench } from '../src/app/workbench'
import { ArtifactTab } from '../src/features/artifacts/ArtifactTab'
import { acceptBridge, markReady, postToScreen } from '../src/features/artifacts/bridge'
import { requestDesignPanel } from '../src/features/artifacts/context'
import { besideBox } from '../src/features/artifacts/ElementPopover'
import {
  type CanvasNode,
  dropIndex,
  fitView,
  layoutNodes,
  neighbour,
  nodesInRect,
  rectOf,
  revealView,
} from '../src/features/artifacts/geometry'
import { implementationPrompt } from '../src/features/artifacts/implPrompt'
import { useLinkedArtifact } from '../src/features/artifacts/link'
import {
  artifactLink,
  focusArtifact,
  resetArtifacts,
  useArtifactFocus,
} from '../src/features/artifacts/store'
import { colorRole, colorRoles, parseTokens } from '../src/features/artifacts/tokens'
import { realtime } from '../src/lib/realtime'
import { mockApi } from './mockApi'

// R2 of docs/plan/原型编辑器-Stitch对标-开发计划.md: the canvas against Stitch's (capability list §3, §4, §9).

const at = '2026-10-29T10:00:00Z'
const ORIGIN = 'https://a1.preview.test'
const TOKENS = `/* tokens */
:root {
  --color-primary: #155332;
  --color-on-primary: #FFFFFF;
  --color-surface: #FFFFFF;
  --color-on-surface: #000000;
  --color-on-surface-variant: #737374;
  --color-evil: url(https://x.test/a.png);
  --rounded-sm: 8px;
  --space-sm: 8px;
  --text-title-md-size: 15px;
  --text-title-md-weight: 400;
  --text-title-md-leading: 21px;
}
.t-title-md { font-size: var(--text-title-md-size); }
`
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
const file = (path: string) => ({ path, hash: 'b'.repeat(64), size: 10 })
const detail = (o: Record<string, unknown> = {}) => ({
  ...version(2, { files: [file('gg-artifact.json'), file('tokens.css'), file('screens/home.html')] }),
  manifest,
  links: [{ from: 'home', to: 'detail', ggId: '120', text: '查看详情' }],
  ...o,
})
const routes = (o: Record<string, unknown> = {}) => ({
  'GET /artifacts/a1': artifact(),
  'GET /artifacts/a1/versions': [version(1), version(2)],
  'GET /artifacts/a1/versions/v2': detail(),
  'GET /artifacts/a1/files/tokens.css?version=v2': () => new Response(TOKENS),
  'GET /artifacts/a1/files/screens/home.html?version=v2': () =>
    new Response('<!doctype html>\n<html>\n<body>首页</body>\n</html>'),
  'POST /artifacts/a1/preview': { previewId: 'pw1', origin: ORIGIN, url: '/api/previews/pw1/open' },
  'POST /artifacts/a1/edits': artifact(),
  'PUT /artifacts/a1/favorites': (body: unknown) =>
    artifact({ favorites: (body as { screenIds: string[] }).screenIds }),
  ...o,
})
const tab = { kind: 'artifact' as const, artifactId: 'a1', title: '读书会小程序' }
const renderTab = async () => {
  render(<ArtifactTab tab={tab} tabKey="artifact:a1" active />)
  await screen.findByTitle('首页')
}
const canvas = () => screen.getByRole('application', { name: '画布' })
const node = (id: string) => screen.getByTestId(`art-node-${id}`)
const key = (k: string, o: Record<string, unknown> = {}) => fireEvent.keyDown(canvas(), { key: k, ...o })
const edits = (calls: { method: string; path: string; body: unknown }[]) =>
  calls.filter((c) => c.method === 'POST' && c.path === '/artifacts/a1/edits').map((c) => c.body)
const manifestOp = (op: string, screenId: string, extra: Record<string, unknown> = {}) => ({
  baseVersionId: 'v2',
  ops: [{ kind: 'manifest', op, screenId, ...extra }],
})
const openContext = (id: string) => {
  fireEvent.contextMenu(node(id))
  return screen.getByRole('menu')
}
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
  vi.stubGlobal('WebSocket', NoopSocket)
  vi.spyOn(realtime, 'subscribe').mockImplementation(() => () => {})
  useWorkbench.setState({ groupId: 'g1', open: false, mode: 'split', previous: 'split', benches: {} })
})
afterEach(() => {
  vi.unstubAllGlobals()
  vi.restoreAllMocks()
})

describe('bridge', () => {
  const frame = () => {
    const f = document.createElement('iframe')
    document.body.append(f)
    return f
  }
  const msg = { source: 'gg-bridge', type: 'size', file: 'screens/home.html', width: 390, height: 1800 }

  it('accepts a screen’s message only from the preview origin and that screen’s frame', () => {
    const home = frame()
    const other = frame()
    const frames = new Map([
      ['screens/home.html', home],
      ['screens/detail.html', other],
    ])
    const ev = (o: Partial<MessageEvent>) => ({ data: msg, origin: ORIGIN, source: home.contentWindow, ...o })
    expect(acceptBridge(ev({}), ORIGIN, frames)).toEqual(msg)
    expect(acceptBridge(ev({ origin: 'https://evil.test' }), ORIGIN, frames)).toBeNull()
    expect(acceptBridge(ev({}), null, frames)).toBeNull()
    expect(acceptBridge(ev({ source: other.contentWindow }), ORIGIN, frames)).toBeNull()
    expect(acceptBridge(ev({ source: window }), ORIGIN, frames)).toBeNull()
    expect(acceptBridge(ev({ data: { ...msg, source: 'gg-host' } }), ORIGIN, frames)).toBeNull()
    expect(acceptBridge(ev({ data: { ...msg, height: 'tall' } }), ORIGIN, frames)).toBeNull()
    expect(acceptBridge(ev({ data: { ...msg, file: 'screens/nope.html' } }), ORIGIN, frames)).toBeNull()
    const scroll = { source: 'gg-bridge', type: 'scroll', file: 'screens/home.html', scrollX: 0, scrollY: 40 }
    expect(acceptBridge(ev({ data: scroll }), ORIGIN, frames)).toEqual(scroll)
    expect(acceptBridge(ev({ data: { ...scroll, scrollY: 'far' } }), ORIGIN, frames)).toBeNull()
  })

  it('renders a screen at its full height once it reports it, and back to the device height on demand', async () => {
    mockApi(routes())
    await renderTab()
    const iframe = screen.getByTitle('首页') as HTMLIFrameElement
    const post = (data: unknown, origin = ORIGIN) =>
      act(() => {
        window.dispatchEvent(new MessageEvent('message', { data, origin, source: iframe.contentWindow }))
      })
    post(msg, 'https://evil.test')
    expect(node('home').style.height).toBe('844px')
    post(msg)
    expect(node('home').style.height).toBe('1800px')
    fireEvent.click(node('home'))
    expect(screen.getByTestId('art-select-home').textContent).toContain('390 x 1800')
    fireEvent.click(screen.getByRole('button', { name: '预览' }))
    fireEvent.click(item(screen.getByRole('menu'), /全高/))
    expect(node('home').style.height).toBe('844px')
    fireEvent.click(screen.getByRole('button', { name: '预览' }))
    fireEvent.click(item(screen.getByRole('menu'), /平板/))
    expect(node('home').style.width).toBe('768px')
    expect(node('home').style.height).toBe('1024px')
  })

  it('tells the screens the tool, and lets them take the pointer only for mark and edit', async () => {
    mockApi(routes())
    await renderTab()
    // The frame can show before the bridge's listener is in: let the effects of that render run first.
    await act(async () => {})
    const iframe = screen.getByTitle('首页') as HTMLIFrameElement
    const sent = vi.spyOn(iframe.contentWindow as Window, 'postMessage')
    expect(iframe.classList.contains('art-node__frame--live')).toBe(false)
    act(() => {
      window.dispatchEvent(
        new MessageEvent('message', {
          data: { source: 'gg-bridge', type: 'ready', file: 'screens/home.html', width: 390, height: 844 },
          origin: ORIGIN,
          source: iframe.contentWindow,
        }),
      )
    })
    key('e')
    expect(screen.getByRole('button', { name: '直接编辑' }).getAttribute('aria-pressed')).toBe('true')
    expect(iframe.classList.contains('art-node__frame--live')).toBe(true)
    expect(sent).toHaveBeenCalledWith({ source: 'gg-host', type: 'mode', mode: 'edit' }, ORIGIN)
    key('v')
    expect(iframe.classList.contains('art-node__frame--live')).toBe(false)
    expect(sent).toHaveBeenLastCalledWith({ source: 'gg-host', type: 'mode', mode: 'preview' }, ORIGIN)
  })
})

describe('nodes', () => {
  it('parses tokens.css without anything that loads or escapes', () => {
    const tk = parseTokens(TOKENS)
    expect(tk.colors.map((g) => g.group)).toEqual(['primary', 'surface'])
    expect(tk.colors[0]?.items).toEqual([
      { name: 'primary', value: '#155332' },
      { name: 'on-primary', value: '#FFFFFF' },
    ])
    expect(tk.vars.some(([k]) => k === '--color-evil')).toBe(false)
    expect(tk.type).toEqual([{ name: 'title-md', size: '15px', weight: '400', leading: '21px' }])
    expect(tk.radii).toEqual([{ name: 'sm', value: '8px' }])
  })

  it('puts the design system first and the prototype last', async () => {
    mockApi(routes())
    await renderTab()
    const ds = await screen.findByTestId('art-design-system')
    expect(within(ds).getByText('#155332')).toBeTruthy()
    expect(within(ds).getByText('title-md')).toBeTruthy()
    expect(within(ds).getByText('主要按钮')).toBeTruthy()
    // Artifact tokens are scoped, so they never shadow the site's own --space-*.
    expect(ds.style.getPropertyValue('--a-color-primary')).toBe('#155332')
    expect(ds.style.getPropertyValue('--space-sm')).toBe('')
    // The node's title and the toolbar's panel button.
    expect(screen.getAllByRole('button', { name: '设计系统' })).toHaveLength(2)
    expect(node('@system').style.left).toBe('0px')
    expect(node('home').style.left).toBe('840px')
    expect(node('detail').style.left).toBe('1350px')
    expect(node('@prototype').style.left).toBe('1860px')
    fireEvent.doubleClick(node('@system'))
    expect(screen.getByRole('complementary', { name: '设计系统' })).toBeTruthy()
    // Double-clicking the prototype opens the prototype editor on the entry screen.
    fireEvent.doubleClick(node('@prototype'))
    expect(screen.getByRole('region', { name: '原型编辑器' })).toBeTruthy()
    expect(screen.getByTestId('proto-screen').dataset.screen).toBe('home')
  })

  it('has no design-system node without tokens.css', async () => {
    mockApi(routes({ 'GET /artifacts/a1/versions/v2': detail({ files: [file('screens/home.html')] }) }))
    await renderTab()
    await waitFor(() => expect(screen.getByTestId('art-node-@prototype')).toBeTruthy())
    expect(screen.queryByTestId('art-node-@system')).toBeNull()
    expect(node('home').style.left).toBe('0px')
  })

  it('reorders by the drop position among the screens', () => {
    const n = (id: string, x: number) => ({
      id,
      kind: 'screen' as const,
      title: id,
      file: '',
      x,
      y: 0,
      w: 100,
      h: 100,
    })
    const s = [n('a', 0), n('b', 200), n('c', 400)]
    expect(dropIndex(s, 'a', 330)).toBe(1)
    expect(dropIndex(s, 'a', 500)).toBe(2)
    expect(dropIndex(s, 'c', 10)).toBe(0)
    expect(neighbour(s, s[1] as (typeof s)[0], 'right')?.id).toBe('c')
    expect(neighbour(s, s[1] as (typeof s)[0], 'left')?.id).toBe('a')
    expect(neighbour(s, s[1] as (typeof s)[0], 'up')).toBeUndefined()
  })
})

describe('context menu and screen operations', () => {
  it('duplicates, copies and pastes, and cuts to move', async () => {
    const calls = mockApi(routes())
    await renderTab()
    fireEvent.click(item(openContext('home'), /创建副本/))
    await waitFor(() => expect(edits(calls)).toEqual([manifestOp('duplicate', 'home')]))
    fireEvent.click(item(openContext('home'), /^复制/))
    fireEvent.click(item(openContext('detail'), /粘贴/))
    await waitFor(() => expect(edits(calls)).toHaveLength(2))
    expect(edits(calls)[1]).toEqual(manifestOp('duplicate', 'home'))
    fireEvent.click(node('home'))
    key('x', { metaKey: true })
    fireEvent.click(node('detail'))
    key('v', { metaKey: true })
    await waitFor(() => expect(edits(calls)).toHaveLength(3))
    expect(edits(calls)[2]).toEqual(manifestOp('reorder', 'home', { index: 1 }))
  })

  it('renames in place: Enter saves, Esc cancels', async () => {
    const calls = mockApi(routes())
    await renderTab()
    fireEvent.click(item(openContext('home'), /重命名/))
    const input = screen.getByRole('textbox', { name: '重命名' }) as HTMLInputElement
    expect(input.value).toBe('首页')
    fireEvent.keyDown(input, { key: 'Escape' })
    expect(screen.queryByRole('textbox', { name: '重命名' })).toBeNull()
    fireEvent.click(item(openContext('home'), /重命名/))
    const again = screen.getByRole('textbox', { name: '重命名' })
    fireEvent.change(again, { target: { value: '发现' } })
    fireEvent.keyDown(again, { key: 'Enter' })
    await waitFor(() => expect(edits(calls)).toEqual([manifestOp('rename', 'home', { title: '发现' })]))
  })

  it('deletes after confirming', async () => {
    const calls = mockApi(routes())
    await renderTab()
    fireEvent.click(item(openContext('detail'), /删除/))
    const dialog = await screen.findByRole('alertdialog', { name: '删除 1 个屏幕？' })
    expect(edits(calls)).toEqual([])
    fireEvent.click(within(dialog).getByRole('button', { name: '删除' }))
    await waitFor(() => expect(edits(calls)).toEqual([manifestOp('delete', 'detail')]))
  })

  it('shows the code with line numbers, and downloads the screen', async () => {
    const created = vi.fn(() => 'blob:x')
    vi.stubGlobal('URL', Object.assign(URL, { createObjectURL: created, revokeObjectURL: vi.fn() }))
    const click = vi.spyOn(HTMLAnchorElement.prototype, 'click').mockImplementation(() => {})
    mockApi(routes())
    await renderTab()
    fireEvent.click(item(openContext('home'), /查看代码/))
    const code = await screen.findByTestId('art-code')
    expect(within(code).getByText('<body>首页</body>')).toBeTruthy()
    expect(code.querySelectorAll('.art-code__no')).toHaveLength(4)
    expect(screen.getByRole('button', { name: '复制代码' })).toBeTruthy()
    fireEvent.click(item(openContext('home'), /下载/))
    await waitFor(() => expect(click).toHaveBeenCalled())
    expect((click.mock.instances[0] as unknown as HTMLAnchorElement).download).toBe('home.html')
  })

  it('opens details with type, size and source', async () => {
    mockApi(routes())
    await renderTab()
    fireEvent.click(item(openContext('home'), /查看详情/))
    const panel = screen.getByRole('complementary', { name: '首页' })
    expect(within(panel).getByText('设计屏幕')).toBeTruthy()
    expect(within(panel).getByTestId('art-details-size').textContent).toBe('390 x 844')
    fireEvent.click(within(panel).getByRole('button', { name: '查看代码' }))
    expect(await screen.findByTestId('art-code')).toBeTruthy()
  })

  it('lists canvas commands on the empty plane', async () => {
    mockApi(routes())
    await renderTab()
    fireEvent.contextMenu(screen.getByTestId('art-plane'))
    const menu = screen.getByRole('menu')
    expect(item(menu, /粘贴/).hasAttribute('disabled')).toBe(true)
    fireEvent.click(item(menu, /全选/))
    expect(screen.getByTestId('art-select-home')).toBeTruthy()
    expect(screen.getByTestId('art-select-detail')).toBeTruthy()
  })
})

describe('connections', () => {
  it('shows a screen’s connections when selected, and all with X', async () => {
    mockApi(routes())
    await renderTab()
    await waitFor(() => expect(screen.getByTestId('art-node-@system')).toBeTruthy())
    expect(screen.queryByText('查看详情')).toBeNull()
    fireEvent.click(node('detail'))
    expect(screen.getByTestId('art-link-home>detail').textContent).toBe('查看详情')
    key('Escape')
    expect(screen.queryByTestId('art-link-home>detail')).toBeNull()
    key('x')
    expect(screen.getByTestId('art-link-home>detail')).toBeTruthy()
    fireEvent.contextMenu(screen.getByTestId('art-plane'))
    fireEvent.click(item(screen.getByRole('menu'), /显示连线/))
    expect(screen.queryByTestId('art-link-home>detail')).toBeNull()
  })
})

describe('shortcuts', () => {
  it('runs the screen commands from the keyboard', async () => {
    const calls = mockApi(routes())
    await renderTab()
    fireEvent.click(node('home'))
    key('d', { metaKey: true })
    await waitFor(() => expect(edits(calls)).toEqual([manifestOp('duplicate', 'home')]))
    key('ArrowRight', { metaKey: true })
    expect(screen.getByTestId('art-select-detail')).toBeTruthy()
    expect(screen.queryByTestId('art-select-home')).toBeNull()
    key('ArrowLeft', { metaKey: true })
    expect(screen.getByTestId('art-select-home')).toBeTruthy()
    key('Backspace')
    expect(await screen.findByRole('alertdialog', { name: '删除 1 个屏幕？' })).toBeTruthy()
    fireEvent.click(screen.getByRole('button', { name: '取消' }))
    key('i')
    expect(screen.getByRole('complementary', { name: '首页' })).toBeTruthy()
    key('C', { shiftKey: true })
    expect(await screen.findByTestId('art-code')).toBeTruthy()
  })

  it('moves the view with the arrows and focuses the selection with F', async () => {
    mockApi(routes())
    await renderTab()
    const world = () => (canvas().querySelector('.art-world') as HTMLElement).style.transform
    const before = world()
    key('ArrowLeft')
    expect(world()).not.toBe(before)
    fireEvent.click(node('home'))
    key('f')
    expect(screen.getByRole('button', { name: '缩放' }).textContent).toBe('100%')
  })

  it('no longer marks implemented shortcuts as coming soon', async () => {
    mockApi(routes())
    await renderTab()
    key('?')
    const dialog = await screen.findByRole('dialog', { name: '快捷键' })
    const row = (name: string) => within(dialog).getByText(name).closest('.art-keys__row') as HTMLElement
    for (const name of ['聚焦所选', '下一屏', '创建副本', '显示连线', '下载所选'])
      expect(row(name).classList.contains('art-keys__row--soon')).toBe(false)
    // Every change is a version at once: there is no ⌘S. ⌘K, hold Z and ⇧ drag are in the sheet and work.
    expect(within(dialog).queryByText('保存')).toBeNull()
    for (const name of ['命令菜单', '缩放（按住，⌥ 缩小）', '框选'])
      expect(row(name).classList.contains('art-keys__row--soon')).toBe(false)
    expect(dialog.querySelector('.art-keys__row--soon')).toBeNull()
  })
})

describe('favourites', () => {
  it('stars with ⇧F and lists favourites in the panel', async () => {
    const calls = mockApi(routes())
    await renderTab()
    fireEvent.click(screen.getByRole('button', { name: '收藏' }))
    const panel = screen.getByRole('complementary', { name: '收藏' })
    expect(within(panel).getByText('还没有收藏')).toBeTruthy()
    expect(within(panel).getByText('选中屏幕按 ⇧F 收藏')).toBeTruthy()
    fireEvent.click(node('detail'))
    key('F', { shiftKey: true })
    await waitFor(() =>
      expect(calls).toContainEqual({
        method: 'PUT',
        path: '/artifacts/a1/favorites',
        body: { screenIds: ['detail'] },
      }),
    )
    key('Escape')
    fireEvent.click(within(panel).getByRole('button', { name: '书籍详情' }))
    expect(screen.getByTestId('art-select-detail')).toBeTruthy()
    key('F', { shiftKey: true })
    await waitFor(() =>
      expect(calls).toContainEqual({
        method: 'PUT',
        path: '/artifacts/a1/favorites',
        body: { screenIds: [] },
      }),
    )
  })

  it('shows the member’s favourites from the artifact', async () => {
    mockApi(routes({ 'GET /artifacts/a1': artifact({ favorites: ['home'] }) }))
    await renderTab()
    expect(screen.getByLabelText('已收藏')).toBeTruthy()
    fireEvent.click(screen.getByRole('button', { name: '收藏' }))
    expect(within(screen.getByRole('complementary', { name: '收藏' })).getByText('首页')).toBeTruthy()
  })
})

describe('while AI is editing', () => {
  it('is read-only with a banner', async () => {
    const calls = mockApi(routes({ 'GET /artifacts/a1': artifact({ running: true }) }))
    await renderTab()
    expect(screen.getByText('AI 正在修改')).toBeTruthy()
    expect(screen.getByRole('button', { name: '撤销' }).hasAttribute('disabled')).toBe(true)
    const menu = openContext('home')
    for (const name of [/创建副本/, /剪切/, /重命名/, /删除/])
      expect(item(menu, name).hasAttribute('disabled')).toBe(true)
    fireEvent.keyDown(menu, { key: 'Escape' })
    key('d', { metaKey: true })
    key('Backspace')
    key('e')
    expect(screen.queryByRole('alertdialog')).toBeNull()
    expect(screen.getByRole('button', { name: '直接编辑' }).hasAttribute('disabled')).toBe(true)
    // Favourites and reading stay available.
    key('F', { shiftKey: true })
    await waitFor(() => expect(calls.some((c) => c.method === 'PUT')).toBe(true))
    expect(edits(calls)).toEqual([])
  })
})

describe('Stitch round 1 fixes', () => {
  /** jsdom lays nothing out: give the plane a size. */
  const sized = (width: number, height: number) => {
    vi.spyOn(HTMLElement.prototype, 'clientWidth', 'get').mockReturnValue(width)
    vi.spyOn(HTMLElement.prototype, 'clientHeight', 'get').mockReturnValue(height)
  }
  const tool = (name: string) =>
    within(screen.getByRole('toolbar', { name: '画布工具' })).getByRole('button', { name })
  const side = () => canvas().style.getPropertyValue('--art-side')
  const float = () => screen.getByRole('toolbar', { name: '所选屏幕' })
  const titleLeft = (name: string) =>
    Number.parseFloat((screen.getByRole('button', { name }).closest('.art-title') as HTMLElement).style.left)

  it('puts the vertical toolbar’s tooltips on its left (T03)', async () => {
    mockApi(routes())
    await renderTab()
    const btn = tool('设计系统')
    const tip = document.getElementById(btn.getAttribute('aria-describedby') ?? '') as HTMLElement
    expect(tip.classList.contains('ui-tip--left')).toBe(true)
  })

  it('moves the selection toolbar off an open panel, icons only when narrow (C06)', async () => {
    sized(700, 600)
    mockApi(routes())
    await renderTab()
    fireEvent.click(node('home'))
    expect(side()).toBe('0px')
    expect(float().classList.contains('art-float--compact')).toBe(false)
    expect(within(float()).getByRole('button', { name: /生成/ }).textContent).toContain('生成')
    fireEvent.click(tool('收藏'))
    expect(side()).toBe('360px')
    expect(float().classList.contains('art-float--compact')).toBe(true)
    const gen = within(float()).getByRole('button', { name: '生成' })
    expect(gen.textContent).toBe('')
    expect(document.getElementById(gen.getAttribute('aria-describedby') ?? '')?.textContent).toBe('生成')
    fireEvent.click(tool('设计系统'))
    expect(side()).toBe('420px')
    fireEvent.click(tool('设计系统'))
    expect(side()).toBe('0px')
  })

  it('pans to a screen whose title takes the keyboard focus off screen (K03)', async () => {
    sized(600, 500)
    mockApi(routes())
    await renderTab()
    key('0', { shiftKey: true, code: 'Digit0' })
    key('ArrowLeft', { shiftKey: true })
    const before = titleLeft('书籍详情')
    expect(before < 0 || before > 600 - 64).toBe(true)
    act(() => screen.getByRole('button', { name: '书籍详情' }).focus())
    const after = titleLeft('书籍详情')
    expect(after).toBeGreaterThanOrEqual(0)
    expect(after).toBeLessThan(600 - 64)
    // In view already: focusing does not move it.
    act(() => screen.getByRole('button', { name: '书籍详情' }).blur())
    act(() => screen.getByRole('button', { name: '书籍详情' }).focus())
    expect(titleLeft('书籍详情')).toBe(after)
  })

  it('reveals a node by panning only, and leaves a visible one alone', () => {
    const n = {
      id: 'x',
      kind: 'screen' as const,
      title: 'x',
      file: 'screens/x.html',
      x: 1000,
      y: 0,
      w: 390,
      h: 844,
    }
    const v = { x: 0, y: 64, z: 1 }
    const next = revealView(n, v, { width: 800, height: 600 })
    expect(next?.z).toBe(1)
    expect(next?.y).toBe(64)
    expect((next?.x ?? 0) + n.x).toBe(400 - n.w / 2)
    expect(revealView(n, { x: -900, y: 64, z: 1 }, { width: 800, height: 600 })).toBeNull()
  })

  it('places the element popover below the toolbar, off the panel, and drops it off screen (T07)', () => {
    const room = { width: 900, height: 700, right: 0 }
    expect(besideBox({ left: 100, top: 10, width: 100, height: 30 }, room)).toEqual({
      left: 212,
      top: 56,
      width: 272,
    })
    // An open 360px panel: the popover goes left of the element.
    expect(besideBox({ left: 400, top: 200, width: 100, height: 30 }, { ...room, right: 360 })?.left).toBe(
      116,
    )
    expect(besideBox({ left: 600, top: 200, width: 100, height: 30 }, { ...room, right: 360 })).toBeNull()
    expect(besideBox({ left: -300, top: 200, width: 100, height: 30 }, room)).toBeNull()
    expect(besideBox({ left: 100, top: 900, width: 100, height: 30 }, room)).toBeNull()
  })
})

describe('Stitch round 2 fixes', () => {
  const sized = (width: number, height: number) => {
    vi.spyOn(HTMLElement.prototype, 'clientWidth', 'get').mockReturnValue(width)
    vi.spyOn(HTMLElement.prototype, 'clientHeight', 'get').mockReturnValue(height)
  }
  const zoomText = () => screen.getByRole('button', { name: '缩放' }).textContent
  const titleOf = (name: string) => screen.getByRole('button', { name }).closest('.art-title') as HTMLElement
  const twelve = {
    ...manifest,
    screens: Array.from({ length: 12 }, (_, i) => ({
      id: `s${i}`,
      title: `第 ${i} 屏`,
      file: `screens/s${i}.html`,
    })),
  }
  const post = (file: string, data: Record<string, unknown>, title = '首页') => {
    const iframe = screen.getByTitle(title) as HTMLIFrameElement
    act(() => {
      window.dispatchEvent(
        new MessageEvent('message', {
          data: { source: 'gg-bridge', file, ...data },
          origin: ORIGIN,
          source: iframe.contentWindow,
        }),
      )
    })
  }

  it('posts to a screen only once it said ready from the preview origin, the latest queued first (R01)', () => {
    const f = document.createElement('iframe')
    document.body.append(f)
    const sent = vi.spyOn(f.contentWindow as Window, 'postMessage')
    postToScreen(f, ORIGIN, { type: 'mode', mode: 'mark' })
    postToScreen(f, ORIGIN, { type: 'mode', mode: 'edit' })
    postToScreen(f, ORIGIN, { type: 'highlight', ggIds: ['1'] })
    expect(sent).not.toHaveBeenCalled()
    markReady(f, ORIGIN)
    expect(sent.mock.calls).toEqual([
      [{ source: 'gg-host', type: 'mode', mode: 'edit' }, ORIGIN],
      [{ source: 'gg-host', type: 'highlight', ggIds: ['1'] }, ORIGIN],
    ])
    postToScreen(f, ORIGIN, { type: 'select-clear' })
    expect(sent).toHaveBeenLastCalledWith({ source: 'gg-host', type: 'select-clear' }, ORIGIN)
    // Ready from another preview does not count for this one.
    sent.mockClear()
    postToScreen(f, 'https://a2.preview.test', { type: 'select-clear' })
    expect(sent).not.toHaveBeenCalled()
  })

  it('tells a screen nothing before it is ready, then its tool on ready (R01)', async () => {
    mockApi(routes())
    await renderTab()
    const iframe = screen.getByTitle('首页') as HTMLIFrameElement
    const sent = vi.spyOn(iframe.contentWindow as Window, 'postMessage')
    key('m')
    expect(sent).not.toHaveBeenCalled()
    post('screens/home.html', { type: 'ready', width: 390, height: 844 })
    expect(sent).toHaveBeenCalledWith({ source: 'gg-host', type: 'mode', mode: 'mark' }, ORIGIN)
    expect(sent).toHaveBeenCalledWith({ source: 'gg-host', type: 'highlight', ggIds: [] }, ORIGIN)
  })

  it('wraps many screens into rows by device width, the prototype after the last (R06)', () => {
    const { nodes } = layoutNodes({ title: 't', manifest: twelve, system: 640, frames: {}, content: {} })
    const at = (id: string) => nodes.find((n) => n.id === id) as CanvasNode
    expect(at('@system')).toMatchObject({ x: 0, y: 0 })
    expect([0, 1, 5].map((i) => at(`s${i}`).x)).toEqual([840, 1350, 3390])
    expect(at('s5').y).toBe(0)
    expect(at('s6')).toMatchObject({ x: 840, y: 844 + 120 + 32 })
    expect(at('@prototype')).toMatchObject({ x: 840, y: 2 * (844 + 120 + 32) })
    const desktop = layoutNodes({
      title: 't',
      manifest: { ...twelve, device: 'desktop' as const },
      system: null,
      frames: {},
      content: {},
    })
    expect(desktop.nodes.filter((n) => n.y === 0).map((n) => n.id)).toEqual(['s0', 's1'])
    // Dropped on the second row's left: first of that row.
    const screensOnly = nodes.filter((n) => n.kind === 'screen')
    expect(dropIndex(screensOnly, 's0', 800, at('s6').y + 10)).toBe(5)
    expect(dropIndex(screensOnly, 's11', 1100, 10)).toBe(1)
  })

  it('fits leaving the tools free, and again as the layout grows until the view is moved (R02)', async () => {
    sized(1200, 800)
    mockApi(routes())
    await renderTab()
    await waitFor(() => expect(zoomText()).toBe('45%'))
    const proto = titleOf('原型 · 读书会小程序')
    expect(Number.parseFloat(proto.style.left) + 390 * 0.448).toBeLessThanOrEqual(1200 - 64)
    post('screens/home.html', { type: 'size', width: 390, height: 1800 })
    expect(zoomText()).toBe('37%')
    key('0', { shiftKey: true, code: 'Digit0' })
    expect(zoomText()).toBe('100%')
    post('screens/home.html', { type: 'size', width: 390, height: 2400 })
    expect(zoomText()).toBe('100%')
    expect(fitView([], { width: 100, height: 100 })).toBeNull()
  })

  it('shows titles as icons zoomed far out, never wider than their node (R06)', async () => {
    sized(600, 400)
    mockApi(routes({ 'GET /artifacts/a1': artifact({ manifest: twelve }) }))
    render(<ArtifactTab tab={tab} tabKey="artifact:a1" active />)
    await screen.findByTitle('第 0 屏')
    await waitFor(() => expect(titleOf('第 0 屏').classList.contains('art-title--tiny')).toBe(true))
    const title = titleOf('第 0 屏')
    expect(screen.getByRole('button', { name: '第 0 屏' }).getAttribute('title')).toBe('第 0 屏')
    expect(Number.parseFloat(title.style.maxWidth)).toBeLessThanOrEqual(Math.max(390 * 0.15, 26))
  })

  it('closes an open menu on Escape and keeps the selection (R03)', async () => {
    mockApi(routes())
    await renderTab()
    fireEvent.click(node('home'))
    const gen = screen.getByRole('button', { name: '生成' })
    // As a pointer press does, focus the button, then open its menu.
    act(() => gen.focus())
    fireEvent.click(gen)
    expect(screen.getByRole('menu')).toBeTruthy()
    fireEvent.keyDown(gen, { key: 'Escape' })
    expect(gen.getAttribute('aria-expanded')).toBe('false')
    expect(screen.getByTestId('art-select-home')).toBeTruthy()
    // Right-click menu too.
    fireEvent.contextMenu(node('home'))
    expect(document.querySelector('.ui-menu--context')).toBeTruthy()
    fireEvent.keyDown(canvas(), { key: 'Escape' })
    expect(document.querySelector('.ui-menu--context')).toBeNull()
    expect(screen.getByTestId('art-select-home')).toBeTruthy()
    key('Escape')
    expect(screen.queryByTestId('art-select-home')).toBeNull()
  })

  it('opens a screen in the shell’s presentation with ⇧P, and sizes the phone preset by device (R12, R13)', async () => {
    const open = vi.spyOn(window, 'open').mockReturnValue(null)
    mockApi(routes({ 'GET /artifacts/a1': artifact({ manifest: { ...manifest, device: 'miniprogram' } }) }))
    await renderTab()
    fireEvent.click(node('home'))
    key('P', { shiftKey: true })
    expect(open).toHaveBeenCalledWith(expect.stringMatching(/#play:home$/), '_blank', 'noopener')
    fireEvent.click(screen.getByRole('button', { name: '预览' }))
    expect(item(screen.getByRole('menu'), /手机/).textContent).toContain('手机 375×884')
  })

  it('keeps its shortcuts after the tab’s 导出 opened the export panel (K01)', async () => {
    mockApi(routes())
    await renderTab()
    const exportBtn = screen.getAllByRole('button', { name: '导出' })[0] as HTMLElement
    act(() => exportBtn.focus())
    fireEvent.click(exportBtn)
    expect(screen.getByTestId('art-export')).toBeTruthy()
    expect(document.activeElement).toBe(canvas())
    key('?', { shiftKey: true, code: 'Slash' })
    expect(await screen.findByRole('dialog', { name: '快捷键' })).toBeTruthy()
  })
})

// Round 3 of docs/plan/stitch-对比-第3轮.md (§3 web P1).
const DESIGN_MD = `---
name: 阅境
colors:
  primary: "#155332"
  surface: "#FFFFFF"
---

# 阅境设计系统

正文用宋体，强调克制的留白。
`
const withDesignMd = () =>
  routes({
    'GET /artifacts/a1/versions/v2': detail({
      files: [file('gg-artifact.json'), file('tokens.css'), file('DESIGN.md'), file('screens/home.html')],
    }),
    'GET /artifacts/a1/files/DESIGN.md?version=v2': () => new Response(DESIGN_MD),
  })
const stubClipboard = () => {
  const writeText = vi.fn(async (_: string) => {})
  vi.stubGlobal('navigator', { ...navigator, clipboard: { writeText } })
  return writeText
}
const zoomText = () => screen.getByRole('button', { name: '缩放' }).textContent
const selectedIds = () =>
  [...document.querySelectorAll('[data-testid^="art-select-"]')].map((el) =>
    (el as HTMLElement).dataset.testid?.slice('art-select-'.length),
  )

describe('G02 right-click on a screen title', () => {
  it('gives the screen menu and selects the screen', async () => {
    mockApi(routes())
    await renderTab()
    const title = screen.getByRole('button', { name: '书籍详情' })
    fireEvent.contextMenu(title)
    const menu = screen.getByRole('menu')
    expect(item(menu, /添加到对话/)).toBeTruthy()
    expect(selectedIds()).toEqual(['detail'])
  })
})

describe('G03 command menu and deep links', () => {
  it('opens on ⌘K inside the canvas without reaching the app search, and runs the picked entry', async () => {
    mockApi(routes())
    await renderTab()
    const appSearch = vi.fn()
    document.addEventListener('keydown', appSearch)
    key('k', { metaKey: true })
    document.removeEventListener('keydown', appSearch)
    expect(appSearch).not.toHaveBeenCalled()
    const menu = await screen.findByTestId('art-command-menu')
    const input = within(menu).getByRole('combobox', { name: '搜索命令' })
    // Single-screen commands say why they cannot run yet.
    fireEvent.change(input, { target: { value: '重新生成' } })
    const regen = within(menu).getByRole('option', { name: /重新生成/ })
    expect(regen.getAttribute('aria-disabled')).toBe('true')
    expect(regen.textContent).toContain('先选中屏幕')
    // A screen jumps there.
    fireEvent.change(input, { target: { value: '书籍' } })
    expect(within(menu).getAllByRole('option')[0]?.textContent).toContain('书籍详情')
    fireEvent.keyDown(input, { key: 'Enter' })
    await waitFor(() => expect(screen.queryByTestId('art-command-menu')).toBeNull())
    expect(selectedIds()).toEqual(['detail'])
  })

  it('lists tools and view commands, and runs them', async () => {
    mockApi(routes())
    await renderTab()
    key('k', { metaKey: true })
    const menu = await screen.findByTestId('art-command-menu')
    const input = within(menu).getByRole('combobox', { name: '搜索命令' })
    fireEvent.change(input, { target: { value: '抓手' } })
    fireEvent.click(within(menu).getByRole('option', { name: /抓手/ }))
    expect(screen.getByRole('button', { name: '抓手' }).getAttribute('aria-pressed')).toBe('true')
    key('k', { metaKey: true })
    const again = await screen.findByTestId('art-command-menu')
    fireEvent.change(within(again).getByRole('combobox'), { target: { value: '缩放到 100%' } })
    fireEvent.keyDown(within(again).getByRole('combobox'), { key: 'Enter' })
    await waitFor(() => expect(zoomText()).toBe('100%'))
  })

  it('opens from the artifact menu in the tab bar', async () => {
    mockApi(routes())
    await renderTab()
    fireEvent.click(screen.getByRole('button', { name: '产物菜单' }))
    fireEvent.click(item(screen.getByRole('menu'), /命令菜单/))
    expect(await screen.findByTestId('art-command-menu')).toBeTruthy()
  })

  it('focuses the screens a link or a card asks for', async () => {
    mockApi(routes())
    await renderTab()
    act(() => {
      focusArtifact('a1', { screenIds: ['detail'] })
    })
    await waitFor(() => expect(selectedIds()).toEqual(['detail']))
    expect(useWorkbench.getState().benches.g1?.tabs).toEqual([
      { kind: 'artifact', artifactId: 'a1', title: '' },
    ])
  })

  it('shows the past version a run card asks for, read-only', async () => {
    mockApi(routes({ 'GET /artifacts/a1/versions/v1': detail({ id: 'v1', n: 1 }) }))
    await renderTab()
    act(() => {
      focusArtifact('a1', { screenIds: ['home'], versionId: 'v1' })
    })
    expect(await screen.findByText('正在查看 v1（只读）')).toBeTruthy()
    await waitFor(() => expect(selectedIds()).toEqual(['home']))
  })

  it('reads ?artifact=&screens= from the page link', async () => {
    const link = artifactLink('g1', 'a1', ['home', 'detail'])
    expect(link).toBe(`${location.origin}/g/g1?artifact=a1&screens=home%2Cdetail`)
    let focus: ReturnType<typeof useArtifactFocus>
    function Probe() {
      useLinkedArtifact('g1')
      focus = useArtifactFocus('a1')
      return null
    }
    render(
      <MemoryRouter initialEntries={[link.slice(location.origin.length)]}>
        <Probe />
      </MemoryRouter>,
    )
    await waitFor(() => expect(focus?.screenIds).toEqual(['home', 'detail']))
    expect(useWorkbench.getState().benches.g1?.active).toBe('artifact:a1')
  })
})

describe('G05 marquee', () => {
  it('finds the nodes a rectangle touches', () => {
    const n = (id: string, x: number): CanvasNode => ({
      id,
      kind: 'screen',
      title: id,
      file: '',
      x,
      y: 0,
      w: 100,
      h: 100,
    })
    const nodes = [n('a', 0), n('b', 200), n('c', 400)]
    expect(rectOf(250, 50, 50, 10)).toEqual({ x: 50, y: 10, w: 200, h: 40 })
    expect(nodesInRect(nodes, rectOf(50, 10, 250, 50)).map((x) => x.id)).toEqual(['a', 'b'])
    expect(nodesInRect(nodes, rectOf(110, 10, 190, 50))).toEqual([])
  })

  it('selects with ⇧ drag, and a plain drag still pans', async () => {
    mockApi(routes())
    await renderTab()
    const plane = screen.getByTestId('art-plane')
    const drag = (shiftKey: boolean, to: number) => {
      fireEvent.pointerDown(plane, { button: 0, pointerId: 1, clientX: 0, clientY: 0, shiftKey })
      fireEvent.pointerMove(plane, { pointerId: 1, clientX: to, clientY: to, shiftKey })
      if (shiftKey) expect(screen.getByTestId('art-marquee')).toBeTruthy()
      fireEvent.pointerUp(plane, { pointerId: 1 })
    }
    const world = () => (canvas().querySelector('.art-world') as HTMLElement).style.transform
    const before = world()
    drag(false, 50)
    expect(world()).not.toBe(before)
    expect(selectedIds()).toEqual([])
    const moved = world()
    drag(true, 4000)
    expect(world()).toBe(moved)
    expect(screen.queryByTestId('art-marquee')).toBeNull()
    expect(selectedIds()).toEqual(expect.arrayContaining(['home', 'detail']))
  })
})

describe('G06 DESIGN.md node', () => {
  it('sits beside the design system when the version has DESIGN.md', () => {
    const base = { title: 't', manifest, frames: {}, content: {} }
    const without = layoutNodes({ ...base, system: 400 }).nodes
    const withDoc = layoutNodes({ ...base, system: 400, doc: 500 }).nodes
    expect(without.map((n) => n.kind)).toEqual(['system', 'screen', 'screen', 'prototype'])
    expect(withDoc.map((n) => n.kind)).toEqual(['system', 'doc', 'screen', 'screen', 'prototype'])
    const doc = withDoc[1] as CanvasNode
    expect(doc.x).toBe(720 + 120)
    expect((withDoc[2] as CanvasNode).x).toBe(doc.x + doc.w + 120)
  })

  it('renders the prose and opens the panel on its DESIGN.md page on double-click', async () => {
    mockApi(withDesignMd())
    await renderTab()
    const card = await screen.findByTestId('art-design-md')
    expect(within(card).getByText('阅境设计系统')).toBeTruthy()
    expect(card.textContent).not.toContain('colors:')
    fireEvent.doubleClick(node('@design-md'))
    const panel = await screen.findByRole('complementary', { name: '设计系统' })
    expect(within(panel).getByRole('tab', { name: 'DESIGN.md' }).getAttribute('aria-selected')).toBe('true')
  })
})

describe('G01 copy as', () => {
  it('copies a screen’s code and a link to the selection, and ⌘C puts the code on the clipboard', async () => {
    const writeText = stubClipboard()
    mockApi(routes())
    await renderTab()
    fireEvent.click(item(openContext('home'), /复制为/))
    fireEvent.click(item(screen.getAllByRole('menu').at(-1) as HTMLElement, /复制代码/))
    await waitFor(() => expect(writeText).toHaveBeenCalledTimes(1))
    expect(writeText.mock.calls[0]?.[0]).toContain('<!-- screens/home.html -->\n<!doctype html>')
    fireEvent.click(item(openContext('home'), /复制为/))
    fireEvent.click(item(screen.getAllByRole('menu').at(-1) as HTMLElement, /复制选区链接/))
    await waitFor(() => expect(writeText).toHaveBeenCalledTimes(2))
    expect(writeText.mock.calls[1]?.[0]).toBe(`${location.origin}/g/g1?artifact=a1&screens=home`)
    key('c', { metaKey: true })
    await waitFor(() => expect(writeText).toHaveBeenCalledTimes(3))
    expect(writeText.mock.calls[2]?.[0]).toContain('<body>首页</body>')
  })
})

describe('G01 copy as PNG', () => {
  it('copies the daemon screenshot of the screen as an image, greyed out until there is one', async () => {
    const write = vi.fn(async (_items: unknown[]) => {})
    vi.stubGlobal(
      'ClipboardItem',
      class {
        constructor(readonly items: Record<string, Promise<Blob>>) {}
      },
    )
    Object.defineProperty(navigator, 'clipboard', {
      value: { write, writeText: vi.fn() },
      configurable: true,
    })
    const png = new Blob(['png'], { type: 'image/png' })
    const url = '/api/artifacts/a1/versions/v2/screens/home/thumbnail'
    mockApi(
      routes({
        'GET /artifacts/a1/versions/v2': detail({ screenThumbs: [{ screenId: 'home', url }] }),
        'GET /artifacts/a1/versions/v2/screens/home/thumbnail': () =>
          new Response(png, { headers: { 'content-type': 'image/png' } }),
      }),
    )
    await renderTab()
    fireEvent.click(item(openContext('detail'), /复制为/))
    const off = item(screen.getAllByRole('menu').at(-1) as HTMLElement, /复制为 PNG/)
    expect(off.getAttribute('aria-disabled') === 'true' || off.hasAttribute('disabled')).toBe(true)
    fireEvent.keyDown(document.activeElement ?? document.body, { key: 'Escape' })
    await waitFor(() => expect(screen.queryAllByRole('menu')).toHaveLength(0))
    fireEvent.click(item(openContext('home'), /复制为/))
    fireEvent.click(item(screen.getAllByRole('menu').at(-1) as HTMLElement, /复制为 PNG/))
    await waitFor(() => expect(write).toHaveBeenCalledTimes(1))
    const clip = (write.mock.calls[0]?.[0] as { items: Record<string, Promise<Blob>> }[] | undefined)?.[0]
    expect(await clip?.items['image/png']).toBeInstanceOf(Blob)
    vi.unstubAllGlobals()
  })
})

describe('G15 hold Z to zoom', () => {
  it('zooms in where clicked while Z is held, out with ⌥, and stops on release', async () => {
    mockApi(routes())
    await renderTab()
    key('0', { shiftKey: true, code: 'Digit0' })
    expect(zoomText()).toBe('100%')
    const plane = screen.getByTestId('art-plane')
    key('z')
    expect(plane.classList.contains('art-plane--zoom-in')).toBe(true)
    fireEvent.pointerDown(plane, { button: 0, pointerId: 1, clientX: 10, clientY: 10 })
    fireEvent.pointerUp(plane, { pointerId: 1 })
    expect(zoomText()).toBe('125%')
    fireEvent.pointerDown(plane, { button: 0, pointerId: 2, clientX: 10, clientY: 10, altKey: true })
    fireEvent.pointerUp(plane, { pointerId: 2 })
    expect(zoomText()).toBe('100%')
    fireEvent.keyUp(canvas(), { key: 'z' })
    expect(plane.classList.contains('art-plane--zoom-in')).toBe(false)
  })
})

describe('G13 palette by role', () => {
  it('sorts colour tokens into roles by name', () => {
    expect(colorRole('on-primary')).toBe('primary')
    expect(colorRole('tertiary-container')).toBe('accent')
    expect(colorRole('on-surface-variant')).toBe('neutral')
    expect(colorRole('danger')).toBe('semantic')
    expect(colorRole('evil')).toBe('other')
    const roles = colorRoles(parseTokens(TOKENS).colors.map((g) => ({ ...g, name: g.group })))
    expect(roles.map((r) => r.role)).toEqual(['primary', 'neutral'])
  })

  it('groups the node’s and the panel’s palette, folding long groups behind +n', async () => {
    const css = TOKENS.replace('--rounded-sm', '--color-outline: #DDDDDD;\n  --rounded-sm')
    mockApi(routes({ 'GET /artifacts/a1/files/tokens.css?version=v2': () => new Response(css) }))
    await renderTab()
    await screen.findByTestId('art-ds-role-primary')
    expect(within(screen.getByTestId('art-ds-role-neutral')).getByText('中性色')).toBeTruthy()
    fireEvent.contextMenu(screen.getByTestId('art-plane'))
    fireEvent.click(item(screen.getByRole('menu'), /设计系统/))
    const neutral = await screen.findByTestId('art-dsp-role-neutral')
    expect(within(neutral).getAllByRole('listitem')).toHaveLength(3)
    fireEvent.click(within(neutral).getByRole('button', { name: '+1' }))
    expect(within(neutral).getAllByRole('listitem')).toHaveLength(4)
    expect(within(screen.getByTestId('art-dsp-role-primary')).getAllByRole('listitem')).toHaveLength(2)
  })
})

describe('G17 implementation prompt', () => {
  it('writes the folder, screens, flows and design tokens for a coding agent', () => {
    const text = implementationPrompt({
      title: '读书会小程序',
      dir: 'design/app',
      manifest: {
        ...manifest,
        screens: [{ ...manifest.screens[0], prompt: '首页：金句与共读' }, manifest.screens[1]],
      } as never,
      links: [{ from: 'home', to: 'detail', ggId: '1', text: '查看详情' }],
      designMd: DESIGN_MD,
      tokens: [],
    })
    expect(text).toContain('design/app/')
    expect(text).toContain('- home「首页」：design/app/screens/home.html')
    expect(text).toContain('说明：首页：金句与共读')
    expect(text).toContain('- 首页 → 书籍详情（点「查看详情」）')
    expect(text).toContain('- colors.primary: #155332')
    expect(text).toContain('- name: 阅境')
  })

  it('is a format of the export panel, copied to the clipboard', async () => {
    const writeText = stubClipboard()
    mockApi(routes())
    await renderTab()
    key('e', { metaKey: true, shiftKey: true })
    const panel = await screen.findByTestId('art-export')
    fireEvent.click(within(panel).getByRole('radio', { name: '实现提示词' }))
    expect(screen.getByTestId('art-export-prompt').textContent).toContain(
      'design/app-screens-ab12/screens/home.html',
    )
    fireEvent.click(screen.getByRole('button', { name: '复制' }))
    await waitFor(() => expect(writeText).toHaveBeenCalled())
    expect(writeText.mock.calls[0]?.[0]).toContain('--color-primary: #155332')
  })
})

describe('G14 tips and the composer’s design-system entry', () => {
  it('turns tips over and remembers closing them', async () => {
    mockApi(routes())
    await renderTab()
    const tip = screen.getByTestId('art-tip')
    const first = tip.textContent
    fireEvent.click(within(tip).getByRole('button', { name: '下一条' }))
    expect(screen.getByTestId('art-tip').textContent).not.toBe(first)
    fireEvent.click(within(tip).getByRole('button', { name: '不再显示提示' }))
    expect(screen.queryByTestId('art-tip')).toBeNull()
    expect(localStorage.getItem('gg.art.tips')).toBe('off')
  })

  it('opens the design-system panel when the composer asks', async () => {
    mockApi(routes())
    await renderTab()
    act(() => requestDesignPanel('a1'))
    expect(await screen.findByRole('complementary', { name: '设计系统' })).toBeTruthy()
  })
})

describe('G18 artifact menu', () => {
  it('renames in the bar, duplicates into a new tab and deletes after confirming', async () => {
    const calls = mockApi(
      routes({
        'PATCH /artifacts/a1': (body: unknown) => artifact({ title: (body as { title: string }).title }),
        'POST /artifacts/a1/duplicate': artifact({ id: 'a2', title: '读书会小程序（副本）' }),
        'POST /artifacts/a1/archive': artifact({ archivedAt: at }),
      }),
    )
    useWorkbench.getState().show(tab)
    await renderTab()
    const menu = () => {
      fireEvent.click(screen.getByRole('button', { name: '产物菜单' }))
      return screen.getByRole('menu')
    }
    fireEvent.click(item(menu(), /重命名/))
    const input = screen.getByRole('textbox', { name: '产物名称' })
    fireEvent.change(input, { target: { value: '共读小程序' } })
    fireEvent.keyDown(input, { key: 'Enter' })
    await waitFor(() =>
      expect(calls.find((c) => c.method === 'PATCH')?.body).toEqual({ title: '共读小程序' }),
    )
    expect(await screen.findByRole('heading', { name: '共读小程序' })).toBeTruthy()

    fireEvent.click(item(menu(), /创建副本/))
    await waitFor(() => expect(useWorkbench.getState().benches.g1?.active).toBe('artifact:a2'))

    fireEvent.click(item(menu(), /删除产物/))
    const dialog = await screen.findByRole('alertdialog', { name: '删除产物「共读小程序」？' })
    fireEvent.click(within(dialog).getByRole('button', { name: '删除' }))
    await waitFor(() => expect(calls.some((c) => c.path === '/artifacts/a1/archive')).toBe(true))
    await waitFor(() =>
      expect(
        useWorkbench.getState().benches.g1?.tabs.map((x) => x.kind === 'artifact' && x.artifactId),
      ).toEqual(['a2']),
    )
  })
})
