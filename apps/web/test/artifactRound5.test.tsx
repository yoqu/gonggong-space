import { readFileSync } from 'node:fs'
import type {
  AnnotationDto,
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
import { ArtifactTab } from '../src/features/artifacts/ArtifactTab'
import { MessageCanvasChips, RunArtifactsLine } from '../src/features/artifacts/CanvasRefs'
import { ContextChips } from '../src/features/artifacts/ContextChips'
import { clearContext, useCanvasContext } from '../src/features/artifacts/context'
import { frontMatterValue } from '../src/features/artifacts/designMd'
import { clearOfPanel, keepZoomBeside, layoutNodes } from '../src/features/artifacts/geometry'
import { linkPaths } from '../src/features/artifacts/Links'
import { resetArtifacts, useArtifactFocus } from '../src/features/artifacts/store'
import { realtime } from '../src/lib/realtime'
import { useStickOnResize } from '../src/lib/useStickOnResize'
import { useToasts } from '../src/ui'
import { type Call, mockApi } from './mockApi'

// Fixes from the 4th Stitch comparison walk-through (docs/plan/stitch-对比-第4轮.md): web P1-01…05 and P2s.

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
  visibility: 'group',
  createdBy: null,
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
const node = (id: string) => screen.getByTestId(`art-node-${id}`)
const bodies = (calls: Call[], method: string, path: string) =>
  calls.filter((c) => c.method === method && c.path === path).map((c) => c.body)
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
  setBots()
})
afterEach(() => {
  vi.unstubAllGlobals()
  vi.restoreAllMocks()
})

const css = (path: string) => readFileSync(`${process.cwd()}/src/features/${path}`, 'utf8')
/** The declarations of the rule whose selector list is exactly `selector`. */
const rule = (text: string, selector: string) => {
  const at = text.indexOf(`${selector} {`)
  if (at < 0) throw new Error(`no rule ${selector}`)
  return text.slice(at, text.indexOf('}', at))
}
function Probe() {
  const f = useArtifactFocus('a1')
  return <i data-testid="probe">{f?.screenIds.join(',') ?? ''}</i>
}
const withDocs = (o: Record<string, unknown> = {}) =>
  routes({
    'GET /artifacts/a1/versions/v2': detail({
      files: [
        { path: 'tokens.css', hash: 'b'.repeat(64), size: 10 },
        { path: 'DESIGN.md', hash: 'c'.repeat(64), size: 10 },
      ],
    }),
    'GET /artifacts/a1/files/tokens.css?version=v2': () =>
      new Response(':root {\n  --color-primary: #155332;\n}'),
    'GET /artifacts/a1/files/DESIGN.md?version=v2': () => new Response('---\nname: 书香\n---\n\n# 书香'),
    ...o,
  })

describe('floating glass (P1-02)', () => {
  it('blurs on a layer behind the bars, so the menus inside them blur the canvas too', () => {
    const text = css('artifacts/artifacts.css')
    const bars = rule(text, '.art-float,\n.art-tools,\n.art-corner')
    expect(bars).not.toContain('backdrop-filter')
    const layer = rule(text, '.art-float::before,\n.art-tools::before,\n.art-corner::before')
    expect(layer).toContain('backdrop-filter: var(--glass-blur)')
    expect(layer).toContain('z-index: -1')
  })
})

describe('chat column chips (P1-05, P2-01, P2-02, P2-16)', () => {
  it('keeps 在画布中查看 at the end of a run’s line, the text cut short before it', () => {
    render(
      <RunArtifactsLine
        artifacts={[
          {
            artifactId: 'a1',
            title: '麓客+ 探索生活',
            versionId: 'v2',
            n: 2,
            changedScreens: [
              { id: 'home', title: '首页' },
              { id: 'detail', title: '书籍详情' },
            ],
          },
        ]}
      />,
    )
    const line = screen.getByTestId('run-artifact')
    const text = line.querySelector('.art-run__text') as HTMLElement
    expect(text.title).toBe('麓客+ 探索生活 · v2 · 改了 首页、书籍详情')
    expect(within(line).getByRole('button', { name: '在画布中查看' }).className).toContain('art-run__open')
    const chips = css('artifacts/chips.css')
    expect(rule(chips, '.art-run')).toContain('max-width: 100%')
    expect(rule(chips, '.art-run__open')).toContain('flex: none')
    expect(rule(chips, '.art-chips--sent')).toContain('max-width: 100%')
    expect(rule(chips, '.art-chip__text')).toContain('max-width: min(320px, 100%)')
  })

  it('folds a long run line to 改了 N 屏 within the column, the names on hover (P1-05)', () => {
    render(
      <RunArtifactsLine
        artifacts={[
          {
            artifactId: 'a1',
            title: '麓客+ 探索生活',
            versionId: 'v1',
            n: 1,
            changedScreens: ['活动详情', '探索生活', '发现体验', '我的', '设置'].map((title, i) => ({
              id: `s${i}`,
              title,
            })),
          },
        ]}
      />,
    )
    const line = screen.getByTestId('run-artifact')
    const text = line.querySelector('.art-run__text') as HTMLElement
    expect(text.textContent).toBe('麓客+ 探索生活 · v1 · 改了 5 屏')
    expect(text.title).toBe('麓客+ 探索生活 · v1 · 改了 活动详情、探索生活、发现体验、我的、设置')
    expect(within(line).getByRole('button', { name: '在画布中查看' })).toBeTruthy()
    // The facts row is as wide as the message column at most, so the line shrinks instead of overflowing it.
    const tags = rule(
      readFileSync(`${process.cwd()}/src/features/chat/timeline.css`, 'utf8'),
      '.run-card__tags',
    )
    expect(tags).toContain('min-width: 0')
    expect(tags).toContain('max-width: min(560px, 100%)')
    expect(rule(css('artifacts/chips.css'), '.art-run__text')).toContain('text-overflow: ellipsis')
  })

  it('shows the reference files a message took along, and opens the canvas on one', () => {
    render(
      <>
        <MessageCanvasChips
          canvas={{
            artifactId: 'a1',
            title: '读书会小程序',
            screens: [],
            elements: [],
            refs: [
              { id: 'r1', title: '竞品参考.png' },
              { id: 'r2', title: '需求.md' },
            ],
          }}
        />
        <Probe />
      </>,
    )
    const chips = within(screen.getByTestId('message-canvas')).getAllByRole('button')
    expect(chips.map((c) => c.textContent)).toEqual(['读书会小程序', '参考 · 竞品参考.png', '参考 · 需求.md'])
    fireEvent.click(chips[1] as HTMLElement)
    expect(screen.getByTestId('probe').textContent).toBe('@ref:r1')
  })

  it('shows an element sent with several notes once, without a duplicate-key warning', () => {
    const error = vi.spyOn(console, 'error').mockImplementation(() => {})
    const el = { file: 'screens/home.html', ggId: '3124', label: '<h1> 标题' }
    render(
      <MessageCanvasChips
        canvas={{ artifactId: 'a1', title: '读书会小程序', screens: [], elements: [el, el, el] }}
      />,
    )
    expect(within(screen.getByTestId('message-canvas')).getAllByRole('button')).toHaveLength(1)
    expect(error.mock.calls.some((c) => String(c[0]).includes('same key'))).toBe(false)
  })

  it('folds more than two selected screens into one 「N 个屏幕」 chip, removable at once', () => {
    const screens = ['home', 'detail', 'shelf'].map((id, i) => ({
      key: `screen:${id}`,
      screenId: id,
      screenTitle: ['首页', '书籍详情', '书架'][i] as string,
      pinned: false,
    }))
    const context = {
      groupId: 'g1',
      artifactId: 'a1',
      title: '读书会小程序',
      botId: null,
      items: [
        ...screens,
        {
          key: 'ref:r1',
          screenId: '',
          screenTitle: '',
          pinned: true,
          ref: { id: 'r1', file: 'refs/competitor.png', title: '竞品首页.png', kind: 'image' as const },
        },
      ],
    }
    useCanvasContext.setState({ context })
    const { rerender } = render(
      <ContextChips
        context={context}
        bot={null}
        others={[]}
        onSwitch={() => {}}
        variations={null}
        onVariations={() => {}}
      />,
    )
    const folded = screen.getByTestId('art-context-screens')
    expect(folded.textContent).toBe('3 个屏幕')
    expect(folded.title).toBe('读书会小程序 · 首页、书籍详情、书架')
    expect(screen.getByTitle('参考 · 竞品首页.png')).toBeTruthy()
    fireEvent.click(within(folded).getByRole('button', { name: '移除 3 个屏幕' }))
    const left = useCanvasContext.getState().context
    expect(left?.items.map((i) => i.key)).toEqual(['ref:r1'])
    rerender(
      <ContextChips
        context={{ ...context, items: screens.slice(0, 2) }}
        bot={null}
        others={[]}
        onSwitch={() => {}}
        variations={null}
        onVariations={() => {}}
      />,
    )
    expect(screen.queryByTestId('art-context-screens')).toBeNull()
    expect(screen.getByTitle('读书会小程序 · 首页')).toBeTruthy()
  })
})

describe('annotations after a run (P2-03, P2-04)', () => {
  it('heads the panel with the notes sent to the AI on the version before, to resolve or reopen', async () => {
    const sent = note({ id: 'n7', versionId: 'v1', status: 'sent', note: '按钮改圆角' })
    const calls = mockApi(
      routes({
        'GET /artifacts/a1/annotations': [sent, note({ id: 'n8', versionId: 'v1', status: 'resolved' })],
        'GET /artifacts/a1/annotations?version=v2': [note({ id: 'n1' }), note({ id: 'n2', status: 'sent' })],
        'PATCH /annotations/n7': { ...sent, status: 'resolved' },
      }),
    )
    await renderTab()
    fireEvent.click(screen.getByRole('button', { name: '批注' }))
    const box = await screen.findByTestId('art-notes-sent')
    expect(box.textContent).toContain('v1 上发给 AI 的 1 条批注')
    expect(box.textContent).toContain('首页按钮改圆角')
    // Open notes of the shown version start ticked; ones already sent do not.
    expect(screen.getByRole('button', { name: '发给 @设计助手（1）' })).toBeTruthy()
    fireEvent.click(within(box).getByRole('button', { name: '标为已解决' }))
    await waitFor(() => expect(bodies(calls, 'PATCH', '/annotations/n7')).toEqual([{ status: 'resolved' }]))
  })
})

describe('the canvas (P2-06, P2-08, P2-09, P2-10, P2-12, P2-17, P2-18)', () => {
  it('does not zoom out for an open panel when the layout settles', () => {
    const now = { x: 0, y: 0, z: 0.17 }
    expect(keepZoomBeside({ x: 5, y: 5, z: 0.09 }, now, 420)).toBeNull()
    expect(keepZoomBeside({ x: 5, y: 5, z: 0.09 }, now, 0)).toEqual({ x: 5, y: 5, z: 0.09 })
    expect(keepZoomBeside({ x: 5, y: 5, z: 0.2 }, now, 420)).toEqual({ x: 5, y: 5, z: 0.2 })
  })

  it('pans just enough for what is edited to clear the panel', () => {
    expect(clearOfPanel({ left: 100, width: 100 }, 1000, 0)).toBe(0)
    expect(clearOfPanel({ left: 100, width: 100 }, 1000, 360)).toBe(0)
    expect(clearOfPanel({ left: 600, width: 100 }, 1000, 360)).toBe(84)
    // Too wide for the room: its left edge stays in view.
    expect(clearOfPanel({ left: 50, width: 900 }, 1000, 360)).toBe(26)
  })

  it('labels only the selection’s own links, fades the ones coming in, and keeps labels apart', () => {
    const { nodes } = layoutNodes({
      title: 'x',
      manifest: manifest([]),
      system: null,
      frames: {},
      content: {},
    })
    const v = { x: 0, y: 0, z: 1 }
    const links = [
      { from: 'home', to: 'detail', ggId: '1', text: '查看详情' },
      { from: 'detail', to: 'home', ggId: '2', text: '首页' },
    ]
    const [out, back] = linkPaths(nodes, links, v, {}, ['home'])
    expect(out?.faded).toBe(false)
    expect(back?.faded).toBe(true)
    // Unfocused, every label shows, none on top of another.
    const many = [1, 2, 3, 4].map((i) => ({ from: 'detail', to: 'home', ggId: String(i), text: `返回${i}` }))
    const extra = {
      ...manifest([]),
      screens: [
        ...manifest([]).screens,
        ...[1, 2, 3].map((i) => ({ id: `s${i}`, title: `屏${i}`, file: `screens/s${i}.html` })),
      ],
    }
    const all = layoutNodes({ title: 'x', manifest: extra, system: null, frames: {}, content: {} }).nodes
    const backs = linkPaths(
      all,
      [
        many[0],
        ...[1, 2, 3].map((i) => ({ from: `s${i}`, to: 'home', ggId: String(i), text: '首页' })),
      ].filter((l): l is NonNullable<typeof l> => !!l),
      v,
    )
    expect(backs.every((p) => !p.faded)).toBe(true)
    for (const a of backs)
      for (const b of backs)
        if (a !== b) expect(Math.abs(a.mid.x - b.mid.x) >= 96 || Math.abs(a.mid.y - b.mid.y) >= 20).toBe(true)
    // Links back swing lower one after another.
    const lows = backs.map((p) => Number(p.d.split(' ')[3]))
    expect(new Set(lows).size).toBe(lows.length)
  })

  it('gives the design system, DESIGN.md and the prototype menus of their own', async () => {
    mockApi(withDocs())
    await renderTab()
    await screen.findByTestId('art-node-@design-md')
    const menuOn = (id: string) => {
      fireEvent.contextMenu(node(id))
      const menu = screen.getByRole('menu')
      const labels = within(menu)
        .getAllByRole('menuitem')
        .map((m) => m.textContent)
      fireEvent.keyDown(menu, { key: 'Escape' })
      return labels
    }
    expect(menuOn('@system')).toEqual(['打开设计系统', '聚焦F', '复制链接'])
    expect(menuOn('@design-md')).toEqual(['打开 DESIGN.md', '复制 Markdown', '聚焦F', '复制链接'])
    expect(menuOn('@prototype')).toEqual(['打开原型编辑器', '扫码查看', '聚焦F', '复制链接'])
    fireEvent.contextMenu(node('@design-md'))
    fireEvent.click(item(screen.getByRole('menu'), /打开 DESIGN.md/))
    expect(await screen.findByRole('complementary', { name: '设计系统' })).toBeTruthy()
  })

  it('says a copy went through over the canvas, not in the chat column', async () => {
    const write = vi.fn(() => Promise.resolve())
    vi.stubGlobal('navigator', { ...navigator, clipboard: { writeText: write } })
    mockApi(withDocs())
    await renderTab()
    await screen.findByTestId('art-node-@design-md')
    fireEvent.contextMenu(node('@design-md'))
    fireEvent.click(item(screen.getByRole('menu'), /复制 Markdown/))
    expect((await screen.findByTestId('art-notice')).textContent).toBe('DESIGN.md 已复制')
    expect(write).toHaveBeenCalledWith('---\nname: 书香\n---\n\n# 书香')
    expect(useToasts.getState().items).toEqual([])
    expect(rule(css('artifacts/artifacts.css'), '.art-notice')).toContain(
      'left: calc((100% - var(--art-side, 0px)) / 2)',
    )
  })

  it('outlines the prototype node on the dark canvas, and lines up ⌘K group titles with their entries', () => {
    const text = css('artifacts/artifacts.css')
    expect(
      rule(text, '[data-theme="dark"] .art-node--prototype,\n[data-theme="hc-dark"] .art-node--prototype'),
    ).toContain('#ffffff3d')
    expect(rule(text, '.art-cmdk .ui-menu__header')).toContain('padding-left: var(--space-6)')
  })
})

describe('design issues (P2-11)', () => {
  const issues = [
    {
      code: 'raw-color',
      file: 'screens/detail.html',
      message: '用了令牌以外的颜色 #ff0000',
      severity: 'warn' as const,
    },
    { code: 'no-title', message: '缺少标题', severity: 'warn' as const },
  ]
  it('lists the findings: one brings its screen into view, 让 AI 修复 hands them all to the bot', async () => {
    const calls = mockApi(
      routes({
        'GET /artifacts/a1/versions': [version(1), version(2, { issues })],
        'POST /artifacts/a1/commands': { id: 'm1' },
      }),
    )
    render(
      <>
        <ArtifactTab tab={tab} tabKey="artifact:a1" active />
        <Probe />
      </>,
    )
    await screen.findByTitle('首页')
    fireEvent.click(await screen.findByRole('button', { name: '2 项规范问题' }))
    const list = screen.getByTestId('art-issues')
    const rows = within(list).getAllByRole('button')
    expect(rows.map((r) => r.textContent)).toEqual(['书籍详情用了令牌以外的颜色 #ff0000', '整个产物缺少标题'])
    expect(rows[1]?.hasAttribute('disabled')).toBe(true)
    fireEvent.click(rows[0] as HTMLElement)
    expect(screen.getByTestId('probe').textContent).toBe('detail')
    fireEvent.click(screen.getByRole('button', { name: '2 项规范问题' }))
    fireEvent.click(screen.getByRole('button', { name: '让 @设计助手 修复' }))
    await waitFor(() =>
      expect(bodies(calls, 'POST', '/artifacts/a1/commands')).toEqual([
        {
          command: 'edit-with-ai',
          botId: 'b1',
          screenIds: ['detail'],
          text: '修复这些规范问题，其余内容不变：\n- screens/detail.html：用了令牌以外的颜色 #ff0000\n- 缺少标题',
        },
      ]),
    )
  })
})

describe('seed colour (P2-05)', () => {
  it('reads the seed kept in DESIGN.md, quoted so YAML keeps the #', () => {
    expect(frontMatterValue('---\nname: 书香\nseed: "#7C3AED"\n---\n', 'seed')).toBe('#7C3AED')
    expect(frontMatterValue('# no front matter', 'seed')).toBe('')
  })
})

describe('chat column (P2-22)', () => {
  it('keeps the timeline pinned to its end while something below makes it shorter', () => {
    const observers: ResizeObserverCallback[] = []
    vi.stubGlobal(
      'ResizeObserver',
      class {
        constructor(cb: ResizeObserverCallback) {
          observers.push(cb)
        }
        observe() {}
        disconnect() {}
      },
    )
    const stick = { current: true }
    function Scroller() {
      const box = { current: null as HTMLDivElement | null }
      const ref = (el: HTMLDivElement | null) => {
        box.current = el
      }
      return <Pinned refFn={ref} box={box} />
    }
    function Pinned({
      refFn,
      box,
    }: {
      refFn: (el: HTMLDivElement | null) => void
      box: { current: HTMLDivElement | null }
    }) {
      useStickOnResize(box, stick)
      return <div ref={refFn} data-testid="scroller" />
    }
    render(<Scroller />)
    const el = screen.getByTestId('scroller')
    vi.spyOn(el, 'scrollHeight', 'get').mockReturnValue(900)
    act(() => {
      for (const cb of observers) cb([], {} as ResizeObserver)
    })
    expect(el.scrollTop).toBe(900)
    stick.current = false
    el.scrollTop = 100
    act(() => {
      for (const cb of observers) cb([], {} as ResizeObserver)
    })
    expect(el.scrollTop).toBe(100)
  })
})
