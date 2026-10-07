import type {
  BotDto,
  BotProbeDto,
  CommandCandidatesDto,
  FileCandidatesDto,
  GroupDto,
  MachineDto,
  MessageDto,
  RepoProbeRes,
  RunDto,
  UserDto,
  WebEvent,
} from '@gonggong/protocol'
import { act, fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import { MemoryRouter } from 'react-router'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { App } from '../src/App'
import { useSession } from '../src/app/session'
import { useWorkspace } from '../src/app/workspace'

const me: UserDto = {
  id: 'u1',
  account: 'wanglei',
  name: '王磊',
  role: 'member',
  mustChangePassword: false,
  disabled: false,
  gitProtocol: 'auto',
}

const group = (o: Partial<GroupDto> = {}): GroupDto => ({
  id: 'g1',
  teamId: 't1',
  name: '退款 v2 迁移',
  kind: 'group',
  mode: 'partition',
  notice: '周五前合入 v2',
  noticeHidden: false,
  repo: { url: 'git@git.corp:pay/refund.git', branch: 'main' },
  members: [
    { userId: 'u1', name: '王磊', isAdmin: true },
    { userId: 'u2', name: '李建国', isAdmin: false },
  ],
  botIds: ['b1', 'b2'],
  unread: 0,
  lastSeq: 4,
  last: '',
  pinned: false,
  muted: false,
  foldRuns: false,
  liveRunIds: [],
  ...o,
})

const users = [
  { id: 'u1', name: '王磊', account: 'wanglei' },
  { id: 'u2', name: '李建国', account: 'lijg' },
  { id: 'u3', name: '赵敏', account: 'zhaomin' },
]

const bot = (o: Partial<BotDto>): BotDto => ({
  id: 'b1',
  teamId: 't1',
  name: '小王的 Claude',
  ownerId: 'u1',
  ownerName: '王磊',
  agentKind: 'claude',
  avatar: 'role-no',
  machineId: 'mc1',
  machineName: 'wanglei-mbp',
  binding: 'bound',
  presence: 'online',
  systemPrompt: '',
  tier: 'workspace',
  triggerScope: 'all',
  triggerList: [],
  concurrency: 2,
  createdBy: 'u1',
  agentVersion: null,
  agentMinVersion: null,
  groupCount: 0,
  defaultWorkspace: null,
  approval: 'ask',
  allowlist: [],
  model: null,
  effort: null,
  catalog: null,
  ...o,
})
const bots = [
  bot({}),
  bot({
    id: 'b2',
    name: '老李的 Codex',
    ownerId: 'u2',
    ownerName: '李建国',
    agentKind: 'codex',
    presence: 'offline',
  }),
  bot({
    id: 'b3',
    name: '小王的 Codex',
    agentKind: 'codex',
    binding: 'pending_confirm',
    presence: 'pending_confirm',
  }),
]

const machine: MachineDto = {
  id: 'mc1',
  ownerId: 'u1',
  name: 'wanglei-mbp',
  os: 'macos',
  arch: 'aarch64',
  online: true,
  agents: [],
  daemonVersion: '0.1.0',
  features: [],
  lastSeenAt: null,
  hostname: 'wanglei-mbp',
  system: null,
  boundAt: '2026-09-01T00:00:00Z',
  createdAt: '2026-09-01T00:00:00Z',
}

const at = '2026-09-23T02:21:00.000Z'
const msg = (o: Partial<MessageDto>): MessageDto => ({
  id: `m${o.seq}`,
  seq: 1,
  groupId: 'g1',
  kind: 'user',
  authorId: 'u1',
  authorName: '王磊',
  body: '',
  mentions: [],
  runId: null,
  createdAt: at,
  attachments: [],
  quote: null,
  ...o,
})

const run = (o: Partial<RunDto> = {}): RunDto => ({
  id: 'r1',
  groupId: 'g1',
  botId: 'b1',
  triggerMessageId: 'm2',
  triggerUserId: 'u1',
  hop: 1,
  status: 'running',
  step: '读取 server/refund.go',
  filesChanged: 2,
  usage: { totalTokens: 1500 },
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
  queuedAt: at,
  startedAt: at,
  endedAt: null,
  ...o,
})

const commandCandidates = (agent: CommandCandidatesDto['agent'] = []): CommandCandidatesDto => ({
  system: [
    { name: 'stop', hint: '停止运行（未 @ Bot 时停止本群全部）' },
    { name: 'new', hint: '开新会话' },
    { name: 'cd', hint: '绑定本机目录（仅分区）' },
  ],
  agent,
})

const reply = [
  '字段变化如下：',
  '',
  '| 字段 | v1 | v2 |',
  '| --- | --- | --- |',
  '| amount | 元 | 分 |',
  '',
  '```go',
  'func main() {}',
  '```',
].join('\n')

const timeline = {
  messages: [
    msg({ seq: 1, kind: 'event', authorId: null, authorName: '', body: '王磊 创建了群 · 成为群管理员' }),
    msg({ seq: 2, body: '@小王的 Claude 看下字段', mentions: ['b1'] }),
    msg({ seq: 3, kind: 'bot', authorId: 'b1', authorName: '小王的 Claude', body: reply, runId: 'r0' }),
  ],
  runs: [run()],
}

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

type Call = { method: string; path: string; body: Record<string, unknown> | undefined }
function mockApi(routes: Record<string, (body: Record<string, unknown> | undefined) => unknown>) {
  const calls: Call[] = []
  vi.stubGlobal(
    'fetch',
    vi.fn(async (url: string, init?: RequestInit) => {
      const path = url.replace(/^\/api/, '')
      const method = init?.method ?? 'GET'
      const body = init?.body ? JSON.parse(String(init.body)) : undefined
      calls.push({ method, path, body })
      const handler = routes[`${method} ${path.split('?')[0]}`]
      if (!handler) return new Response(JSON.stringify({ error: 'not_found', message: '' }), { status: 404 })
      return new Response(JSON.stringify(await handler(body)))
    }),
  )
  return calls
}

const probeRes = (
  results: Partial<BotProbeDto>[],
  branches = ['main'],
  defaultBranch: string | null = 'main',
): RepoProbeRes => ({
  results: results.map((r) => ({ botId: 'b1', ok: false, reason: null, usedUrl: null, detail: null, ...r })),
  defaultBranch,
  branches,
})

const baseRoutes = (groups: GroupDto[]) => ({
  'GET /groups': () => groups,
  'GET /users': () => users,
  'GET /bots': () => bots,
  'GET /machines': () => [],
  'GET /notifications': () => [],
  'GET /groups/g1/timeline': () => timeline,
  'POST /groups/g1/read': () => groups[0],
})

function renderAt(path: string) {
  return render(
    <MemoryRouter initialEntries={[path]}>
      <App />
    </MemoryRouter>,
  )
}

beforeEach(() => {
  Object.defineProperty(window, 'innerWidth', { configurable: true, value: 1440 })
  vi.stubGlobal('WebSocket', FakeSocket)
  useSession.setState({ user: me, status: 'ready' })
  useWorkspace.setState({ groups: [], bots: [], machines: [], activeGroupId: null })
})
afterEach(() => vi.unstubAllGlobals())

describe('sidebar', () => {
  it('lists groups and DMs with last line and unread badge', async () => {
    mockApi(
      baseRoutes([
        group({ unread: 3, last: '李建国：好的' }),
        group({ id: 'd1', kind: 'dm', name: '脚本实验' }),
      ]),
    )
    renderAt('/')
    const nav = screen.getByRole('navigation', { name: '会话列表' })
    const row = await within(nav).findByRole('link', { name: /退款 v2 迁移/ })
    // The second line is the latest message; the mode is shown in the chat header instead.
    expect(row.querySelector('.pn-conv__preview')?.textContent).toBe('李建国：好的')
    expect(within(row).getByText('3')).toBeTruthy()
    expect(within(nav).getByRole('link', { name: /脚本实验/ })).toBeTruthy()
  })

  it('welcomes a new user in the main area with the three first-run steps', async () => {
    mockApi({ ...baseRoutes([]), 'GET /bots': () => [] })
    renderAt('/')
    const welcome = await within(screen.getByRole('main')).findByRole('region', { name: '开始使用' })
    expect(within(welcome).getByRole('heading', { name: /欢迎来到共工空间/ })).toBeTruthy()
    for (const b of ['绑定机器', '新建 Bot', '新建群'])
      expect(within(welcome).getByRole('button', { name: b })).toBeTruthy()
    // The main area carries the guide, so the sidebar doesn't repeat it.
    expect(
      within(screen.getByRole('navigation', { name: '会话列表' })).queryByRole('region', {
        name: '开始使用',
      }),
    ).toBeNull()
    act(() => {
      useWorkspace.setState({ machines: [machine] })
    })
    expect(within(welcome).getByText('已完成')).toBeTruthy()
  })

  it('guides a new user to bind a machine and create a bot, then hides once both exist', async () => {
    mockApi({
      ...baseRoutes([]),
      'GET /bots': () => [],
      'POST /bind-codes': () => ({
        code: 'K7QM-4X2P',
        expiresAt: new Date(Date.now() + 600_000).toISOString(),
        link: 'gonggong://bind?server=x&code=K7QM-4X2P',
      }),
      'GET /bots/owners': () => [{ id: 'u1', name: '王磊', machines: [] }],
    })
    renderAt('/')
    const main = screen.getByRole('main')
    const guide = await within(main).findByRole('region', { name: '开始使用' })
    fireEvent.click(within(guide).getByRole('button', { name: /绑定机器/ }))
    expect(await screen.findByRole('link', { name: '在客户端中打开' })).toBeTruthy()
    fireEvent.click(
      within(screen.getByRole('dialog', { name: '绑定新机器' })).getByRole('button', { name: '取消' }),
    )

    fireEvent.click(within(guide).getByRole('button', { name: /新建 Bot/ }))
    expect(
      await screen.findByText('王磊 还没有绑定机器。Bot 会以「待绑定」创建，可先选 agent 种类。'),
    ).toBeTruthy()
    fireEvent.click(
      within(screen.getByRole('dialog', { name: /新建 Bot/ })).getByRole('button', { name: '取消' }),
    )

    act(() => {
      useWorkspace.setState({ machines: [machine], bots: [bot({})] })
    })
    expect(within(guide).getAllByText('已完成')).toHaveLength(2)
  })

  it('opens the new bot dialog from the 我的 BOT section', async () => {
    mockApi({ ...baseRoutes([]), 'GET /bots/owners': () => [{ id: 'u1', name: '王磊', machines: [] }] })
    renderAt('/')
    const nav = screen.getByRole('navigation', { name: '会话列表' })
    fireEvent.click(within(nav).getByRole('button', { name: '新建 Bot…' }))
    expect(await screen.findByRole('dialog', { name: /新建 Bot/ })).toBeTruthy()
  })
})

describe('my machines and bots', () => {
  const oldBox: MachineDto = { ...machine, id: 'mc2', name: 'old-box', os: 'linux', online: false }

  it('opens a machine from the sidebar to see, rename and revoke it', async () => {
    const detailed: MachineDto = {
      ...oldBox,
      agents: [
        {
          kind: 'claude',
          available: true,
          version: '2.1.4',
          path: '/bin/claude',
          minVersion: null,
          catalog: null,
        },
      ],
      system: {
        osVersion: 'Ubuntu 24.04',
        kernel: '6.8.0',
        cpuModel: 'AMD EPYC',
        cpuCores: 8,
        memoryBytes: 17179869184,
        macAddress: 'a4:83:e7:12:34:56',
      },
    }
    const calls = mockApi({
      ...baseRoutes([]),
      'GET /machines': () => [machine, detailed],
      'PATCH /machines/mc2': (b) => ({ ...detailed, name: b?.name }),
      'DELETE /machines/mc2': () => null,
    })
    renderAt('/')
    const nav = screen.getByRole('navigation', { name: '会话列表' })
    const section = await within(nav).findByRole('region', { name: '我的机器' })
    fireEvent.click(await within(section).findByRole('button', { name: /old-box/ }))
    const dialog = await screen.findByRole('dialog', { name: '机器详情' })
    for (const text of ['Ubuntu 24.04', '6.8.0', 'AMD EPYC · 8 核', '16 GB', 'Claude Code', '2.1.4'])
      expect(within(dialog).getByText(text)).toBeTruthy()
    fireEvent.change(within(dialog).getByRole('textbox', { name: '名称' }), { target: { value: '旧服务器' } })
    fireEvent.click(within(dialog).getByRole('button', { name: '保存' }))
    await waitFor(() =>
      expect(calls).toContainEqual({ method: 'PATCH', path: '/machines/mc2', body: { name: '旧服务器' } }),
    )

    fireEvent.click(within(dialog).getByRole('button', { name: '吊销机器' }))
    const confirm = await screen.findByRole('alertdialog', { name: /吊销机器 old-box/ })
    fireEvent.click(within(confirm).getByRole('button', { name: '吊销' }))
    await waitFor(() => expect(within(section).queryByText('old-box')).toBeNull())
    await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull())
    expect(calls).toContainEqual(expect.objectContaining({ method: 'DELETE', path: '/machines/mc2' }))
  })

  it('opens a bot from the sidebar and deletes it after confirmation', async () => {
    const calls = mockApi({
      ...baseRoutes([]),
      'GET /machines': () => [machine],
      'GET /usage': () => [],
      'DELETE /bots/b1': () => null,
    })
    renderAt('/')
    const nav = screen.getByRole('navigation', { name: '会话列表' })
    fireEvent.click(await within(nav).findByRole('link', { name: /小王的 Claude/ }))
    const page = await screen.findByRole('region', { name: 'Bot 概况' })
    fireEvent.click(within(page).getByRole('button', { name: '编辑 Bot' }))
    const detail = await screen.findByRole('dialog', { name: /Bot 详情/ })
    expect(within(detail).getByRole('textbox', { name: '系统提示词' })).toBeTruthy()

    fireEvent.click(within(detail).getByRole('button', { name: '删除 Bot' }))
    const confirm = await screen.findByRole('alertdialog', { name: /删除 小王的 Claude/ })
    fireEvent.click(within(confirm).getByRole('button', { name: '删除' }))
    await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull())
    expect(within(nav).queryByRole('link', { name: /小王的 Claude/ })).toBeNull()
    expect(calls).toContainEqual(expect.objectContaining({ method: 'DELETE', path: '/bots/b1' }))
  })
})

describe('chat view', () => {
  it('renders events, messages, markdown replies and run cards', async () => {
    const calls = mockApi(baseRoutes([group()]))
    renderAt('/g/g1')
    const main = screen.getByRole('main')
    expect(await within(main).findByRole('heading', { name: '退款 v2 迁移' })).toBeTruthy()
    expect(within(main).getByText('refund · main').getAttribute('title')).toBe('git@git.corp:pay/refund.git')
    expect(within(main).getByText('周五前合入 v2')).toBeTruthy()

    expect(await within(main).findByText('王磊 创建了群 · 成为群管理员')).toBeTruthy()
    expect(within(main).getByText('@小王的 Claude').className).toContain('mention')
    expect(within(main).getByTestId('bot-reply').textContent).toContain('字段变化如下')
    expect(within(main).getByRole('cell', { name: '分' })).toBeTruthy()
    expect(
      within(main.querySelector('.pn-code') as HTMLElement).getByRole('button', { name: '复制' }),
    ).toBeTruthy()

    const card = within(main).getByTestId('run-card')
    expect(card.textContent).toContain('小王的 Claude')
    expect(card.textContent).toContain('Claude Code · 王磊 触发')
    expect(card.textContent).toContain('运行中')
    expect(card.textContent).toContain('读取 server/refund.go')
    expect(card.textContent).toContain('改动 2 个文件')
    expect(card.textContent).toContain('1.5k tokens')
    await waitFor(() => expect(calls.some((c) => c.path === '/groups/g1/read')).toBe(true))
    // An MCP call's step reads as the tool's name, not its raw `mcp__server__tool` id.
    push({ t: 'run.updated', run: run({ step: 'mcp__gonggong__list_messages' }) })
    expect(card.textContent).toContain('读取聊天记录')
    expect(card.textContent).not.toContain('mcp__')

    // A burst of streamed text lands as one update rather than a re-render per chunk.
    push({ t: 'run.delta', runId: 'r1', text: '正在对比 v1 与 v2 ' })
    push({ t: 'run.delta', runId: 'r1', text: '的字段' })
    expect(card.textContent).not.toContain('正在对比')
    await waitFor(() => expect(card.textContent).toContain('正在对比 v1 与 v2 的字段'))
    push({
      t: 'run.updated',
      run: run({ status: 'completed', usage: null, endedAt: at, newSessionReason: 'resume_failed' }),
    })
    expect(card.textContent).toContain('已完成')
    expect(card.textContent).toContain('用量未上报')
    expect(card.textContent).toContain('会话恢复失败')
    push({ t: 'message.new', message: msg({ seq: 9, authorId: 'u2', authorName: '李建国', body: '收到' }) })
    expect(within(main).getByText('收到')).toBeTruthy()

    expect(within(main).getByTestId('git-bar').textContent).toContain('老李的 Codex待创建托管')
    const git = { branch: 'main', ahead: 0, behind: 1, dirty: true, workspace: 'managed' as const }
    push({
      t: 'group.botState',
      groupId: 'g1',
      state: {
        botId: 'b1',
        workspace: 'managed',
        state: 'ready',
        path: null,
        git,
        error: null,
        reason: null,
        tier: null,
        model: null,
        effort: null,
        context: null,
      },
    })
    expect(within(main).getByTestId('git-b1').textContent).toBe('小王的 Claudemain1未提交托管')
  })

  it('plays the enter animation only for messages that arrive after the first load', async () => {
    mockApi(baseRoutes([group()]))
    renderAt('/g/g1')
    const main = screen.getByRole('main')
    await within(main).findByText('王磊 创建了群 · 成为群管理员')
    const entering = () => main.querySelectorAll('.tl-item--enter')
    expect(entering()).toHaveLength(0)

    push({ t: 'run.delta', runId: 'r1', text: '流式输出' })
    push({ t: 'message.new', message: timeline.messages[1]! })
    expect(entering()).toHaveLength(0)

    push({ t: 'message.new', message: msg({ seq: 9, authorId: 'u2', authorName: '李建国', body: '收到' }) })
    const item = within(main).getByText('收到').closest('.tl-item')
    expect(item?.classList.contains('tl-item--enter')).toBe(true)
    expect(entering()).toHaveLength(1)

    push({ t: 'message.new', message: msg({ seq: 9, authorId: 'u2', authorName: '李建国', body: '收到了' }) })
    expect(within(main).getByText('收到了').closest('.tl-item')).toBe(item)
    expect(entering()).toHaveLength(1)
  })

  it('marks human fan-out and shows relay hops as triggered by the bot', async () => {
    mockApi({
      ...baseRoutes([group()]),
      'GET /groups/g1/timeline': () => ({
        messages: [
          msg({ seq: 2, body: '@小王的 Claude @老李的 Codex 迁移', mentions: ['b1', 'b2'] }),
          msg({
            seq: 3,
            kind: 'bot',
            authorId: 'b1',
            authorName: '小王的 Claude',
            body: '@老李的 Codex 补单测',
          }),
        ],
        runs: [
          run({ id: 'r1', status: 'completed' }),
          run({ id: 'r2', botId: 'b2', status: 'completed' }),
          run({
            id: 'r3',
            botId: 'b2',
            triggerMessageId: 'm3',
            triggerUserId: null,
            hop: 2,
            parentRunId: 'r1',
          }),
        ],
      }),
    })
    renderAt('/g/g1')
    const main = screen.getByRole('main')
    expect(await within(main).findByText('扇出 · 2 个 Bot 并行')).toBeTruthy()
    const cards = await within(main).findAllByTestId('run-card')
    expect(cards[2]!.textContent).toContain('Codex · 小王的 Claude 触发')
  })

  it('sends over plain http on a LAN address, where crypto.randomUUID is missing', async () => {
    const calls = mockApi({ ...baseRoutes([group()]), 'POST /groups/g1/messages': () => msg({ id: 'm11' }) })
    vi.stubGlobal('crypto', { getRandomValues: crypto.getRandomValues.bind(crypto) })
    renderAt('/g/g1')
    const box = (await screen.findByPlaceholderText(
      '输入消息，@ 触发 Bot 或引用文件，/ 查看命令',
    )) as HTMLTextAreaElement
    fireEvent.change(box, { target: { value: '你好' } })
    fireEvent.keyDown(box, { key: 'Enter' })
    await waitFor(() => expect(box.value).toBe(''))
    const post = calls.find((c) => c.path === '/groups/g1/messages')
    expect(String(post?.body?.clientId)).toMatch(
      /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/,
    )
  })

  it('sends with Enter once, deduping the realtime echo, and suggests @ candidates', async () => {
    const sent = msg({ id: 'm10', seq: 10, body: '@小王的 Claude 跑一下', mentions: ['b1'] })
    const calls = mockApi({ ...baseRoutes([group()]), 'POST /groups/g1/messages': () => sent })
    renderAt('/g/g1')
    await screen.findByTestId('bot-reply')
    const box = screen.getByPlaceholderText(
      '输入消息，@ 触发 Bot 或引用文件，/ 查看命令',
    ) as HTMLTextAreaElement

    fireEvent.change(box, { target: { value: '@', selectionStart: 1 } })
    const list = screen.getByRole('listbox', { name: '@ 候选' })
    expect(within(list).getByRole('option', { name: /老李的 Codex/ })).toBeTruthy()
    expect(
      within(within(list).getByRole('group', { name: '成员 / Bot' })).getByRole('option', {
        name: /^李建国/,
      }),
    ).toBeTruthy()
    fireEvent.click(within(list).getByRole('option', { name: /小王的 Claude/ }))
    expect(box.value).toBe('@小王的 Claude ')

    fireEvent.change(box, { target: { value: '@小王的 Claude 跑一下' } })
    fireEvent.keyDown(box, { key: 'Enter' })
    fireEvent.keyDown(box, { key: 'Enter' })
    await waitFor(() => expect(box.value).toBe(''))
    const posts = calls.filter((c) => c.path === '/groups/g1/messages')
    expect(posts).toHaveLength(1)
    expect(posts[0]!.body).toMatchObject({ body: '@小王的 Claude 跑一下' })
    expect(String(posts[0]!.body!.clientId).length).toBeGreaterThanOrEqual(8)

    push({ t: 'message.new', message: sent })
    expect(within(screen.getByRole('main')).getAllByText('跑一下', { exact: false })).toHaveLength(1)
  })

  it('suggests system commands after a leading / with keyboard navigation', async () => {
    mockApi({ ...baseRoutes([group()]), 'GET /groups/g1/candidates/commands': () => commandCandidates() })
    renderAt('/g/g1')
    await screen.findByTestId('bot-reply')
    const box = screen.getByPlaceholderText(
      '输入消息，@ 触发 Bot 或引用文件，/ 查看命令',
    ) as HTMLTextAreaElement

    fireEvent.change(box, { target: { value: '/', selectionStart: 1 } })
    const list = await screen.findByRole('listbox', { name: '/ 命令' })
    const options = within(within(list).getByRole('group', { name: '系统命令' })).getAllByRole('option')
    expect(options.map((o) => o.textContent)).toEqual([
      '/stop停止运行（未 @ Bot 时停止本群全部）',
      '/new开新会话',
      '/cd绑定本机目录（仅分区）',
    ])
    fireEvent.keyDown(box, { key: 'ArrowUp' })
    fireEvent.keyDown(box, { key: 'Enter' })
    expect(box.value).toBe('/cd ')
    expect(screen.queryByRole('listbox')).toBeNull()

    fireEvent.change(box, { target: { value: '  /N', selectionStart: 4 } })
    const filtered = within(screen.getByRole('listbox', { name: '/ 命令' })).getAllByRole('option')
    expect(filtered.map((o) => o.textContent)).toEqual(['/new开新会话'])
    fireEvent.keyDown(box, { key: 'Tab' })
    expect(box.value).toBe('  /new ')

    fireEvent.change(box, { target: { value: '看下 /', selectionStart: 4 } })
    expect(screen.queryByRole('listbox')).toBeNull()
    fireEvent.change(box, { target: { value: '/', selectionStart: 1 } })
    fireEvent.keyDown(box, { key: 'Escape' })
    expect(screen.queryByRole('listbox')).toBeNull()

    // The toolbar's 命令 button inserts `/` at the end and opens the list, even with a stale caret.
    fireEvent.change(box, { target: { value: '', selectionStart: 0 } })
    box.setSelectionRange(0, 0)
    box.blur()
    fireEvent.click(screen.getByTitle('命令'))
    expect(box.value).toBe('/')
    expect(screen.getByRole('listbox', { name: '/ 命令' })).toBeTruthy()
  })

  it('groups file candidates by source with hints and inserts paths', async () => {
    let files: FileCandidatesDto = {
      source: 'workspace',
      label: '小王的 Claude 工作区 · 含未提交',
      entries: [
        { path: 'server/refund/', dir: true, uncommitted: false, notInWorkspace: false },
        { path: 'server/refund/v2/handler.go', dir: false, uncommitted: true, notInWorkspace: false },
        { path: 'server/refund.md', dir: false, uncommitted: false, notInWorkspace: true },
      ],
    }
    const calls = mockApi({ ...baseRoutes([group()]), 'GET /groups/g1/candidates/files': () => files })
    renderAt('/g/g1')
    await screen.findByTestId('bot-reply')
    const box = screen.getByPlaceholderText(
      '输入消息，@ 触发 Bot 或引用文件，/ 查看命令',
    ) as HTMLTextAreaElement

    fireEvent.change(box, { target: { value: '@小王的 Claude @ser', selectionStart: 17 } })
    const pop = await screen.findByTestId('composer-popover')
    const group_ = await within(pop).findByRole('group', { name: '文件' })
    expect(group_.textContent).toContain('来源：小王的 Claude 工作区 · 含未提交')
    expect(
      within(group_)
        .getAllByRole('option')
        .map((o) => o.textContent),
    ).toEqual([
      'server/refund/文件夹',
      'server/refund/v2/handler.go未提交',
      'server/refund.md该文件不在你的工作区，可能需要拉取',
    ])
    expect(calls.map((c) => c.path)).toContain('/groups/g1/candidates/files?q=ser&botId=b1')
    fireEvent.keyDown(box, { key: 'ArrowDown' })
    fireEvent.keyDown(box, { key: 'ArrowUp' })
    fireEvent.keyDown(box, { key: 'Enter' })
    expect(box.value).toBe('@小王的 Claude @server/refund/ ')

    files = {
      source: 'mirror',
      label: 'main 镜像 · 3 分钟前更新',
      entries: [{ path: 'README.md', dir: false, uncommitted: false, notInWorkspace: false }],
    }
    fireEvent.change(box, { target: { value: '@READ', selectionStart: 5 } })
    expect(await screen.findByText('来源：main 镜像 · 3 分钟前更新')).toBeTruthy()
    expect(calls.map((c) => c.path)).toContain('/groups/g1/candidates/files?q=READ')
    fireEvent.click(
      within(screen.getByTestId('composer-popover')).getByRole('option', { name: /README\.md/ }),
    )
    expect(box.value).toBe('@README.md ')
  })

  it('lists agent commands of the mentioned bot after the mention', async () => {
    const calls = mockApi({
      ...baseRoutes([group()]),
      'GET /groups/g1/candidates/commands': () =>
        commandCandidates([
          { name: 'compact', hint: 'Compact the conversation', botId: 'b1', botName: '小王的 Claude' },
          { name: '小王的Claude:new', hint: '与系统命令重名', botId: 'b1', botName: '小王的 Claude' },
        ]),
    })
    renderAt('/g/g1')
    await screen.findByTestId('bot-reply')
    const box = screen.getByPlaceholderText(
      '输入消息，@ 触发 Bot 或引用文件，/ 查看命令',
    ) as HTMLTextAreaElement

    fireEvent.change(box, { target: { value: '@小王的 Claude /', selectionStart: 14 } })
    const list = await screen.findByRole('listbox', { name: '/ 命令' })
    const agent = await within(list).findByRole('group', { name: 'AGENT 命令' })
    expect(agent.textContent).toContain('ACP 上报')
    expect(
      within(agent)
        .getAllByRole('option')
        .map((o) => o.textContent),
    ).toEqual(['/compactCompact the conversation', '/小王的Claude:new与系统命令重名'])
    expect(calls.map((c) => c.path)).toContain('/groups/g1/candidates/commands?botId=b1')
    fireEvent.change(box, { target: { value: '@小王的 Claude /com', selectionStart: 17 } })
    expect(
      within(list)
        .getAllByRole('option')
        .map((o) => o.textContent),
    ).toEqual(['/compactCompact the conversation'])
    fireEvent.keyDown(box, { key: 'Enter' })
    expect(box.value).toBe('@小王的 Claude /compact ')
  })

  it('shows a not-found state for groups I am not in', async () => {
    mockApi(baseRoutes([]))
    renderAt('/g/zz')
    expect(await screen.findByText('群不存在或你已不在群内')).toBeTruthy()
  })
})

const history = [
  {
    id: 'r1',
    key: 'git.corp/pay/refund',
    url: 'git@git.corp:pay/refund.git',
    name: 'refund',
    lastBranch: 'release',
    lastUsedAt: '2026-09-20T00:00:00Z',
    groups: 3,
    mine: true,
    localPaths: [{ machineId: 'm1', path: '/Users/w/refund' }],
  },
]

/** Opens the repo popover of `scope` and returns it. */
async function openRepoPanel(scope: HTMLElement) {
  fireEvent.click(within(scope).getByRole('button', { name: '仓库' }))
  return screen.findByRole('dialog', { name: '选择仓库' })
}

async function addBot(dialog: HTMLElement, name: RegExp) {
  fireEvent.click(within(dialog).getByRole('button', { name: '添加 Bot…' }))
  const pick = await screen.findByRole('dialog', { name: '添加 Bot' })
  fireEvent.click(within(pick).getByRole('menuitemcheckbox', { name }))
  fireEvent.click(within(dialog).getByRole('button', { name: '添加 Bot…' }))
}

describe('new group dialog', () => {
  it('creates a repo-less DM with only my bound bots on offer', async () => {
    const created = group({
      id: 'd9',
      kind: 'dm',
      name: '小王的 Claude',
      repo: null,
      botIds: ['b1'],
      members: [],
    })
    const calls = mockApi({
      ...baseRoutes([]),
      'POST /groups': () => created,
      'GET /groups/d9/timeline': () => ({ messages: [], runs: [] }),
      'POST /groups/d9/read': () => created,
    })
    renderAt('/')
    fireEvent.click(screen.getByRole('button', { name: '新建私聊' }))
    const dialog = await screen.findByRole('dialog', { name: '新建私聊' })
    expect(within(dialog).queryByRole('tab')).toBeNull()
    expect(within(dialog).queryByRole('group', { name: '成员' })).toBeNull()

    expect(within(dialog).queryByRole('heading', { name: '仓库' })).toBeNull()
    expect(within(dialog).getAllByText('仓库')).toHaveLength(1)
    // A DM is titled by its Bot: no name to fill, a Bot to pick instead.
    expect(within(dialog).queryByLabelText('名称')).toBeNull()
    const create = within(dialog).getByRole('button', { name: '创建' })
    expect(create.hasAttribute('disabled')).toBe(true)

    fireEvent.click(within(dialog).getByRole('button', { name: '添加 Bot…' }))
    const pick = await screen.findByRole('dialog', { name: '添加 Bot' })
    expect(dialog.contains(pick)).toBe(false)
    expect(within(pick).queryByRole('menuitemcheckbox', { name: /老李的 Codex/ })).toBeNull()
    expect(
      within(pick)
        .getByRole('menuitemcheckbox', { name: /小王的 Codex/ })
        .hasAttribute('disabled'),
    ).toBe(true)
    fireEvent.click(within(pick).getByRole('menuitemcheckbox', { name: /小王的 Claude/ }))

    expect(within(dialog).getByText('不绑定 · 各 Bot 使用本机目录')).toBeTruthy()
    expect(create.hasAttribute('disabled')).toBe(false)
    fireEvent.click(create)

    expect(await screen.findByRole('heading', { name: '小王的 Claude' })).toBeTruthy()
    expect(calls.find((c) => c.method === 'POST' && c.path === '/groups')?.body).toEqual({
      name: '小王的 Claude',
      kind: 'dm',
      memberIds: [],
      botIds: ['b1'],
      repo: null,
    })
  })

  it('checks the repo on its own and marks the result on each bot row', async () => {
    const calls = mockApi({
      ...baseRoutes([]),
      'GET /me/git-accounts': () => [],
      'GET /repos': () => history,
      'POST /repos/probe': () =>
        probeRes([{ botId: 'b2', ok: true, usedUrl: 'git@git.corp:pay/refund.git' }], ['main', 'release']),
      'POST /groups': () => group({ id: 'g7' }),
    })
    renderAt('/')
    fireEvent.click(screen.getByRole('button', { name: '新建群' }))
    const dialog = await screen.findByRole('dialog', { name: '新建群' })
    await addBot(dialog, /老李的 Codex/)
    expect(within(dialog).getByText('Bot · 1')).toBeTruthy()

    const panel = await openRepoPanel(dialog)
    const option = await within(panel).findByRole('option', { name: /pay\/refund/ })
    expect(option.textContent).toContain('3 个群在用 · release · 本机已有')
    fireEvent.mouseDown(option)
    // The repo name fills the empty name field.
    expect((within(dialog).getByLabelText('名称') as HTMLInputElement).value).toBe('refund')
    expect((within(dialog).getByLabelText('基准分支') as HTMLInputElement).value).toBe('release')
    expect(within(dialog).getByRole('button', { name: '检查中…' }).hasAttribute('disabled')).toBe(true)

    const row = await within(dialog).findByText('可访问 · SSH')
    expect(row.closest('.ng-botrow')?.textContent).toContain('老李的 Codex')
    expect(within(dialog).getByText('1 个 Bot 可访问')).toBeTruthy()
    expect(calls.find((c) => c.path === '/repos/probe')?.body).toEqual({
      url: 'git@git.corp:pay/refund.git',
      branch: 'release',
      botIds: ['b2'],
    })

    const people = within(dialog).getByRole('group', { name: '成员' })
    expect(within(people).getByText('李建国').parentElement?.textContent).toContain('Bot 主人')
    fireEvent.click(within(people).getByRole('button', { name: '添加成员' }))
    fireEvent.click(await screen.findByRole('button', { name: /赵敏/ }))
    expect(within(dialog).getByText(/成员 · 3/)).toBeTruthy()

    const create = within(dialog).getByRole('button', { name: '创建' })
    fireEvent.click(create)
    await waitFor(() => expect(calls.some((c) => c.path === '/groups' && c.method === 'POST')).toBe(true))
    expect(calls.find((c) => c.path === '/groups' && c.method === 'POST')?.body).toEqual({
      name: 'refund',
      kind: 'group',
      memberIds: ['u3'],
      botIds: ['b2'],
      repo: { url: 'git@git.corp:pay/refund.git', branch: 'release' },
    })
  })

  it('blocks creating without a name, while checking, and on a missing branch', async () => {
    let answer: (v: unknown) => void = () => {}
    mockApi({
      ...baseRoutes([]),
      'GET /me/git-accounts': () => [],
      'GET /repos': () => [],
      'POST /repos/probe': () => new Promise((r) => (answer = r)),
    })
    renderAt('/')
    fireEvent.click(screen.getByRole('button', { name: '新建群' }))
    const dialog = await screen.findByRole('dialog', { name: '新建群' })
    await addBot(dialog, /小王的 Claude/)
    fireEvent.change(within(dialog).getByLabelText('名称'), { target: { value: '仓库协作' } })
    const panel = await openRepoPanel(dialog)
    fireEvent.change(within(panel).getByLabelText('搜索仓库'), {
      target: { value: 'https://git.corp/pay/demo.git' },
    })
    fireEvent.mouseDown(
      await within(panel).findByRole('option', { name: /使用地址 https:\/\/git.corp\/pay\/demo.git/ }),
    )
    expect((within(dialog).getByLabelText('名称') as HTMLInputElement).value).toBe('仓库协作')
    fireEvent.change(within(dialog).getByLabelText('基准分支'), { target: { value: 'dev' } })
    const checking = await within(dialog).findByRole('button', { name: '检查中…' })
    expect(checking.hasAttribute('disabled')).toBe(true)
    await waitFor(() => expect(answer).not.toBe(undefined))
    await act(async () => {
      await new Promise((r) => setTimeout(r, 450))
      answer(probeRes([{ botId: 'b1', ok: false, reason: 'branch_missing' }], ['main']))
    })
    expect(within(dialog).getByText('分支不存在')).toBeTruthy()
    expect(within(dialog).getAllByText('分支 dev 不存在').length).toBeGreaterThan(0)
    expect(within(dialog).getByRole('button', { name: '创建' }).hasAttribute('disabled')).toBe(true)

    fireEvent.change(within(dialog).getByLabelText('名称'), { target: { value: '' } })
    fireEvent.change(within(dialog).getByLabelText('基准分支'), { target: { value: 'main' } })
    await act(async () => {
      await new Promise((r) => setTimeout(r, 450))
      answer(probeRes([{ botId: 'b1', ok: false, reason: 'denied', detail: 'Repository not found.' }]))
    })
    expect(within(dialog).getByText('无权限 · 进群后暂停').getAttribute('title')).toBe(
      'Repository not found.',
    )
    expect(within(dialog).getByText('1 个 Bot 进群后暂停，主人配置凭据后可重新检查')).toBeTruthy()
    expect(within(dialog).getByRole('button', { name: '创建' }).hasAttribute('disabled')).toBe(true)
    fireEvent.change(within(dialog).getByLabelText('名称'), { target: { value: '仓库协作' } })
    expect(within(dialog).getByRole('button', { name: '创建' }).hasAttribute('disabled')).toBe(false)
  })
})

describe('repo picker', () => {
  const account = {
    id: 'a1',
    provider: 'github',
    baseUrl: 'https://github.com',
    login: 'wanglei',
    status: 'ok',
  }

  it('searches my GitHub repos, defaults to their default branch and lists its branches', async () => {
    localStorage.setItem('gonggong.repoSource', 'a1')
    const calls = mockApi({
      ...baseRoutes([]),
      'GET /me/git-accounts': () => [account, { ...account, id: 'a2', login: 'old', status: 'invalid' }],
      'GET /repos': () => history,
      'GET /git-accounts/a1/repos': () => [
        { fullName: 'acme/shop', url: 'git@github.com:acme/shop.git', defaultBranch: 'trunk', private: true },
      ],
      'GET /git-accounts/a1/branches': () => ['trunk', 'next'],
      'POST /repos/probe': () =>
        probeRes([{ botId: 'b1', ok: true, usedUrl: 'git@github.com:acme/shop.git' }]),
    })
    renderAt('/')
    fireEvent.click(screen.getByRole('button', { name: '新建群' }))
    const dialog = await screen.findByRole('dialog', { name: '新建群' })
    const panel = await openRepoPanel(dialog)
    const sources = within(panel).getByRole('radiogroup', { name: '来源' })
    expect(
      within(sources)
        .getAllByRole('radio')
        .map((r) => r.textContent),
    ).toEqual(['最近', 'GitHub'])
    expect(within(sources).getByRole('radio', { name: 'GitHub' }).getAttribute('aria-checked')).toBe('true')
    fireEvent.change(within(panel).getByLabelText('搜索仓库'), { target: { value: 'shop' } })
    await waitFor(() => expect(calls.some((c) => c.path === '/git-accounts/a1/repos?q=shop')).toBe(true))
    const option = await within(panel).findByRole('option', { name: /acme\/shop/ })
    expect(within(option).getByRole('img', { name: '私有' })).toBeTruthy()
    fireEvent.keyDown(within(panel).getByLabelText('搜索仓库'), { key: 'Enter' })

    expect((within(dialog).getByLabelText('基准分支') as HTMLInputElement).value).toBe('trunk')
    await waitFor(() =>
      expect(calls.some((c) => c.path === '/git-accounts/a1/branches?repo=acme%2Fshop&q=')).toBe(true),
    )
    fireEvent.click(within(dialog).getAllByRole('button', { name: '显示选项' }).at(-1)!)
    const branches = await within(dialog).findByRole('listbox', { name: '' })
    expect(
      within(branches)
        .getAllByRole('option')
        .map((o) => o.textContent),
    ).toEqual(['trunk', 'next'])

    fireEvent.click(within(dialog).getByRole('button', { name: '仓库' }))
    const again = await screen.findByRole('dialog', { name: '选择仓库' })
    fireEvent.click(within(again).getByRole('radio', { name: '最近' }))
    expect(await within(again).findByRole('option', { name: /pay\/refund/ })).toBeTruthy()
    expect(localStorage.getItem('gonggong.repoSource')).toBe('recent')
    fireEvent.click(within(again).getByRole('button', { name: '不绑定仓库' }))
    expect(within(dialog).getByText('不绑定 · 各 Bot 使用本机目录')).toBeTruthy()
    localStorage.clear()
  })

  it('offers to connect an account when there is none', async () => {
    mockApi({ ...baseRoutes([]), 'GET /me/git-accounts': () => [], 'GET /repos': () => [] })
    renderAt('/')
    fireEvent.click(screen.getByRole('button', { name: '新建群' }))
    const dialog = await screen.findByRole('dialog', { name: '新建群' })
    const panel = await openRepoPanel(dialog)
    expect(within(panel).queryByRole('radiogroup', { name: '来源' })).toBeNull()
    expect(await within(panel).findByText('没有匹配的仓库')).toBeTruthy()
    fireEvent.click(within(panel).getByRole('button', { name: '连接 GitHub / GitLab 账号…' }))
    expect(await screen.findByRole('dialog', { name: 'Git 与仓库' })).toBeTruthy()
  })

  it('drops a check once the picked bots change, and offers a retry when the check fails', async () => {
    const answers: ((v: unknown) => void)[] = []
    let fail = false
    const calls = mockApi({
      ...baseRoutes([]),
      'GET /me/git-accounts': () => [],
      'GET /repos': () => history,
      'POST /repos/probe': () => {
        if (fail) throw new Error('offline')
        return new Promise((r) => answers.push(r))
      },
    })
    renderAt('/')
    fireEvent.click(screen.getByRole('button', { name: '新建群' }))
    const dialog = await screen.findByRole('dialog', { name: '新建群' })
    const panel = await openRepoPanel(dialog)
    fireEvent.mouseDown(await within(panel).findByRole('option', { name: /pay\/refund/ }))
    await waitFor(() => expect(answers).toHaveLength(1))
    await addBot(dialog, /小王的 Claude/)
    await act(async () => answers[0]!(probeRes([{ botId: 'b1', ok: true }])))
    expect(within(dialog).queryByText(/可访问/)).toBeNull()
    await waitFor(() => expect(answers).toHaveLength(2))
    expect(calls.filter((c) => c.path === '/repos/probe').at(-1)?.body).toMatchObject({ botIds: ['b1'] })

    fail = true
    fireEvent.change(within(dialog).getByLabelText('基准分支'), { target: { value: 'main' } })
    expect(await within(dialog).findByText('网络连接失败，请检查网络后重试')).toBeTruthy()
    expect(within(dialog).getByRole('button', { name: '创建' }).hasAttribute('disabled')).toBe(true)
    fail = false
    fireEvent.click(within(dialog).getByRole('button', { name: '重新检查' }))
    await waitFor(() => expect(answers).toHaveLength(3))
  })

  it('follows the repo default branch when the branch field was left as is', async () => {
    const calls = mockApi({
      ...baseRoutes([]),
      'GET /me/git-accounts': () => [],
      'GET /repos': () => [],
      'POST /repos/probe': (body) =>
        (body as { branch: string }).branch === 'master'
          ? probeRes(
              [{ botId: 'b1', ok: true, usedUrl: 'https://git.corp/ops/infra.git' }],
              ['master'],
              'master',
            )
          : probeRes([{ botId: 'b1', ok: false, reason: 'branch_missing' }], ['master'], 'master'),
    })
    renderAt('/')
    fireEvent.click(screen.getByRole('button', { name: '新建群' }))
    const dialog = await screen.findByRole('dialog', { name: '新建群' })
    await addBot(dialog, /小王的 Claude/)
    const panel = await openRepoPanel(dialog)
    fireEvent.change(within(panel).getByLabelText('搜索仓库'), {
      target: { value: 'https://git.corp/ops/infra.git' },
    })
    fireEvent.mouseDown(await within(panel).findByRole('option', { name: /使用地址/ }))
    expect(await within(dialog).findByText('可访问 · HTTPS', {}, { timeout: 2000 })).toBeTruthy()
    expect((within(dialog).getByLabelText('基准分支') as HTMLInputElement).value).toBe('master')
    expect(
      calls.filter((c) => c.path === '/repos/probe').map((c) => (c.body as { branch: string }).branch),
    ).toEqual(['main', 'master'])
  })
})

describe('repo and workspaces', () => {
  const states = [
    { botId: 'b1', workspace: 'managed', state: 'ready', path: null },
    { botId: 'b2', workspace: 'cd', state: 'failed', path: '/Users/li/pay', reason: 'denied' },
  ].map((s) => ({
    git: null,
    error: null,
    reason: null,
    tier: null,
    model: null,
    effort: null,
    context: null,
    ...s,
  }))

  it('lets a group admin change the repo, checking it against the group bots', async () => {
    const calls = mockApi({
      ...baseRoutes([group()]),
      'GET /groups/g1/bot-states': () => states,
      'GET /me/git-accounts': () => [],
      'GET /repos': () => [],
      'POST /repos/probe': () =>
        probeRes(
          [
            { botId: 'b1', ok: true, usedUrl: 'git@git.corp:pay/new.git' },
            { botId: 'b2', ok: false, reason: 'offline' },
          ],
          ['dev'],
        ),
      'PATCH /groups/g1/repo': (body) => group({ repo: body as GroupDto['repo'] }),
    })
    renderAt('/g/g1')
    const main = screen.getByRole('main')
    fireEvent.click(await within(main).findByRole('button', { name: '群设置' }))
    const drawer = await screen.findByRole('complementary', { name: '群设置' })
    fireEvent.click(within(drawer).getByRole('button', { name: /仓库与基准分支/ }))
    const dialog = await screen.findByRole('dialog', { name: '仓库与工作区 · 退款 v2 迁移' })
    expect(within(dialog).getByText('pay/refund')).toBeTruthy()

    fireEvent.click(within(dialog).getByRole('button', { name: '更换…' }))
    const panel = await openRepoPanel(dialog)
    expect(within(panel).queryByRole('button', { name: '不绑定仓库' })).toBeNull()
    fireEvent.change(within(panel).getByLabelText('搜索仓库'), {
      target: { value: 'git@git.corp:pay/new.git' },
    })
    fireEvent.mouseDown(await within(panel).findByRole('option', { name: /使用地址/ }))
    fireEvent.change(within(dialog).getByLabelText('基准分支'), { target: { value: 'dev' } })
    expect(await within(dialog).findByText('可访问 · SSH', {}, { timeout: 2000 })).toBeTruthy()
    expect(within(dialog).getByTestId('rw-bot-b2').textContent).toContain('离线 · 上线后验证')
    expect(within(dialog).getByText('各 Bot 的托管工作区将重建')).toBeTruthy()
    expect(calls.find((c) => c.path === '/repos/probe')?.body).toMatchObject({ botIds: ['b1', 'b2'] })
    fireEvent.click(within(dialog).getByRole('button', { name: '更换仓库' }))
    await waitFor(() =>
      expect(calls.find((c) => c.method === 'PATCH')?.body).toEqual({
        url: 'git@git.corp:pay/new.git',
        branch: 'dev',
      }),
    )
    expect(await within(main).findByText('new · dev')).toBeTruthy()
  })

  it('shows every member where each bot works; only the owner can move it', async () => {
    const calls = mockApi({
      ...baseRoutes([group({ members: [{ userId: 'u1', name: '王磊', isAdmin: false }] })]),
      'GET /groups/g1/bot-states': () => states,
      'POST /groups/g1/bots/b2/recheck': () => ({}),
    })
    renderAt('/g/g1')
    const main = screen.getByRole('main')
    fireEvent.click(await within(main).findByRole('button', { name: '群设置' }))
    const drawer = await screen.findByRole('complementary', { name: '群设置' })
    fireEvent.click(within(drawer).getByRole('button', { name: /仓库与工作区/ }))
    expect(within(drawer).queryByRole('button', { name: '更换…' })).toBeNull()
    const mine = await within(drawer).findByTestId('rw-bot-b1')
    expect(mine.textContent).toContain('托管克隆 · 就绪')
    expect(within(mine).getByRole('button', { name: '更改…' })).toBeTruthy()
    const theirs = within(drawer).getByTestId('rw-bot-b2')
    expect(theirs.textContent).toContain('老李的 Codex · 李建国')
    expect(theirs.textContent).toContain('已暂停 · 无权限')
    expect(within(theirs).queryByRole('button', { name: '更改…' })).toBeNull()
    expect(within(theirs).queryByRole('button', { name: '重新检查' })).toBeNull()
    expect(calls.some((c) => c.path.endsWith('/recheck'))).toBe(false)
  })

  it('lets an admin recheck a paused bot', async () => {
    const calls = mockApi({
      ...baseRoutes([group()]),
      'GET /groups/g1/bot-states': () => states,
      'POST /groups/g1/bots/b2/recheck': () => ({}),
    })
    renderAt('/g/g1')
    const main = screen.getByRole('main')
    fireEvent.click(await within(main).findByRole('button', { name: '群设置' }))
    const drawer = await screen.findByRole('complementary', { name: '群设置' })
    fireEvent.click(within(drawer).getByRole('button', { name: /仓库与工作区/ }))
    const theirs = await within(drawer).findByTestId('rw-bot-b2')
    fireEvent.click(within(theirs).getByRole('button', { name: '重新检查' }))
    await waitFor(() => expect(calls.some((c) => c.path === '/groups/g1/bots/b2/recheck')).toBe(true))
  })

  it('locks repo binding for non-admins', async () => {
    mockApi(baseRoutes([group({ members: [{ userId: 'u1', name: '王磊', isAdmin: false }] })]))
    renderAt('/g/g1')
    const main = screen.getByRole('main')
    fireEvent.click(await within(main).findByRole('button', { name: '群设置' }))
    const drawer = await screen.findByRole('complementary', { name: '群设置' })
    expect(
      within(drawer)
        .getByRole('button', { name: /仓库与基准分支/ })
        .hasAttribute('disabled'),
    ).toBe(true)
  })
})
