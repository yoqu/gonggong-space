import type { ArtifactDto, BotDto, GroupDto, UserDto } from '@gonggong/protocol'
import { act, fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { useSession } from '../src/app/session'
import { useWorkbench } from '../src/app/workbench'
import { useWorkspace } from '../src/app/workspace'
import { ArtifactTab } from '../src/features/artifacts/ArtifactTab'
import { clearContext } from '../src/features/artifacts/context'
import { GUIDE_KEY } from '../src/features/artifacts/prototype'
import { resetArtifacts } from '../src/features/artifacts/store'
import { realtime } from '../src/lib/realtime'
import { useToasts } from '../src/ui'
import { fromFrame, ORIGIN, versionAt } from './artifactFixtures'
import { mockApi } from './mockApi'

// The prototype preview's 标注 layer: the page rules (rules/<screen>.md) as numbered marks over the screen and a
// side panel, like Axure's / Mockplus's annotation mode.

const HOME_RULES = `# 首页 · 页面规则

1. **本周共读** \`#ben-zhou-gong-du\`：未登录时点击先去 **登录**。
2. **整页** [待确认]：家庭成员能否看到书单？（见 S1）
`
const SHARED = `# 共享规则

## S1 角色权限
| 操作 | 下单人 |
| --- | --- |
| 看书单 | 可以 |
`
const at = '2026-11-17T10:00:00Z'
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
const artifact = (): ArtifactDto => ({
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
})
const files = [
  { path: 'screens/home.html', hash: 'b'.repeat(64), size: 10 },
  { path: 'rules/home.md', hash: 'c'.repeat(64), size: 10 },
  { path: 'rules/shared.md', hash: 'd'.repeat(64), size: 10 },
]
const thumbs = [
  { screenId: 'home', url: '/api/artifacts/a1/versions/v2/screens/home/thumbnail' },
  { screenId: 'detail', url: '/api/artifacts/a1/versions/v2/screens/detail/thumbnail' },
]
const MORE_RULES = `${HOME_RULES}3. **轮播** \`#lun-bo\`：自动轮播 4 秒。
4. **旧按钮** \`#jiu-an-niu\`：已下线。
5. **本周共读** \`#ben-zhou-gong-du\` [待确认]：满员后显示候补？
`
const routes = (rules: string | { thumbs: typeof thumbs } = HOME_RULES) => ({
  'GET /artifacts/a1': artifact(),
  'GET /artifacts/a1/versions': [version(1), version(2)],
  'GET /artifacts/a1/versions/v2': {
    ...version(2, { files }),
    manifest,
    links: [],
    screenThumbs: typeof rules === 'string' ? thumbs : rules.thumbs,
  },
  'GET /artifacts/a1/files/rules/home.md?version=v2': () =>
    new Response(typeof rules === 'string' ? rules : HOME_RULES),
  'GET /artifacts/a1/files/rules/shared.md?version=v2': () => new Response(SHARED),
  'GET /artifacts/a1/annotations?version=v2': [],
  'GET /artifacts/a1/commands': [],
  'POST /artifacts/a1/preview': { previewId: 'pw1', origin: ORIGIN, url: '/api/previews/pw1/open' },
})
const me = { id: 'u1', name: '王磊', role: 'member' } as UserDto
const tab = { kind: 'artifact' as const, artifactId: 'a1', title: '读书会小程序' }

const openPreview = async () => {
  render(<ArtifactTab tab={tab} tabKey="artifact:a1" active />)
  await screen.findByTitle('首页')
  await waitFor(() =>
    expect(screen.getByRole('button', { name: '预览原型' }).hasAttribute('disabled')).toBe(false),
  )
  fireEvent.click(screen.getByRole('button', { name: '预览原型' }))
  await screen.findByRole('region', { name: '原型预览' })
  await screen.findByRole('button', { name: /^规则 \d+ · 待确认/ })
}
const shown = () => screen.getByTestId('proto-screen')
const frame = () => {
  const s = shown().dataset.screen as string
  const title = manifest.screens.find((x) => x.id === s)?.title as string
  return screen.getByTitle(title) as HTMLIFrameElement
}
const fromScreen = (data: Record<string, unknown>) =>
  fromFrame(frame(), `screens/${shown().dataset.screen}.html`, data)
const ready = () =>
  fromScreen({
    type: 'ready',
    width: 390,
    height: 1200,
    links: [{ ggId: '12', screen: 'detail', rect: { x: 20, y: 100, w: 80, h: 20 } }],
    anchors: [{ anchor: 'ben-zhou-gong-du', ggId: '12', rect: { x: 20, y: 100, w: 80, h: 40 } }],
  })
const panel = () => screen.getByRole('complementary', { name: '标注' })
const mark = (n: number) => screen.getByTestId(`proto-mark-${n}`)
const press = (key: string) => fireEvent.keyDown(window, { key })
/** The bubble describing a mark. */
const tipOf = (m: HTMLElement) =>
  document.getElementById(m.getAttribute('aria-describedby') ?? '')?.closest('.proto-bubble') as HTMLElement
const posted = (post: { mock: { calls: unknown[][] } }) => post.mock.calls.map(([m]) => m)

class NoopSocket {
  close() {}
}
beforeEach(() => {
  localStorage.clear()
  localStorage.setItem(GUIDE_KEY, '1')
  Element.prototype.scrollIntoView = vi.fn()
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

describe('prototype preview annotations (标注)', () => {
  it('starts clean; 标注 or N shows the marks and the panel, remembered across visits', async () => {
    mockApi(routes())
    await openPreview()
    ready()
    const toggle = screen.getByRole('button', { name: '标注' })
    expect(toggle.getAttribute('aria-pressed')).toBe('false')
    expect(screen.queryByTestId('proto-marks')).toBeNull()
    expect(screen.queryByRole('complementary', { name: '标注' })).toBeNull()

    press('n')
    expect(toggle.getAttribute('aria-pressed')).toBe('true')
    expect(localStorage.getItem('gg.art.previewMarks')).toBe('on')
    expect(mark(1).textContent).toBe('1')
    // On the element's top right corner, in the screen's viewport.
    expect(mark(1).style.left).toBe('100px')
    expect(mark(1).style.top).toBe('100px')
    // The whole-page rule sits above the device, out of the screen's way, and is pending.
    expect(mark(2).className).toContain('proto-mark--pending')
    expect(mark(2).className).toContain('proto-mark--page')
    expect(screen.getByTestId('proto-page-marks').contains(mark(2))).toBe(true)
    expect(screen.getByTestId('proto-marks').contains(mark(2))).toBe(false)
    expect(within(panel()).getByText('2 条 · 待确认 1')).toBeTruthy()
    expect(within(panel()).getByText('本周共读')).toBeTruthy()
    // The rule's text is Markdown.
    expect(within(panel()).getByText('登录').tagName).toBe('STRONG')

    // The marks follow the screen's scroll; one scrolled out of view hides, kept (it does not come in again).
    fromScreen({ type: 'scroll', scrollX: 0, scrollY: 40 })
    expect(mark(1).style.top).toBe('60px')
    const one = mark(1)
    fromScreen({ type: 'scroll', scrollX: 0, scrollY: 400 })
    expect(mark(1).className).toContain('proto-mark--out')
    fromScreen({ type: 'scroll', scrollX: 0, scrollY: 0 })
    expect(mark(1)).toBe(one)
    expect(mark(1).className).not.toContain('proto-mark--out')

    fireEvent.click(toggle)
    expect(screen.queryByTestId('proto-marks')).toBeNull()
    expect(screen.queryByRole('complementary', { name: '标注' })).toBeNull()
    expect(localStorage.getItem('gg.art.previewMarks')).toBe('off')
  })

  it('opens from the title’s badge', async () => {
    mockApi(routes())
    await openPreview()
    fireEvent.click(screen.getByRole('button', { name: '规则 2 · 待确认 1' }))
    expect(panel()).toBeTruthy()
    // Before the page reports its anchors only the whole-page rule has a mark.
    expect(screen.getByTestId('proto-page-marks')).toBeTruthy()
  })

  it('links marks, rules and the screen: a mark picks its rule and outlines its element, hover outlines too', async () => {
    mockApi(routes())
    await openPreview()
    ready()
    press('n')
    const post = vi.spyOn(frame().contentWindow as Window, 'postMessage').mockImplementation(() => {})
    fireEvent.click(mark(1))
    expect(within(panel()).getByTestId('proto-note-1').className).toContain('proto-note--on')
    expect(mark(1).className).toContain('proto-mark--on')
    // Outlined in its mark's tone (a settled rule: solid).
    expect(posted(post)).toContainEqual({
      source: 'gg-host',
      type: 'highlight',
      ggIds: ['12'],
      tone: 'settled',
    })
    expect(posted(post)).toContainEqual({
      source: 'gg-host',
      type: 'scroll-to',
      ggId: '12',
      behavior: 'smooth',
    })
    expect(Element.prototype.scrollIntoView).toHaveBeenCalled()
    // A mark is over the screen, not in it: the link under it does not fire.
    expect(shown().dataset.screen).toBe('home')

    // Hovering the whole-page rule outlines nothing; leaving it brings the selection back.
    post.mockClear()
    const note2 = within(panel()).getByTestId('proto-note-2')
    fireEvent.mouseEnter(note2)
    expect(mark(2).className).toContain('proto-mark--hover')
    expect(posted(post)).toContainEqual({ source: 'gg-host', type: 'highlight', ggIds: [] })
    fireEvent.mouseLeave(note2)
    expect(posted(post).at(-1)).toEqual({
      source: 'gg-host',
      type: 'highlight',
      ggIds: ['12'],
      tone: 'settled',
    })
    // Hovering a mark lights its rule.
    fireEvent.mouseEnter(mark(2))
    expect(note2.className).toContain('proto-note--hover')
  })

  it('walks the rules with [ / ] while the panel is open, Esc clears then closes', async () => {
    mockApi(routes())
    await openPreview()
    ready()
    fromScreen({ type: 'nav', screen: 'detail' })
    fromScreen({ type: 'back' })
    press('n')
    press(']')
    expect(within(panel()).getByTestId('proto-note-1').className).toContain('proto-note--on')
    press(']')
    expect(within(panel()).getByTestId('proto-note-2').className).toContain('proto-note--on')
    press(']')
    expect(within(panel()).getByTestId('proto-note-1').className).toContain('proto-note--on')
    press('[')
    expect(within(panel()).getByTestId('proto-note-2').className).toContain('proto-note--on')
    // [ walks the rules; ← still goes back a screen.
    expect(shown().dataset.screen).toBe('home')
    press('Escape')
    expect(within(panel()).getByTestId('proto-note-2').className).not.toContain('proto-note--on')
    press('Escape')
    expect(screen.queryByRole('complementary', { name: '标注' })).toBeNull()
    // The marks stay; a mark opens its rule's bubble, which leads to the panel.
    fireEvent.click(mark(1))
    fireEvent.click(screen.getByRole('button', { name: '在侧栏查看' }))
    expect(panel()).toBeTruthy()
    // Marks take Tab focus.
    expect(mark(1).tagName).toBe('BUTTON')
  })

  it('opens a referred shared rule in place', async () => {
    mockApi(routes())
    await openPreview()
    press('n')
    const note = within(panel()).getByTestId('proto-note-2')
    const ref = within(note).getByRole('button', { name: 'S1 角色权限' })
    expect(ref.getAttribute('aria-expanded')).toBe('false')
    fireEvent.click(ref)
    expect(ref.getAttribute('aria-expanded')).toBe('true')
    expect(within(note).getByText('看书单')).toBeTruthy()
  })

  it('follows the screen; one without rules says where to add them', async () => {
    mockApi(routes())
    await openPreview()
    ready()
    press('n')
    fromScreen({ type: 'nav', screen: 'detail' })
    expect(within(panel()).getByText('书籍详情')).toBeTruthy()
    expect(within(panel()).getByText('这屏还没有规则')).toBeTruthy()
    expect(screen.queryByTestId('proto-mark-1')).toBeNull()
    expect(screen.queryByRole('button', { name: /^规则 \d/ })).toBeNull()
  })

  it('stays out of edit mode', async () => {
    mockApi(routes())
    await openPreview()
    ready()
    press('n')
    fireEvent.click(screen.getByRole('radio', { name: '编辑' }))
    expect(screen.queryByTestId('proto-marks')).toBeNull()
    expect(screen.queryByRole('complementary', { name: '标注' })).toBeNull()
    expect(screen.queryByRole('button', { name: '标注' })).toBeNull()
    press('n')
    fireEvent.click(screen.getByRole('radio', { name: '预览' }))
    expect(screen.getByTestId('proto-marks')).toBeTruthy()
  })

  it('keeps the marks on their elements when coming back to a screen left scrolled (P0)', async () => {
    mockApi(routes())
    await openPreview()
    ready()
    press('n')
    fromScreen({ type: 'scroll', scrollX: 0, scrollY: 600 })
    fromScreen({ type: 'nav', screen: 'detail' })
    fromScreen({ type: 'back' })
    // The page comes back at its top: its ready says so, the old scroll no longer counts.
    fromScreen({
      type: 'ready',
      width: 390,
      height: 1200,
      scrollX: 0,
      scrollY: 0,
      anchors: [{ anchor: 'ben-zhou-gong-du', ggId: '12', rect: { x: 20, y: 100, w: 80, h: 40 } }],
    })
    expect(mark(1).style.top).toBe('100px')
    expect(mark(1).className).not.toContain('proto-mark--out')
    // A page that starts scrolled (a reload) is placed by where it says it is.
    fromScreen({ type: 'ready', width: 390, height: 1200, scrollX: 0, scrollY: 30 })
    expect(mark(1).style.top).toBe('70px')
  })

  it('takes the shortcuts from inside the screen too, ignoring a held N', async () => {
    mockApi(routes())
    await openPreview()
    ready()
    const toggle = screen.getByRole('button', { name: '标注' })
    fromScreen({ type: 'key', key: 'n', repeat: false })
    expect(toggle.getAttribute('aria-pressed')).toBe('true')
    fromScreen({ type: 'key', key: 'n', repeat: true })
    fromScreen({ type: 'key', key: 'n', repeat: true })
    expect(toggle.getAttribute('aria-pressed')).toBe('true')
    fromScreen({ type: 'key', key: ']', repeat: false })
    expect(within(panel()).getByTestId('proto-note-1').className).toContain('proto-note--on')
    fromScreen({ type: 'key', key: 'Escape', repeat: false })
    expect(within(panel()).getByTestId('proto-note-1').className).not.toContain('proto-note--on')
    fromScreen({ type: 'key', key: 'h', repeat: false })
    expect(screen.getByRole('button', { name: '高亮热点' }).getAttribute('aria-pressed')).toBe('true')
  })

  it('outlines again after a reload (R)', async () => {
    mockApi(routes())
    await openPreview()
    ready()
    press('n')
    fireEvent.click(mark(1))
    press('r')
    const post = vi.spyOn(frame().contentWindow as Window, 'postMessage').mockImplementation(() => {})
    ready()
    expect(posted(post)).toContainEqual({
      source: 'gg-host',
      type: 'highlight',
      ggIds: ['12'],
      tone: 'settled',
    })
  })

  it('tells a whole-page rule, an element out of sight and a missing element apart; marks never sit on one another', async () => {
    mockApi(routes(MORE_RULES))
    await openPreview()
    fromScreen({
      type: 'ready',
      width: 390,
      height: 1200,
      anchors: [
        { anchor: 'ben-zhou-gong-du', ggId: '12', rect: { x: 20, y: 100, w: 80, h: 40 } },
        { anchor: 'lun-bo', ggId: '30', rect: { x: 500, y: 300, w: 80, h: 20 }, hidden: true },
      ],
    })
    press('n')
    // 1 and 5 hang on the same element: one mark for both.
    expect(mark(1).textContent).toBe('1+1')
    expect(screen.queryByTestId('proto-mark-5')).toBeNull()
    // Out of sight: no mark; picking it scrolls the page (and its row) to it.
    expect(screen.queryByTestId('proto-mark-3')).toBeNull()
    const post = vi.spyOn(frame().contentWindow as Window, 'postMessage').mockImplementation(() => {})
    fireEvent.click(within(panel()).getByTestId('proto-note-3'))
    expect(posted(post)).toContainEqual({
      source: 'gg-host',
      type: 'scroll-to',
      ggId: '30',
      behavior: 'smooth',
    })
    // Missing: said so in the panel, no mark, not counted as a whole-page rule.
    expect(screen.queryByTestId('proto-mark-4')).toBeNull()
    expect(within(within(panel()).getByTestId('proto-note-4')).getByText('元素已不存在')).toBeTruthy()
    expect(
      within(screen.getByTestId('proto-page-marks'))
        .getAllByRole('button')
        .map((b) => b.textContent),
    ).toEqual(['2'])
    // A pending element rule outlines dashed (its tone).
    fireEvent.click(within(panel()).getByTestId('proto-note-5'))
    expect(posted(post)).toContainEqual({
      source: 'gg-host',
      type: 'highlight',
      ggIds: ['12'],
      tone: 'pending',
    })
  })

  it('docks the panel along the bottom of a narrow stage, tall enough for a few rules, the device clear of it', async () => {
    vi.spyOn(HTMLElement.prototype, 'clientWidth', 'get').mockReturnValue(660)
    vi.spyOn(HTMLElement.prototype, 'clientHeight', 'get').mockReturnValue(700)
    localStorage.removeItem(GUIDE_KEY)
    mockApi(routes())
    await openPreview()
    press('n')
    const p = panel()
    expect(p.className).toContain('proto-notes--drawer')
    const drawer = Number.parseFloat(p.style.height)
    expect(drawer).toBeGreaterThanOrEqual(220)
    // The guide gives way meanwhile (it would take the device's room).
    expect(screen.queryByRole('status', { name: '原型预览引导' })).toBeNull()
    const stage = screen.getByTestId('proto-stage')
    expect(stage.style.paddingRight).toBe('12px')
    expect(stage.style.paddingTop).toBe('')
    expect(Number.parseFloat(stage.style.paddingBottom)).toBeGreaterThanOrEqual(68 + drawer)
  })

  it('puts the shortcuts behind a ? by the title', async () => {
    mockApi(routes())
    await openPreview()
    press('n')
    const keys = within(panel()).getByRole('button', { name: '快捷键' })
    expect(within(panel()).queryByText('隐藏标注')).toBeNull()
    fireEvent.click(keys)
    expect(within(panel()).getByText('隐藏标注')).toBeTruthy()
  })
})

describe('标注 round 3', () => {
  it('walks the rules with [ from inside the screen; ← there still goes back, once', async () => {
    mockApi(routes())
    await openPreview()
    ready()
    fromScreen({ type: 'nav', screen: 'detail' })
    fromScreen({ type: 'nav', screen: 'home' })
    ready()
    press('n')
    fromScreen({ type: 'key', key: '[', repeat: false })
    expect(shown().dataset.screen).toBe('home')
    expect(within(panel()).getByTestId('proto-note-2').className).toContain('proto-note--on')
    fromScreen({ type: 'key', key: 'ArrowLeft', repeat: false })
    expect(shown().dataset.screen).toBe('detail')
  })

  it('hides a mark whose element sits under the status bar', async () => {
    mockApi(routes())
    await openPreview()
    ready()
    press('n')
    // The element (y 100–120) scrolled to 10–30: under the 47px status bar.
    fromScreen({ type: 'scroll', scrollX: 0, scrollY: 90 })
    expect(mark(1).className).toContain('proto-mark--out')
  })

  it('counts the rules in the 标注 button too, for a narrow bar', async () => {
    mockApi(routes())
    await openPreview()
    const toggle = screen.getByRole('button', { name: '标注' })
    // Rules · to confirm: a narrow bar's count, not one orange pill.
    expect(toggle.querySelector('.proto-marks-toggle__count')?.textContent).toBe('2')
    expect(toggle.querySelector('.proto-marks-toggle__pending')?.textContent).toBe('1')
  })

  it('says a rule’s element is out of sight and finds it; picks with the keyboard and reads the rule out', async () => {
    mockApi(routes(MORE_RULES))
    await openPreview()
    fromScreen({
      type: 'ready',
      width: 390,
      height: 1200,
      anchors: [
        { anchor: 'ben-zhou-gong-du', ggId: '12', rect: { x: 20, y: 100, w: 80, h: 40 } },
        { anchor: 'lun-bo', ggId: '30', rect: { x: 500, y: 300, w: 80, h: 20 }, hidden: true },
      ],
    })
    press('n')
    const note3 = within(panel()).getByTestId('proto-note-3')
    expect(within(note3).getByText('当前不可见 · 点击定位')).toBeTruthy()
    // Each rule is a button: Tab and Enter reach it.
    const pick = within(note3).getByRole('button', { name: /^3 轮播/ })
    fireEvent.click(pick)
    expect(pick.getAttribute('aria-pressed')).toBe('true')
    expect(within(panel()).getByRole('status').textContent).toContain('规则 3：轮播')
    // A pending rule picked takes the pending tone, like its mark.
    fireEvent.click(within(within(panel()).getByTestId('proto-note-5')).getByRole('button', { name: /^5 / }))
    expect(within(panel()).getByTestId('proto-note-5').className).toContain('proto-note--pending')
  })

  it('sends a screen without rules back to the canvas, to its 页面文档', async () => {
    mockApi(routes())
    await openPreview()
    ready()
    press('n')
    fromScreen({ type: 'nav', screen: 'detail' })
    fireEvent.click(within(panel()).getByRole('button', { name: '回画布添加规则' }))
    const doc = await screen.findByTestId('art-pagedoc-detail')
    expect(within(doc).getByText(/还没有规则/)).toBeTruthy()
  })

  it('opens the rule in a bubble by its mark, also with the panel closed', async () => {
    mockApi(routes())
    await openPreview()
    ready()
    press('n')
    press('Escape')
    expect(screen.queryByRole('complementary', { name: '标注' })).toBeNull()
    fireEvent.mouseEnter(mark(1))
    const bubble = tipOf(mark(1))
    expect(bubble.textContent).toContain('未登录时点击先去 登录。')
    expect(within(bubble).getByRole('button', { name: '在侧栏查看' })).toBeTruthy()
    fireEvent.click(mark(1))
    fireEvent.mouseLeave(mark(1))
    // Picked with the panel closed: it stays.
    expect(tipOf(mark(1))).toBeTruthy()
    fireEvent.click(within(tipOf(mark(1))).getByRole('button', { name: '在侧栏查看' }))
    expect(panel()).toBeTruthy()
    expect(within(panel()).getByTestId('proto-note-1').className).toContain('proto-note--on')
    // The panel shows the rule already: hovering it there opens no bubble over the screen.
    fireEvent.mouseEnter(within(panel()).getByTestId('proto-note-2'))
    expect(document.querySelector('.proto-bubble')).toBeNull()
  })

  it('moves the focus with the picked rule', async () => {
    mockApi(routes())
    await openPreview()
    ready()
    press('n')
    act(() => mark(1).focus())
    // From the focused rule (1) to the next.
    press('ArrowRight')
    expect(document.activeElement).toBe(mark(2))
  })

  it('brings a screen back where it was scrolled when going back to it', async () => {
    mockApi(routes())
    await openPreview()
    ready()
    fromScreen({ type: 'scroll', scrollX: 0, scrollY: 300 })
    fromScreen({ type: 'nav', screen: 'detail' })
    fromScreen({ type: 'back' })
    const post = vi.spyOn(frame().contentWindow as Window, 'postMessage').mockImplementation(() => {})
    ready()
    expect(posted(post)).toContainEqual({ source: 'gg-host', type: 'scroll-position', x: 0, y: 300 })
  })

  it('shows the screenshot again while a reload (R) loads', async () => {
    mockApi(routes())
    await openPreview()
    ready()
    expect(screen.queryByTestId('proto-placeholder')).toBeNull()
    press('r')
    expect(screen.getByTestId('proto-placeholder')).toBeTruthy()
  })

  it('carries the leaving screen’s marks with it', async () => {
    mockApi(routes())
    await openPreview()
    ready()
    press('n')
    fromScreen({ type: 'nav', screen: 'detail' })
    expect(screen.getByTestId('proto-leave').contains(screen.getByTestId('proto-marks-leaving'))).toBe(true)
  })

  it('lets the device glide (on a transform) only while a panel or the mode changes', async () => {
    const proto = HTMLElement.prototype as unknown as Record<string, unknown>
    const animate = vi.fn()
    proto.animate = animate
    proto.getAnimations = () => []
    const width = vi.spyOn(HTMLElement.prototype, 'offsetWidth', 'get').mockReturnValue(400)
    const height = vi.spyOn(HTMLElement.prototype, 'offsetHeight', 'get').mockReturnValue(800)
    vi.stubGlobal(
      'DOMMatrixReadOnly',
      class {
        a = 1
        d = 1
        e = 0
        f = 0
      },
    )
    document.documentElement.style.setProperty('--spring-smooth', '379ms linear(0, 1)')
    try {
      mockApi(routes())
      await openPreview()
      expect(animate).not.toHaveBeenCalled()
      press('n')
      expect(animate).toHaveBeenCalledWith(
        [{ transform: expect.stringMatching(/^translate\(.+\) scale\(.+\)$/) }, { transform: 'none' }],
        { duration: 379, easing: 'linear(0, 1)' },
      )
    } finally {
      delete proto.animate
      delete proto.getAnimations
      width.mockRestore()
      height.mockRestore()
      vi.unstubAllGlobals()
      document.documentElement.style.removeProperty('--spring-smooth')
    }
  })

  it('stops a glide under way when the window resizes, so the device follows the window at once', async () => {
    const proto = HTMLElement.prototype as unknown as Record<string, unknown>
    const cancel = vi.fn()
    proto.animate = vi.fn()
    proto.getAnimations = () => [{ cancel }]
    const width = vi.spyOn(HTMLElement.prototype, 'offsetWidth', 'get').mockReturnValue(400)
    const height = vi.spyOn(HTMLElement.prototype, 'offsetHeight', 'get').mockReturnValue(800)
    vi.stubGlobal(
      'DOMMatrixReadOnly',
      class {
        a = 1
        d = 1
        e = 0
        f = 0
      },
    )
    const observers: ((entries: unknown[]) => void)[] = []
    vi.stubGlobal(
      'ResizeObserver',
      class {
        constructor(cb: (entries: unknown[]) => void) {
          observers.push(cb)
        }
        observe() {}
        unobserve() {}
        disconnect() {}
      },
    )
    const now = vi.spyOn(performance, 'now')
    document.documentElement.style.setProperty('--spring-smooth', '379ms linear(0, 1)')
    try {
      mockApi(routes())
      await openPreview()
      now.mockReturnValue(10_000)
      press('n')
      expect(proto.animate).toHaveBeenCalled()
      cancel.mockClear()
      // The stage resizing with the panel change itself keeps the glide.
      for (const cb of observers) act(() => cb([]))
      expect(cancel).not.toHaveBeenCalled()
      now.mockReturnValue(10_200)
      for (const cb of observers) act(() => cb([]))
      expect(cancel).toHaveBeenCalled()
    } finally {
      delete proto.animate
      delete proto.getAnimations
      width.mockRestore()
      height.mockRestore()
      now.mockRestore()
      vi.unstubAllGlobals()
      document.documentElement.style.removeProperty('--spring-smooth')
    }
  })
})

const GROUP_RULES = `${HOME_RULES}3. **本周共读** \`#ben-zhou-gong-du\`：三。
4. **本周共读** \`#ben-zhou-gong-du\`：四。
5. **本周共读** \`#ben-zhou-gong-du\` [待确认]：五。
6. **本周共读** \`#ben-zhou-gong-du\`：六。
`

describe('标注 round 4', () => {
  it('keeps a fixed element’s mark on it whatever the page’s scroll', async () => {
    mockApi(routes())
    await openPreview()
    fromScreen({
      type: 'ready',
      width: 390,
      height: 1200,
      anchors: [
        { anchor: 'ben-zhou-gong-du', ggId: '12', rect: { x: 0, y: 744, w: 390, h: 56 }, fixed: true },
      ],
    })
    press('n')
    const top = mark(1).style.top
    fromScreen({ type: 'scroll', scrollX: 0, scrollY: 300 })
    expect(mark(1).style.top).toBe(top)
    expect(mark(1).className).not.toContain('proto-mark--out')
  })

  it('describes a mark by its bubble, shown on focus too; ↓ goes into it, Esc back, Tab goes on to the next mark', async () => {
    mockApi(routes())
    await openPreview()
    ready()
    press('n')
    act(() => mark(1).focus())
    const tip = tipOf(mark(1))
    // A non-modal popup (it holds a button): the shortcuts go on with the focus in it.
    expect([tip.getAttribute('role'), tip.getAttribute('aria-modal')]).toEqual(['dialog', 'false'])
    expect(mark(1).hasAttribute('title')).toBe(false)
    expect(tip.textContent).toContain('未登录时点击先去')
    // A non-modal bubble: the shortcuts keep working (← / → from the focused rule).
    press('ArrowRight')
    expect(within(panel()).getByTestId('proto-note-2').className).toContain('proto-note--on')
    act(() => mark(1).focus())
    const more = within(tipOf(mark(1))).getByRole('button', { name: '在侧栏查看' })
    // Out of the Tab order: Tab walks the marks (and the whole-page row) without stopping in bubbles.
    expect(more.tabIndex).toBe(-1)
    fireEvent.keyDown(mark(1), { key: 'ArrowDown' })
    expect(document.activeElement).toBe(more)
    fireEvent.keyDown(more, { key: 'Escape' })
    expect(document.activeElement).toBe(mark(1))
    // That Esc was the bubble's: the rule stays picked, the panel open.
    expect(within(panel()).getByTestId('proto-note-2').className).toContain('proto-note--on')
  })

  it('opens a group mark as a list to pick from; its mark again unpicks', async () => {
    mockApi(routes(GROUP_RULES))
    await openPreview()
    ready()
    press('n')
    const group = screen.getByTestId('proto-marks').querySelector('.proto-mark--group') as HTMLElement
    // Its first number and how many more: `1+4`, not a range.
    expect(group.textContent).toMatch(/^\d+\+\d+$/)
    fireEvent.mouseEnter(group)
    const list = tipOf(group)
    const items = within(list)
      .getAllByRole('button')
      .filter((b) => /^\d+ /.test(b.getAttribute('aria-label') ?? ''))
    const ids = items.map((b) => (b.getAttribute('aria-label') ?? '').split(' ')[0] as string)
    expect([...ids].sort((a, b) => Number(a) - Number(b))).toEqual(ids)
    // Plain text with its element and 待确认, not Markdown source.
    expect(list.textContent).not.toContain('**')
    expect(list.textContent).toContain('本周共读')
    const last = ids.at(-1) as string
    fireEvent.click(items.at(-1) as HTMLElement)
    expect(within(panel()).getByTestId(`proto-note-${last}`).className).toContain('proto-note--on')
    fireEvent.click(group)
    expect(panel().querySelector('.proto-note--on')).toBeNull()
  })

  it('brings a reloaded screen (R) back where it was scrolled', async () => {
    mockApi(routes())
    await openPreview()
    ready()
    fromScreen({ type: 'scroll', scrollX: 0, scrollY: 300 })
    press('r')
    const post = vi.spyOn(frame().contentWindow as Window, 'postMessage').mockImplementation(() => {})
    ready()
    expect(posted(post)).toContainEqual({ source: 'gg-host', type: 'scroll-position', x: 0, y: 300 })
  })

  it('holds a screen coming back scrolled out of sight until it is where it was', async () => {
    mockApi(routes())
    await openPreview()
    ready()
    fromScreen({ type: 'scroll', scrollX: 0, scrollY: 300 })
    fromScreen({ type: 'nav', screen: 'detail' })
    fromScreen({ type: 'back' })
    ready()
    expect(frame().className).toContain('proto-frame--hold')
    // Not its top's screenshot meanwhile: it is coming back elsewhere.
    expect(screen.queryByTestId('proto-placeholder')).toBeNull()
    fromScreen({ type: 'scroll', scrollX: 0, scrollY: 300 })
    expect(frame().className).not.toContain('proto-frame--hold')
  })

  it('moves the focus to the panel’s rule when its mark is out of view', async () => {
    mockApi(routes(MORE_RULES))
    await openPreview()
    fromScreen({
      type: 'ready',
      width: 390,
      height: 1200,
      anchors: [
        { anchor: 'ben-zhou-gong-du', ggId: '12', rect: { x: 20, y: 100, w: 80, h: 40 } },
        { anchor: 'lun-bo', ggId: '30', rect: { x: 20, y: 2000, w: 80, h: 40 } },
      ],
    })
    press('n')
    act(() => mark(1).focus())
    press('ArrowRight')
    press('ArrowRight')
    expect(document.activeElement).toBe(
      within(panel()).getByTestId('proto-note-3').querySelector('.proto-note__pick'),
    )
  })
})

const CODE_RULES = `# 首页 · 页面规则

1. **本周共读** \`#ben-zhou-gong-du\`：带代码块：
   \`\`\`js
   const city = located ?? '上海'
   \`\`\`
2. **整页** [待确认]：家庭成员能否看到书单？（见 S1）
`

describe('标注 round 5', () => {
  it('keeps a bubble free of the Markdown’s controls (a code block’s copy button): Tab goes to 在侧栏查看', async () => {
    mockApi(routes(CODE_RULES))
    await openPreview()
    ready()
    press('n')
    act(() => mark(1).focus())
    const tip = tipOf(mark(1))
    expect(
      within(tip)
        .getAllByRole('button')
        .map((b) => b.textContent),
    ).toEqual(['在侧栏查看'])
    expect(tip.textContent).toContain("const city = located ?? '上海'")
  })

  it('walks the rules from the focused one, and keeps the focus on its side (panel or marks)', async () => {
    mockApi(routes(MORE_RULES))
    await openPreview()
    fromScreen({
      type: 'ready',
      width: 390,
      height: 1200,
      anchors: [
        { anchor: 'ben-zhou-gong-du', ggId: '12', rect: { x: 20, y: 100, w: 80, h: 40 } },
        { anchor: 'lun-bo', ggId: '30', rect: { x: 20, y: 300, w: 80, h: 40 } },
      ],
    })
    press('n')
    const pick = (n: number) =>
      within(panel()).getByTestId(`proto-note-${n}`).querySelector('.proto-note__pick') as HTMLElement
    act(() => pick(3).focus())
    press('ArrowRight')
    expect(within(panel()).getByTestId('proto-note-4').className).toContain('proto-note--on')
    expect(document.activeElement).toBe(pick(4))
    press('ArrowRight')
    // Rule 5 has a mark: the focus stays in the panel all the same.
    expect(document.activeElement).toBe(pick(5))
    act(() => mark(1).focus())
    press('ArrowRight')
    expect(within(panel()).getByTestId('proto-note-2').className).toContain('proto-note--on')
    expect(document.activeElement).toBe(mark(2))
  })

  it('names the switch for what it does next', async () => {
    mockApi(routes())
    await openPreview()
    const toggle = screen.getByRole('button', { name: '标注' })
    const tip = () => document.getElementById(toggle.getAttribute('aria-describedby') as string)?.textContent
    expect(tip()).toContain('显示页面规则标注')
    press('n')
    expect(tip()).toContain('隐藏页面规则标注')
  })

  it('draws no mark for what a pinned layer covers', async () => {
    mockApi(routes())
    await openPreview()
    fromScreen({
      type: 'ready',
      width: 390,
      height: 1200,
      anchors: [{ anchor: 'ben-zhou-gong-du', ggId: '12', rect: { x: 20, y: 60, w: 80, h: 30 } }],
      covers: [{ x: 0, y: 47, w: 390, h: 40 }],
    })
    press('n')
    expect(mark(1).className).toContain('proto-mark--out')
  })

  it('zooms the preview: fit, fit width (the stage scrolls), 100%; 0, 1 and 2 from the keyboard', async () => {
    vi.spyOn(HTMLElement.prototype, 'clientWidth', 'get').mockReturnValue(1200)
    vi.spyOn(HTMLElement.prototype, 'clientHeight', 'get').mockReturnValue(700)
    mockApi(routes())
    await openPreview()
    const scale = () => Number.parseFloat(screen.getByTestId('proto-device').style.transform.slice(6))
    const fit = scale()
    expect(fit).toBeLessThan(1)
    press('1')
    expect(scale()).toBe(1)
    expect(screen.getByTestId('proto-stage').className).toContain('proto-stage--zoomed')
    press('2')
    expect(scale()).toBeCloseTo(Math.min(1, (1200 - 236 - 68) / 410))
    press('0')
    expect(scale()).toBeCloseTo(fit)
    expect(screen.getByTestId('proto-stage').className).not.toContain('proto-stage--zoomed')
    // From the rail too.
    fireEvent.click(screen.getByRole('button', { name: /^缩放/ }))
    fireEvent.click(screen.getByRole('menuitemradio', { name: /100%/ }))
    expect(scale()).toBe(1)
  })
})

const DESK = {
  title: '后台',
  device: 'desktop' as const,
  entry: 'home',
  screens: [{ id: 'home', title: '首页', file: 'screens/home.html' }],
}

describe('标注 round 6', () => {
  it('opens a desktop prototype fitted to the width left beside the panel (no sideways scroll), the list folded', async () => {
    vi.spyOn(HTMLElement.prototype, 'clientWidth', 'get').mockReturnValue(925)
    vi.spyOn(HTMLElement.prototype, 'clientHeight', 'get').mockReturnValue(800)
    const r = routes()
    mockApi({
      ...r,
      'GET /artifacts/a1': { ...artifact(), manifest: DESK },
      'GET /artifacts/a1/versions/v2': { ...r['GET /artifacts/a1/versions/v2'], manifest: DESK },
    })
    await openPreview()
    press('n')
    expect(screen.queryByRole('complementary', { name: '原型中的屏幕' })).toBeNull()
    const scale = Number.parseFloat(screen.getByTestId('proto-device').style.transform.slice(6))
    // The stage less the folded list's 12 and the panel's 380, over the 1440 + 20 device.
    expect(scale).toBeCloseTo((925 - 12 - 380) / 1460)
    expect(screen.getByTestId('proto-stage').className).toContain('proto-stage--zoomed')
  })

  it('keeps the whole-page rules in view while zoomed (over the stage, not above the device)', async () => {
    mockApi(routes())
    await openPreview()
    press('n')
    press('1')
    expect(screen.getByTestId('proto-page-marks').className).toContain('proto-page-marks--float')
    press('0')
    expect(screen.getByTestId('proto-page-marks').className).not.toContain('proto-page-marks--float')
  })

  it('brings in later screens’ marks quietly (no bounce each time)', async () => {
    mockApi(routes())
    await openPreview()
    ready()
    press('n')
    expect(document.querySelector('.proto-marks-host--quiet')).toBeNull()
    fromScreen({ type: 'nav', screen: 'detail' })
    fromScreen({ type: 'back' })
    expect(document.querySelector('.proto-marks-host--quiet')).toBeTruthy()
  })

  it('keeps the stage where it was when a click in the screen would scroll it (zoomed)', async () => {
    mockApi(routes())
    await openPreview()
    press('1')
    const stage = screen.getByTestId('proto-stage')
    stage.scrollLeft = 120
    stage.scrollTop = 40
    fireEvent.scroll(stage)
    // The screen's frame takes the focus (a click in it)…
    fireEvent.focus(stage.querySelector('iframe.proto-frame') as HTMLElement)
    // …and the browser scrolls it into view…
    stage.scrollLeft = 410
    fireEvent.scroll(stage)
    // …and the stage goes back.
    expect([stage.scrollLeft, stage.scrollTop]).toEqual([120, 40])
  })
})

describe('标注 round 7', () => {
  it('leaves Shift+N alone, and Esc to an open menu', async () => {
    mockApi(routes())
    await openPreview()
    const toggle = screen.getByRole('button', { name: '标注' })
    fireEvent.keyDown(window, { key: 'N', shiftKey: true })
    expect(toggle.getAttribute('aria-pressed')).toBe('false')
    press('n')
    press(']')
    fireEvent.click(screen.getByRole('button', { name: /^缩放/ }))
    const item = screen.getByRole('menuitemradio', { name: /100%/ })
    fireEvent.keyDown(item, { key: 'Escape' })
    // The rule stays picked: the Esc was the menu's.
    expect(within(panel()).getByTestId('proto-note-1').className).toContain('proto-note--on')
  })

  it('drops the pointer’s rule and its bubble when the marks go', async () => {
    mockApi(routes())
    await openPreview()
    ready()
    press('n')
    fireEvent.mouseEnter(mark(1))
    expect(document.querySelector('.proto-bubble')).toBeTruthy()
    press('n')
    press('n')
    expect(document.querySelector('.proto-bubble')).toBeNull()
    expect(mark(1).className).not.toContain('proto-mark--hover')
  })
})

describe('标注 round 8', () => {
  it('lets go of a rule picked with the panel closed: its mark again, the stage, a click in the page', async () => {
    mockApi(routes())
    await openPreview()
    ready()
    press('n')
    press('Escape')
    const picked = () => mark(1).getAttribute('aria-pressed') === 'true'
    fireEvent.click(mark(1))
    expect(picked()).toBe(true)
    fireEvent.click(mark(1))
    expect(picked()).toBe(false)
    fireEvent.click(mark(1))
    fireEvent.click(screen.getByTestId('proto-stage'))
    expect(picked()).toBe(false)
    expect(document.querySelector('.proto-bubble')).toBeNull()
    fireEvent.click(mark(1))
    fromScreen({ type: 'miss' })
    expect(picked()).toBe(false)
  })

  it('walks the rules with the panel closed too: the bubble shows the rule, the focus on its mark', async () => {
    mockApi(routes())
    await openPreview()
    ready()
    press('n')
    press('Escape')
    press(']')
    expect(mark(1).getAttribute('aria-pressed')).toBe('true')
    expect(tipOf(mark(1)).textContent).toContain('未登录时点击先去')
    expect(document.activeElement).toBe(mark(1))
    expect(screen.queryByRole('complementary', { name: '标注' })).toBeNull()
  })

  it('keeps the rail at the right of a narrow full-screen stage, the drawer above the floating composer', async () => {
    vi.spyOn(HTMLElement.prototype, 'clientWidth', 'get').mockReturnValue(660)
    vi.spyOn(HTMLElement.prototype, 'clientHeight', 'get').mockReturnValue(664)
    const dock = document.createElement('div')
    dock.className = 'cdock--float'
    dock.innerHTML = '<div class="cdock__shell"></div>'
    document.body.append(dock)
    vi.spyOn(Element.prototype, 'getBoundingClientRect').mockImplementation(function (this: Element) {
      const r = this.classList.contains('cdock__shell')
        ? { left: 20, right: 640, top: 552, bottom: 652 }
        : { left: 0, right: 660, top: 0, bottom: 664 }
      return {
        ...r,
        x: r.left,
        y: r.top,
        width: r.right - r.left,
        height: r.bottom - r.top,
        toJSON() {},
      } as DOMRect
    })
    try {
      mockApi(routes())
      await openPreview()
      press('n')
      const rail = screen.getByRole('toolbar', { name: '原型工具' })
      expect(rail.className).not.toContain('proto-rail--bottom')
      const p = panel()
      // 664 - 552 + 12: above the composer, not under it.
      expect(p.style.bottom).toBe('124px')
      const stage = screen.getByTestId('proto-stage')
      expect(stage.style.paddingRight).toBe('68px')
      expect(Number.parseFloat(stage.style.paddingBottom)).toBe(124 + Number.parseFloat(p.style.height))
    } finally {
      dock.remove()
    }
  })

  it('remembers the zoom per kind of device', async () => {
    mockApi(routes())
    await openPreview()
    press('1')
    expect(localStorage.getItem('gg.art.protoZoom.mobile')).toBe('actual')
  })

  it('takes turning the marks on as having seen the guide', async () => {
    localStorage.removeItem(GUIDE_KEY)
    mockApi(routes())
    await openPreview()
    press('n')
    expect(screen.queryByRole('status', { name: '原型预览引导' })).toBeNull()
    expect(localStorage.getItem(GUIDE_KEY)).toBe('1')
  })
})

describe('标注 round 9', () => {
  // 1 and 5 share one element: one `1+1` mark for both.
  const allAnchored = () =>
    fromScreen({
      type: 'ready',
      width: 390,
      height: 1200,
      anchors: [
        { anchor: 'ben-zhou-gong-du', ggId: '12', rect: { x: 20, y: 100, w: 80, h: 40 } },
        { anchor: 'lun-bo', ggId: '30', rect: { x: 20, y: 300, w: 80, h: 40 } },
        { anchor: 'jiu-an-niu', ggId: '40', rect: { x: 20, y: 500, w: 80, h: 40 } },
      ],
    })
  const on = (n: number) =>
    within(panel()).getByTestId(`proto-note-${n}`).className.includes('proto-note--on')

  it('walks through a group mark’s rules with the focus on the marks, never stuck on it', async () => {
    mockApi(routes(MORE_RULES))
    await openPreview()
    allAnchored()
    press('n')
    act(() => mark(3).focus())
    press('ArrowRight')
    expect(on(4)).toBe(true)
    press('ArrowRight')
    expect(on(5)).toBe(true)
    expect(document.activeElement).toBe(mark(1))
    press('ArrowRight')
    expect(on(1)).toBe(true)
    press('ArrowRight')
    expect(on(2)).toBe(true)
  })

  it('walks every rule with ] and the panel closed, each in its own bubble (not the group’s list)', async () => {
    mockApi(routes(MORE_RULES))
    await openPreview()
    allAnchored()
    press('n')
    press('Escape')
    const words = [
      '未登录时点击先去',
      '家庭成员能否看到书单',
      '自动轮播 4 秒',
      '已下线',
      '满员后显示候补',
      '未登录时点击先去',
    ]
    for (const w of words) {
      press(']')
      const bubble = document.querySelector('.proto-bubble') as HTMLElement
      expect(bubble.textContent).toContain(w)
      expect(bubble.querySelector('.proto-bubble__group')).toBeNull()
      expect((document.activeElement as HTMLElement).getAttribute('aria-pressed')).toBe('true')
    }
  })
})

describe('screen transitions', () => {
  it('slides the last screen’s live page out under the new one, which shows its screenshot until it loads', async () => {
    mockApi(routes())
    await openPreview()
    ready()
    const home = frame()
    fromScreen({ type: 'nav', screen: 'detail' })
    const leaving = screen.getByTestId('proto-leave')
    expect(leaving.className).toContain('proto-leave--push')
    expect(leaving.className).not.toContain('proto-leave--over')
    // The very page that was showing, not a reload of it.
    expect(leaving.querySelector('iframe')).toBe(home)
    expect(screen.getByTestId('proto-placeholder').getAttribute('src')).toBe(thumbs[1]?.url)
    fireEvent.animationEnd(leaving)
    expect(screen.queryByTestId('proto-leave')).toBeNull()
    fromScreen({ type: 'ready', width: 390, height: 900 })
    expect(screen.queryByTestId('proto-placeholder')).toBeNull()
    // Going back reverses it: the screen leaving slides away over the one coming back.
    fromScreen({ type: 'back' })
    expect(screen.getByTestId('proto-leave').className).toContain('proto-leave--push-back')
    expect(screen.getByTestId('proto-leave').className).toContain('proto-leave--over')
  })

  it('fades the leaving screen’s marks with it', async () => {
    mockApi(routes())
    await openPreview()
    ready()
    press('n')
    fromScreen({ type: 'nav', screen: 'detail' })
    const leaving = screen.getByTestId('proto-marks-leaving')
    expect(leaving.className).toContain('proto-marks--leaving')
    expect(within(leaving).getByText('1')).toBeTruthy()
  })

  it('shows a skeleton while a screen without a screenshot loads', async () => {
    mockApi(routes({ thumbs: [] }))
    await openPreview()
    expect(screen.getByTestId('proto-skeleton')).toBeTruthy()
    ready()
    expect(screen.queryByTestId('proto-skeleton')).toBeNull()
  })
})
