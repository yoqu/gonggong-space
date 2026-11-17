import type { ArtifactDto, ArtifactVersionDto, BotDto, GroupDto, UserDto } from '@gonggong/protocol'
import { act, fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { useSession } from '../src/app/session'
import { useWorkbench } from '../src/app/workbench'
import { useWorkspace } from '../src/app/workspace'
import { ArtifactTab } from '../src/features/artifacts/ArtifactTab'
import { clearContext } from '../src/features/artifacts/context'
import { implementationPrompt } from '../src/features/artifacts/implPrompt'
import {
  addRuleOps,
  anchorFor,
  anchorSpots,
  defaultLabel,
  loadRomanizer,
  promptRules,
  referringScreens,
  ruleStats,
  sharedChunks,
  sharedRefs,
} from '../src/features/artifacts/rules'
import { resetArtifacts } from '../src/features/artifacts/store'
import { realtime } from '../src/lib/realtime'
import { useToasts } from '../src/ui'
import { type Call, mockApi } from './mockApi'

// Page business rules (rules/<screen>.md, rules/shared.md): design/app-screens-fzvz rules-view, rules-add, shared-rules.

const HOME_RULES = `# 首页 · 页面规则

1. **本周共读** \`#ben-zhou-gong-du\`：未登录时点击先去登录。
2. **整页** [待确认]：家庭成员能否看到书单？（见 S1）
`
const SHARED = `# 共享规则

## S1 角色权限
| 操作 | 下单人 |
| --- | --- |
| 看书单 | 是 |

## S2 金额取整
- 四舍五入到分
`

describe('rules.ts', () => {
  it('counts rules and pending ones', () => {
    expect(
      ruleStats([
        { label: 'a', anchor: 'a', pending: false, text: 'x' },
        { label: null, anchor: null, pending: true, text: 'y' },
      ]),
    ).toEqual({ total: 2, pending: 1 })
  })

  it('names an element by its first 12 characters, else its tag', () => {
    expect(defaultLabel({ text: '  超过 200 字时禁止继续输入 ', tag: 'p' })).toBe('超过 200 字时禁止继')
    expect(defaultLabel({ text: '', tag: 'textarea' })).toBe('textarea')
  })

  it('makes a kebab anchor from the name (pinyin for Chinese), unique in the screen', async () => {
    const romanize = await loadRomanizer()
    expect(anchorFor('退款原因', 'div', [], romanize)).toBe('tui-kuan-yuan-yin')
    expect(anchorFor('Submit order!', 'button', ['submit-order'])).toBe('submit-order-2')
    expect(anchorFor('Submit order!', 'button', ['submit-order', 'submit-order-2'])).toBe('submit-order-3')
    expect(anchorFor('……', 'button', [])).toBe('button')
    const long = anchorFor('a'.repeat(10).split('').join(' ').repeat(6), 'p', [])
    expect(long.length).toBeLessThanOrEqual(40)
    expect(long).toMatch(/^[a-z0-9]+(-[a-z0-9]+)*$/)
  })

  it('adds a rule: an element without an anchor gets one in the same version, one with an anchor only the file', () => {
    const base = {
      screenId: 'home',
      title: '首页 · 页面规则',
      rules: [],
      text: '必填',
      pending: true,
      taken: [],
    }
    const target = { label: 'Name', file: 'screens/home.html', ggId: '12', anchor: null, tag: 'input' }
    expect(addRuleOps({ ...base, target })).toEqual([
      { kind: 'attr', file: 'screens/home.html', ggId: '12', name: 'data-gg-anchor', value: 'name' },
      {
        kind: 'file',
        path: 'rules/home.md',
        content: '# 首页 · 页面规则\n\n1. **Name** `#name` [待确认]：必填\n',
      },
    ])
    expect(addRuleOps({ ...base, pending: false, target: { ...target, anchor: 'nick' } })).toEqual([
      { kind: 'file', path: 'rules/home.md', content: '# 首页 · 页面规则\n\n1. **Name** `#nick`：必填\n' },
    ])
    // Whole page, or an element made by a script (no ggId, no anchor).
    const page = '# 首页 · 页面规则\n\n1. **整页**：必填\n'
    expect(addRuleOps({ ...base, pending: false, target: null })).toEqual([
      { kind: 'file', path: 'rules/home.md', content: page },
    ])
    expect(addRuleOps({ ...base, pending: false, target: { ...target, ggId: null } })).toEqual([
      { kind: 'file', path: 'rules/home.md', content: page },
    ])
  })

  it('keeps well-formed anchor spots only', () => {
    expect(
      anchorSpots([
        { anchor: 'ok', ggId: '3', rect: { x: 1, y: 2, w: 3, h: 4 } },
        { anchor: 'Bad Anchor', ggId: '3', rect: { x: 1, y: 2, w: 3, h: 4 } },
        { anchor: 'nope', ggId: '3' },
      ]),
    ).toEqual([{ anchor: 'ok', ggId: '3', rect: { x: 1, y: 2, w: 3, h: 4 } }])
    expect(anchorSpots(undefined)).toBeUndefined()
  })

  it('finds which page rules refer to each shared rule', () => {
    const pages = {
      list: { title: null, md: '', rules: [{ label: null, anchor: null, pending: false, text: 'a' }] },
      home: {
        title: null,
        md: '',
        rules: [
          { label: null, anchor: null, pending: false, text: 'b' },
          { label: null, anchor: null, pending: false, text: '见 S1、S2' },
        ],
      },
    }
    const refs = sharedRefs(pages, [
      { id: 'list', title: '订单列表' },
      { id: 'home', title: '首页' },
    ])
    expect(refs).toEqual({
      S1: [{ screenId: 'home', title: '首页', n: 2 }],
      S2: [{ screenId: 'home', title: '首页', n: 2 }],
    })
    expect(referringScreens(refs)).toBe(1)
  })

  it('splits the shared rules into sections', () => {
    expect(sharedChunks(SHARED).map((c) => c.id)).toEqual([null, 'S1', 'S2'])
  })

  it('puts each screen’s rules into the implementation prompt, pending ones apart', () => {
    expect(promptRules([], null, 'x')).toEqual([])
    const prompt = implementationPrompt({
      title: '读书会',
      dir: 'design/a',
      manifest: {
        title: '读书会',
        device: 'mobile',
        entry: 'home',
        screens: [
          { id: 'home', title: '首页', file: 'screens/home.html' },
          { id: 'detail', title: '详情', file: 'screens/detail.html' },
        ],
      },
      links: [],
      designMd: null,
      tokens: [],
      rules: {
        pages: {
          home: {
            title: null,
            md: '',
            rules: [
              { label: '本周共读', anchor: 'ben-zhou', pending: false, text: '未登录先登录' },
              { label: '整页', anchor: null, pending: true, text: '家庭成员？见 S1' },
            ],
          },
        },
        shared: SHARED,
      },
    })
    expect(prompt).toContain(
      [
        '- home「首页」：design/a/screens/home.html',
        '  本屏业务规则：',
        '  1. 本周共读（data-gg-anchor="ben-zhou"）：未登录先登录',
        '  未定（待确认，实现前先问清楚）：',
        '  2. 整页：家庭成员？见 S1',
        '  引用的共享规则（全文见 design/a/rules/shared.md）：',
        '  - S1 角色权限',
        '- detail「详情」：design/a/screens/detail.html',
      ].join('\n'),
    )
  })
})

// ── On the canvas ──

const at = '2026-11-16T10:00:00Z'
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
  ...o,
})
const ruleFiles = (shared = true) => [
  { path: 'rules/home.md', hash: 'c'.repeat(64), size: 10 },
  ...(shared ? [{ path: 'rules/shared.md', hash: 'd'.repeat(64), size: 10 }] : []),
]
const routes = (o: Record<string, unknown> = {}, shared = true) => ({
  'GET /artifacts/a1': artifact(),
  'GET /artifacts/a1/versions': [version(1), version(2)],
  'GET /artifacts/a1/versions/v2': { ...version(2, { files: ruleFiles(shared) }), manifest, links: [] },
  'GET /artifacts/a1/files/rules/home.md?version=v2': () => new Response(HOME_RULES),
  'GET /artifacts/a1/files/rules/shared.md?version=v2': () => new Response(SHARED),
  'GET /artifacts/a1/annotations?version=v2': [],
  'GET /artifacts/a1/commands': [],
  'POST /artifacts/a1/preview': { previewId: 'pw1', origin: ORIGIN, url: '/api/previews/pw1/open' },
  'POST /artifacts/a1/edits': artifact(),
  'POST /artifacts/a1/commands': { id: 'm1' },
  ...o,
})
const me = { id: 'u1', name: '王磊', role: 'member' } as UserDto
const tab = { kind: 'artifact' as const, artifactId: 'a1', title: '读书会小程序' }
const renderTab = async () => {
  render(<ArtifactTab tab={tab} tabKey="artifact:a1" active />)
  await screen.findByTitle('首页')
}
const bodies = (calls: Call[], method: string, path: string) =>
  calls.filter((c) => c.method === method && c.path === path).map((c) => c.body)
const frameOf = (title: string) => document.querySelector(`iframe[title="${title}"]`) as HTMLIFrameElement
const fromScreen = (data: Record<string, unknown>, title = '首页', file = 'screens/home.html') => {
  const iframe = frameOf(title)
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
const select = (o: Record<string, unknown> = {}) =>
  fromScreen({
    type: 'select',
    ggId: '40',
    selector: 'body > textarea',
    rect: { x: 10, y: 200, w: 300, h: 60 },
    tag: 'textarea',
    text: '',
    textOnly: true,
    computed: {},
    inlineStyle: '',
    src: null,
    href: null,
    link: null,
    transition: null,
    anchor: null,
    snippet: '<textarea>',
    ...o,
  })
const panel = () => screen.getByRole('complementary', { name: '页面规则' })

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

describe('page rules on the canvas', () => {
  it('badges a screen with its rules, opens them, and the marks toggle hides badges', async () => {
    mockApi(routes())
    await renderTab()
    const badge = await screen.findByRole('button', { name: '规则 2 · 待确认 1' })
    expect(screen.queryByTestId('art-rules-badge-detail')).toBeNull()
    fireEvent.click(badge)
    const p = panel()
    expect(within(p).getByText('2 条 · 待确认 1')).toBeTruthy()
    expect(within(p).getByText('本周共读')).toBeTruthy()
    expect(within(p).getByText('整页')).toBeTruthy()
    expect(within(p).getByText('未登录时点击先去登录。')).toBeTruthy()
    // The Markdown view is the file itself.
    fireEvent.click(within(p).getByRole('radio', { name: 'Markdown' }))
    expect((within(p).getByRole('textbox', { name: 'Markdown' }) as HTMLTextAreaElement).value).toBe(
      HOME_RULES,
    )

    fireEvent.click(screen.getByRole('button', { name: '显示角标' }))
    expect(screen.queryByRole('button', { name: '规则 2 · 待确认 1' })).toBeNull()
    expect(localStorage.getItem('gg.art.ruleMarks')).toBe('off')
  })

  it('marks the elements the screen reports by anchor; a mark opens its rule and a rule highlights its element', async () => {
    mockApi(routes())
    await renderTab()
    await screen.findByRole('button', { name: '规则 2 · 待确认 1' })
    const frame = frameOf('首页').contentWindow as Window
    fromScreen({
      type: 'ready',
      width: 390,
      height: 800,
      anchors: [{ anchor: 'ben-zhou-gong-du', ggId: '12', rect: { x: 20, y: 100, w: 80, h: 20 } }],
    })
    const post = vi.spyOn(frame, 'postMessage').mockImplementation(() => {})
    const mark = screen.getByTestId('art-rule-mark-home-1')
    expect(mark.textContent).toBe('1')
    // The whole-page rule hangs at the screen's top left, pending.
    expect(screen.getByTestId('art-rule-mark-home-2').className).toContain('art-rule-mark--pending')
    fireEvent.click(mark)
    expect(within(panel()).getByTestId('art-rule-1').className).toContain('art-rule--on')
    fireEvent.click(within(panel()).getByText('未登录时点击先去登录。'))
    expect(post.mock.calls.map(([m]) => m)).toContainEqual({
      source: 'gg-host',
      type: 'highlight',
      ggIds: ['12'],
    })
  })

  it('edits and deletes a rule as one file save each', async () => {
    const calls = mockApi(routes())
    await renderTab()
    fireEvent.click(await screen.findByRole('button', { name: '规则 2 · 待确认 1' }))
    const rule = within(panel()).getByTestId('art-rule-2')
    fireEvent.click(within(rule).getByRole('button', { name: '编辑' }))
    fireEvent.change(within(rule).getByRole('textbox'), { target: { value: '家庭成员不能申请退款。' } })
    fireEvent.click(within(rule).getByRole('checkbox'))
    fireEvent.click(within(rule).getByRole('button', { name: '保存' }))
    await waitFor(() =>
      expect(bodies(calls, 'POST', '/artifacts/a1/edits')).toEqual([
        {
          baseVersionId: 'v2',
          ops: [
            {
              kind: 'file',
              path: 'rules/home.md',
              content:
                '# 首页 · 页面规则\n\n1. **本周共读** `#ben-zhou-gong-du`：未登录时点击先去登录。\n2. **整页**：家庭成员不能申请退款。\n',
            },
          ],
        },
      ]),
    )
    fireEvent.click(within(within(panel()).getByTestId('art-rule-1')).getByRole('button', { name: '删除' }))
    await waitFor(() => expect(bodies(calls, 'POST', '/artifacts/a1/edits')).toHaveLength(2))
    expect(bodies(calls, 'POST', '/artifacts/a1/edits')[1]).toMatchObject({
      ops: [
        {
          kind: 'file',
          path: 'rules/home.md',
          content: '# 首页 · 页面规则\n\n1. **整页** [待确认]：家庭成员能否看到书单？（见 S1）\n',
        },
      ],
    })
  })

  it('adds a rule by picking an element: its anchor and the rule in one version', async () => {
    const calls = mockApi(routes())
    await renderTab()
    fireEvent.click(await screen.findByRole('button', { name: '规则 2 · 待确认 1' }))
    fromScreen({ type: 'ready', width: 390, height: 800 })
    const frame = frameOf('首页').contentWindow as Window
    const post = vi.spyOn(frame, 'postMessage').mockImplementation(() => {})
    fireEvent.click(within(panel()).getByRole('button', { name: '添加规则' }))
    expect(screen.getByRole('status', { name: '选取元素' }).textContent).toContain('点击页面元素挂规则')
    expect(post.mock.calls.map(([m]) => m)).toContainEqual({ source: 'gg-host', type: 'mode', mode: 'mark' })
    select({ text: 'Remark box', tag: 'textarea' })
    const card = within(panel()).getByRole('group', { name: '新规则 3' })
    expect((within(card).getByRole('textbox', { name: '挂载元素名' }) as HTMLInputElement).value).toBe(
      'Remark box',
    )
    expect(screen.getByTestId('art-rule-draft').textContent).toBe('3')
    fireEvent.change(within(card).getByRole('textbox', { name: '规则' }), {
      target: { value: '超过 200 字时禁止继续输入。' },
    })
    fireEvent.click(within(card).getByRole('checkbox', { name: '标记为待确认' }))
    fireEvent.keyDown(within(card).getByRole('textbox', { name: '规则' }), { key: 'Enter', metaKey: true })
    await waitFor(() => expect(bodies(calls, 'POST', '/artifacts/a1/edits')).toHaveLength(1))
    expect(bodies(calls, 'POST', '/artifacts/a1/edits')[0]).toMatchObject({
      ops: [
        { kind: 'attr', file: 'screens/home.html', ggId: '40', name: 'data-gg-anchor', value: 'remark-box' },
        {
          kind: 'file',
          path: 'rules/home.md',
          content: expect.stringContaining(
            '3. **Remark box** `#remark-box` [待确认]：超过 200 字时禁止继续输入。\n',
          ),
        },
      ],
    })
    await waitFor(() => expect(screen.queryByRole('status', { name: '选取元素' })).toBeNull())
  })

  it('a script-made element can only take a whole-page rule; Esc cancels picking', async () => {
    mockApi(routes())
    await renderTab()
    fireEvent.click(await screen.findByRole('button', { name: '规则 2 · 待确认 1' }))
    fireEvent.click(within(panel()).getByRole('button', { name: '添加规则' }))
    select({ ggId: null, text: '动态' })
    expect(within(panel()).getByText('脚本生成的元素只能挂整页')).toBeTruthy()
    fireEvent.keyDown(window, { key: 'Escape' })
    expect(screen.queryByRole('status', { name: '选取元素' })).toBeNull()
    expect(within(panel()).queryByRole('group', { name: '新规则 3' })).toBeNull()
  })

  it('AI 补全 hands the screen to the artifact’s bot', async () => {
    const calls = mockApi(routes())
    await renderTab()
    fireEvent.click(await screen.findByRole('button', { name: '规则 2 · 待确认 1' }))
    fireEvent.click(within(panel()).getByRole('button', { name: 'AI 补全' }))
    await waitFor(() =>
      expect(bodies(calls, 'POST', '/artifacts/a1/commands')).toEqual([
        { command: 'complete-rules', botId: 'b1', screenIds: ['home'] },
      ]),
    )
  })
})

describe('shared rules', () => {
  it('shows the file on the canvas and as a Markdown document with who refers to each section', async () => {
    mockApi(routes())
    await renderTab()
    const node = await screen.findByTestId('art-shared-rules')
    expect(within(node).getByText('角色权限', { exact: false })).toBeTruthy()
    fireEvent.click(node)
    const view = screen.getByRole('complementary', { name: '共享规则.md' })
    expect(within(view).getByText('被 1 个页面引用')).toBeTruthy()
    const refs = within(view).getByTestId('art-shared-refs-S1')
    expect(refs.textContent).toBe('引用：首页 #2')
    expect(within(view).queryByTestId('art-shared-refs-S2')).toBeNull()
    fireEvent.click(within(refs).getByRole('button', { name: '首页 #2' }))
    expect(within(panel()).getByTestId('art-rule-2').className).toContain('art-rule--on')
    // S1 in a page rule opens the shared rules.
    fireEvent.click(within(panel()).getByRole('button', { name: 'S1' }))
    expect(screen.getByRole('complementary', { name: '共享规则.md' })).toBeTruthy()
  })

  it('without the file an editor sees an empty node to start one; the source saves as rules/shared.md', async () => {
    const calls = mockApi(routes({}, false))
    await renderTab()
    const node = await screen.findByTestId('art-shared-rules')
    expect(within(node).getByText('还没有共享规则')).toBeTruthy()
    fireEvent.click(within(node).getByRole('button', { name: '新建' }))
    const view = screen.getByRole('complementary', { name: '共享规则.md' })
    const src = within(view).getByRole('textbox', { name: '共享规则.md' }) as HTMLTextAreaElement
    fireEvent.change(src, { target: { value: '# 共享规则\n\n## S1 状态\n- 待付款\n' } })
    fireEvent.click(within(view).getByRole('button', { name: '保存' }))
    await waitFor(() =>
      expect(bodies(calls, 'POST', '/artifacts/a1/edits')).toEqual([
        {
          baseVersionId: 'v2',
          ops: [{ kind: 'file', path: 'rules/shared.md', content: '# 共享规则\n\n## S1 状态\n- 待付款\n' }],
        },
      ]),
    )
  })
})
