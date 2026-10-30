import type { BotDto, GroupDto, MessageDto, RunDto } from '@gonggong/protocol'
import { fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import type { ReactElement } from 'react'
import { MemoryRouter } from 'react-router'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { useWorkbench } from '../src/app/workbench'
import { useWorkspace } from '../src/app/workspace'
import { type CanvasContext, clearContext, useCanvasContext } from '../src/features/artifacts/context'
import { parseArtifactSlash } from '../src/features/artifacts/slash'
import { resetArtifacts, useArtifactFocus } from '../src/features/artifacts/store'
import { MessageComposer } from '../src/features/chat/MessageComposer'
import { RunCard, UserMessage } from '../src/features/chat/TimelineItems'
import { useToasts } from '../src/ui'
import { mockApi } from './mockApi'

// G07 / G11 / G14 of docs/plan/stitch-对比-第3轮.md: the group composer and timeline around the canvas.

const at = '2026-10-30T10:00:00Z'
const bots = [{ id: 'b1', name: '设计助手', presence: 'online', avatar: 'role-no' }] as BotDto[]
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
  useWorkbench.setState({ groupId: 'g1', open: false, mode: 'split', previous: 'split', benches: {} })
})
afterEach(() => {
  vi.unstubAllGlobals()
  vi.restoreAllMocks()
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

describe('/ artifact commands (G07)', () => {
  it('lists the artifact commands first with the canvas selected', async () => {
    mockApi({})
    setCanvas()
    render(<MessageComposer group={group} onSent={() => {}} />)
    type('/')
    const pop = await screen.findByTestId('composer-popover')
    const groups = within(pop).getAllByRole('group')
    expect(groups[0]?.getAttribute('aria-label')).toBe('产物')
    const names = within(groups[0] as HTMLElement)
      .getAllByRole('option')
      .map((o) => o.querySelector('.pn-mentionpicker__name')?.textContent)
    expect(names).toEqual([
      '/图片',
      '/Logo',
      '/图表',
      '/动效',
      '/应用商店素材',
      '/网页素材',
      '/营销物料',
      '/无障碍检查',
    ])
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

  it('reads the command at the head of the draft only', () => {
    expect(parseArtifactSlash('/应用商店素材 三张')?.slash.command).toBe('app-store-assets')
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
    fireEvent.click(screen.getByRole('button', { name: /设计系统/ }))
    expect(useCanvasContext.getState().design).toEqual({ artifactId: 'a1', n: 1 })
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
        <UserMessage m={m} names={['设计助手']} />
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
