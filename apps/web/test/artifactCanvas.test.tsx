import type { ArtifactDto, ArtifactVersionDto } from '@gonggong/protocol'
import { act, fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { useWorkbench } from '../src/app/workbench'
import { ArtifactTab } from '../src/features/artifacts/ArtifactTab'
import { acceptBridge } from '../src/features/artifacts/bridge'
import { dropIndex, neighbour } from '../src/features/artifacts/geometry'
import { resetArtifacts } from '../src/features/artifacts/store'
import { parseTokens } from '../src/features/artifacts/tokens'
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
const artifact = (o: Partial<ArtifactDto> & { favorites?: string[] } = {}): ArtifactDto => ({
  id: 'a1',
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
    const iframe = screen.getByTitle('首页') as HTMLIFrameElement
    const sent = vi.spyOn(iframe.contentWindow as Window, 'postMessage')
    expect(iframe.classList.contains('art-node__frame--live')).toBe(false)
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
    const open = vi.spyOn(window, 'open').mockImplementation(() => null)
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
    fireEvent.doubleClick(node('@prototype'))
    expect(open).toHaveBeenCalledWith('/api/previews/pw1/open?path=%2F#play:home', '_blank', 'noopener')
    fireEvent.doubleClick(node('@system'))
    expect(screen.getByRole('complementary', { name: '设计系统' })).toBeTruthy()
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
    expect(row('保存').classList.contains('art-keys__row--soon')).toBe(true)
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
