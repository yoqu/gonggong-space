import type {
  BotDto,
  GroupDto,
  MessageDto,
  NotificationDto,
  ScheduleDto,
  ThreadDto,
  UserDto,
} from '@gonggong/protocol'
import { act, cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import { MemoryRouter, Route, Routes } from 'react-router'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { AppShell } from '../src/app/AppShell'
import { ChatPage } from '../src/app/ChatPage'
import { useSession } from '../src/app/session'
import { useSidebarCollapse } from '../src/app/sidebarCollapse'
import { useWorkspace } from '../src/app/workspace'
import { setArtifactPage } from '../src/features/artifacts/page'
import { loadArtifact, resetArtifacts } from '../src/features/artifacts/store'
import { ChatView } from '../src/features/chat/ChatView'
import { type ActionTarget, MessageActions } from '../src/features/chat/MessageActions'
import { MessageComposer } from '../src/features/chat/MessageComposer'
import { MessageEditor } from '../src/features/chat/MessageEditor'
import { ThreadView } from '../src/features/chat/ThreadView'
import { useThreadUnread } from '../src/features/chat/threadUnread'
import { NotificationPanel } from '../src/features/notifications/NotificationPanel'
import { ScheduleCard } from '../src/features/schedules/ScheduleCard'
import { ScheduleTag } from '../src/features/schedules/ScheduleTag'
import { resetSchedules } from '../src/features/schedules/store'
import { useTerminalSpaces } from '../src/features/terminal/spaces'
import { realtime } from '../src/lib/realtime'
import { ComboBox, Dialog, Toaster, TokenField, useToasts } from '../src/ui'
import { apiError, mockApi } from './mockApi'

const now = '2026-11-26T02:00:00.000Z'
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
const bot: BotDto = {
  id: 'b1',
  teamId: 't1',
  name: '共字君',
  ownerId: 'u1',
  ownerName: '王磊',
  agentKind: 'claude',
  avatar: 'role-no',
  followAgent: false,
  avatarUrl: null,
  machineId: 'mc1',
  machineName: 'mbp',
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
}
const group: GroupDto = {
  id: 'g1',
  teamId: 't1',
  name: '产品评审',
  kind: 'group',
  mode: 'partition',
  adminOnlyInvite: false,
  protectBase: false,
  notice: '',
  noticeHidden: false,
  avatar: null,
  repo: null,
  members: [{ userId: 'u1', name: '王磊', avatar: null, isAdmin: true }],
  botIds: ['b1'],
  unread: 0,
  lastSeq: 1,
  last: '',
  pinned: false,
  notifyLevel: 'mentions',
  foldRuns: false,
  liveRunIds: [],
  liveRuns: [],
}

class NoopSocket {
  close() {}
}

beforeEach(() => {
  localStorage.clear()
  sessionStorage.clear()
  resetArtifacts()
  resetSchedules()
  useToasts.setState({ items: [] })
  useThreadUnread.setState({ unread: 0, mentioned: 0, groups: {} })
  useSidebarCollapse.setState({ collapsed: false })
  useTerminalSpaces.setState({ spaces: [] })
  vi.stubGlobal('WebSocket', NoopSocket)
  useSession.setState({ user: me, status: 'ready', tenancy: { pluginsEnabled: true, teams: [] } as never })
  useWorkspace.setState({ groups: [group], bots: [bot], machines: [], loaded: true, pins: {}, notifCount: 2 })
})
afterEach(() => {
  vi.unstubAllGlobals()
  vi.restoreAllMocks()
})

describe('Slice B Chat, UI, Shell & Schedules TDD', () => {
  it('U-04 & U-05: canvasChat shows RunConfigChips alongside CanvasBotPicker, and disables Send with 暂无可用 Bot when no Bot exists', () => {
    mockApi({ 'GET /bots/b1/catalog': { catalog: null } })
    const { rerender } = render(
      <MemoryRouter>
        <MessageComposer
          group={group}
          onSent={() => {}}
          canvasChat={{ rootId: 'r1', artifactId: 'a1', botId: 'b1' }}
        />
      </MemoryRouter>,
    )
    expect(screen.getByRole('button', { name: '共字君 的模型与推理强度' })).toBeTruthy()

    useWorkspace.setState({ groups: [], bots: [] })
    const emptyGroup = { ...group, id: 'g-empty', botIds: [] }
    rerender(
      <MemoryRouter>
        <MessageComposer
          group={emptyGroup}
          onSent={() => {}}
          canvasChat={{ rootId: 'r1', artifactId: 'a1', botId: null }}
        />
      </MemoryRouter>,
    )
    const box = screen.getByRole('combobox') as HTMLTextAreaElement
    fireEvent.change(box, { target: { value: '改一下配色' } })
    expect((screen.getByRole('button', { name: '发送' }) as HTMLButtonElement).disabled).toBe(true)
    expect(screen.getByText('暂无可用 Bot')).toBeTruthy()
  })

  it('U-20: canvasChat shows folder chip when a folder is selected and uses side-agnostic placeholder', async () => {
    mockApi({
      'GET /artifacts/a1': () => ({
        id: 'a1',
        title: '读书会',
        manifest: {
          entry: 'home',
          groups: [{ id: 'grp-1', title: '登录流程' }],
          screens: [{ id: 'home', title: '首页', file: 'screens/home.html', group: 'grp-1' }],
        },
      }),
      'GET /artifacts/a1/versions': () => [],
    })
    await loadArtifact('a1')
    setArtifactPage('a1', 'grp-1')
    render(
      <MemoryRouter>
        <MessageComposer
          group={group}
          onSent={() => {}}
          canvasChat={{ rootId: 'r1', artifactId: 'a1', botId: 'b1' }}
        />
      </MemoryRouter>,
    )
    expect(screen.getByTestId('art-canvas-page').textContent).toBe('登录流程')
    expect((screen.getByRole('combobox') as HTMLTextAreaElement).placeholder).not.toContain('左侧')
    setArtifactPage('a1', null)
  })

  it('U-23: chat header 话题 button includes unread count in aria-label and wraps label text in responsive span', async () => {
    mockApi({
      'GET /groups/g1/timeline?limit=50': { messages: [], runs: [] },
      'GET /groups/g1/plugins': [],
      'GET /groups/g1/connectors': { connectors: [] },
      'GET /groups/g1/schedules': { schedules: [] },
      'GET /groups/g1/previews': { previews: [] },
      'GET /groups/g1/provider-state': { items: [] },
      'GET /groups/g1/bot-states': { states: [] },
      'GET /groups/g1/git-operations': { operations: [] },
      'GET /groups/g1/tabs': { tabs: [] },
    })
    useThreadUnread.setState({ unread: 2, mentioned: 0, groups: { g1: 2 } })
    render(
      <MemoryRouter initialEntries={['/g/g1']}>
        <ChatView group={group} />
      </MemoryRouter>,
    )
    const btn = await screen.findByRole('button', { name: '话题，2 个未读' })
    expect(btn.querySelector('.chat-view__threads-label')).toBeTruthy()
  })

  it('U-27: clicking Emoji while ConnectorMenu is open closes ConnectorMenu and opens EmojiPicker; typing closes ConnectorMenu', async () => {
    mockApi({ 'GET /groups/g1/connectors': { connectors: [] } })
    render(
      <MemoryRouter>
        <MessageComposer group={group} onSent={() => {}} />
      </MemoryRouter>,
    )
    fireEvent.click(screen.getByRole('button', { name: '外部连接' }))
    expect(await screen.findByRole('dialog', { name: '外部连接' })).toBeTruthy()

    fireEvent.click(screen.getByRole('button', { name: '表情' }))
    await waitFor(() => expect(screen.queryByRole('dialog', { name: '外部连接' })).toBeNull())
    expect(screen.getByRole('button', { name: '表情' }).getAttribute('aria-pressed')).toBe('true')

    fireEvent.click(screen.getByRole('button', { name: '外部连接' }))
    expect(await screen.findByRole('dialog', { name: '外部连接' })).toBeTruthy()
    fireEvent.change(screen.getByRole('combobox'), { target: { value: '@', selectionStart: 1 } })
    await waitFor(() => expect(screen.queryByRole('dialog', { name: '外部连接' })).toBeNull())
  })

  it('U-28: ThreadView shows older-replies retry UI on failure and missing-root empty state instead of infinite spinner', async () => {
    const root: MessageDto = {
      id: 'm1',
      seq: 1,
      groupId: 'g1',
      kind: 'user',
      authorId: 'u1',
      authorName: '王磊',
      body: '根消息',
      mentions: [],
      runId: null,
      createdAt: now,
      attachments: [],
      quote: null,
    } as unknown as MessageDto
    const replies = Array.from({ length: 50 }, (_, i) => ({
      ...root,
      id: `r${i + 2}`,
      seq: i + 2,
      body: `回复 ${i + 2}`,
      threadRootId: 'm1',
    }))
    let failOlder = true
    mockApi({
      'GET /messages/m1/thread?limit=50': {
        root,
        replies,
        runs: [],
        state: { rootId: 'm1', groupId: 'g1', following: true, lastReadSeq: 51, unread: 0, mentioned: false },
      } as ThreadDto,
      'GET /messages/m1/thread?limit=50&before=2': () =>
        failOlder
          ? apiError(500, 'internal', 'boom')
          : {
              root,
              replies: [{ ...root, id: 'r-old', seq: 1, body: '更早的回复', threadRootId: 'm1' }],
              runs: [],
              state: {
                rootId: 'm1',
                groupId: 'g1',
                following: true,
                lastReadSeq: 51,
                unread: 0,
                mentioned: false,
              },
            },
      'GET /messages/missing/thread?limit=50': {
        root: undefined,
        replies: [],
        runs: [],
        state: {
          rootId: 'missing',
          groupId: 'g1',
          following: false,
          lastReadSeq: 0,
          unread: 0,
          mentioned: false,
        },
      },
    })
    const { rerender } = render(
      <MemoryRouter>
        <ThreadView group={group} rootId="m1" onClose={() => {}} />
      </MemoryRouter>,
    )
    await screen.findByText('回复 51')
    const scroller = document.querySelector('.pn-threadpanel__scroll') as HTMLElement
    Object.defineProperty(scroller, 'scrollTop', { value: 0, writable: true })
    fireEvent.scroll(scroller)
    expect(await screen.findByText('加载更早回复失败')).toBeTruthy()
    failOlder = false
    fireEvent.click(screen.getByRole('button', { name: '重试' }))
    expect(await screen.findByText('更早的回复')).toBeTruthy()

    rerender(
      <MemoryRouter>
        <ThreadView key="missing" group={group} rootId="missing" onClose={() => {}} />
      </MemoryRouter>,
    )
    expect(await screen.findByText('话题不存在或已删除')).toBeTruthy()
  })

  it('U-29: MessageActions confirms unpin with AlertDialog + toast, toasts on pin, and locks branch', async () => {
    let finishBranch!: (v: unknown) => void
    const calls = mockApi({
      'POST /groups/g1/pins': {
        pins: [
          {
            messageId: 'm1',
            seq: 1,
            authorName: '王磊',
            text: 'hi',
            attachments: 0,
            pinnedBy: { id: 'u1', name: '王磊' },
            pinnedAt: now,
          },
        ],
      },
      'DELETE /groups/g1/pins/m1': undefined,
      'POST /messages/m1/branch': () => new Promise((r) => (finishBranch = r)),
    })
    const m = {
      id: 'm1',
      seq: 1,
      groupId: 'g1',
      kind: 'bot',
      authorId: 'b1',
      authorName: '共字君',
      body: 'hi',
      mentions: [],
      runId: null,
      createdAt: now,
      attachments: [],
      quote: null,
    } as unknown as MessageDto
    const target: ActionTarget = { message: m, link: '', onQuote: () => {}, copyText: 'hi', branchable: true }
    render(
      <MemoryRouter>
        <MessageActions {...target} />
        <Toaster />
      </MemoryRouter>,
    )
    fireEvent.click(screen.getByRole('button', { name: '更多' }))
    fireEvent.click(await screen.findByText('置顶'))
    expect(await screen.findByText('已置顶')).toBeTruthy()

    fireEvent.click(screen.getByRole('button', { name: '更多' }))
    fireEvent.click(await screen.findByText('取消置顶'))
    const dlg = await screen.findByRole('alertdialog', { name: '要取消置顶这条消息吗？' })
    expect(calls.filter((c) => c.method === 'DELETE')).toHaveLength(0)
    fireEvent.click(within(dlg).getByRole('button', { name: '取消置顶' }))
    expect(await screen.findByText('已取消置顶')).toBeTruthy()

    fireEvent.click(screen.getByRole('button', { name: '更多' }))
    fireEvent.click(await screen.findByText('分支到新聊天'))
    fireEvent.click(screen.getByRole('button', { name: '更多' }))
    fireEvent.click(await screen.findByText('分支到新聊天'))
    expect(calls.filter((c) => c.path === '/messages/m1/branch')).toHaveLength(1)
    await act(async () => finishBranch({ groupId: 'g2' }))
  })

  it('U-30: MessageEditor & ComboBox guard Safari IME Enter; TokenField Esc closes listbox without wiping text or parent Dialog', () => {
    const calls = mockApi({ 'PATCH /messages/m1': {} })
    const m = { id: 'm1', groupId: 'g1', body: '原内容', attachments: [] } as unknown as MessageDto
    const onDone = vi.fn()
    render(<MessageEditor message={m} onDone={onDone} />)
    const area = screen.getByLabelText('编辑消息')
    fireEvent.change(area, { target: { value: '新内容' } })
    fireEvent.compositionStart(area)
    fireEvent.compositionEnd(area)
    fireEvent.keyDown(area, { key: 'Enter' })
    expect(calls).toHaveLength(0)
    cleanup()

    const onSelect = vi.fn()
    render(<ComboBox aria-label="模型" options={['Claude', 'Codex']} onChange={onSelect} />)
    const combo = screen.getByRole('combobox', { name: '模型' })
    fireEvent.change(combo, { target: { value: 'Cl' } })
    fireEvent.compositionStart(combo)
    fireEvent.compositionEnd(combo)
    fireEvent.keyDown(combo, { key: 'Enter' })
    expect(onSelect).not.toHaveBeenCalled()
    cleanup()

    const onCloseDialog = vi.fn()
    render(
      <Dialog open title="测试" onClose={onCloseDialog}>
        <TokenField aria-label="标签" suggestions={['alpha', 'apex']} />
      </Dialog>,
    )
    const tokenInput = screen.getByRole('combobox', { name: '标签' }) as HTMLInputElement
    fireEvent.change(tokenInput, { target: { value: 'al' } })
    expect(screen.getByRole('listbox')).toBeTruthy()
    fireEvent.keyDown(document, { key: 'Escape' })
    expect(screen.queryByRole('listbox')).toBeNull()
    expect(tokenInput.value).toBe('al')
    expect(onCloseDialog).not.toHaveBeenCalled()
  })

  it('U-31: NotificationPanel sets aria-modal, locks duplicate delete, and renders Alert on load failure', async () => {
    let resolveDel!: (v: unknown) => void
    let fail = true
    const notif: NotificationDto = {
      id: 'n1',
      teamId: 't1',
      type: 'mention',
      payload: { groupId: 'g1', groupName: '产品评审', actorName: '李四', body: 'hi' },
      readAt: null,
      resolvedAt: null,
      createdAt: now,
    }
    const calls = mockApi({
      'GET /notifications': () => (fail ? apiError(500, 'internal', 'err') : [notif]),
      'GET /me/feishu': { identity: null },
      'DELETE /notifications/n1': () => new Promise((r) => (resolveDel = r)),
    })
    render(
      <MemoryRouter>
        <NotificationPanel open onClose={() => {}} />
      </MemoryRouter>,
    )
    const dlg = await screen.findByRole('dialog', { name: '通知' })
    expect(dlg.getAttribute('aria-modal')).toBe('true')
    const alert = await within(dlg).findByRole('alert')
    expect(within(alert).getByText('通知加载失败')).toBeTruthy()

    fail = false
    fireEvent.click(within(alert).getByRole('button', { name: '重试' }))
    const delBtn = await within(dlg).findByRole('button', { name: '删除通知' })
    fireEvent.click(delBtn)
    fireEvent.click(delBtn)
    expect(calls.filter((c) => c.method === 'DELETE')).toHaveLength(1)
    await act(async () => resolveDel(undefined))
    expect(useWorkspace.getState().notifCount).toBe(1)
  })

  it('U-32: ChatPage shows loading on / and /t/:spaceId while fetching, and AppShell shows offline banner on desktop when sidebar is collapsed', async () => {
    mockApi({
      'GET /groups': () => new Promise(() => {}),
      'GET /terminal-spaces': () => new Promise(() => {}),
      'GET /sections': { sections: [] },
      'GET /team-sections': { sections: [], directory: [] },
      'GET /threads/unread': { unread: 0, mentioned: 0 },
      'GET /saved/count': { open: 0, due: 0 },
    })
    useWorkspace.setState({ groups: [], bots: [], machines: [], loaded: false })
    const { unmount } = render(
      <MemoryRouter initialEntries={['/']}>
        <Routes>
          <Route path="/" element={<ChatPage />} />
        </Routes>
      </MemoryRouter>,
    )
    expect(screen.queryByText('选择一个群或私聊开始')).toBeNull()
    expect(screen.getByRole('img', { name: '加载中' })).toBeTruthy()
    unmount()

    const { unmount: unmountT } = render(
      <MemoryRouter initialEntries={['/t/s1']}>
        <Routes>
          <Route path="/t/:spaceId" element={<ChatPage />} />
        </Routes>
      </MemoryRouter>,
    )
    expect(screen.queryByText('终端不存在或已删除')).toBeNull()
    unmountT()

    // AppShell desktop offline banner when sidebar is collapsed.
    const statusListeners = new Set<(s: 'connecting' | 'open' | 'closed') => void>()
    let status: 'connecting' | 'open' | 'closed' = 'open'
    vi.spyOn(realtime, 'getStatus').mockImplementation(() => status)
    vi.spyOn(realtime, 'onStatus').mockImplementation((fn) => {
      statusListeners.add(fn)
      return () => statusListeners.delete(fn)
    })
    useSidebarCollapse.setState({ collapsed: true })
    render(
      <MemoryRouter initialEntries={['/g/g1']}>
        <Routes>
          <Route element={<AppShell />}>
            <Route path="*" element={<div />} />
          </Route>
        </Routes>
      </MemoryRouter>,
    )
    act(() => {
      status = 'closed'
      for (const fn of statusListeners) fn('closed')
    })
    expect(await screen.findByText('连接已断开，正在重连…')).toBeTruthy()
  })

  it('A-1 & A-5: ScheduleCard omits redundant fallback, shows loading + trigger toast; ScheduleTag shows 定时任务 {n} label', async () => {
    let finishRun!: (v: unknown) => void
    const s: ScheduleDto = {
      id: 's1',
      groupId: 'g1',
      name: '日报',
      prompt: '汇总 PR',
      cron: '0 9 * * 1-5',
      runAt: null,
      timezone: 'Asia/Shanghai',
      botIds: ['b1'],
      runOptions: {},
      enabled: true,
      pausedReason: null,
      nextRunAt: '2026-12-01T01:00:00.000Z',
      lastFiredAt: null,
      lastRunId: null,
      lastBotId: null,
      lastStatus: null,
      failStreak: 0,
      ownerId: 'u1',
      ownerName: '王磊',
      createdByBotId: null,
      canManage: true,
      createdAt: now,
    }
    mockApi({
      'GET /groups/g1/schedules': { schedules: [s] },
      'POST /schedules/s1/run': () => new Promise((r) => (finishRun = r)),
    })
    render(
      <>
        <ScheduleCard scheduleId="s1" groupId="g1" fallback="王磊 创建了定时任务「日报」" />
        <ScheduleTag groupId="g1" onManage={() => {}} />
        <Toaster />
      </>,
    )
    await screen.findByText('日报')
    expect(screen.queryByText('王磊 创建了定时任务「日报」')).toBeNull()
    expect(screen.getByText('定时任务 1')).toBeTruthy()

    const runBtn = screen.getByRole('button', { name: '立即执行' })
    fireEvent.click(runBtn)
    await waitFor(() => expect(runBtn.getAttribute('aria-busy')).toBe('true'))
    await act(async () => finishRun(s))
    expect(await screen.findByText('已触发「日报」，结果见群里')).toBeTruthy()
  })
})
