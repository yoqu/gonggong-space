import type {
  AnnotationDto,
  ArtifactCard,
  ArtifactDto,
  ArtifactVersionDto,
  BotDto,
  GgArtifactManifest,
  GgArtifactRef,
  GroupDto,
  UserDto,
} from '@gonggong/protocol'
import { act, fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { useSession } from '../src/app/session'
import { useWorkbench } from '../src/app/workbench'
import { useWorkspace } from '../src/app/workspace'
import { ArtifactCardView } from '../src/features/artifacts/ArtifactCard'
import { ArtifactTab } from '../src/features/artifacts/ArtifactTab'
import { acceptBridge } from '../src/features/artifacts/bridge'
import { artifactContextOf, clearContext, useCanvasContext } from '../src/features/artifacts/context'
import { layoutNodes, REF_SIZE } from '../src/features/artifacts/geometry'
import { resetArtifacts } from '../src/features/artifacts/store'
import { realtime } from '../src/lib/realtime'
import { useToasts } from '../src/ui'
import { type Call, mockApi } from './mockApi'

// Round 4 of the Stitch comparison: files on the canvas (G04), region marks (G08), the queued banner (R04), the
// annotation badge, scrolled screens, arrow keys (G10), stale thumbnails and Copy as PNG.

const at = '2026-10-30T10:00:00Z'
const ORIGIN = 'https://a1.preview.test'
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
const REFS: GgArtifactRef[] = [
  { id: 'r1', title: '竞品首页.png', file: 'refs/competitor.png', kind: 'image' },
  { id: 'r2', title: '需求.pdf', file: 'refs/spec.pdf', kind: 'pdf' },
  { id: 'r3', title: '文案.md', file: 'refs/copy.md', kind: 'text', x: 0, y: 2000 },
]
const manifest = (refs: GgArtifactRef[] = REFS): GgArtifactManifest => ({
  title: '读书会小程序',
  device: 'mobile',
  entry: 'home',
  screens: [
    { id: 'home', title: '首页', file: 'screens/home.html' },
    { id: 'detail', title: '书籍详情', file: 'screens/detail.html' },
  ],
  refs,
})
const { files: _, ...head } = version(2)
const artifact = (o: Partial<ArtifactDto> = {}): ArtifactDto => ({
  id: 'a1',
  favorites: [],
  botId: 'b1',
  groupId: 'g1',
  title: '读书会小程序',
  dir: 'design/app-screens-ab12',
  pluginId: 'p1',
  pluginVersionId: 'pv1',
  designSystemId: null,
  headVersionId: 'v2',
  head,
  manifest: manifest(),
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
const detail = (o: Record<string, unknown> = {}) => ({
  ...version(2, { files: [] }),
  manifest: manifest(),
  links: [],
  ...o,
})
const note = (o: Partial<AnnotationDto> = {}): AnnotationDto => ({
  id: 'n1',
  artifactId: 'a1',
  versionId: 'v2',
  file: 'screens/home.html',
  ggId: '120',
  selector: 'body > h1',
  rect: { x: 10, y: 300, w: 100, h: 30 },
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
  'GET /artifacts/a1/versions/v2': detail(),
  'GET /artifacts/a1/files/refs/copy.md?version=v2': () => new Response('# 文案\n第一行\n第二行'),
  'GET /artifacts/a1/annotations?version=v2': [],
  'POST /artifacts/a1/preview': { previewId: 'pw1', origin: ORIGIN, url: '/api/previews/pw1/open' },
  'POST /artifacts/a1/edits': artifact(),
  'POST /artifacts/a1/uploads': { uploadId: 'up1', path: 'assets/up1.png' },
  ...o,
})
const me = { id: 'u1', name: '王磊', role: 'member' } as UserDto
const setBots = (presence: BotDto['presence'] = 'online') =>
  useWorkspace.setState({
    groups: [{ id: 'g1', kind: 'group', members: [], botIds: ['b1'] } as unknown as GroupDto],
    bots: [{ id: 'b1', name: '设计助手', presence } as BotDto],
  })
const tab = { kind: 'artifact' as const, artifactId: 'a1', title: '读书会小程序' }
const renderTab = async () => {
  render(<ArtifactTab tab={tab} tabKey="artifact:a1" active />)
  await screen.findByTitle('首页')
}
const canvas = () => screen.getByRole('application', { name: '画布' })
const node = (id: string) => screen.getByTestId(`art-node-${id}`)
const key = (k: string, o: Record<string, unknown> = {}) => fireEvent.keyDown(canvas(), { key: k, ...o })
const bodies = (calls: Call[], method: string, path: string) =>
  calls.filter((c) => c.method === method && c.path === path).map((c) => c.body)
const fromScreen = (data: Record<string, unknown>) => {
  const iframe = screen.getByTitle('首页') as HTMLIFrameElement
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
const item = (menu: HTMLElement, name: RegExp) => {
  const m = within(menu)
  const [hit] = [...m.queryAllByRole('menuitem', { name }), ...m.queryAllByRole('menuitemcheckbox', { name })]
  if (!hit) throw new Error(`no menu item ${name}`)
  return hit
}
const png = (name = '参考.png', type = 'image/png') => new File(['x'], name, { type })

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
  setBots()
})
afterEach(() => {
  vi.unstubAllGlobals()
  vi.restoreAllMocks()
})

describe('files on the canvas (G04)', () => {
  it('lays references out in a row below the screens, or where the member put them', () => {
    const { nodes } = layoutNodes({
      title: 'x',
      manifest: manifest(),
      system: null,
      frames: {},
      content: {},
      refs: REFS,
      refHeights: { r1: 180 },
    })
    const ref = (id: string) => nodes.find((n) => n.id === `@ref:${id}`)
    const bottom = Math.max(...nodes.filter((n) => n.kind !== 'ref').map((n) => n.y + n.h))
    expect(ref('r1')).toMatchObject({
      kind: 'ref',
      x: 0,
      w: REF_SIZE.image.w,
      h: 180,
      file: 'refs/competitor.png',
    })
    expect(ref('r1')?.y).toBeGreaterThan(bottom)
    expect(ref('r2')).toMatchObject({ x: REF_SIZE.image.w + 120, y: ref('r1')?.y, h: REF_SIZE.pdf.h })
    expect(ref('r3')).toMatchObject({ x: 0, y: 2000 })
  })

  it('shows an image as itself, a PDF as its icon and name, a text file as its first lines', async () => {
    mockApi(routes())
    await renderTab()
    expect(within(node('@ref:r1')).getByRole('img', { name: '竞品首页.png' }).getAttribute('src')).toBe(
      '/api/artifacts/a1/files/refs/competitor.png?version=v2',
    )
    expect(node('@ref:r2').textContent).toContain('需求.pdf')
    expect(node('@ref:r2').textContent).toContain('PDF 文档')
    await waitFor(() => expect(node('@ref:r3').textContent).toContain('第一行'))
  })

  it('uploads picked files and adds them as references in one version; refuses other types', async () => {
    const calls = mockApi(routes())
    await renderTab()
    const input = screen.getByTestId('art-upload-input') as HTMLInputElement
    const click = vi.spyOn(input, 'click').mockImplementation(() => {})
    fireEvent.click(screen.getByRole('button', { name: '上传到画布' }))
    expect(click).toHaveBeenCalled()
    fireEvent.change(input, { target: { files: [png(), new File(['x'], '笔记.md'), png('脚本.exe', '')] } })
    await waitFor(() => expect(bodies(calls, 'POST', '/artifacts/a1/edits').length).toBe(1))
    const uploads = bodies(calls, 'POST', '/artifacts/a1/uploads') as Blob[]
    expect(uploads.map((b) => b.type)).toEqual(['image/png', 'text/markdown'])
    expect(bodies(calls, 'POST', '/artifacts/a1/edits')).toEqual([
      {
        baseVersionId: 'v2',
        ops: [
          { kind: 'ref', uploadId: 'up1', title: '参考.png' },
          { kind: 'ref', uploadId: 'up1', title: '笔记.md' },
        ],
      },
    ])
    expect(useToasts.getState().items.map((t) => t.message)).toContain('不支持的文件类型：脚本.exe')
  })

  it('takes files dragged onto the canvas, saying where they go while over it', async () => {
    const calls = mockApi(routes())
    await renderTab()
    const dataTransfer = { types: ['Files'], files: [png()], dropEffect: 'none' }
    fireEvent.dragOver(canvas(), { dataTransfer })
    expect(screen.getByTestId('art-drop').textContent).toContain('松开即可上传到画布')
    fireEvent.drop(canvas(), { dataTransfer })
    expect(screen.queryByTestId('art-drop')).toBeNull()
    await waitFor(() =>
      expect(bodies(calls, 'POST', '/artifacts/a1/edits')).toEqual([
        { baseVersionId: 'v2', ops: [{ kind: 'ref', uploadId: 'up1', title: '参考.png' }] },
      ]),
    )
  })

  it('takes no files while the AI is at work', async () => {
    mockApi(routes({ 'GET /artifacts/a1': artifact({ running: true }) }))
    await renderTab()
    expect(screen.getByRole('button', { name: '上传到画布' }).hasAttribute('disabled')).toBe(true)
    fireEvent.dragOver(canvas(), { dataTransfer: { types: ['Files'], files: [png()] } })
    expect(screen.queryByTestId('art-drop')).toBeNull()
  })

  it('moves a reference where it is dragged (ref-move)', async () => {
    const calls = mockApi(routes())
    await renderTab()
    const r = node('@ref:r3')
    fireEvent.pointerDown(r, { button: 0, pointerId: 1, clientX: 10, clientY: 10 })
    fireEvent.pointerMove(r, { pointerId: 1, clientX: 60, clientY: 30 })
    fireEvent.pointerUp(r, { pointerId: 1 })
    await waitFor(() => expect(bodies(calls, 'POST', '/artifacts/a1/edits').length).toBe(1))
    const op = (bodies(calls, 'POST', '/artifacts/a1/edits')[0] as { ops: Record<string, number>[] }).ops[0]
    expect(op).toMatchObject({ kind: 'ref-move', id: 'r3' })
    expect(op?.x).toBeGreaterThan(0)
    expect(op?.y).toBeGreaterThan(2000)
  })

  it('adds a selected reference to the chat as a ref of the message context', async () => {
    mockApi(routes())
    await renderTab()
    fireEvent.click(node('@ref:r1'))
    fireEvent.click(
      within(screen.getByRole('toolbar', { name: '所选参考文件' })).getByRole('button', {
        name: '添加到对话',
      }),
    )
    const c = useCanvasContext.getState().context
    expect(c?.items.map((i) => [i.key, i.pinned])).toEqual([['ref:r1', true]])
    expect(artifactContextOf(c as never)).toEqual({ artifactId: 'a1', refs: ['refs/competitor.png'] })
  })

  it('renames and deletes a reference from its context menu', async () => {
    const calls = mockApi(routes())
    await renderTab()
    fireEvent.contextMenu(node('@ref:r2'))
    const menu = screen.getByRole('menu')
    expect(within(menu).queryByRole('menuitem', { name: /查看代码/ })).toBeNull()
    fireEvent.click(item(menu, /重命名/))
    const field = screen.getByRole('textbox', { name: '重命名' })
    fireEvent.change(field, { target: { value: '需求说明' } })
    fireEvent.keyDown(field, { key: 'Enter' })
    await waitFor(() =>
      expect(bodies(calls, 'POST', '/artifacts/a1/edits')).toEqual([
        { baseVersionId: 'v2', ops: [{ kind: 'ref-rename', id: 'r2', title: '需求说明' }] },
      ]),
    )
    fireEvent.click(node('@ref:r2'))
    key('Delete')
    const dialog = await screen.findByRole('alertdialog', { name: '删除 1 个参考文件？' })
    fireEvent.click(within(dialog).getByRole('button', { name: '删除' }))
    await waitFor(() =>
      expect(bodies(calls, 'POST', '/artifacts/a1/edits')[1]).toEqual({
        baseVersionId: 'v2',
        ops: [{ kind: 'ref-delete', id: 'r2' }],
      }),
    )
  })

  it('lists the upload and the references in the command menu', async () => {
    mockApi(routes())
    await renderTab()
    key('k', { metaKey: true })
    const dialog = await screen.findByRole('dialog', { name: '命令菜单' })
    expect(within(dialog).getByRole('option', { name: /上传到画布/ })).toBeTruthy()
    fireEvent.click(within(dialog).getByRole('option', { name: /需求\.pdf/ }))
    expect(screen.getByTestId('art-select-@ref:r2')).toBeTruthy()
  })
})

describe('region marks (G08)', () => {
  it('annotates a box dragged in a screen, in document coordinates, without an element', async () => {
    const calls = mockApi(routes({ 'POST /artifacts/a1/annotations': note({ ggId: null, selector: '' }) }))
    await renderTab()
    key('m')
    fromScreen({ type: 'scroll', scrollX: 0, scrollY: 50 })
    fromScreen({ type: 'mark-rect', rect: { x: 20, y: 40, w: 200, h: 120 }, ggIds: ['120', '340', 'evil'] })
    const pop = screen.getByRole('dialog', { name: '批注' })
    expect(pop.textContent).toContain('首页 › 区域')
    fireEvent.change(within(pop).getByRole('textbox', { name: '意见' }), { target: { value: '这块太挤' } })
    fireEvent.click(within(pop).getByRole('button', { name: '添加批注' }))
    await waitFor(() =>
      expect(bodies(calls, 'POST', '/artifacts/a1/annotations')).toEqual([
        {
          versionId: 'v2',
          file: 'screens/home.html',
          ggId: null,
          selector: '',
          rect: { x: 20, y: 90, w: 200, h: 120 },
          snippet: '区域内的元素：[data-gg-id="120"], [data-gg-id="340"]',
          note: '这块太挤',
        },
      ]),
    )
  })

  it('draws region annotations as boxes with their number, and lists element and region apart', async () => {
    mockApi(
      routes({
        'GET /artifacts/a1/annotations?version=v2': [
          note(),
          note({ id: 'n2', ggId: null, selector: '', note: '这块太挤' }),
        ],
      }),
    )
    await renderTab()
    key('m')
    expect(await screen.findByTestId('art-region-n2')).toBeTruthy()
    expect(screen.queryByTestId('art-region-n1')).toBeNull()
    expect(screen.getByTestId('art-bubble-n2').textContent).toBe('2')
    fireEvent.click(screen.getByRole('button', { name: '批注' }))
    const rows = within(await screen.findByTestId('art-annotations')).getAllByRole('listitem')
    expect(rows[0]?.textContent).toContain('元素')
    expect(rows[1]?.textContent).toContain('区域')
  })

  it('ignores a malformed box', () => {
    const f = document.createElement('iframe')
    document.body.append(f)
    const frames = new Map([['screens/home.html', f]])
    const ev = (data: unknown) => ({ data, origin: ORIGIN, source: f.contentWindow })
    const msg = {
      source: 'gg-bridge',
      type: 'mark-rect',
      file: 'screens/home.html',
      rect: { x: 1, y: 2, w: 3, h: 4 },
    }
    expect(acceptBridge(ev({ ...msg, ggIds: ['1', 2] }), ORIGIN, frames)).toEqual({ ...msg, ggIds: ['1'] })
    expect(acceptBridge(ev({ ...msg, ggIds: 'x' }), ORIGIN, frames)).toBeNull()
    expect(acceptBridge(ev({ ...msg, rect: { x: 1 }, ggIds: [] }), ORIGIN, frames)).toBeNull()
  })
})

describe('scrolled screens', () => {
  it('moves the bubbles and the element popover with the screen’s own scrolling', async () => {
    mockApi(routes({ 'GET /artifacts/a1/annotations?version=v2': [note()] }))
    await renderTab()
    key('m')
    const bubble = await screen.findByTestId('art-bubble-n1')
    const top = () => Number.parseFloat(bubble.style.top)
    const before = top()
    fromScreen({ type: 'scroll', scrollX: 0, scrollY: 100 })
    expect(top()).toBeLessThan(before)
    fromScreen({ type: 'scroll', scrollX: 0, scrollY: 5000 })
    expect(screen.queryByTestId('art-bubble-n1')).toBeNull()
  })

  it('keeps a picked element in document coordinates', async () => {
    const calls = mockApi(routes({ 'POST /artifacts/a1/annotations': note() }))
    await renderTab()
    key('m')
    fromScreen({ type: 'scroll', scrollX: 0, scrollY: 200 })
    fromScreen({
      type: 'select',
      ggId: '120',
      selector: 'body > h1',
      rect: { x: 10, y: 20, w: 100, h: 30 },
      tag: 'h1',
      text: '本周共读',
      textOnly: true,
      computed: {},
      inlineStyle: '',
      src: null,
      href: null,
      link: null,
    })
    const pop = screen.getByRole('dialog', { name: '批注' })
    fireEvent.change(within(pop).getByRole('textbox', { name: '意见' }), { target: { value: '大一点' } })
    fireEvent.click(within(pop).getByRole('button', { name: '添加批注' }))
    await waitFor(() =>
      expect((bodies(calls, 'POST', '/artifacts/a1/annotations')[0] as { rect: unknown }).rect).toEqual({
        x: 10,
        y: 220,
        w: 100,
        h: 30,
      }),
    )
  })
})

describe('queued commands (R04) and the annotation badge', () => {
  it('says commands wait for the offline bot, and not while a run is at work', async () => {
    setBots('offline')
    mockApi(routes({ 'GET /artifacts/a1': artifact({ queued: true, queuedRunCount: 2 }) }))
    await renderTab()
    expect(screen.getByTestId('art-queued').textContent).toBe(
      '@设计助手 离线，2 个指令排队中，上线后自动执行',
    )
  })

  it('shows no banner without queued runs', async () => {
    mockApi(routes())
    await renderTab()
    expect(screen.queryByTestId('art-queued')).toBeNull()
  })

  it('counts the open annotations of the shown version on the annotations tool', async () => {
    mockApi(
      routes({
        'GET /artifacts/a1/annotations?version=v2': [
          note(),
          note({ id: 'n2' }),
          note({ id: 'n3', status: 'resolved' }),
        ],
      }),
    )
    await renderTab()
    const tool = screen.getByRole('button', { name: '批注' })
    await waitFor(() => expect(within(tool).getByTestId('art-tool-badge').textContent).toBe('2'))
  })
})

describe('arrow keys (G10, kept as is)', () => {
  it('move the view, ⇧ ten times as far, with a screen selected too', async () => {
    mockApi(routes())
    await renderTab()
    const x = () =>
      Number(
        /translate\((-?[\d.]+)px/.exec(
          (canvas().querySelector('.art-world') as HTMLElement).style.transform,
        )?.[1],
      )
    fireEvent.click(node('home'))
    const before = x()
    key('ArrowLeft')
    expect(x() - before).toBe(40)
    key('ArrowLeft', { shiftKey: true })
    expect(x() - before).toBe(440)
  })
})

describe('thumbnails', () => {
  const card: ArtifactCard = {
    type: 'artifact',
    artifactId: 'a1',
    title: '读书会小程序',
    versionN: 3,
    status: 'ready',
    thumbnailUrl: '/t.png',
    issueCount: 0,
  }
  it('marks a card whose thumbnail is from an earlier version', () => {
    const { rerender } = render(<ArtifactCardView card={card} />)
    expect(screen.queryByTestId('art-thumb-stale')).toBeNull()
    rerender(<ArtifactCardView card={{ ...card, thumbnailStale: true } as ArtifactCard} />)
    expect(screen.getByTestId('art-thumb-stale').textContent).toBe('缩略图为旧版本')
  })

  it('notes stale thumbnails in the version menu', async () => {
    mockApi(routes({ 'GET /artifacts/a1/versions': [version(1), version(2, { thumbnailStale: true })] }))
    await renderTab()
    fireEvent.click(screen.getByRole('button', { name: '版本' }))
    expect(item(screen.getByRole('menu'), /v2/).textContent).toContain('缩略图为旧版本')
  })

  it('copies a screen as PNG once its thumbnail exists, else says it cannot yet', async () => {
    const write = vi.fn(async () => {})
    vi.stubGlobal('navigator', { ...navigator, clipboard: { write } })
    vi.stubGlobal(
      'ClipboardItem',
      class {
        constructor(public items: Record<string, unknown>) {}
      },
    )
    mockApi(routes())
    await renderTab()
    fireEvent.contextMenu(node('home'))
    const copyAs = item(screen.getByRole('menu'), /复制为$/)
    fireEvent.click(copyAs)
    const off = screen.getByRole('menuitem', { name: /复制为 PNG/ })
    expect(off.hasAttribute('disabled') || off.getAttribute('aria-disabled') === 'true').toBe(true)
    key('Escape')
    fireEvent.click(node('home'))
    key('c', { metaKey: true, shiftKey: true })
    expect(write).not.toHaveBeenCalled()
    expect(useToasts.getState().items.map((t) => t.message)).toContain('缩略图生成后才能复制为 PNG')
  })

  it('writes the thumbnail to the clipboard with ⌘⇧C', async () => {
    const write = vi.fn(async () => {})
    vi.stubGlobal('navigator', { ...navigator, clipboard: { write } })
    vi.stubGlobal(
      'ClipboardItem',
      class {
        constructor(public items: Record<string, unknown>) {}
      },
    )
    mockApi(
      routes({
        'GET /artifacts/a1/versions/v2': detail({
          screenThumbs: [{ screenId: 'home', url: '/api/thumbs/home.png' }],
        }),
        'GET /thumbs/home.png': () => new Response('p', { headers: { 'content-type': 'image/png' } }),
      }),
    )
    await renderTab()
    fireEvent.click(node('home'))
    await waitFor(() => {
      key('c', { metaKey: true, shiftKey: true })
      expect(write).toHaveBeenCalled()
    })
  })
})
