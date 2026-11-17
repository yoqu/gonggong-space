import type {
  ArtifactDto,
  ArtifactVersionDto,
  BotDto,
  GgArtifactLink,
  GgArtifactManifest,
  GroupDto,
  UserDto,
} from '@gonggong/protocol'
import { fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { useSession } from '../src/app/session'
import { useWorkbench } from '../src/app/workbench'
import { useWorkspace } from '../src/app/workspace'
import { ArtifactTab } from '../src/features/artifacts/ArtifactTab'
import { clearContext } from '../src/features/artifacts/context'
import { LINK_CARD, LINK_HEAD, layoutNodes } from '../src/features/artifacts/geometry'
import { resetArtifacts } from '../src/features/artifacts/store'
import { realtime } from '../src/lib/realtime'
import { useToasts } from '../src/ui'
import { type Call, mockApi } from './mockApi'

// Web pages on the canvas: an embedded page or a link card, added from the toolbar, ⌘K or a pasted URL.

const at = '2026-11-17T10:00:00Z'
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
const PRD: GgArtifactLink = {
  id: 'prd',
  url: 'https://luhu.feishu.cn/docx/RfQ8dKm2',
  title: '退款业务 PRD',
  display: 'embed',
  ratio: '4:3',
  x: 0,
  y: 2000,
}
const API: GgArtifactLink = {
  id: 'api',
  url: 'https://opendocs.alipay.com/open/02e7go',
  title: '统一收单交易退款接口',
  display: 'card',
  ratio: '4:3',
  x: 700,
  y: 2000,
}
const manifest = (links: GgArtifactLink[] = [PRD, API]): GgArtifactManifest => ({
  title: '订单退款',
  device: 'mobile',
  entry: 'home',
  screens: [{ id: 'home', title: '首页', file: 'screens/home.html' }],
  links,
})
const { files: _, ...head } = version(2)
const artifact = (m = manifest()): ArtifactDto => ({
  id: 'a1',
  favorites: [],
  botId: 'b1',
  groupId: 'g1',
  title: '订单退款',
  dir: 'design/app-screens-ab12',
  pluginId: 'p1',
  pluginVersionId: 'pv1',
  designSystemId: null,
  headVersionId: 'v2',
  head,
  manifest: m,
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
})
const routes = (m = manifest(), o: Record<string, unknown> = {}) => ({
  'GET /artifacts/a1': artifact(m),
  'GET /artifacts/a1/versions': [version(1), version(2)],
  'GET /artifacts/a1/versions/v2': { ...version(2), manifest: m, links: [] },
  'GET /artifacts/a1/annotations?version=v2': [],
  'POST /artifacts/a1/preview': { previewId: 'pw1', origin: ORIGIN, url: '/api/previews/pw1/open' },
  'POST /artifacts/a1/edits': artifact(m),
  ...o,
})
const me = { id: 'u1', name: '王磊', role: 'member' } as UserDto
const tab = { kind: 'artifact' as const, artifactId: 'a1', title: '订单退款' }
const renderTab = async () => {
  render(<ArtifactTab tab={tab} tabKey="artifact:a1" active />)
  await screen.findByTitle('首页')
}
const canvas = () => screen.getByRole('application', { name: '画布' })
const node = (id: string) => screen.getByTestId(`art-node-${id}`)
const edits = (calls: Call[]) =>
  calls
    .filter((c) => c.method === 'POST' && c.path === '/artifacts/a1/edits')
    .map((c) => (c.body as { ops: unknown[] }).ops)
const openAdd = async () => {
  fireEvent.click(screen.getByRole('button', { name: '添加链接' }))
  return screen.findByRole('dialog', { name: '添加链接' })
}
const typeUrl = (dialog: HTMLElement, url: string) => {
  const field = within(dialog).getByRole('textbox', { name: '链接地址' })
  fireEvent.change(field, { target: { value: url } })
  fireEvent.blur(field)
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
  useWorkspace.setState({
    groups: [{ id: 'g1', kind: 'group', members: [], botIds: ['b1'] } as unknown as GroupDto],
    bots: [{ id: 'b1', name: '设计助手', presence: 'online' } as BotDto],
  })
})
afterEach(() => {
  vi.unstubAllGlobals()
  vi.restoreAllMocks()
})

describe('link nodes', () => {
  it('lays an embed out as its header over the page at its ratio, a card as one row', () => {
    const { nodes } = layoutNodes({
      title: 'x',
      manifest: manifest(),
      system: null,
      frames: {},
      content: {},
      links: [
        { ...PRD, x: undefined, y: undefined },
        { ...PRD, id: 'wide', ratio: '16:9', w: 640 },
        { ...PRD, id: 'free', ratio: 'free', w: 300, h: 500 },
        API,
      ],
    })
    const link = (id: string) => nodes.find((n) => n.id === `@link:${id}`)
    expect(link('prd')).toMatchObject({ kind: 'link', w: 480, h: LINK_HEAD + 360, file: PRD.url })
    expect(link('wide')).toMatchObject({ w: 640, h: LINK_HEAD + 360, x: 0, y: 2000 })
    expect(link('free')).toMatchObject({ w: 300, h: LINK_HEAD + 500 })
    expect(link('api')).toMatchObject({ ...LINK_CARD, x: 700 })
  })

  it('embeds the page in a sandboxed iframe that takes the pointer only once selected', async () => {
    mockApi(routes())
    await renderTab()
    const prd = node('@link:prd')
    expect(prd.textContent).toContain('退款业务 PRD')
    expect(prd.textContent).toContain('luhu.feishu.cn')
    const frame = within(prd).getByTitle('退款业务 PRD')
    expect(frame.getAttribute('src')).toBe(PRD.url)
    expect(frame.getAttribute('sandbox')).toBe(
      'allow-scripts allow-same-origin allow-popups allow-forms allow-popups-to-escape-sandbox',
    )
    expect(frame.getAttribute('referrerpolicy')).toBe('no-referrer-when-downgrade')
    expect(frame.className).not.toContain('art-link__frame--live')
    fireEvent.click(prd)
    // Once the view has settled (it fits itself to the layout as it loads).
    await waitFor(() =>
      expect(within(node('@link:prd')).getByTitle('退款业务 PRD').className).toContain(
        'art-link__frame--live',
      ),
    )
    const open = vi.spyOn(window, 'open').mockImplementation(() => null)
    fireEvent.click(within(prd).getByRole('button', { name: '新标签打开' }))
    expect(open).toHaveBeenCalledWith(PRD.url, '_blank', 'noopener')
  })

  it('shows a card as its title, host and 打开', async () => {
    mockApi(routes())
    await renderTab()
    const card = node('@link:api')
    expect(card.textContent).toContain('统一收单交易退款接口')
    expect(card.textContent).toContain('opendocs.alipay.com')
    expect(card.querySelector('iframe')).toBeNull()
    const open = vi.spyOn(window, 'open').mockImplementation(() => null)
    fireEvent.click(within(card).getByRole('button', { name: '打开' }))
    expect(open).toHaveBeenCalledWith(API.url, '_blank', 'noopener')
  })

  it('switches the ratio from the bar over a selected embed, saving at once', async () => {
    const calls = mockApi(routes())
    await renderTab()
    fireEvent.click(node('@link:prd'))
    const bar = screen.getByRole('toolbar', { name: '嵌入比例' })
    expect(bar.textContent).toContain('480 × 360')
    fireEvent.click(within(bar).getByRole('radio', { name: '自由' }))
    await waitFor(() =>
      expect(edits(calls)).toEqual([[{ kind: 'link-update', id: 'prd', ratio: 'free', h: 360 }]]),
    )
    fireEvent.click(
      within(screen.getByRole('toolbar', { name: '嵌入比例' })).getByRole('radio', { name: '16:9' }),
    )
    await waitFor(() =>
      expect(edits(calls)[1]).toEqual([{ kind: 'link-update', id: 'prd', ratio: '16:9', h: null }]),
    )
  })

  it('resizes from the bottom-right corner: a fixed ratio changes the width only, free both', async () => {
    const calls = mockApi(
      routes(manifest([PRD, { ...API, id: 'free', display: 'embed', ratio: 'free', h: 300 }])),
    )
    await renderTab()
    const drag = (id: string) => {
      fireEvent.click(node(`@link:${id}`))
      const grip = screen.getByTestId(`art-link-resize-${id}`)
      fireEvent.pointerDown(grip, { button: 0, pointerId: 1, clientX: 100, clientY: 100 })
      fireEvent.pointerMove(grip, { pointerId: 1, clientX: 400, clientY: 400 })
      fireEvent.pointerUp(grip, { pointerId: 1 })
    }
    drag('prd')
    await waitFor(() => expect(edits(calls).length).toBe(1))
    const [fixed] = edits(calls)[0] as Record<string, unknown>[]
    expect(fixed).toMatchObject({ kind: 'link-update', id: 'prd' })
    expect(fixed?.w).toBeGreaterThan(480)
    expect(fixed).not.toHaveProperty('h')
    drag('free')
    await waitFor(() => expect(edits(calls).length).toBe(2))
    const [free] = edits(calls)[1] as Record<string, number>[]
    expect(free?.w).toBeGreaterThan(480)
    expect(free?.h).toBeGreaterThan(300)
  })

  it('moves, toggles, renames and deletes a link from its context menu', async () => {
    const calls = mockApi(routes())
    await renderTab()
    const card = node('@link:api')
    fireEvent.pointerDown(card, { button: 0, pointerId: 1, clientX: 10, clientY: 10 })
    fireEvent.pointerMove(card, { pointerId: 1, clientX: 60, clientY: 30 })
    fireEvent.pointerUp(card, { pointerId: 1 })
    await waitFor(() => expect(edits(calls).length).toBe(1))
    expect(edits(calls)[0]?.[0]).toMatchObject({ kind: 'link-move', id: 'api' })
    fireEvent.contextMenu(node('@link:api'))
    fireEvent.click(within(screen.getByRole('menu')).getByRole('menuitem', { name: /切换为嵌入/ }))
    await waitFor(() =>
      expect(edits(calls)[1]).toEqual([{ kind: 'link-update', id: 'api', display: 'embed' }]),
    )
    fireEvent.contextMenu(node('@link:api'))
    fireEvent.click(within(screen.getByRole('menu')).getByRole('menuitem', { name: /重命名/ }))
    const field = screen.getByRole('textbox', { name: '重命名' })
    fireEvent.change(field, { target: { value: '退款接口' } })
    fireEvent.keyDown(field, { key: 'Enter' })
    await waitFor(() =>
      expect(edits(calls)[2]).toEqual([{ kind: 'link-update', id: 'api', title: '退款接口' }]),
    )
    fireEvent.click(node('@link:api'))
    fireEvent.keyDown(canvas(), { key: 'Delete' })
    const dialog = await screen.findByRole('alertdialog', { name: '删除 1 个链接？' })
    fireEvent.click(within(dialog).getByRole('button', { name: '删除' }))
    await waitFor(() => expect(edits(calls)[3]).toEqual([{ kind: 'link-delete', id: 'api' }]))
  })
})

describe('添加链接', () => {
  const meta = (title: string | null, embeddable = true) => ({
    'POST /artifacts/a1/link-meta': { title, embeddable },
  })

  it('reads the title, embeds at 4:3 by default and adds the link near the middle of the view', async () => {
    const calls = mockApi(routes(manifest([]), meta('退款业务 PRD')))
    await renderTab()
    const dialog = await openAdd()
    expect(document.activeElement).toBe(within(dialog).getByRole('textbox', { name: '链接地址' }))
    typeUrl(dialog, PRD.url)
    await waitFor(() =>
      expect((within(dialog).getByRole('textbox', { name: '标题' }) as HTMLInputElement).value).toBe(
        '退款业务 PRD',
      ),
    )
    expect(calls.find((c) => c.path === '/artifacts/a1/link-meta')?.body).toEqual({ url: PRD.url })
    expect((within(dialog).getByRole('radio', { name: /嵌入页面/ }) as HTMLInputElement).checked).toBe(true)
    expect(within(dialog).getByRole('radio', { name: '4:3' }).getAttribute('aria-checked')).toBe('true')
    expect(dialog.textContent).toContain('添加后拖右下角可调整')
    expect(dialog.textContent).toContain('飞书文档用你当前的飞书登录态加载，无权限时显示飞书登录页')
    fireEvent.click(within(dialog).getByRole('radio', { name: '16:9' }))
    fireEvent.click(within(dialog).getByRole('button', { name: '添加到画布' }))
    await waitFor(() => expect(edits(calls).length).toBe(1))
    const [op] = edits(calls)[0] as Record<string, unknown>[]
    expect(op).toMatchObject({
      kind: 'link',
      url: PRD.url,
      title: '退款业务 PRD',
      display: 'embed',
      ratio: '16:9',
    })
    expect(typeof op?.x).toBe('number')
    expect(typeof op?.y).toBe('number')
    await waitFor(() => expect(screen.queryByRole('dialog', { name: '添加链接' })).toBeNull())
  })

  it('takes a page that forbids framing as a link card only', async () => {
    const calls = mockApi(routes(manifest([]), meta('统一收单交易退款接口', false)))
    await renderTab()
    const dialog = await openAdd()
    typeUrl(dialog, API.url)
    await waitFor(() =>
      expect(dialog.textContent).toContain('该网站不允许被其他页面嵌入，只能添加为链接卡片'),
    )
    const embed = within(dialog).getByRole('radio', { name: /嵌入页面/ }) as HTMLInputElement
    expect(embed.disabled).toBe(true)
    expect((within(dialog).getByRole('radio', { name: /链接卡片/ }) as HTMLInputElement).checked).toBe(true)
    expect(within(dialog).queryByRole('radio', { name: '4:3' })).toBeNull()
    fireEvent.click(within(dialog).getByRole('button', { name: '添加到画布' }))
    await waitFor(() => expect(edits(calls)[0]?.[0]).toMatchObject({ kind: 'link', display: 'card' }))
  })

  it('asks for the title when it cannot be read, and only then adds', async () => {
    mockApi(routes(manifest([]), meta(null)))
    await renderTab()
    const dialog = await openAdd()
    typeUrl(dialog, 'https://erp.shanye.example/refund/sop?id=318')
    await waitFor(() => expect(dialog.textContent).toContain('无法读取标题，请手动填写'))
    const add = within(dialog).getByRole('button', { name: '添加到画布' })
    expect(add.hasAttribute('disabled')).toBe(true)
    fireEvent.change(within(dialog).getByRole('textbox', { name: '标题' }), { target: { value: '退款 SOP' } })
    expect(add.hasAttribute('disabled')).toBe(false)
    expect(dialog.textContent).not.toContain('飞书文档用你当前的飞书登录态加载')
  })

  it('refuses anything but http(s)', async () => {
    mockApi(routes(manifest([]), meta('x')))
    await renderTab()
    const dialog = await openAdd()
    typeUrl(dialog, 'javascript:alert(1)')
    fireEvent.change(within(dialog).getByRole('textbox', { name: '标题' }), { target: { value: 'x' } })
    expect(within(dialog).getByRole('button', { name: '添加到画布' }).hasAttribute('disabled')).toBe(true)
  })

  it('is in the command menu', async () => {
    mockApi(routes(manifest([])))
    await renderTab()
    fireEvent.keyDown(canvas(), { key: 'k', metaKey: true })
    const menu = await screen.findByRole('dialog', { name: '命令菜单' })
    fireEvent.click(within(menu).getByRole('option', { name: /添加链接/ }))
    expect(await screen.findByRole('dialog', { name: '添加链接' })).toBeTruthy()
  })

  it('opens with a URL pasted on the canvas', async () => {
    mockApi(routes(manifest([]), meta('退款业务 PRD')))
    await renderTab()
    fireEvent.paste(canvas(), { clipboardData: { getData: () => ` ${PRD.url} ` } })
    const dialog = await screen.findByRole('dialog', { name: '添加链接' })
    expect((within(dialog).getByRole('textbox', { name: '链接地址' }) as HTMLInputElement).value).toBe(
      PRD.url,
    )
    await waitFor(() =>
      expect((within(dialog).getByRole('textbox', { name: '标题' }) as HTMLInputElement).value).toBe(
        '退款业务 PRD',
      ),
    )
  })
})
