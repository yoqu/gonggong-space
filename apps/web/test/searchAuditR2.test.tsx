import { readFileSync } from 'node:fs'
import type {
  BotDto,
  GroupBotStateDto,
  GroupDto,
  MachineDto,
  SearchResultDto,
  UserDto,
} from '@gonggong/protocol'
import { act, fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import { MemoryRouter, Route, Routes, useLocation } from 'react-router'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { AppShell, ShellBar, useShellOverlay } from '../src/app/AppShell'
import { ChatPage } from '../src/app/ChatPage'
import { useInspector } from '../src/app/inspector'
import { useSession } from '../src/app/session'
import { useWorkbench } from '../src/app/workbench'
import { useWorkspace } from '../src/app/workspace'
import { useSections, useTeamSections } from '../src/features/groups/sections'
import { SearchOverlay } from '../src/features/search/SearchOverlay'
import { useTerminalSpaces } from '../src/features/terminal/spaces'
import { Toaster, useToasts } from '../src/ui'
import { mockApi } from './mockApi'

const me: UserDto = {
  id: 'u1',
  account: 'wanglei',
  name: '王磊',
  role: 'member',
  mustChangePassword: false,
  disabled: false,
  gitProtocol: 'auto',
  email: null,
  avatar: null,
}

const group = (o: Partial<GroupDto> = {}): GroupDto => ({
  id: 'g1',
  teamId: 't1',
  name: '退款服务',
  kind: 'group',
  mode: 'partition',
  adminOnlyInvite: false,
  protectBase: false,
  notice: '',
  noticeHidden: false,
  avatar: null,
  repo: { url: 'git@git.corp:pay/refund.git', branch: 'main' },
  members: [
    { userId: 'u1', name: '王磊', avatar: null, isAdmin: true },
    { userId: 'u2', name: '李建国', avatar: null, isAdmin: false },
  ],
  botIds: [],
  unread: 0,
  lastSeq: 0,
  last: '',
  pinned: false,
  notifyLevel: 'mentions',
  foldRuns: false,
  liveRunIds: [],
  liveRuns: [],
  ...o,
})

const bot = (o: Partial<BotDto>): BotDto => ({
  id: 'b1',
  teamId: 't1',
  name: '小王的 Claude',
  ownerId: 'u1',
  ownerName: '王磊',
  agentKind: 'claude',
  avatar: 'role-no',
  followAgent: false,
  avatarUrl: null,
  machineId: 'mc1',
  machineName: 'wanglei-mbp',
  binding: 'bound',
  presence: 'online',
  systemPrompt: '',
  tier: 'workspace',
  triggerScope: 'all',
  access: { trusted: 'ask', others: 'auto' },
  triggerList: [],
  concurrency: 2,
  createdBy: 'u1',
  agentVersion: null,
  agentMinVersion: null,
  groupCount: 1,
  defaultWorkspace: null,
  gitName: null,
  gitEmail: null,
  gitDefaultEmail: 'b1@bots.gonggong.local',
  sharedWith: [],
  agentSettings: {},
  approval: 'ask',
  allowlist: [],
  alwaysAllow: [],
  aiReview: false,
  model: null,
  effort: null,
  catalog: null,
  ...o,
})

const machine = (id: string, online: boolean, ownerId = 'u1'): MachineDto => ({
  id,
  ownerId,
  name: id,
  os: 'macos',
  arch: 'aarch64',
  online,
  agents: [],
  daemonVersion: '0.1.0',
  features: [],
  lastSeenAt: null,
  hostname: id,
  system: null,
  boundAt: '2026-09-01T00:00:00Z',
  createdAt: '2026-09-01T00:00:00Z',
})

const botState = (botId: string, state: GroupBotStateDto['state']): GroupBotStateDto => ({
  botId,
  workspace: 'managed',
  state,
  path: state === 'ready' ? `/work/${botId}` : null,
  git: null,
  error: null,
  reason: null,
  tier: null,
  model: null,
  effort: null,
  context: null,
  extraDirs: [],
  repoPaths: {},
})

const hit = (o: Partial<SearchResultDto>): SearchResultDto => ({
  kind: 'run',
  title: '小王的 Claude · 退款迁移',
  sub: '支付服务重构',
  groupId: 'g1',
  messageId: null,
  runId: 'r9',
  at: '2026-09-23T02:21:00.000Z',
  ...o,
})

class FakeSocket {
  close() {}
  send() {}
}

function Where() {
  const l = useLocation()
  return <div data-testid="where">{l.pathname + l.search}</div>
}

function renderChatAt(path: string) {
  return render(
    <MemoryRouter initialEntries={[path]}>
      <Routes>
        <Route
          path="/g/:groupId"
          element={
            <>
              <ChatPage />
              <Where />
              <Toaster />
            </>
          }
        />
      </Routes>
    </MemoryRouter>,
  )
}

function renderOverlay(onClose: () => void = () => {}) {
  return render(
    <MemoryRouter initialEntries={['/']}>
      <Routes>
        <Route
          path="*"
          element={
            <>
              <SearchOverlay onClose={onClose} />
              <Where />
            </>
          }
        />
      </Routes>
    </MemoryRouter>,
  )
}

function renderShell() {
  return render(
    <MemoryRouter initialEntries={['/']}>
      <Routes>
        <Route element={<AppShell />}>
          <Route
            path="*"
            element={
              <>
                <ShellBar />
                <Where />
              </>
            }
          />
        </Route>
      </Routes>
    </MemoryRouter>,
  )
}

const chatRoutes = (g: GroupDto, states: GroupBotStateDto[] = []) => ({
  'GET /groups': [g],
  'GET /terminal-spaces': [],
  'GET /sidebar-sections': [],
  'GET /team-sections': { sections: [], canManage: false },
  'GET /team-directory': [],
  'GET /me/onboarding': { guide: 'done' },
  [`GET /groups/${g.id}/timeline`]: { messages: [], runs: [] },
  [`GET /groups/${g.id}/bot-states`]: states,
  [`GET /groups/${g.id}/git/operations`]: { operations: [] },
  [`GET /groups/${g.id}/pins`]: { pins: [] },
  [`GET /groups/${g.id}/tabs`]: { tabs: [] },
  [`GET /groups/${g.id}/previews`]: { previews: [], services: [], canManage: false },
  [`GET /groups/${g.id}/schedules`]: { schedules: [] },
  [`GET /groups/${g.id}/artifacts`]: [],
  [`GET /groups/${g.id}/plugins`]: [],
  [`POST /groups/${g.id}/read`]: g,
})

beforeEach(() => {
  Object.defineProperty(window, 'innerWidth', { configurable: true, value: 1440 })
  Element.prototype.scrollIntoView = vi.fn()
  localStorage.clear()
  vi.stubGlobal('WebSocket', FakeSocket)
  useSession.setState({ user: me, tenancy: null, status: 'ready' })
  useWorkspace.setState({
    groups: [],
    bots: [],
    machines: [],
    notifCount: 0,
    loaded: false,
    botStates: {},
    gitOps: {},
    pins: {},
    activeGroupId: null,
  })
  useWorkbench.setState({ groupId: null, open: false, mode: 'split', previous: 'split', benches: {} })
  useInspector.getState().close()
  useShellOverlay.getState().set(null)
  useToasts.setState({ items: [] })
  useSections.setState({ sections: [] })
  useTeamSections.setState({ sections: [], canManage: false, directory: [] })
  useTerminalSpaces.setState({ spaces: [] })
})

afterEach(() => vi.unstubAllGlobals())

describe('R2B P1-1: mirror file link (?file= without run=)', () => {
  it('opens the file tab on my online workspace-ready bot and removes only file from the URL', async () => {
    const g = group({ botIds: ['b-unbound', 'b-other', 'b-mine'] })
    const states = [
      botState('b-unbound', 'unbound'),
      botState('b-other', 'ready'),
      botState('b-mine', 'ready'),
    ]
    mockApi(chatRoutes(g, states))
    useWorkspace.setState({
      groups: [g],
      bots: [
        bot({ id: 'b-unbound', ownerId: 'u1', presence: 'online', machineId: 'mc1' }),
        bot({ id: 'b-other', ownerId: 'u2', presence: 'online', machineId: 'mc2' }),
        bot({ id: 'b-mine', ownerId: 'u1', presence: 'online', machineId: 'mc1' }),
      ],
      machines: [machine('mc1', true)],
      botStates: { g1: Object.fromEntries(states.map((s) => [s.botId, s])) },
      loaded: true,
    })

    renderChatAt('/g/g1?file=src%2Fpay.ts&keep=1')

    await waitFor(() =>
      expect(useWorkbench.getState().benches.g1?.tabs).toEqual([
        { kind: 'file', source: { botId: 'b-mine', path: 'src/pay.ts' } },
      ]),
    )
    expect(useWorkbench.getState().open).toBe(true)
    expect(screen.getByTestId('where').textContent).toBe('/g/g1?keep=1')
    expect(useToasts.getState().items).toEqual([])
  })

  it('skips an unbound bot of mine and falls back to a teammate online ready bot', async () => {
    const g = group({ botIds: ['b-unbound', 'b-other'] })
    const states = [botState('b-unbound', 'unbound'), botState('b-other', 'ready')]
    mockApi(chatRoutes(g, states))
    useWorkspace.setState({
      groups: [g],
      bots: [
        bot({ id: 'b-unbound', ownerId: 'u1', presence: 'online', machineId: 'mc1' }),
        bot({ id: 'b-other', ownerId: 'u2', presence: 'running', machineId: 'mc2' }),
      ],
      machines: [machine('mc1', true)],
      botStates: { g1: Object.fromEntries(states.map((s) => [s.botId, s])) },
      loaded: true,
    })

    renderChatAt('/g/g1?file=docs%2Fspec.md')

    await waitFor(() =>
      expect(useWorkbench.getState().benches.g1?.tabs).toEqual([
        { kind: 'file', source: { botId: 'b-other', path: 'docs/spec.md' } },
      ]),
    )
    expect(screen.getByTestId('where').textContent).toBe('/g/g1')
  })

  it('waits for workspaceLoaded, then toasts and strips ?file= when no online ready bot exists', async () => {
    const g = group({ botIds: ['b-off', 'b-unbound'] })
    const states = [botState('b-off', 'ready'), botState('b-unbound', 'unbound')]
    mockApi(chatRoutes(g, states))
    useWorkspace.setState({
      groups: [g],
      bots: [
        bot({ id: 'b-off', ownerId: 'u1', presence: 'offline', machineId: 'mc1' }),
        bot({ id: 'b-unbound', ownerId: 'u1', presence: 'online', machineId: 'mc2' }),
      ],
      machines: [machine('mc1', false), machine('mc2', true)],
      botStates: { g1: Object.fromEntries(states.map((s) => [s.botId, s])) },
      loaded: false,
    })

    renderChatAt('/g/g1?file=src%2Fpay.ts&foo=bar')

    await waitFor(() => expect(useWorkbench.getState().groupId).toBe('g1'))
    expect(useToasts.getState().items).toEqual([])
    expect(screen.getByTestId('where').textContent).toBe('/g/g1?file=src%2Fpay.ts&foo=bar')

    act(() => useWorkspace.setState({ loaded: true }))

    expect(await screen.findByText('当前没有在线且已绑定工作区的 Bot，无法打开该文件')).toBeTruthy()
    expect(useWorkbench.getState().benches.g1?.tabs ?? []).toEqual([])
    expect(screen.getByTestId('where').textContent).toBe('/g/g1?foo=bar')
  })

  it('keeps ?run=&file= opening a run diff tab while preserving unrelated query params', async () => {
    const g = group()
    mockApi(chatRoutes(g))
    useWorkspace.setState({ groups: [g], loaded: true })

    renderChatAt('/g/g1?run=r42&file=src%2Fpay.ts&extra=1')

    await waitFor(() =>
      expect(useWorkbench.getState().benches.g1?.tabs).toEqual([
        { kind: 'run', runId: 'r42', view: 'diff', file: 'src/pay.ts' },
      ]),
    )
    expect(screen.getByTestId('where').textContent).toBe('/g/g1?extra=1')
  })
})

describe('R2B P1-2: tab isolation, active index clamping, and Safari IME Enter guard', () => {
  it('excludes conversations in 文件/运行 tabs, shows file empty guidance, and shows msg empty note', async () => {
    useWorkspace.setState({ groups: [group({ id: 'g1', name: '退款服务' })] })
    mockApi({
      'GET /search?q=%E9%80%80%E6%AC%BE&tab=msg': [],
      'GET /search?q=%E9%80%80%E6%AC%BE&tab=file': [],
      'GET /search?q=%E9%80%80%E6%AC%BE&tab=run': [hit({})],
    })
    renderOverlay()
    const input = screen.getByPlaceholderText('搜索会话、消息、文件、运行')
    const results = screen.getByTestId('search-results')

    fireEvent.change(input, { target: { value: '退款' } })
    expect(within(results).getByRole('option').textContent).toContain('退款服务')
    expect(await within(results).findByText('没有匹配的消息')).toBeTruthy()
    expect(within(results).queryByText('没有匹配的结果')).toBeNull()

    fireEvent.click(screen.getByRole('tab', { name: '文件' }))
    expect(within(results).queryByText('退款服务')).toBeNull()
    expect(await within(results).findByText('没有匹配的结果')).toBeTruthy()
    expect(
      within(results).getByText('文件搜索仅覆盖保留了改动详情的运行，过期运行的文件可在「运行」里按名称查找'),
    ).toBeTruthy()

    fireEvent.click(within(results).getByRole('button', { name: '去「运行」里搜' }))
    expect(document.activeElement).toBe(input)
    const runRows = await within(results).findAllByRole('option')
    expect(runRows).toHaveLength(1)
    expect(runRows[0]!.textContent).toContain('小王的 Claude · 退款迁移')
    expect(within(results).queryByText('退款服务')).toBeNull()
  })

  it('resets active to 0 on tab switch and clamps safeActive when option count shrinks', async () => {
    const groups = [
      group({ id: 'g1', name: '退款一' }),
      group({ id: 'g2', name: '退款二' }),
      group({ id: 'g3', name: '退款三' }),
    ]
    useWorkspace.setState({ groups })
    mockApi({
      'GET /search?q=%E9%80%80%E6%AC%BE&tab=msg': [],
      'GET /search?q=%E9%80%80%E6%AC%BE&tab=run': [hit({ runId: 'r9' })],
    })
    renderOverlay()
    const input = screen.getByPlaceholderText('搜索会话、消息、文件、运行')
    const results = screen.getByTestId('search-results')

    fireEvent.change(input, { target: { value: '退款' } })
    fireEvent.keyDown(input, { key: 'ArrowDown' })
    fireEvent.keyDown(input, { key: 'ArrowDown' })
    let rows = within(results).getAllByRole('option')
    expect(rows[2]!.getAttribute('aria-selected')).toBe('true')
    expect(input.getAttribute('aria-activedescendant')).toBe(rows[2]!.id)

    act(() => useWorkspace.setState({ groups: [groups[0]!] }))
    rows = within(results).getAllByRole('option')
    expect(rows).toHaveLength(1)
    expect(rows[0]!.getAttribute('aria-selected')).toBe('true')
    expect(input.getAttribute('aria-activedescendant')).toBe(rows[0]!.id)

    act(() => useWorkspace.setState({ groups }))
    fireEvent.keyDown(input, { key: 'ArrowDown' })
    fireEvent.keyDown(input, { key: 'ArrowDown' })
    fireEvent.click(screen.getByRole('tab', { name: '运行' }))
    const runRows = await within(results).findAllByRole('option')
    expect(runRows[0]!.getAttribute('aria-selected')).toBe('true')
    expect(input.getAttribute('aria-activedescendant')).toBe(runRows[0]!.id)
    fireEvent.keyDown(input, { key: 'Enter' })
    expect(screen.getByTestId('where').textContent).toBe('/g/g1?run=r9')
  })

  it('ignores Enter during IME composition including Safari post-compositionend Enter and keyCode 229', async () => {
    useWorkspace.setState({ groups: [group({ id: 'g1', name: '退款服务' })] })
    mockApi({ 'GET /search?q=%E9%80%80%E6%AC%BE&tab=msg': [] })
    const onClose = vi.fn()
    renderOverlay(onClose)
    const input = screen.getByPlaceholderText('搜索会话、消息、文件、运行')
    fireEvent.change(input, { target: { value: '退款' } })

    fireEvent.keyDown(input, { key: 'Enter', isComposing: true })
    fireEvent.keyDown(input, { key: 'Enter', keyCode: 229 })
    fireEvent.compositionStart(input)
    fireEvent.compositionEnd(input)
    fireEvent.keyDown(input, { key: 'Enter', isComposing: false })
    expect(onClose).not.toHaveBeenCalled()
    expect(screen.getByTestId('where').textContent).toBe('/')

    await act(async () => {
      await new Promise((r) => setTimeout(r, 0))
    })
    fireEvent.keyDown(input, { key: 'Enter' })
    expect(onClose).toHaveBeenCalledOnce()
    expect(screen.getByTestId('where').textContent).toBe('/g/g1')
  })
})

describe('R2B P1-3: aria-modal, focus trap, focus restoration, ⌘K toggle, and active mark contrast', () => {
  it('sets aria-modal, traps Tab across real tab stops, and restores focus to trigger on close', async () => {
    useWorkspace.setState({
      groups: [
        group({ id: 'g1', name: '退款', lastAt: '2026-09-23T01:00:00.000Z' }),
        group({ id: 'g2', name: '支付', lastAt: '2026-09-23T02:00:00.000Z' }),
      ],
    })
    mockApi({})
    renderShell()
    const trigger = screen.getByRole('button', { name: '搜索会话、消息、文件、运行' })
    trigger.focus()
    fireEvent.click(trigger)

    const dialog = await screen.findByRole('dialog', { name: '搜索' })
    expect(dialog.getAttribute('aria-modal')).toBe('true')
    const input = within(dialog).getByRole('combobox')
    expect(document.activeElement).toBe(input)

    fireEvent.keyDown(input, { key: 'Tab', shiftKey: true })
    const activeTab = within(dialog).getByRole('tab', { name: '消息' })
    expect(document.activeElement).toBe(activeTab)

    fireEvent.keyDown(activeTab, { key: 'Tab' })
    expect(document.activeElement).toBe(input)

    fireEvent.keyDown(document, { key: 'Escape' })
    expect(screen.queryByRole('dialog', { name: '搜索' })).toBeNull()
    expect(document.activeElement).toBe(trigger)
  })

  it('toggles search open and closed with ⌘K / Ctrl+K and ignores Shift+⌘K and Alt+⌘K', async () => {
    mockApi({})
    renderShell()
    const trigger = screen.getByRole('button', { name: '搜索会话、消息、文件、运行' })
    trigger.focus()

    fireEvent.keyDown(document, { key: 'k', metaKey: true, shiftKey: true })
    fireEvent.keyDown(document, { key: 'k', metaKey: true, altKey: true })
    expect(screen.queryByRole('dialog', { name: '搜索' })).toBeNull()

    fireEvent.keyDown(document, { key: 'k', metaKey: true })
    expect(await screen.findByRole('dialog', { name: '搜索' })).toBeTruthy()

    fireEvent.keyDown(document, { key: 'k', metaKey: true })
    expect(screen.queryByRole('dialog', { name: '搜索' })).toBeNull()
    expect(document.activeElement).toBe(trigger)

    fireEvent.keyDown(document, { key: 'k', ctrlKey: true })
    expect(await screen.findByRole('dialog', { name: '搜索' })).toBeTruthy()
    fireEvent.keyDown(document, { key: 'k', ctrlKey: true })
    expect(screen.queryByRole('dialog', { name: '搜索' })).toBeNull()
  })

  it('uses a high-contrast dark highlight with semibold weight for active search marks', () => {
    const css = readFileSync('src/features/search/search.css', 'utf8')
    const start = css.indexOf('.search__row--active .search__title mark {')
    expect(start).toBeGreaterThan(-1)
    const rule = css.slice(start, css.indexOf('}', start))
    expect(rule).toContain('background: rgba(0, 0, 0, 0.24);')
    expect(rule).toContain('font-weight: 600;')
    expect(rule).not.toContain('var(--glass-fill-clear)')
  })
})
