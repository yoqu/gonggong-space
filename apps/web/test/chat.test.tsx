import type { BotDto, GroupDto, MessageDto, RunDto, UserDto, WebEvent } from '@aiws/protocol'
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
}

const group = (o: Partial<GroupDto> = {}): GroupDto => ({
  id: 'g1',
  name: '退款 v2 迁移',
  kind: 'group',
  mode: 'partition',
  notice: '周五前合入 v2',
  repo: { url: 'git@git.corp:pay/refund.git', branch: 'main' },
  members: [
    { userId: 'u1', name: '王磊', isAdmin: true },
    { userId: 'u2', name: '李建国', isAdmin: false },
  ],
  botIds: ['b1', 'b2'],
  unread: 0,
  lastSeq: 4,
  last: '',
  ...o,
})

const users = [
  { id: 'u1', name: '王磊', account: 'wanglei' },
  { id: 'u2', name: '李建国', account: 'lijg' },
  { id: 'u3', name: '赵敏', account: 'zhaomin' },
]

const bot = (o: Partial<BotDto>): BotDto => ({
  id: 'b1',
  name: '小王的 Claude',
  ownerId: 'u1',
  ownerName: '王磊',
  agentKind: 'claude',
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
  groupCount: 0,
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
  queuedAt: at,
  startedAt: at,
  endedAt: null,
  ...o,
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
    expect(row.textContent).toContain('分区模式')
    expect(row.textContent).toContain('李建国：好的')
    expect(within(row).getByText('3')).toBeTruthy()
    expect(within(nav).getByRole('link', { name: /脚本实验/ })).toBeTruthy()
  })
})

describe('new group dialog', () => {
  it('creates a repo-less DM with my bound bot and opens it', async () => {
    const created = group({ id: 'd9', kind: 'dm', name: '脚本实验', repo: null, botIds: ['b1'], members: [] })
    const calls = mockApi({
      ...baseRoutes([]),
      'POST /groups': () => created,
      'GET /groups/d9/timeline': () => ({ messages: [], runs: [] }),
      'POST /groups/d9/read': () => created,
    })
    renderAt('/')
    fireEvent.click(screen.getByRole('button', { name: '新建私聊' }))
    const dialog = await screen.findByRole('dialog', { name: '新建私聊' })
    expect(within(dialog).getByRole('tab', { name: '私聊' }).getAttribute('aria-selected')).toBe('true')
    await within(dialog).findByRole('button', { name: /小王的 Claude/ })
    expect(within(dialog).queryByRole('button', { name: /老李的 Codex/ })).toBeNull()
    expect(
      within(dialog)
        .getByRole('button', { name: /小王的 Codex/ })
        .hasAttribute('disabled'),
    ).toBe(true)

    const create = within(dialog).getByRole('button', { name: '创建' })
    expect(create.hasAttribute('disabled')).toBe(true)
    fireEvent.change(within(dialog).getByLabelText('名称'), { target: { value: '脚本实验' } })
    expect(create.hasAttribute('disabled')).toBe(true)
    fireEvent.click(within(dialog).getByRole('tab', { name: '暂不绑定' }))
    fireEvent.click(within(dialog).getByRole('button', { name: /小王的 Claude/ }))
    expect(create.hasAttribute('disabled')).toBe(false)
    fireEvent.click(create)

    expect(await screen.findByRole('heading', { name: '脚本实验' })).toBeTruthy()
    expect(calls.find((c) => c.method === 'POST' && c.path === '/groups')?.body).toEqual({
      name: '脚本实验',
      kind: 'dm',
      memberIds: [],
      botIds: ['b1'],
      repo: null,
    })
  })

  it('requires a validated repo and auto-adds bot owners as members', async () => {
    const calls = mockApi({
      ...baseRoutes([]),
      'POST /groups/validate-repo': () => ({ ok: true, message: '地址格式正确' }),
      'POST /groups': () => group({ id: 'g7' }),
    })
    renderAt('/')
    fireEvent.click(screen.getByRole('button', { name: '新建群' }))
    const dialog = await screen.findByRole('dialog', { name: '新建群' })
    fireEvent.change(within(dialog).getByLabelText('名称'), { target: { value: '退款' } })
    const create = within(dialog).getByRole('button', { name: '创建' })
    expect(create.hasAttribute('disabled')).toBe(true)
    expect(within(dialog).getByText('先校验仓库地址')).toBeTruthy()

    fireEvent.change(within(dialog).getByLabelText('仓库地址'), {
      target: { value: 'git@git.corp:pay/refund.git' },
    })
    fireEvent.click(within(dialog).getByRole('button', { name: '校验' }))
    expect(await within(dialog).findByText('地址格式正确')).toBeTruthy()
    expect(create.hasAttribute('disabled')).toBe(false)

    fireEvent.click(await within(dialog).findByRole('button', { name: /老李的 Codex/ }))
    const people = within(dialog).getByRole('group', { name: '成员' })
    expect(within(people).getByRole('button', { name: /李建国/ }).textContent).toContain('bot 主人')
    fireEvent.click(within(people).getByRole('button', { name: /赵敏/ }))
    fireEvent.click(create)
    await waitFor(() => expect(calls.some((c) => c.path === '/groups' && c.method === 'POST')).toBe(true))
    expect(calls.find((c) => c.path === '/groups' && c.method === 'POST')?.body).toMatchObject({
      kind: 'group',
      memberIds: ['u3'],
      botIds: ['b2'],
      repo: { url: 'git@git.corp:pay/refund.git', branch: 'main' },
    })
  })
})

describe('chat view', () => {
  it('renders events, messages, markdown replies and run cards', async () => {
    const calls = mockApi(baseRoutes([group()]))
    renderAt('/g/g1')
    const main = screen.getByRole('main')
    expect(await within(main).findByRole('heading', { name: '退款 v2 迁移' })).toBeTruthy()
    expect(within(main).getByText('git@git.corp:pay/refund.git · main')).toBeTruthy()
    expect(within(main).getByText('周五前合入 v2')).toBeTruthy()

    expect(await within(main).findByText('王磊 创建了群 · 成为群管理员')).toBeTruthy()
    expect(within(main).getByText('@小王的 Claude').className).toContain('mention')
    expect(within(main).getByText('最终回复')).toBeTruthy()
    expect(within(main).getByRole('cell', { name: '分' })).toBeTruthy()
    expect(within(main).getByRole('button', { name: '复制' })).toBeTruthy()

    const card = within(main).getByTestId('run-card')
    expect(card.textContent).toContain('小王的 Claude')
    expect(card.textContent).toContain('Claude Code · 王磊 触发')
    expect(card.textContent).toContain('运行中')
    expect(card.textContent).toContain('读取 server/refund.go')
    expect(card.textContent).toContain('改动 2 个文件')
    expect(card.textContent).toContain('1.5k tokens')
    await waitFor(() => expect(calls.some((c) => c.path === '/groups/g1/read')).toBe(true))

    push({ t: 'run.delta', runId: 'r1', text: '正在对比 v1 与 v2 ' })
    push({ t: 'run.delta', runId: 'r1', text: '的字段' })
    expect(card.textContent).toContain('正在对比 v1 与 v2 的字段')
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
      state: { botId: 'b1', workspace: 'managed', state: 'ready', git, error: null },
    })
    expect(within(main).getByTestId('git-b1').textContent).toBe('小王的 Claudemain↓1 ↑0未提交托管')
  })

  it('sends with Enter once, deduping the realtime echo, and suggests @ candidates', async () => {
    const sent = msg({ id: 'm10', seq: 10, body: '@小王的 Claude 跑一下', mentions: ['b1'] })
    const calls = mockApi({ ...baseRoutes([group()]), 'POST /groups/g1/messages': () => sent })
    renderAt('/g/g1')
    await screen.findByText('最终回复')
    const box = screen.getByPlaceholderText(
      '输入消息，@ 触发 bot 或引用文件，/ 查看命令',
    ) as HTMLTextAreaElement

    fireEvent.change(box, { target: { value: '@', selectionStart: 1 } })
    const list = screen.getByRole('listbox', { name: '@ 候选' })
    expect(within(list).getByRole('option', { name: /老李的 Codex/ })).toBeTruthy()
    expect(
      within(within(list).getByRole('group', { name: '成员' })).getByRole('option', { name: /李建国/ }),
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
    mockApi(baseRoutes([group()]))
    renderAt('/g/g1')
    await screen.findByText('最终回复')
    const box = screen.getByPlaceholderText(
      '输入消息，@ 触发 bot 或引用文件，/ 查看命令',
    ) as HTMLTextAreaElement

    fireEvent.change(box, { target: { value: '/', selectionStart: 1 } })
    const list = screen.getByRole('listbox', { name: '/ 命令' })
    const options = within(within(list).getByRole('group', { name: '系统命令' })).getAllByRole('option')
    expect(options.map((o) => o.textContent)).toEqual([
      '/stop停止运行（未 @ bot 时停止本群全部）',
      '/hold连续占用群锁',
      '/release释放群锁',
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

  it('shows a not-found state for groups I am not in', async () => {
    mockApi(baseRoutes([]))
    renderAt('/g/zz')
    expect(await screen.findByText('群不存在或你已不在群内')).toBeTruthy()
  })
})

describe('repo validation and binding', () => {
  it('shows format, checking, failure and success states in the new group dialog', async () => {
    let answer: (v: unknown) => void = () => {}
    mockApi({
      ...baseRoutes([]),
      'POST /groups/validate-repo': () => new Promise((r) => (answer = r)),
    })
    renderAt('/')
    fireEvent.click(screen.getByRole('button', { name: '新建群' }))
    const dialog = await screen.findByRole('dialog', { name: '新建群' })
    fireEvent.change(within(dialog).getByLabelText('名称'), { target: { value: '仓库协作' } })
    const url = within(dialog).getByLabelText('仓库地址')
    fireEvent.change(url, { target: { value: 'ftp://x' } })
    expect(within(dialog).getByText('地址格式不正确，支持 git@ / https:// / ssh://')).toBeTruthy()
    expect(within(dialog).getByRole('button', { name: '校验' }).hasAttribute('disabled')).toBe(true)

    fireEvent.change(url, { target: { value: 'file:///srv/git/demo.git' } })
    fireEvent.click(within(dialog).getByRole('button', { name: '校验' }))
    expect(within(dialog).getByRole('button', { name: '校验中…' }).hasAttribute('disabled')).toBe(true)
    await act(async () => answer({ ok: false, message: '仓库可访问，但分支 main 不存在' }))
    expect(within(dialog).getByText('仓库可访问，但分支 main 不存在')).toBeTruthy()
    expect(within(dialog).getByText('先校验仓库地址')).toBeTruthy()

    fireEvent.click(within(dialog).getByRole('button', { name: '校验' }))
    await act(async () => answer({ ok: true, message: '仓库可访问 · 分支 main 存在 · 最新提交 3f2a91c' }))
    expect(within(dialog).getByRole('button', { name: '已校验' })).toBeTruthy()
    expect(within(dialog).queryByText('先校验仓库地址')).toBeNull()

    fireEvent.change(within(dialog).getByLabelText('基准分支'), { target: { value: 'dev' } })
    expect(within(dialog).queryByText(/最新提交/)).toBeNull()
    expect(within(dialog).getByRole('button', { name: '校验' })).toBeTruthy()
  })

  it('lets a group admin change the repo after validating it', async () => {
    const calls = mockApi({
      ...baseRoutes([group()]),
      'POST /groups/validate-repo': () => ({
        ok: true,
        message: '仓库可访问 · 分支 dev 存在 · 最新提交 1a2b3c4',
      }),
      'PATCH /groups/g1/repo': (body) => group({ repo: body as GroupDto['repo'] }),
    })
    renderAt('/g/g1')
    const main = screen.getByRole('main')
    fireEvent.click(await within(main).findByRole('button', { name: '仓库与基准分支' }))
    const dialog = await screen.findByRole('dialog', { name: '基本信息 · 退款 v2 迁移' })
    expect(within(dialog).getByText('git@git.corp:pay/refund.git')).toBeTruthy()
    expect(within(dialog).getByText('一期一群一仓库')).toBeTruthy()
    expect(within(dialog).getByText(/更换仓库会重建所有 bot 的托管工作区/)).toBeTruthy()

    fireEvent.click(within(dialog).getByRole('button', { name: '更换' }))
    const save = within(dialog).getByRole('button', { name: '保存' })
    expect(save.hasAttribute('disabled')).toBe(true)
    fireEvent.change(within(dialog).getByLabelText('仓库地址'), {
      target: { value: 'git@git.corp:pay/new.git' },
    })
    fireEvent.change(within(dialog).getByLabelText('基准分支'), { target: { value: 'dev' } })
    fireEvent.click(within(dialog).getByRole('button', { name: '校验' }))
    expect(await within(dialog).findByText(/最新提交 1a2b3c4/)).toBeTruthy()
    fireEvent.click(save)
    await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull())
    expect(calls.find((c) => c.method === 'PATCH')?.body).toEqual({
      url: 'git@git.corp:pay/new.git',
      branch: 'dev',
    })
    expect(await within(main).findByText('git@git.corp:pay/new.git · dev')).toBeTruthy()
  })

  it('offers repo binding to admins only', async () => {
    mockApi(baseRoutes([group({ members: [{ userId: 'u1', name: '王磊', isAdmin: false }] })]))
    renderAt('/g/g1')
    const main = screen.getByRole('main')
    expect(await within(main).findByRole('heading', { name: '退款 v2 迁移' })).toBeTruthy()
    expect(within(main).queryByRole('button', { name: '仓库与基准分支' })).toBeNull()
  })
})
