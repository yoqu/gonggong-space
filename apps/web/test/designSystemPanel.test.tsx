import type { ArtifactDto, ArtifactVersionDto } from '@gonggong/protocol'
import { act, fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { useWorkbench } from '../src/app/workbench'
import { useWorkspace } from '../src/app/workspace'
import { ArtifactTab } from '../src/features/artifacts/ArtifactTab'
import { resetArtifacts } from '../src/features/artifacts/store'
import { realtime } from '../src/lib/realtime'
import { useToasts } from '../src/ui/toast'
import { apiError, type Call, mockApi } from './mockApi'

// R4 of docs/plan/原型编辑器-Stitch对标-开发计划.md: the design-system panel (Stitch capability list §5).

const at = '2026-10-29T10:00:00Z'
const TOKENS = `/* generated from DESIGN.md */
:root {
  --color-primary: #155332;
  --color-on-primary: #FFFFFF;
  --color-background: #F5F5F7;
  --color-surface: #FFFFFF;
  --color-on-surface: #000000;
  --color-scrim: rgba(0, 0, 0, 0.55);
  --rounded-sm: 8px;
  --space-sm: 8px;
  --font-sans: "PingFang SC", -apple-system, "Helvetica Neue", "Hiragino Sans GB", "Microsoft YaHei", sans-serif;
  --text-title-md-size: 15px;
  --text-title-md-weight: 400;
  --text-title-md-leading: 21px;
}
.t-title-md { font-size: var(--text-title-md-size); }
`
const DESIGN = `---
version: alpha
name: 麓客+ 小程序
colors:
  primary: "#155332"
  surface: "#FFFFFF"
---

## 品牌色

<script>alert(1)</script>
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
  screens: [{ id: 'home', title: '首页', file: 'screens/home.html' }],
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
const routes = (o: Record<string, unknown> = {}) => ({
  'GET /artifacts/a1': artifact(),
  'GET /artifacts/a1/versions': [version(1), version(2)],
  'GET /artifacts/a1/versions/v2': {
    ...version(2, { files: [file('DESIGN.md'), file('tokens.css'), file('screens/home.html')] }),
    manifest,
    links: [],
  },
  'GET /artifacts/a1/files/tokens.css?version=v2': () => new Response(TOKENS),
  'GET /artifacts/a1/files/DESIGN.md?version=v2': () => new Response(DESIGN),
  'GET /artifacts/a1/design-systems': [
    {
      id: 'warm-reading',
      title: '暖色书房',
      description: '米色纸张与焦糖棕',
      swatches: ['#8C5835', '#F7F1EA'],
      category: 'app',
    },
  ],
  'POST /artifacts/a1/preview': { previewId: 'pw1', origin: 'https://a1.preview.test', url: '/x' },
  'POST /artifacts/a1/edits': artifact(),
  'POST /artifacts/a1/commands': { id: 'm1' },
  ...o,
})
const tab = { kind: 'artifact' as const, artifactId: 'a1', title: '读书会小程序' }

const openPanel = async () => {
  render(<ArtifactTab tab={tab} tabKey="artifact:a1" active />)
  await screen.findByTestId('art-design-system')
  fireEvent.click(tool())
  const panel = screen.getByRole('complementary', { name: '设计系统' })
  // DESIGN.md loaded: the name is in.
  await waitFor(() =>
    expect(within(panel).getByRole('textbox', { name: '设计系统名称' })).toHaveProperty(
      'value',
      '麓客+ 小程序',
    ),
  )
  return within(panel)
}
const toasts = () => useToasts.getState().items.map((i) => i.message)
const edits = (calls: Call[]) =>
  calls.filter((c) => c.method === 'POST' && c.path === '/artifacts/a1/edits').map((c) => c.body)
const value = (p: ReturnType<typeof within>, name: string) => p.getByRole('textbox', { name: `${name} 的值` })
const node = () => screen.getByTestId('art-design-system')
const tool = () =>
  within(screen.getByRole('toolbar', { name: '画布工具' })).getByRole('button', { name: '设计系统' })

class NoopSocket {
  close() {}
}
beforeEach(() => {
  localStorage.clear()
  resetArtifacts()
  vi.stubGlobal('WebSocket', NoopSocket)
  vi.spyOn(realtime, 'subscribe').mockImplementation(() => () => {})
  useWorkbench.setState({ groupId: 'g1', open: false, mode: 'split', previous: 'split', benches: {} })
  useWorkspace.setState({
    groups: [{ id: 'g1', botIds: ['b0', 'b1'] }] as never,
    bots: [
      { id: 'b0', name: '前端助手' },
      { id: 'b1', name: '设计助手' },
    ] as never,
  })
})
afterEach(() => {
  vi.unstubAllGlobals()
  vi.restoreAllMocks()
  useWorkspace.setState({ groups: [], bots: [] })
})

describe('design-system panel', () => {
  it('opens from the toolbar, the canvas menu and the node, and the node shows the name', async () => {
    mockApi(routes())
    const p = await openPanel()
    expect(within(node()).getByRole('heading', { name: '麓客+ 小程序' })).toBeTruthy()
    expect(p.getByRole('radio', { name: '浅色' }).getAttribute('aria-checked')).toBe('true')
    expect(p.getByRole('button', { name: '保存' })).toHaveProperty('disabled', true)
    fireEvent.click(tool())
    expect(screen.queryByRole('complementary', { name: '设计系统' })).toBeNull()
    fireEvent.contextMenu(screen.getByTestId('art-plane'))
    const menu = screen.getByRole('menu')
    fireEvent.click(within(menu).getByRole('menuitem', { name: /设计系统/ }))
    expect(screen.getByRole('complementary', { name: '设计系统' })).toBeTruthy()
  })

  it('previews palette edits on the node and saves them as token ops with DESIGN.md mirrored', async () => {
    const calls = mockApi(routes())
    const p = await openPanel()
    fireEvent.change(value(p, '--color-surface'), { target: { value: '#101010' } })
    expect(node().style.getPropertyValue('--a-color-surface')).toBe('#101010')
    fireEvent.change(p.getByRole('spinbutton', { name: '--rounded-sm 的值' }), { target: { value: '12' } })
    fireEvent.blur(p.getByRole('spinbutton', { name: '--rounded-sm 的值' }))
    fireEvent.click(p.getByRole('button', { name: '保存' }))
    await waitFor(() => expect(edits(calls)).toHaveLength(1))
    expect(edits(calls)[0]).toEqual({
      baseVersionId: 'v2',
      ops: [
        { kind: 'token', name: '--color-surface', value: '#101010' },
        { kind: 'token', name: '--rounded-sm', value: '12px' },
        {
          kind: 'file',
          path: 'DESIGN.md',
          content: DESIGN.replace('surface: "#FFFFFF"', 'surface: "#101010"'),
        },
      ],
    })
    // Over the canvas where it was done, not in the app's corner over the chat (P2-18).
    await waitFor(() => expect(screen.getByTestId('art-notice').textContent).toBe('设计系统已保存'))
    expect(toasts()).not.toContain('设计系统已保存')
  })

  it('writes the name into the front matter and edits DESIGN.md as a file op', async () => {
    const calls = mockApi(routes())
    const p = await openPanel()
    fireEvent.change(p.getByRole('textbox', { name: '设计系统名称' }), { target: { value: '暖色书房' } })
    expect(within(node()).getByRole('heading', { name: '暖色书房' })).toBeTruthy()
    fireEvent.click(p.getByRole('tab', { name: 'DESIGN.md' }))
    const source = p.getByRole('textbox', { name: 'DESIGN.md' }) as HTMLTextAreaElement
    expect(source.value).toContain('name: 暖色书房')
    fireEvent.change(source, { target: { value: `${source.value}\n## 文字\n` } })
    fireEvent.click(p.getByRole('button', { name: '保存' }))
    await waitFor(() => expect(edits(calls)).toHaveLength(1))
    expect(edits(calls)[0]).toEqual({
      baseVersionId: 'v2',
      ops: [
        {
          kind: 'file',
          path: 'DESIGN.md',
          content: `${DESIGN.replace('name: 麓客+ 小程序', 'name: 暖色书房')}\n## 文字\n`,
        },
      ],
    })
  })

  it('derives dark neutrals from the seed, applies the seed’s primary roles, and picks font stacks', async () => {
    const calls = mockApi(routes())
    const p = await openPanel()
    fireEvent.click(p.getByRole('radio', { name: '深色' }))
    expect(p.getByText('推导')).toBeTruthy()
    const surface = (value(p, '--color-surface') as HTMLInputElement).value
    expect(surface).not.toBe('#FFFFFF')
    expect(node().style.getPropertyValue('--a-color-on-surface')).not.toBe('#000000')
    // Back to light restores the version's own neutrals.
    fireEvent.click(p.getByRole('radio', { name: '浅色' }))
    expect((value(p, '--color-surface') as HTMLInputElement).value).toBe('#FFFFFF')
    expect(p.queryByText('推导')).toBeNull()
    expect(p.getByRole('button', { name: '保存' })).toHaveProperty('disabled', true)

    // A valid seed applies at once (D04).
    fireEvent.change(p.getByRole('textbox', { name: '种子色十六进制' }), { target: { value: '#8C5835' } })
    expect((value(p, '--color-primary') as HTMLInputElement).value).toBe('#8c5835')
    expect((value(p, '--color-on-primary') as HTMLInputElement).value).toBe('#ffffff')

    fireEvent.click(p.getByRole('button', { name: '--font-sans 字体' }))
    fireEvent.click(screen.getByRole('menuitemcheckbox', { name: /思源宋体（衬线）/ }))
    fireEvent.click(p.getByRole('button', { name: '保存' }))
    await waitFor(() => expect(edits(calls)).toHaveLength(1))
    const ops = (edits(calls)[0] as { ops: { kind: string; name?: string; value?: string }[] }).ops
    expect(ops.filter((o) => o.kind === 'token')).toEqual([
      { kind: 'token', name: '--color-primary', value: '#8c5835' },
      { kind: 'token', name: '--color-on-primary', value: '#ffffff' },
      {
        kind: 'token',
        name: '--font-sans',
        value: '"Source Han Serif SC", "Noto Serif SC", "Songti SC", serif',
      },
    ])
  })

  it('derives from the seed as it is typed, keeping colours set by hand', async () => {
    mockApi(routes())
    const p = await openPanel()
    const seed = p.getByRole('textbox', { name: '种子色十六进制' })
    expect(p.queryByRole('button', { name: '应用种子色' })).toBeNull()
    fireEvent.change(value(p, '--color-on-primary') as HTMLInputElement, { target: { value: '#EEEEEE' } })
    // Half-typed: nothing is derived yet.
    fireEvent.change(seed, { target: { value: '#8C58' } })
    expect((value(p, '--color-primary') as HTMLInputElement).value).toBe('#155332')
    fireEvent.change(seed, { target: { value: '#8C5835' } })
    expect((value(p, '--color-primary') as HTMLInputElement).value).toBe('#8c5835')
    expect(node().style.getPropertyValue('--a-color-primary')).toBe('#8c5835')
    expect((value(p, '--color-on-primary') as HTMLInputElement).value).toBe('#EEEEEE')
    // The next seed moves what the last one derived.
    fireEvent.change(seed, { target: { value: '#1E5AA8' } })
    expect((value(p, '--color-primary') as HTMLInputElement).value).toBe('#1e5aa8')
    expect((value(p, '--color-on-primary') as HTMLInputElement).value).toBe('#EEEEEE')
  })

  it('keeps the seed picked in DESIGN.md and shows it again, not the primary it derived (P2-05)', async () => {
    const calls = mockApi(
      routes({
        'GET /artifacts/a1/files/DESIGN.md?version=v2': () =>
          new Response(DESIGN.replace('name: 麓客+ 小程序', 'name: 麓客+ 小程序\nseed: "#7C3AED"')),
      }),
    )
    const p = await openPanel()
    const seed = p.getByRole('textbox', { name: '种子色十六进制' }) as HTMLInputElement
    expect(seed.value).toBe('#7C3AED')
    fireEvent.change(seed, { target: { value: '#8C5835' } })
    fireEvent.click(p.getByRole('button', { name: '保存' }))
    await waitFor(() => expect(edits(calls)).toHaveLength(1))
    const md = (edits(calls)[0] as { ops: { path?: string; content?: string }[] }).ops.find(
      (o) => o.path === 'DESIGN.md',
    )
    expect(md?.content).toContain('seed: "#8C5835"')
    expect(md?.content).not.toContain('#7C3AED')
  })

  it('applies a preset only after confirming', async () => {
    const calls = mockApi(routes())
    const p = await openPanel()
    await waitFor(() => expect(p.getByRole('button', { name: '预设' })).toHaveProperty('disabled', false))
    fireEvent.click(p.getByRole('button', { name: '预设' }))
    fireEvent.click(screen.getByRole('menuitem', { name: /暖色书房/ }))
    const dialog = screen.getByRole('alertdialog')
    expect(within(dialog).getByText('套用预设会覆盖当前主题')).toBeTruthy()
    expect(edits(calls)).toHaveLength(0)
    fireEvent.click(within(dialog).getByRole('button', { name: '套用' }))
    await waitFor(() =>
      expect(edits(calls)).toEqual([
        { baseVersionId: 'v2', ops: [{ kind: 'design-system', id: 'warm-reading' }] },
      ]),
    )
  })

  it('saves, then asks the bot that made the screens to apply the design system', async () => {
    const calls = mockApi(routes())
    const p = await openPanel()
    fireEvent.change(value(p, '--color-primary'), { target: { value: '#8C5835' } })
    fireEvent.click(p.getByRole('button', { name: '保存并让 AI 统一' }))
    await waitFor(() => expect(calls.some((c) => c.path === '/artifacts/a1/commands')).toBe(true))
    const posts = calls.filter((c) => c.method === 'POST' && c.path !== '/artifacts/a1/preview')
    expect(posts.map((c) => c.path)).toEqual(['/artifacts/a1/edits', '/artifacts/a1/commands'])
    expect(posts[1]?.body).toEqual({ command: 'apply-design-system', botId: 'b1' })
    // Over the canvas where it was done, not in the app's corner over the chat (P2-18).
    await waitFor(() =>
      expect(screen.getByTestId('art-notice').textContent).toBe('已让 设计助手 按设计系统统一所有屏幕'),
    )
    expect(toasts()).not.toContain('已让 设计助手 按设计系统统一所有屏幕')
  })

  it('keeps the draft on a 409 and lets the member discard it', async () => {
    const calls = mockApi(
      routes({ 'POST /artifacts/a1/edits': () => apiError(409, 'conflict', '不是最新版本') }),
    )
    const p = await openPanel()
    fireEvent.change(value(p, '--color-primary'), { target: { value: '#8C5835' } })
    fireEvent.click(p.getByRole('button', { name: '保存并让 AI 统一' }))
    expect(await p.findByText(/产物已有新版本，或 AI 正在修改/)).toBeTruthy()
    expect(calls.some((c) => c.path === '/artifacts/a1/commands')).toBe(false)
    expect((value(p, '--color-primary') as HTMLInputElement).value).toBe('#8C5835')
    fireEvent.click(p.getByRole('button', { name: '放弃改动' }))
    expect((value(p, '--color-primary') as HTMLInputElement).value).toBe('#155332')
  })

  it('asks before closing with unsaved changes', async () => {
    mockApi(routes())
    const p = await openPanel()
    fireEvent.change(value(p, '--color-primary'), { target: { value: '#8C5835' } })
    fireEvent.click(p.getByRole('button', { name: '关闭' }))
    let dialog = screen.getByRole('alertdialog', { name: '放弃未保存的设计系统改动？' })
    fireEvent.click(within(dialog).getByRole('button', { name: '继续编辑' }))
    expect(screen.getByRole('complementary', { name: '设计系统' })).toBeTruthy()
    // The toolbar toggle and switching panels ask too.
    fireEvent.click(screen.getByRole('button', { name: '收藏' }))
    dialog = screen.getByRole('alertdialog', { name: '放弃未保存的设计系统改动？' })
    fireEvent.click(within(dialog).getByRole('button', { name: '放弃改动' }))
    expect(screen.queryByRole('complementary', { name: '设计系统' })).toBeNull()
    expect(screen.getByRole('complementary', { name: '收藏' })).toBeTruthy()
    expect(node().style.getPropertyValue('--a-color-primary')).toBe('#155332')
  })

  it('is read-only while the AI is editing, with DESIGN.md rendered safely', async () => {
    mockApi(routes({ 'GET /artifacts/a1': artifact({ running: true }) }))
    const p = await openPanel()
    expect(p.getByText('AI 修改中或查看历史版本时只读')).toBeTruthy()
    expect(value(p, '--color-primary')).toHaveProperty('disabled', true)
    expect(p.getByRole('button', { name: '保存' })).toHaveProperty('disabled', true)
    expect(p.getByRole('button', { name: '保存并让 AI 统一' })).toHaveProperty('disabled', true)
    expect(p.getByRole('textbox', { name: '种子色十六进制' })).toHaveProperty('disabled', true)
    fireEvent.click(p.getByRole('tab', { name: 'DESIGN.md' }))
    expect(p.queryByRole('textbox', { name: 'DESIGN.md' })).toBeNull()
    expect(p.getByRole('heading', { name: '品牌色' })).toBeTruthy()
    expect(document.querySelector('.art-dsp script')).toBeNull()
    await act(async () => {})
  })
})
