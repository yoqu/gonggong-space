import type { BotDto, GroupDto, MessageDto, RunDto } from '@gonggong/protocol'
import { act, fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import type { ReactElement } from 'react'
import { MemoryRouter } from 'react-router'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { FloatingChat } from '../src/app/floatingChat'
import { useWorkbench } from '../src/app/workbench'
import { useWorkspace } from '../src/app/workspace'
import { useCanvasChat } from '../src/features/artifacts/chatRoot'
import { type CanvasContext, clearContext, useCanvasContext } from '../src/features/artifacts/context'
import { setArtifactPage } from '../src/features/artifacts/page'
import { artifactSlash, parseArtifactSlash } from '../src/features/artifacts/slash'
import { loadArtifact, resetArtifacts, useArtifactFocus } from '../src/features/artifacts/store'
import { MessageComposer } from '../src/features/chat/MessageComposer'
import { RunCard, UserMessage } from '../src/features/chat/TimelineItems'
import { useToasts } from '../src/ui'
import { mockApi } from './mockApi'

// G07 / G11 / G14 of docs/archive/2026-11/stitch-对比-第3轮.md: the group composer and timeline around the canvas.

const at = '2026-10-30T10:00:00Z'
const bots = [
  {
    id: 'b1',
    name: '设计助手',
    presence: 'online',
    avatar: 'role-no',
    systemPrompt: '',
    agentKind: 'claude',
  },
] as BotDto[]
const group = { id: 'g1', kind: 'group', members: [], botIds: ['b1'] } as unknown as GroupDto
const home = { key: 'screen:home', screenId: 'home', screenTitle: '首页', pinned: false }
const setCanvas = (items: CanvasContext['items'] = [home]) =>
  useCanvasContext.setState({
    context: { groupId: 'g1', artifactId: 'a1', title: '读书会', botId: 'b1', items },
  })
const input = () => screen.getByRole('combobox') as HTMLTextAreaElement
const type = (value: string) => fireEvent.change(input(), { target: { value } })
const posts = (calls: { method: string; path: string; body: unknown }[], path: string) =>
  calls.filter((c) => c.method === 'POST' && c.path === path).map((c) => c.body)
const withRouter = (ui: ReactElement) => render(<MemoryRouter>{ui}</MemoryRouter>)
function FocusProbe() {
  const f = useArtifactFocus('a1')
  return <output data-testid="focus">{f ? JSON.stringify([f.screenIds, f.versionId]) : ''}</output>
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
  useWorkspace.setState({ groups: [group], bots })
  useCanvasChat.setState({ byGroup: {} })
  useWorkbench.setState({ groupId: 'g1', open: false, mode: 'split', previous: 'split', benches: {} })
})
afterEach(() => {
  vi.unstubAllGlobals()
  vi.restoreAllMocks()
})

describe("the canvas's own composer (画布 AI 对话)", () => {
  const chat = { rootId: 'root1', artifactId: 'a1', botId: 'b1' }

  it("always posts to the artifact's AI 对话, to its bot, carrying the canvas selection", async () => {
    const calls = mockApi({ 'POST /groups/g1/messages': (b: unknown) => ({ id: 'm1', ...(b as object) }) })
    useCanvasChat.setState({ byGroup: { g1: { artifactId: 'a1', rootId: 'root1' } } })
    render(<MessageComposer group={group} onSent={() => {}} canvasChat={chat} />)
    expect(input().placeholder).toBe('描述要怎么改，发给 @设计助手，回复显示在左侧「AI 对话」')
    type('首页改成深色')
    fireEvent.keyDown(input(), { key: 'Enter' })
    await waitFor(() => expect(posts(calls, '/groups/g1/messages')).toHaveLength(1))
    expect(posts(calls, '/groups/g1/messages')[0]).toMatchObject({
      body: '首页改成深色',
      threadRootId: 'root1',
    })
    expect(posts(calls, '/groups/g1/messages')[0]).not.toHaveProperty('alsoSent')

    setCanvas()
    type('标题加粗')
    fireEvent.keyDown(input(), { key: 'Enter' })
    await waitFor(() => expect(posts(calls, '/groups/g1/messages')).toHaveLength(2))
    expect(posts(calls, '/groups/g1/messages')[1]).toMatchObject({
      threadRootId: 'root1',
      artifactContext: { artifactId: 'a1' },
    })
  })

  it('names every selected page top left, drops the other chips, and keeps 设计系统 under the input', () => {
    mockApi({})
    useCanvasChat.setState({ byGroup: { g1: { artifactId: 'a1', rootId: 'root1' } } })
    setCanvas([
      home,
      { key: 'screen:detail', screenId: 'detail', screenTitle: '详情', pinned: false },
      { key: 'screen:pay', screenId: 'pay', screenTitle: '支付', pinned: false },
    ])
    render(<MessageComposer group={group} onSent={() => {}} canvasChat={{ ...chat, designSystem: true }} />)
    const pages = screen.getByTestId('art-canvas-pages')
    expect(
      within(pages)
        .getAllByTestId('art-canvas-page')
        .map((c) => c.textContent),
    ).toEqual(['首页', '详情', '支付'])
    expect(screen.queryByTestId('art-context-to')).toBeNull()
    expect(screen.queryByTestId('art-variations')).toBeNull()
    expect(
      within(screen.getByTestId('composer-chips')).queryByRole('button', { name: /设计系统/ }),
    ).toBeNull()
    const asked = useCanvasContext.getState().design?.n ?? 0
    fireEvent.click(screen.getByRole('button', { name: '设计系统' }))
    expect(useCanvasContext.getState().design).toEqual({ artifactId: 'a1', n: asked + 1 })
    fireEvent.click(within(pages).getByRole('button', { name: '移除 详情' }))
    expect(
      within(pages)
        .getAllByTestId('art-canvas-page')
        .map((c) => c.textContent),
    ).toEqual(['首页', '支付'])
  })

  it('takes the one page opened in the list as the selected page and sends it along', async () => {
    const calls = mockApi({
      'GET /artifacts/a1': () => ({
        id: 'a1',
        title: '读书会',
        manifest: { entry: 'home', screens: [{ id: 'home', title: '首页', file: 'screens/home.html' }] },
      }),
      'GET /artifacts/a1/versions': () => [],
      'POST /groups/g1/messages': (b: unknown) => ({ id: 'm1', ...(b as object) }),
    })
    await loadArtifact('a1')
    setArtifactPage('a1', 'home')
    useCanvasChat.setState({ byGroup: { g1: { artifactId: 'a1', rootId: 'root1' } } })
    render(<MessageComposer group={group} onSent={() => {}} canvasChat={chat} />)
    expect(screen.getByTestId('art-canvas-page').textContent).toBe('首页')
    type('标题加粗')
    fireEvent.keyDown(input(), { key: 'Enter' })
    await waitFor(() => expect(posts(calls, '/groups/g1/messages')).toHaveLength(1))
    expect(posts(calls, '/groups/g1/messages')[0]).toMatchObject({
      artifactContext: { artifactId: 'a1', page: 'home' },
    })
    setArtifactPage('a1', null)
  })

  it('leaves the group composer to the group, 全屏 or not, and keeps the canvas selection out of it', async () => {
    const calls = mockApi({ 'POST /groups/g1/messages': (b: unknown) => ({ id: 'm1', ...(b as object) }) })
    useCanvasChat.setState({ byGroup: { g1: { artifactId: 'a1', rootId: 'root1' } } })
    setCanvas()
    for (const floating of [true, false]) {
      const { unmount } = render(
        <FloatingChat.Provider value={floating}>
          <MessageComposer group={group} onSent={() => {}} />
        </FloatingChat.Provider>,
      )
      expect(screen.queryByTestId('composer-chips')).toBeNull()
      type('大家看看')
      fireEvent.keyDown(input(), { key: 'Enter' })
      await waitFor(() => expect(posts(calls, '/groups/g1/messages')).toHaveLength(floating ? 1 : 2))
      const sent = posts(calls, '/groups/g1/messages').at(-1)
      expect(sent).not.toHaveProperty('threadRootId')
      expect(sent).not.toHaveProperty('artifactContext')
      unmount()
    }
  })
})

describe('variations ×n in the composer (G07)', () => {
  it('sends the draft as a variations command, then turns itself off', async () => {
    const calls = mockApi({ 'POST /artifacts/a1/commands': { id: 'm1' } })
    setCanvas()
    render(<MessageComposer group={group} onSent={() => {}} />)
    const toggle = screen.getByRole('button', { name: /变体/, pressed: false })
    fireEvent.click(toggle)
    expect(screen.getByRole('button', { name: /变体/, pressed: true })).toBeTruthy()
    fireEvent.click(screen.getByRole('button', { name: '变体数量' }))
    fireEvent.click(screen.getByRole('menuitemcheckbox', { name: '×5' }))
    expect(input().placeholder).toBe('描述变体方向，生成 5 个变体')
    type('更活泼的配色')
    fireEvent.keyDown(input(), { key: 'Enter' })
    await waitFor(() => expect(posts(calls, '/artifacts/a1/commands')).toHaveLength(1))
    expect(posts(calls, '/artifacts/a1/commands')[0]).toEqual({
      command: 'variations',
      count: 5,
      text: '更活泼的配色',
      screenIds: ['home'],
      botId: 'b1',
    })
    expect(posts(calls, '/groups/g1/messages')).toEqual([])
    await waitFor(() => expect(input().value).toBe(''))
    expect(useCanvasContext.getState().context).toBeNull()
  })

  it('does not send an empty draft with variations on', async () => {
    const calls = mockApi({ 'POST /artifacts/a1/commands': { id: 'm1' } })
    setCanvas()
    render(<MessageComposer group={group} onSent={() => {}} />)
    fireEvent.click(screen.getByRole('button', { name: /变体/, pressed: false }))
    fireEvent.keyDown(input(), { key: 'Enter' })
    await new Promise((r) => setTimeout(r, 20))
    expect(calls.filter((c) => c.method === 'POST')).toEqual([])
  })
})

describe('dismissible canvas Bot target chip', () => {
  it('places 发给 @{bot} leftmost with title and × dismiss, restores via 恢复发给 @{bot}, and omits artifactContext when bypassed', async () => {
    const calls = mockApi({ 'POST /groups/g1/messages': (b: unknown) => ({ id: 'm1', ...(b as object) }) })
    setCanvas()
    render(<MessageComposer group={group} onSent={() => {}} />)

    const chips = screen.getByTestId('art-context-chips')
    const target = screen.getByTestId('art-context-to')
    expect(chips.firstElementChild).toBe(target)
    expect(target.getAttribute('title')).toBe('将针对当前画布发送给 @设计助手')

    const dismiss = within(target).getByRole('button', { name: '改为仅发给群成员，不触发 Bot' })
    fireEvent.click(dismiss)

    // Selection chip stays intact, target pill is dismissed, focus returns to textarea, bypass bar appears.
    expect(screen.queryByTestId('art-context-to')).toBeNull()
    expect(screen.getByText('读书会 · 首页')).toBeTruthy()
    expect(document.activeElement).toBe(input())
    expect(input().placeholder).not.toContain('发给 @设计助手')
    expect(screen.getByText('本次仅发给群成员，不触发 Bot')).toBeTruthy()

    // Restore brings the target pill back and keeps focus in input.
    fireEvent.click(screen.getByRole('button', { name: '恢复发给 @设计助手' }))
    expect(screen.getByTestId('art-context-to')).toBeTruthy()
    expect(document.activeElement).toBe(input())

    // Dismiss again and send: message goes to members without triggering Bot (no artifactContext), then resets bypass.
    fireEvent.click(screen.getByRole('button', { name: '改为仅发给群成员，不触发 Bot' }))
    type('大家觉得这个布局怎么样')
    fireEvent.keyDown(input(), { key: 'Enter' })
    await waitFor(() => expect(posts(calls, '/groups/g1/messages')).toHaveLength(1))
    expect(posts(calls, '/groups/g1/messages')[0]).not.toHaveProperty('artifactContext')
    // Bypass resets after sending so the kept canvas selection resumes targeting the Bot.
    expect(screen.getByTestId('art-context-to')).toBeTruthy()
  })

  it('clears bypass mode when enabling 变体 so UI and command routing stay mutually exclusive', async () => {
    const calls = mockApi({
      'POST /artifacts/a1/commands': { id: 'm1' },
      'POST /groups/g1/messages': (b: unknown) => ({ id: 'm2', ...(b as object) }),
    })
    setCanvas()
    render(<MessageComposer group={group} onSent={() => {}} />)

    // Dismiss Bot -> bypass bar is shown.
    fireEvent.click(screen.getByRole('button', { name: '改为仅发给群成员，不触发 Bot' }))
    expect(screen.getByTestId('art-context-bypass')).toBeTruthy()
    expect(screen.queryByTestId('art-context-to')).toBeNull()

    // Turning on 变体 exits bypass mode immediately and restores 发给 @Bot.
    fireEvent.click(screen.getByRole('button', { name: /变体/, pressed: false }))
    expect(screen.queryByTestId('art-context-bypass')).toBeNull()
    expect(screen.getByTestId('art-context-to')).toBeTruthy()
    expect(screen.getByRole('button', { name: /变体/, pressed: true })).toBeTruthy()

    // Sending now routes to /artifacts/a1/commands as expected.
    type('换一种温暖配色')
    fireEvent.keyDown(input(), { key: 'Enter' })
    await waitFor(() => expect(posts(calls, '/artifacts/a1/commands')).toHaveLength(1))
    expect(posts(calls, '/groups/g1/messages')).toEqual([])

    // Conversely, turning on 变体 then dismissing Bot turns 变体 off and sends a plain group message.
    await waitFor(() => expect(useCanvasContext.getState().context).toBeNull())
    act(() => setCanvas())
    fireEvent.click(screen.getByRole('button', { name: /变体/, pressed: false }))
    expect(screen.getByRole('button', { name: /变体/, pressed: true })).toBeTruthy()
    fireEvent.click(screen.getByRole('button', { name: '改为仅发给群成员，不触发 Bot' }))
    expect(screen.getByRole('button', { name: /变体/, pressed: false })).toBeTruthy()
    expect(screen.getByTestId('art-context-bypass')).toBeTruthy()
    type('先讨论下需求')
    fireEvent.keyDown(input(), { key: 'Enter' })
    await waitFor(() => expect(posts(calls, '/groups/g1/messages')).toHaveLength(1))
    expect(posts(calls, '/groups/g1/messages')[0]).not.toHaveProperty('artifactContext')
    expect(posts(calls, '/artifacts/a1/commands')).toHaveLength(1)
  })

  it('resets bypass when canvas selection changes and drops the target chip in canvasChat mode', () => {
    mockApi({})
    setCanvas()
    const { rerender } = render(<MessageComposer group={group} onSent={() => {}} />)
    fireEvent.click(screen.getByRole('button', { name: '改为仅发给群成员，不触发 Bot' }))
    expect(screen.queryByTestId('art-context-to')).toBeNull()

    // Changing selection resets bypassCanvasBot.
    act(() => setCanvas([{ key: 'screen:detail', screenId: 'detail', screenTitle: '详情', pinned: false }]))
    expect(screen.getByTestId('art-context-to')).toBeTruthy()

    // The canvas's own composer always goes to the artifact's bot: no target chip.
    useCanvasChat.setState({ byGroup: { g1: { artifactId: 'a1', rootId: 'root1' } } })
    rerender(
      <MessageComposer
        group={group}
        onSent={() => {}}
        canvasChat={{ rootId: 'root1', artifactId: 'a1', botId: 'b1' }}
      />,
    )
    expect(screen.queryByTestId('art-context-to')).toBeNull()
  })

  it('animates CandidatePopover enter/exit with usePresence data-state', () => {
    mockApi({})
    render(<MessageComposer group={group} onSent={() => {}} />)
    fireEvent.change(input(), { target: { value: '@', selectionStart: 1 } })
    const wrap = screen.getByTestId('composer-popover').parentElement as HTMLElement
    expect(wrap.dataset.state).toBe('open')
    fireEvent.keyDown(input(), { key: 'Escape' })
    expect(wrap.dataset.state).toBe('closed')
    expect(wrap.getAttribute('aria-hidden')).toBe('true')
  })
})

/** What GET /artifacts/a1/commands answers for a 产品原型 artifact (two of its plugin's commands). */
const PLUGIN_COMMANDS = [
  { name: 'app-store-assets', title: '应用商店素材', description: '上架截图与应用图标', needsScreen: false },
  { name: 'accessibility-audit', title: '无障碍检查', description: '检查无障碍问题', needsScreen: true },
]

describe('/ artifact commands (G07)', () => {
  it("lists the platform's artifact commands, then its plugin's, first with the canvas selected", async () => {
    mockApi({ 'GET /artifacts/a1/commands': PLUGIN_COMMANDS })
    setCanvas()
    render(<MessageComposer group={group} onSent={() => {}} />)
    type('/')
    const pop = await screen.findByTestId('composer-popover')
    const groups = within(pop).getAllByRole('group')
    expect(groups[0]?.getAttribute('aria-label')).toBe('产物')
    const names = within(groups[0] as HTMLElement)
      .getAllByRole('option')
      .map((o) => o.querySelector('.pn-mentionpicker__name')?.textContent)
    expect(names).toEqual(['/图片', '/Logo', '/图表', '/动效', '/应用商店素材', '/无障碍检查'])
    expect(within(pop).getByRole('option', { name: /动效/ }).getAttribute('aria-disabled')).toBeNull()
  })

  it('greys out commands that need screens when only the artifact tab is open', async () => {
    mockApi({})
    useWorkbench.setState({
      benches: {
        g1: {
          tabs: [{ kind: 'artifact', artifactId: 'a1', title: '读书会' }],
          active: 'artifact:a1',
          used: {},
        },
      },
    })
    render(<MessageComposer group={group} onSent={() => {}} />)
    type('/动')
    const option = await screen.findByRole('option', { name: /动效/ })
    expect(option.getAttribute('aria-disabled')).toBe('true')
    expect(option.textContent).toContain('先在画布上选屏')
    fireEvent.keyDown(input(), { key: 'Enter' })
    expect(input().value).toBe('/动')
  })

  it('sends /Logo with the rest as the request and the selection', async () => {
    const calls = mockApi({ 'POST /artifacts/a1/commands': { id: 'm1' } })
    setCanvas([
      home,
      {
        key: 'el:screens/home.html#12',
        screenId: 'home',
        screenTitle: '首页',
        element: { file: 'screens/home.html', ggId: '12', label: 'h1' },
        pinned: false,
      },
    ])
    render(<MessageComposer group={group} onSent={() => {}} />)
    type('/Lo')
    fireEvent.keyDown(input(), { key: 'Enter' })
    expect(input().value).toBe('/Logo ')
    type('/Logo 极简风')
    fireEvent.keyDown(input(), { key: 'Enter' })
    await waitFor(() => expect(posts(calls, '/artifacts/a1/commands')).toHaveLength(1))
    expect(posts(calls, '/artifacts/a1/commands')[0]).toEqual({
      command: 'logo',
      text: '极简风',
      screenIds: ['home'],
      ggIds: [{ file: 'screens/home.html', ggId: '12' }],
      botId: 'b1',
    })
    expect(posts(calls, '/groups/g1/messages')).toEqual([])
  })

  it('sends a plugin command by its name', async () => {
    const calls = mockApi({
      'GET /artifacts/a1/commands': PLUGIN_COMMANDS,
      'POST /artifacts/a1/commands': { id: 'm1' },
    })
    setCanvas()
    render(<MessageComposer group={group} onSent={() => {}} />)
    await waitFor(() => expect(calls.some((c) => c.path === '/artifacts/a1/commands')).toBe(true))
    type('/应用商店素材 三张')
    fireEvent.keyDown(input(), { key: 'Enter' })
    await waitFor(() => expect(posts(calls, '/artifacts/a1/commands')).toHaveLength(1))
    expect(posts(calls, '/artifacts/a1/commands')[0]).toMatchObject({
      command: 'app-store-assets',
      text: '三张',
    })
  })

  it('reads the command at the head of the draft only', () => {
    const list = artifactSlash(PLUGIN_COMMANDS)
    expect(parseArtifactSlash('/应用商店素材 三张', list)?.slash.command).toBe('app-store-assets')
    expect(parseArtifactSlash('/应用商店素材 三张')).toBeNull()
    expect(parseArtifactSlash('/logo')?.text).toBe('')
    expect(parseArtifactSlash('/Logos')).toBeNull()
    expect(parseArtifactSlash('画个 /Logo')).toBeNull()
  })
})

describe('design system entry (G14)', () => {
  it('asks the canvas to open its design-system panel', () => {
    mockApi({})
    setCanvas()
    render(<MessageComposer group={group} onSent={() => {}} />)
    const asked = useCanvasContext.getState().design?.n ?? 0
    fireEvent.click(screen.getByRole('button', { name: /设计系统/ }))
    expect(useCanvasContext.getState().design).toEqual({ artifactId: 'a1', n: asked + 1 })
  })
})

describe('canvas refs in the timeline (G11)', () => {
  const activeTab = () => {
    const b = useWorkbench.getState().benches.g1
    return b?.active
  }

  it('shows a message’s canvas context and opens the artifact on its screens', () => {
    const m = {
      id: 'm1',
      seq: 1,
      groupId: 'g1',
      kind: 'user',
      authorId: 'u1',
      authorName: '王磊',
      body: '标题再大点',
      mentions: ['b1'],
      runId: null,
      createdAt: at,
      attachments: [],
      quote: null,
      reactions: [],
      canvas: {
        artifactId: 'a1',
        title: '读书会',
        screens: [{ id: 'home', title: '首页' }],
        elements: [{ file: 'screens/home.html', ggId: '12', label: 'h1「本周共读」' }],
      },
    } as MessageDto
    withRouter(
      <>
        <UserMessage m={m} targets={[{ id: 'b1', name: '设计助手' }]} />
        <FocusProbe />
      </>,
    )
    const chips = screen.getByTestId('message-canvas')
    expect(chips.textContent).toContain('读书会 · 首页')
    expect(chips.textContent).toContain('首页 › h1「本周共读」')
    fireEvent.click(within(chips).getByText('读书会 · 首页'))
    expect(activeTab()).toBe('artifact:a1')
    expect(screen.getByTestId('focus').textContent).toBe('[["home"],null]')
  })

  it('offers 在画布中查看 on a run card that made a version', () => {
    const run = {
      id: 'r1',
      groupId: 'g1',
      botId: 'b1',
      triggerMessageId: 'm0',
      triggerUserId: 'u1',
      hop: 1,
      status: 'completed',
      step: '',
      filesChanged: 2,
      usage: null,
      newSessionReason: null,
      parentRunId: null,
      hopMax: 5,
      offlineWaitMin: 30,
      originUserId: 'u1',
      approvals: [],
      questions: [],
      interrupt: null,
      stoppedBy: null,
      delegation: { subagents: 0, subagentsRunning: 0, tasksRunning: 0 },
      model: null,
      effort: null,
      queuedAt: at,
      startedAt: at,
      endedAt: at,
      lastActivityAt: at,
      artifacts: [
        {
          artifactId: 'a1',
          title: '读书会',
          versionId: 'v3',
          n: 3,
          changedScreens: [
            { id: 'home', title: '首页' },
            { id: 'detail', title: '详情' },
          ],
        },
      ],
    } as unknown as RunDto
    withRouter(
      <>
        <RunCard run={run} botName="设计助手" agent="Claude" trigger="王磊" />
        <FocusProbe />
      </>,
    )
    const line = screen.getByTestId('run-artifact')
    expect(line.textContent).toContain('读书会 · v3 · 改了 首页、详情')
    fireEvent.click(within(line).getByRole('button', { name: '在画布中查看' }))
    expect(activeTab()).toBe('artifact:a1')
    expect(screen.getByTestId('focus').textContent).toBe('[["home","detail"],"v3"]')
  })
})
