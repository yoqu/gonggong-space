import type { BotDto, GroupDto, MessageDto, RunDto, UserDto, WebEvent } from '@gonggong/protocol'
import { act, fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import { MemoryRouter } from 'react-router'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { App } from '../src/App'
import { useSession } from '../src/app/session'
import { useWorkspace } from '../src/app/workspace'
import { CanvasChat } from '../src/features/artifacts/CanvasChat'
import { uploadFile } from '../src/features/attachments/api'
import { useRecalled } from '../src/features/chat/recalled'
import { ThreadView } from '../src/features/chat/ThreadView'
import { Toaster, useToasts } from '../src/ui'
import { apiError, mockApi } from './mockApi'

vi.mock('../src/features/attachments/api', async (orig) => ({
  ...(await orig<typeof import('../src/features/attachments/api')>()),
  uploadFile: vi.fn(),
}))

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

const group: GroupDto = {
  id: 'g1',
  teamId: 't1',
  name: '退款 v2 迁移',
  kind: 'group',
  mode: 'partition',
  adminOnlyInvite: false,
  protectBase: false,
  notice: '',
  noticeHidden: false,
  avatar: null,
  repo: null,
  members: [
    { userId: 'u1', name: '王磊', avatar: null, isAdmin: true },
    { userId: 'u2', name: '李建国', avatar: null, isAdmin: false },
  ],
  botIds: [],
  unread: 0,
  lastSeq: 9,
  last: '',
  pinned: false,
  notifyLevel: 'mentions',
  foldRuns: false,
  liveRunIds: [],
  liveRuns: [],
}

const HOUR = 3600_000
const msg = (o: Partial<MessageDto>): MessageDto => ({
  id: `m${o.seq}`,
  seq: 1,
  groupId: 'g1',
  kind: 'user',
  authorId: 'u1',
  authorName: '王磊',
  body: `第 ${o.seq} 条`,
  mentions: [],
  runId: null,
  createdAt: new Date(Date.now() - HOUR).toISOString(),
  attachments: [],
  quote: null,
  ...o,
})

class FakeSocket {
  static last: FakeSocket | undefined
  onopen: (() => void) | null = null
  onmessage: ((e: { data: string }) => void) | null = null
  onclose: (() => void) | null = null
  constructor() {
    FakeSocket.last = this
  }
  close() {}
}
const push = (e: WebEvent) => act(() => FakeSocket.last!.onmessage!({ data: JSON.stringify(e) }))

const run = (o: Partial<RunDto>): RunDto => ({
  id: 'r1',
  groupId: 'g1',
  botId: 'b1',
  triggerMessageId: 'm1',
  triggerUserId: 'u1',
  hop: 1,
  status: 'running',
  step: '',
  filesChanged: 0,
  usage: null,
  newSessionReason: null,
  parentRunId: null,
  hopMax: 3,
  offlineWaitMin: 30,
  originUserId: 'u1',
  approvals: [],
  questions: [],
  interrupt: null,
  stoppedBy: null,
  delegation: { subagents: 0, subagentsRunning: 0, tasksRunning: 0 },
  model: null,
  effort: null,
  queuedAt: new Date(Date.now() - HOUR).toISOString(),
  startedAt: new Date(Date.now() - HOUR).toISOString(),
  endedAt: null,
  lastActivityAt: new Date(Date.now() - HOUR).toISOString(),
  ...o,
})

const renderChat = (messages: MessageDto[], routes: Record<string, unknown> = {}, runs: RunDto[] = []) => {
  const calls = mockApi({
    'GET /groups': [group],
    'GET /bots': [] as BotDto[],
    'GET /machines': [],
    'GET /notifications/unread': { n: 0 },
    'GET /groups/g1/timeline?limit=50': { messages, runs },
    'POST /groups/g1/read': group,
    ...routes,
  })
  render(
    <MemoryRouter initialEntries={['/g/g1']}>
      <App />
    </MemoryRouter>,
  )
  return calls
}

const openMore = async (text: string) => {
  const row = (await screen.findByText(text)).closest('.pn-msg') as HTMLElement
  fireEvent.click(within(row).getByRole('button', { name: '更多' }))
  return screen.getAllByRole('menuitem').map((b) => b.textContent)
}

beforeEach(() => {
  Object.defineProperty(window, 'innerWidth', { configurable: true, value: 1440 })
  vi.stubGlobal('WebSocket', FakeSocket)
  Element.prototype.scrollIntoView = vi.fn()
  useSession.setState({ user: me, status: 'ready' })
  useWorkspace.setState({ groups: [], bots: [], machines: [], activeGroupId: null })
  useRecalled.setState({ drafts: {}, pending: null })
})
afterEach(() => vi.unstubAllGlobals())

describe('更多 menu', () => {
  it('offers 撤回 and 删除 on my own messages, after 复制链接', async () => {
    renderChat([msg({ seq: 1, body: '我的消息' })])
    expect(await openMore('我的消息')).toEqual([
      '稍后处理',
      '复制链接',
      '从这里标为未读',
      '置顶',
      '存入知识库',
      '编辑',
      '撤回',
      '删除',
    ])
  })

  it('hides 撤回 once my message is older than 24 hours', async () => {
    renderChat([msg({ seq: 1, body: '旧消息', createdAt: new Date(Date.now() - 25 * HOUR).toISOString() })])
    expect(await openMore('旧消息')).toEqual([
      '稍后处理',
      '复制链接',
      '从这里标为未读',
      '置顶',
      '存入知识库',
      '删除',
    ])
  })

  it("offers neither on other members' messages", async () => {
    renderChat([msg({ seq: 1, authorId: 'u2', authorName: '李建国', body: '别人的' })])
    expect(await openMore('别人的')).toEqual(['稍后处理', '复制链接', '从这里标为未读', '置顶', '存入知识库'])
  })
})

describe('recall', () => {
  it('replaces my message with a notice right away', async () => {
    const m = msg({ seq: 1, body: '说错了' })
    const calls = renderChat([m], {
      'POST /messages/m1/recall': { ...m, body: '', recalled: true, reactions: [] },
    })
    await openMore('说错了')
    fireEvent.click(screen.getByRole('menuitem', { name: '撤回' }))
    expect(await screen.findByText('你撤回了一条消息')).toBeTruthy()
    expect(screen.queryByText('说错了')).toBeNull()
    expect(calls.some((c) => c.method === 'POST' && c.path === '/messages/m1/recall')).toBe(true)
  })

  it("shows the author's name to others, live, and marks quotes of it", async () => {
    renderChat([
      msg({ seq: 1, authorId: 'u2', authorName: '李建国', body: '机密方案' }),
      msg({ seq: 2, body: '收到', quote: { kind: 'message', id: 'm1', who: '李建国', text: '机密方案' } }),
    ])
    await screen.findByText('收到')
    push({ t: 'message.recalled', groupId: 'g1', messageId: 'm1' })
    expect(screen.getByText('李建国 撤回了一条消息')).toBeTruthy()
    expect(screen.queryByText('机密方案')).toBeNull()
    expect(screen.getByText('该消息已撤回')).toBeTruthy()
  })

  it('renders recalled messages from the server as notices', async () => {
    renderChat([
      msg({ seq: 1, body: '', recalled: true }),
      msg({ seq: 2, authorId: 'u2', authorName: '李建国', body: '', recalled: true }),
    ])
    expect(await screen.findByText('你撤回了一条消息')).toBeTruthy()
    expect(screen.getByText('李建国 撤回了一条消息')).toBeTruthy()
    expect(screen.queryByRole('toolbar', { name: '消息操作' })).toBeNull()
  })

  it('explains a late recall', async () => {
    renderChat(
      [msg({ seq: 1, body: '快到期', createdAt: new Date(Date.now() - 23.99 * HOUR).toISOString() })],
      {
        'POST /messages/m1/recall': apiError(409, 'recall_expired', 'late'),
      },
    )
    await openMore('快到期')
    fireEvent.click(screen.getByRole('menuitem', { name: '撤回' }))
    expect(await screen.findByText('超过 24 小时，无法撤回')).toBeTruthy()
    expect(screen.getByText('快到期')).toBeTruthy()
  })
})

describe('重新编辑', () => {
  const box = () =>
    screen.getByPlaceholderText('输入消息，@ 触发 Bot 或引用文件，/ 查看命令') as HTMLTextAreaElement
  const recallIt = async (text: string) => {
    await openMore(text)
    fireEvent.click(screen.getByRole('menuitem', { name: '撤回' }))
    await screen.findByText('你撤回了一条消息')
  }
  const recalled = (m: MessageDto) => ({ 'POST /messages/m1/recall': { ...m, body: '', recalled: true } })

  it('puts my recalled text, @ and quote back into the composer', async () => {
    const m = msg({
      seq: 1,
      body: '@Claude 改成 v3',
      quote: { kind: 'message', id: 'm0', who: '李建国', text: '方案 v2' },
    })
    renderChat([m], recalled(m))
    await recallIt('@Claude 改成 v3')
    fireEvent.click(screen.getByRole('button', { name: '重新编辑' }))
    expect(box().value).toBe('@Claude 改成 v3')
    expect(screen.getByText('方案 v2')).toBeTruthy()
    expect(screen.queryByRole('button', { name: '重新编辑' })).toBeNull()
  })

  it('brings its attachments back as new uploads', async () => {
    vi.mocked(uploadFile).mockImplementation((_g, f) => ({
      done: Promise.resolve({ id: 'up1', name: f.name, size: f.size, mime: f.type }),
      abort: vi.fn(),
    }))
    const m = msg({
      seq: 1,
      body: '看图',
      attachments: [{ id: 'a1', name: 'shot.png', size: 3, mime: 'image/png', messageId: 'm1' }],
    })
    const calls = renderChat([m], { ...recalled(m), 'GET /attachments/a1': new Response('png') })
    await recallIt('看图')
    expect(calls.some((c) => c.path === '/attachments/a1')).toBe(true)
    fireEvent.click(screen.getByRole('button', { name: '重新编辑' }))
    expect(vi.mocked(uploadFile).mock.calls[0]?.[1]).toMatchObject({ name: 'shot.png', type: 'image/png' })
  })

  it('is offered for five minutes only', async () => {
    vi.useFakeTimers({ shouldAdvanceTime: true })
    try {
      const m = msg({ seq: 1, body: '晚点再说' })
      renderChat([m], recalled(m))
      await recallIt('晚点再说')
      expect(screen.getByRole('button', { name: '重新编辑' })).toBeTruthy()
      act(() => vi.advanceTimersByTime(5 * 60_000 - 1000))
      expect(screen.getByRole('button', { name: '重新编辑' })).toBeTruthy()
      act(() => vi.advanceTimersByTime(1000))
      await waitFor(() => expect(screen.queryByRole('button', { name: '重新编辑' })).toBeNull())
    } finally {
      vi.useRealTimers()
    }
  })

  it("is not offered for others' recalls or ones made before this page loaded", async () => {
    renderChat([
      msg({ seq: 1, body: '', recalled: true }),
      msg({ seq: 2, authorId: 'u2', authorName: '李建国', body: '机密方案' }),
    ])
    await screen.findByText('你撤回了一条消息')
    push({ t: 'message.recalled', groupId: 'g1', messageId: 'm2' })
    expect(screen.getByText('李建国 撤回了一条消息')).toBeTruthy()
    expect(screen.queryByRole('button', { name: '重新编辑' })).toBeNull()
  })

  it('confirms before recalling a message with running bots, then stops started runs', async () => {
    let resolveRecall!: (v: MessageDto) => void
    const m = msg({ seq: 1, body: '@Claude 部署' })
    const calls = renderChat(
      [m],
      {
        'GET /bots': [
          {
            id: 'b1',
            name: '小王的 Claude',
            ownerId: 'u1',
            agentKind: 'claude',
            sharedWith: [],
            systemPrompt: '',
            avatar: 'role-no',
            presence: 'online',
            binding: 'bound',
          },
        ] as unknown as BotDto[],
        'POST /messages/m1/recall': () =>
          new Promise<MessageDto>((r) => {
            resolveRecall = r
          }),
        'POST /runs/r1/stop': { stopped: 1 },
        'POST /runs/r2/stop': { stopped: 1 },
      },
      [
        run({ id: 'r1', status: 'running' }),
        run({ id: 'r2', status: 'awaiting_approval' }),
        run({ id: 'r3', status: 'queued', startedAt: null }),
        run({ id: 'r4', status: 'completed' }),
        run({ id: 'r5', triggerMessageId: 'm9' }),
      ],
    )
    await openMore('@Claude 部署')
    fireEvent.click(screen.getByRole('menuitem', { name: '撤回' }))

    const dlg = screen.getByRole('alertdialog', { name: '要撤回这条消息并中断运行吗？' })
    expect(
      within(dlg).getByText('小王的 Claude 正在根据这条消息执行任务，撤回会立即中断当前运行。'),
    ).toBeTruthy()
    expect(calls.some((c) => c.path === '/messages/m1/recall')).toBe(false)

    // Cancelling leaves the message and runs untouched.
    fireEvent.click(within(dlg).getByRole('button', { name: '取消' }))
    expect(calls.some((c) => c.path === '/messages/m1/recall')).toBe(false)

    // Re-open and confirm: button locks with loading while recall is in flight, then stops started runs only.
    await openMore('@Claude 部署')
    fireEvent.click(screen.getByRole('menuitem', { name: '撤回' }))
    const dlg2 = screen.getByRole('alertdialog', { name: '要撤回这条消息并中断运行吗？' })
    const confirmBtn = within(dlg2).getByRole('button', { name: '撤回并中断' })
    fireEvent.click(confirmBtn)
    await waitFor(() => expect(confirmBtn.getAttribute('aria-busy')).toBe('true'))
    expect((within(dlg2).getByRole('button', { name: '取消' }) as HTMLButtonElement).disabled).toBe(true)

    await act(async () => resolveRecall({ ...m, body: '', recalled: true }))
    expect(await screen.findByText('你撤回了一条消息')).toBeTruthy()
    await waitFor(() =>
      expect(calls.filter((c) => c.method === 'POST' && c.path.endsWith('/stop')).map((c) => c.path)).toEqual(
        ['/runs/r1/stop', '/runs/r2/stop'],
      ),
    )
  })

  it('also confirms for queued or offline_wait runs, while recalling completed runs directly without a modal', async () => {
    const m1 = msg({ seq: 1, body: '排队消息' })
    const m2 = msg({ seq: 2, body: '已完成消息' })
    const calls = renderChat(
      [m1, m2],
      {
        'GET /bots': [
          {
            id: 'b1',
            name: '小王的 Claude',
            ownerId: 'u1',
            agentKind: 'claude',
            sharedWith: [],
            systemPrompt: '',
            avatar: 'role-no',
            presence: 'online',
            binding: 'bound',
          },
        ] as unknown as BotDto[],
        'POST /messages/m1/recall': { ...m1, body: '', recalled: true },
        'POST /messages/m2/recall': { ...m2, body: '', recalled: true },
      },
      [
        run({ id: 'r1', triggerMessageId: 'm1', status: 'queued', startedAt: null }),
        run({ id: 'r2', triggerMessageId: 'm2', status: 'completed' }),
      ],
    )
    // Completed run: instant direct recall with no modal.
    await openMore('已完成消息')
    fireEvent.click(screen.getByRole('menuitem', { name: '撤回' }))
    expect(screen.queryByRole('alertdialog')).toBeNull()
    expect(await screen.findByText('你撤回了一条消息')).toBeTruthy()
    expect(calls.some((c) => c.path === '/messages/m2/recall')).toBe(true)

    // Queued run: shows confirmation AlertDialog.
    await openMore('排队消息')
    fireEvent.click(screen.getByRole('menuitem', { name: '撤回' }))
    expect(screen.getByRole('alertdialog', { name: '要撤回这条消息并中断运行吗？' })).toBeTruthy()
    expect(calls.some((c) => c.path === '/messages/m1/recall')).toBe(false)
  })

  it('confirms and stops running bots when recalling inside ThreadView and CanvasChat', async () => {
    const bot = {
      id: 'b1',
      name: '小王的 Claude',
      ownerId: 'u1',
      agentKind: 'claude',
      sharedWith: [],
      systemPrompt: '',
      avatar: 'role-no',
      presence: 'online',
      binding: 'bound',
    } as unknown as BotDto
    useWorkspace.setState({ groups: [group], bots: [bot] })

    // 1. ThreadView
    const root = msg({ id: 'root1', seq: 1, body: '话题根消息' })
    const reply = msg({ id: 'm2', seq: 2, threadRootId: 'root1', body: '话题内触发' })
    const threadCalls = mockApi({
      'GET /messages/root1/thread?limit=50': {
        root,
        replies: [reply],
        runs: [run({ id: 'rt1', triggerMessageId: 'm2', threadRootId: 'root1', status: 'running' })],
        state: { following: false, unread: 0, mentioned: false },
      },
      'POST /messages/m2/recall': { ...reply, body: '', recalled: true },
      'POST /runs/rt1/stop': { stopped: 1 },
    })
    const tView = render(
      <MemoryRouter>
        <ThreadView group={group} rootId="root1" onClose={() => {}} />
        <Toaster />
      </MemoryRouter>,
    )
    await openMore('话题内触发')
    fireEvent.click(screen.getByRole('menuitem', { name: '撤回' }))
    const tDlg = screen.getByRole('alertdialog', { name: '要撤回这条消息并中断运行吗？' })
    expect(within(tDlg).getByText(/小王的 Claude/)).toBeTruthy()
    fireEvent.click(within(tDlg).getByRole('button', { name: '撤回并中断' }))
    await waitFor(() =>
      expect(threadCalls.some((c) => c.method === 'POST' && c.path === '/runs/rt1/stop')).toBe(true),
    )
    tView.unmount()

    // 2. CanvasChat
    const cRoot = msg({ id: 'croot1', seq: 1, body: '画布根' })
    const cReply = msg({ id: 'cm2', seq: 2, threadRootId: 'croot1', body: '画布内触发' })
    const canvasCalls = mockApi({
      'POST /artifacts/a1/chat': { rootId: 'croot1' },
      'GET /messages/croot1/thread?limit=50': {
        root: cRoot,
        replies: [cReply],
        runs: [run({ id: 'rc1', triggerMessageId: 'cm2', threadRootId: 'croot1', status: 'running' })],
        state: { following: false, unread: 0, mentioned: false },
      },
      'POST /messages/cm2/recall': { ...cReply, body: '', recalled: true },
      'POST /runs/rc1/stop': { stopped: 1 },
    })
    render(
      <MemoryRouter>
        <CanvasChat artifactId="a1" groupId="g1" />
        <Toaster />
      </MemoryRouter>,
    )
    await openMore('画布内触发')
    fireEvent.click(screen.getByRole('menuitem', { name: '撤回' }))
    const cDlg = screen.getByRole('alertdialog', { name: '要撤回这条消息并中断运行吗？' })
    fireEvent.click(within(cDlg).getByRole('button', { name: '撤回并中断' }))
    await waitFor(() =>
      expect(canvasCalls.some((c) => c.method === 'POST' && c.path === '/runs/rc1/stop')).toBe(true),
    )
  })

  it('stops a queued run that transitions to running while a slow attachment snapshot is in flight, and reports stop failures clearly', async () => {
    useToasts.setState({ items: [] })
    let resolveAttach!: (r: Response) => void
    const m = msg({
      seq: 1,
      body: '带附件排队',
      attachments: [{ id: 'a1', name: 'spec.txt', size: 4, mime: 'text/plain', messageId: 'm1' }],
    })
    const calls = renderChat(
      [m],
      {
        'GET /bots': [
          {
            id: 'b1',
            name: '小王的 Claude',
            ownerId: 'u1',
            agentKind: 'claude',
            sharedWith: [],
            systemPrompt: '',
            avatar: 'role-no',
            presence: 'online',
            binding: 'bound',
          },
        ] as unknown as BotDto[],
        'GET /attachments/a1': () =>
          new Promise<Response>((r) => {
            resolveAttach = r
          }),
        'POST /messages/m1/recall': { ...m, body: '', recalled: true },
        'POST /runs/r1/stop': apiError(500, 'internal', 'daemon unreachable'),
      },
      [run({ id: 'r1', triggerMessageId: 'm1', status: 'queued', startedAt: null })],
    )
    await openMore('带附件排队')
    fireEvent.click(screen.getByRole('menuitem', { name: '撤回' }))
    const dlg = screen.getByRole('alertdialog', { name: '要撤回这条消息并中断运行吗？' })
    fireEvent.click(within(dlg).getByRole('button', { name: '撤回并中断' }))

    // While attachment fetch is still pending, the queued run starts running.
    await waitFor(() => expect(calls.some((c) => c.path === '/attachments/a1')).toBe(true))
    push({ t: 'run.updated', run: run({ id: 'r1', triggerMessageId: 'm1', status: 'running' }) })

    await act(async () => resolveAttach(new Response('data')))
    expect(await screen.findByText('你撤回了一条消息')).toBeTruthy()
    await waitFor(() =>
      expect(calls.some((c) => c.method === 'POST' && c.path === '/runs/r1/stop')).toBe(true),
    )
    expect(await screen.findByText('消息已撤回，但未能停止正在运行的任务，请手动停止')).toBeTruthy()
  })
})

describe('delete', () => {
  it('asks first, then hides the message only for me', async () => {
    let done: () => void = () => {}
    const calls = renderChat([msg({ seq: 1, body: '要删的' }), msg({ seq: 2, body: '留下的' })], {
      'POST /messages/m1/hide': () => new Promise<undefined>((r) => (done = () => r(undefined))),
    })
    await openMore('要删的')
    fireEvent.click(screen.getByRole('menuitem', { name: '删除' }))
    const dialog = await screen.findByRole('alertdialog', { name: '要删除这条消息吗？' })
    expect(within(dialog).getByText('删除后仅对你隐藏，其他成员仍可见')).toBeTruthy()
    expect(calls.some((c) => c.path === '/messages/m1/hide')).toBe(false)
    const del = within(dialog).getByRole('button', { name: '删除' })
    expect(del.className).toContain('ui-btn--destructive')
    fireEvent.click(del)
    await waitFor(() => expect(del.getAttribute('aria-busy')).toBe('true'))
    await act(async () => done())
    await waitFor(() => expect(screen.queryByText('要删的')).toBeNull())
    expect(screen.getByText('留下的')).toBeTruthy()
    expect(calls.some((c) => c.method === 'POST' && c.path === '/messages/m1/hide')).toBe(true)
  })

  it('drops a message deleted in another session', async () => {
    renderChat([msg({ seq: 1, body: '别处删了' })])
    await screen.findByText('别处删了')
    push({ t: 'message.hidden', groupId: 'g1', messageId: 'm1' })
    expect(screen.queryByText('别处删了')).toBeNull()
  })
})
