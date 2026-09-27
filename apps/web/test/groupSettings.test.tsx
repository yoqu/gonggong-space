import type { BotDto, GroupDto, RunDto, Tier, UserDto } from '@gonggong/protocol'
import { fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import { MemoryRouter } from 'react-router'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { App } from '../src/App'
import { useSession } from '../src/app/session'
import { useWorkspace } from '../src/app/workspace'
import { apiError, mockApi } from './mockApi'

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
  name: '支付服务重构',
  kind: 'group',
  mode: 'partition',
  notice: '',
  noticeHidden: false,
  repo: { url: 'git@git.corp:pay/pay-server.git', branch: 'main' },
  members: [
    { userId: 'u1', name: '王磊', isAdmin: true },
    { userId: 'u2', name: '李建国', isAdmin: false },
  ],
  botIds: ['b1', 'b2'],
  unread: 0,
  lastSeq: 1,
  last: '',
  pinned: false,
  muted: false,
  foldRuns: false,
  liveRunIds: [],
  ...o,
})

const bot = (o: Partial<BotDto>): BotDto => ({
  id: 'b1',
  name: '小王的 Claude',
  ownerId: 'u1',
  ownerName: '王磊',
  agentKind: 'claude',
  avatar: null,
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
  groupCount: 1,
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
  bot({ id: 'b2', name: '老李的 Codex', ownerId: 'u2', ownerName: '李建国', agentKind: 'codex' }),
  bot({ id: 'b3', name: '小周的 Codex', ownerId: 'u4', ownerName: '周婷', agentKind: 'codex' }),
]
const users = [
  { id: 'u1', name: '王磊', account: 'wanglei' },
  { id: 'u2', name: '李建国', account: 'lijg' },
  { id: 'u3', name: '赵敏', account: 'zhaomin' },
]
const params = { approvalTimeoutMin: 30, chainMaxHops: 3, offlineWaitMin: 30 }

const at = '2026-09-23T02:21:00.000Z'
const run = (o: Partial<RunDto>): RunDto => ({
  id: 'r1',
  groupId: 'g1',
  botId: 'b1',
  triggerMessageId: 'm1',
  triggerUserId: 'u1',
  hop: 1,
  status: 'completed',
  step: '已回复',
  filesChanged: 1,
  usage: null,
  newSessionReason: null,
  queuedAt: at,
  startedAt: at,
  endedAt: at,
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
  ...o,
})
const message = {
  id: 'm1',
  seq: 1,
  groupId: 'g1',
  kind: 'user',
  authorId: 'u1',
  authorName: '王磊',
  body: '@小王的 Claude 干活',
  mentions: ['b1'],
  runId: null,
  createdAt: at,
  attachments: [],
  quote: null,
}

class FakeSocket {
  onopen: (() => void) | null = null
  onmessage: ((e: { data: string }) => void) | null = null
  onclose: (() => void) | null = null
  close() {}
}

const routes = (groups: GroupDto[], extra: Record<string, unknown> = {}) => ({
  'GET /groups': groups,
  'GET /users': users,
  'GET /bots': bots,
  'GET /machines': [],
  'GET /notifications': [],
  'GET /groups/g1/timeline?limit=50': { messages: [], runs: [] },
  'GET /groups/g1/bot-states': [],
  'GET /groups/g1/params': params,
  'POST /groups/g1/read': groups[0],
  ...extra,
})

function renderAt(path: string) {
  return render(
    <MemoryRouter initialEntries={[path]}>
      <App />
    </MemoryRouter>,
  )
}

async function openDrawer() {
  const main = screen.getByRole('main')
  fireEvent.click(await within(main).findByRole('button', { name: '群设置' }))
  return screen.findByRole('complementary', { name: '群设置' })
}

beforeEach(() => {
  Object.defineProperty(window, 'innerWidth', { configurable: true, value: 1440 })
  vi.stubGlobal('WebSocket', FakeSocket)
  useSession.setState({ user: me, status: 'ready' })
  useWorkspace.setState({ groups: [], bots: [], machines: [], activeGroupId: null })
})
afterEach(() => vi.unstubAllGlobals())

describe('group settings inspector', () => {
  it('shows an admin the group card, members, bots, switches and management rows', async () => {
    mockApi(routes([group()]))
    renderAt('/g/g1')
    const d = await openDrawer()
    expect(within(d).getByText('git@git.corp:pay/pay-server.git · main')).toBeTruthy()
    expect(within(within(d).getByRole('region', { name: '群成员' })).getByText('2')).toBeTruthy()
    expect(within(d).getByRole('button', { name: /^Bot.*2 个$/ })).toBeTruthy()
    expect(within(d).getByRole('switch', { name: /消息免打扰/ })).toBeTruthy()
    expect(within(d).getByText('普通消息不提醒；@我、我的 Bot 待审批、向我提问、锁轮到我仍提醒')).toBeTruthy()
    expect(within(d).getByText('只对我生效，审批与提问卡片始终展开')).toBeTruthy()
    expect(within(d).getByText('你是群管理员')).toBeTruthy()
    expect(await within(d).findByRole('button', { name: /群级参数\s*审批 30 分 · 接力 3 跳/ })).toBeTruthy()
    expect(within(d).getByRole('button', { name: '退出群' })).toBeTruthy()
    expect(within(d).getByRole('button', { name: '解散群' })).toBeTruthy()
  })

  it('shows the group avatar as a member mosaic in the list, header and inspector', async () => {
    mockApi(routes([group()]))
    renderAt('/g/g1')
    const d = await openDrawer()
    // People show a character; bots (b1, b2) show their SVG art.
    const tiles = (el: Element) =>
      [...el.querySelectorAll('.ui-avatar__tile')].map(
        (t) => t.textContent || t.querySelector('image')?.tagName,
      )
    const want = ['磊', '国', 'image', 'image']
    expect(tiles(screen.getByTestId('group-item-g1'))).toEqual(want)
    expect(tiles(screen.getByRole('main').querySelector('.pn-chathead') as Element)).toEqual(want)
    expect(tiles(d.querySelector('.pn-info__id') as Element)).toEqual(want)
  })

  it('locks management rows for plain members and hides dissolving', async () => {
    mockApi(
      routes([
        group({
          members: [
            { userId: 'u2', name: '李建国', isAdmin: true },
            { userId: 'u1', name: '王磊', isAdmin: false },
          ],
        }),
      ]),
    )
    renderAt('/g/g1')
    const d = await openDrawer()
    expect(within(d).getByText('仅群管理员 · 李建国')).toBeTruthy()
    for (const name of [/群名称与公告/, /仓库与基准分支/, /同步模式/, /群级参数/])
      expect(within(d).getByRole('button', { name }).hasAttribute('disabled')).toBe(true)
    expect(within(d).queryByRole('button', { name: '解散群' })).toBeNull()
  })

  it('edits the name and notice, then shows the notice bar', async () => {
    const calls = mockApi(
      routes([group()], {
        'PATCH /groups/g1': (b: unknown) => group(b as Partial<GroupDto>),
      }),
    )
    renderAt('/g/g1')
    const d = await openDrawer()
    fireEvent.click(within(d).getByRole('button', { name: /群名称与公告/ }))
    const info = await screen.findByRole('complementary', { name: '群设置' })
    fireEvent.change(within(info).getByLabelText('群名称'), { target: { value: '设置后' } })
    fireEvent.change(within(info).getByLabelText(/群公告/), { target: { value: '每个 Bot 独立分支，走 PR' } })
    fireEvent.click(within(info).getByRole('button', { name: '保存' }))
    await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull())
    expect(calls.find((c) => c.method === 'PATCH')?.body).toEqual({
      name: '设置后',
      notice: '每个 Bot 独立分支，走 PR',
    })
    expect((await screen.findByTestId('group-notice')).textContent).toContain('每个 Bot 独立分支，走 PR')
    expect(screen.getByRole('heading', { name: '设置后' })).toBeTruthy()
  })

  it('lets an admin remove the notice for everyone after confirming', async () => {
    const calls = mockApi(
      routes([group({ notice: '走 PR' })], { 'DELETE /groups/g1/notice': group({ notice: '' }) }),
    )
    renderAt('/g/g1')
    const bar = await screen.findByTestId('group-notice')
    fireEvent.click(within(bar).getByRole('button', { name: '移除' }))
    const dialog = await screen.findByRole('dialog', { name: '移除群公告' })
    fireEvent.click(within(dialog).getByRole('button', { name: '移除' }))
    await waitFor(() => expect(screen.queryByTestId('group-notice')).toBeNull())
    expect(calls.some((c) => c.method === 'DELETE' && c.path === '/groups/g1/notice')).toBe(true)
  })

  it('lets a member hide the notice for themselves and bring it back from the history', async () => {
    const member = {
      members: [
        { userId: 'u2', name: '李建国', isAdmin: true },
        { userId: 'u1', name: '王磊', isAdmin: false },
      ],
    }
    const calls = mockApi(
      routes([group({ ...member, notice: '走 PR' })], {
        'PUT /groups/g1/prefs': (b: unknown) => group({ ...member, notice: '走 PR', ...(b as object) }),
        'GET /groups/g1/notices': [
          { id: 'n2', body: '走 PR', authorName: '李建国', createdAt: at, removedAt: null },
          { id: 'n1', body: '旧公告', authorName: '李建国', createdAt: at, removedAt: at },
        ],
      }),
    )
    renderAt('/g/g1')
    const bar = await screen.findByTestId('group-notice')
    fireEvent.click(within(bar).getByRole('button', { name: '不再显示' }))
    await waitFor(() => expect(screen.queryByTestId('group-notice')).toBeNull())
    expect(calls.find((c) => c.method === 'PUT')?.body).toEqual({ noticeHidden: true })

    const d = await openDrawer()
    fireEvent.click(within(d).getByRole('button', { name: /^群公告/ }))
    const view = await screen.findByRole('complementary', { name: '群设置' })
    expect(await within(view).findByText('旧公告')).toBeTruthy()
    fireEvent.click(within(view).getByRole('button', { name: '在对话顶部显示' }))
    expect(await screen.findByTestId('group-notice')).toBeTruthy()
    expect(calls.filter((c) => c.method === 'PUT').at(-1)?.body).toEqual({ noticeHidden: false })
  })

  it('toggles personal prefs; pinned groups sort first and muted badges turn grey', async () => {
    const other = group({ id: 'g0', name: '官网改版', unread: 2 })
    const calls = mockApi(
      routes([other, group()], {
        'PUT /groups/g1/prefs': (b: unknown) => group(b as Partial<GroupDto>),
        'PUT /groups/g0/prefs': (b: unknown) => ({ ...other, ...(b as object) }),
      }),
    )
    renderAt('/g/g1')
    const d = await openDrawer()
    fireEvent.click(within(d).getByRole('switch', { name: '置顶群' }))
    const nav = screen.getByRole('navigation', { name: '会话列表' })
    await waitFor(() =>
      expect(within(screen.getByTestId('group-item-g1')).getByLabelText('已置顶')).toBeTruthy(),
    )
    const items = within(nav).getAllByTestId(/^group-item-/)
    expect(items.map((i) => i.dataset.testid)).toEqual(['group-item-g1', 'group-item-g0'])
    expect(calls.find((c) => c.method === 'PUT')?.body).toEqual({ pinned: true })

    useWorkspace.getState().applyEvent({ t: 'group.updated', group: { ...other, muted: true } })
    const badge = await within(screen.getByTestId('group-item-g0')).findByText('2')
    expect(badge.className).toContain('ui-badge--muted')
  })

  it('asks before dissolving, then drops the group', async () => {
    const calls = mockApi(routes([group()], { 'POST /groups/g1/dissolve': { ok: true } }))
    renderAt('/g/g1')
    const d = await openDrawer()
    fireEvent.click(within(d).getByRole('button', { name: '解散群' }))
    expect(within(d).getByText(/解散后群归档，消息与审计记录保留/)).toBeTruthy()
    fireEvent.click(within(d).getByRole('button', { name: '确认解散' }))
    await waitFor(() => expect(screen.queryByTestId('group-item-g1')).toBeNull())
    expect(calls.some((c) => c.method === 'POST' && c.path === '/groups/g1/dissolve')).toBe(true)
  })

  it('calls a DM deletion 删除私聊 and offers no leaving', async () => {
    mockApi(
      routes([
        group({ kind: 'dm', name: '脚本实验', members: [{ userId: 'u1', name: '王磊', isAdmin: true }] }),
      ]),
    )
    renderAt('/g/g1')
    fireEvent.click(await within(screen.getByRole('main')).findByRole('button', { name: '群设置' }))
    const d = await screen.findByRole('complementary', { name: '私聊设置' })
    expect(within(d).queryByRole('region', { name: '群成员' })).toBeNull()
    expect(within(d).queryByRole('button', { name: '退出群' })).toBeNull()
    fireEvent.click(within(d).getByRole('button', { name: '删除私聊' }))
    expect(within(d).getByRole('button', { name: '确认删除' })).toBeTruthy()
  })

  it('a member confirms leaving', async () => {
    const calls = mockApi(
      routes(
        [
          group({
            members: [
              { userId: 'u2', name: '李建国', isAdmin: true },
              { userId: 'u1', name: '王磊', isAdmin: false },
            ],
          }),
        ],
        {
          'POST /groups/g1/leave': { ok: true },
        },
      ),
    )
    renderAt('/g/g1')
    const d = await openDrawer()
    fireEvent.click(within(d).getByRole('button', { name: '退出群' }))
    expect(within(d).getByText(/退出后你的 Bot 一并移出本群/)).toBeTruthy()
    fireEvent.click(within(d).getByRole('button', { name: '确认退出' }))
    await waitFor(() => expect(screen.queryByTestId('group-item-g1')).toBeNull())
    expect(calls.some((c) => c.path === '/groups/g1/leave')).toBe(true)
  })

  it('the only admin is sent to 群成员 to appoint a successor', async () => {
    const calls = mockApi(
      routes([group()], {
        'POST /groups/g1/admins/u2': group({
          members: [
            { userId: 'u1', name: '王磊', isAdmin: true },
            { userId: 'u2', name: '李建国', isAdmin: true },
          ],
        }),
      }),
    )
    renderAt('/g/g1')
    const d = await openDrawer()
    fireEvent.click(within(d).getByRole('button', { name: '退出群' }))
    expect(within(d).getByText('你是唯一的群管理员，退出前先在「群成员」里指定其他群管理员。')).toBeTruthy()
    fireEvent.click(within(d).getByRole('button', { name: '退出群' }))
    expect(await within(d).findByRole('heading', { name: '群成员 · 2' })).toBeTruthy()
    const li = within(d).getByTestId('member-u2')
    expect(within(li).getByText('带入 老李的 Codex')).toBeTruthy()
    fireEvent.click(within(li).getByRole('button', { name: '设为管理员' }))
    await waitFor(() => expect(within(within(d).getByTestId('member-u2')).getByText('群管理员')).toBeTruthy())
    expect(calls.some((c) => c.method === 'POST' && c.path === '/groups/g1/admins/u2')).toBe(true)
    expect(within(d).queryByTestId('member-u1')?.querySelector('button')).toBeNull()
  })

  it('adds members and pulls in bots from the sub-views', async () => {
    const calls = mockApi(
      routes([group()], {
        'POST /groups/g1/members': group(),
        'POST /groups/g1/bots': group(),
      }),
    )
    renderAt('/g/g1')
    const d = await openDrawer()
    fireEvent.click(within(d).getByRole('button', { name: '查看全部' }))
    fireEvent.click(within(d).getByRole('button', { name: '添加成员' }))
    fireEvent.click(await within(d).findByRole('button', { name: '赵敏' }))
    await waitFor(() =>
      expect(calls.find((c) => c.path === '/groups/g1/members')?.body).toEqual({ userId: 'u3' }),
    )

    fireEvent.click(within(d).getByRole('button', { name: '返回' }))
    fireEvent.click(within(d).getByRole('button', { name: /^Bot/ }))
    fireEvent.click(within(d).getByRole('button', { name: '拉入 Bot' }))
    const cand = within(d).getByRole('button', { name: /小周的 Codex/ })
    expect(cand.textContent).toContain('主人将一并加入')
    fireEvent.click(cand)
    await waitFor(() =>
      expect(calls.find((c) => c.path === '/groups/g1/bots')?.body).toEqual({ botId: 'b3' }),
    )
  })

  it('the 添加 tile opens 群成员 with the candidates already listed', async () => {
    mockApi(routes([group()]))
    renderAt('/g/g1')
    const d = await openDrawer()
    fireEvent.click(within(d).getByRole('button', { name: '添加' }))
    expect(await within(d).findByRole('heading', { name: '群成员 · 2' })).toBeTruthy()
    expect(await within(d).findByRole('button', { name: '赵敏' })).toBeTruthy()
    fireEvent.click(within(d).getByRole('button', { name: '返回' }))
    expect(within(d).getByRole('heading', { name: '群设置' })).toBeTruthy()
  })

  it('hides leaving when I am the only member; dissolving stays in the danger zone', async () => {
    mockApi(routes([group({ members: [{ userId: 'u1', name: '王磊', isAdmin: true }] })]))
    renderAt('/g/g1')
    const d = await openDrawer()
    expect(within(d).queryByRole('button', { name: '退出群' })).toBeNull()
    const dissolve = within(d).getByRole('button', { name: '解散群' })
    expect(dissolve.closest('.pn-info__group--danger')).toBeTruthy()
  })

  it('confirms removing a member, blocks double submits and reports success', async () => {
    const calls = mockApi(
      routes([group()], {
        'DELETE /groups/g1/members/u2': group({ members: [{ userId: 'u1', name: '王磊', isAdmin: true }] }),
      }),
    )
    renderAt('/g/g1')
    const d = await openDrawer()
    fireEvent.click(within(d).getByRole('button', { name: '查看全部' }))
    fireEvent.click(within(within(d).getByTestId('member-u2')).getByRole('button', { name: '移出' }))
    expect(calls.some((c) => c.method === 'DELETE')).toBe(false)
    const confirm = await screen.findByRole('dialog', { name: '移出成员 李建国' })
    expect(confirm.textContent).toContain('其 Bot 一并移出')
    const ok = within(confirm).getByRole('button', { name: '移出' })
    fireEvent.click(ok)
    fireEvent.click(ok)
    expect(await screen.findByText('已移出 李建国')).toBeTruthy()
    expect(calls.filter((c) => c.method === 'DELETE')).toHaveLength(1)
    await waitFor(() => expect(screen.queryByRole('dialog', { name: '移出成员 李建国' })).toBeNull())
  })

  it('confirms removing a bot and reports success', async () => {
    const calls = mockApi(routes([group()], { 'DELETE /groups/g1/bots/b2': group({ botIds: ['b1'] }) }))
    renderAt('/g/g1')
    const d = await openDrawer()
    fireEvent.click(within(d).getByRole('button', { name: /^Bot/ }))
    const row = within(d).getByText('老李的 Codex').closest('.gs-bot') as HTMLElement
    fireEvent.click(within(row).getByRole('button', { name: '移出' }))
    const confirm = await screen.findByRole('dialog', { name: '移出 Bot 老李的 Codex' })
    fireEvent.click(within(confirm).getByRole('button', { name: '移出' }))
    expect(await screen.findByText('已移出 老李的 Codex')).toBeTruthy()
    expect(calls.find((c) => c.method === 'DELETE')?.path).toBe('/groups/g1/bots/b2')
  })

  it('flips a pref at once and rolls it back when saving fails', async () => {
    mockApi(routes([group()], { 'PUT /groups/g1/prefs': () => apiError(500, 'internal', '保存失败') }))
    renderAt('/g/g1')
    const d = await openDrawer()
    const pin = within(d).getByRole('switch', { name: '置顶群' }) as HTMLInputElement
    fireEvent.click(pin)
    expect(pin.checked).toBe(true)
    expect(pin.disabled).toBe(true)
    await waitFor(() => expect(pin.disabled).toBe(false))
    expect(pin.checked).toBe(false)
    expect(await screen.findByText('保存失败')).toBeTruthy()
  })

  it('shows failed loads inline with a retry', async () => {
    let fail = true
    mockApi(
      routes([group()], {
        'GET /groups/g1/params': () => (fail ? apiError(500, 'internal', 'boom') : params),
        'GET /users': () => (fail ? apiError(500, 'internal', 'boom') : users),
      }),
    )
    renderAt('/g/g1')
    const d = await openDrawer()
    expect(await within(d).findByText('群级参数加载失败')).toBeTruthy()
    fail = false
    fireEvent.click(within(d).getByRole('button', { name: '重试' }))
    expect(await within(d).findByRole('button', { name: /群级参数\s*审批 30 分 · 接力 3 跳/ })).toBeTruthy()

    fail = true
    fireEvent.click(within(d).getByRole('button', { name: '查看全部' }))
    fireEvent.click(within(d).getByRole('button', { name: '添加成员' }))
    expect(await within(d).findByText('成员列表加载失败')).toBeTruthy()
    fail = false
    fireEvent.click(within(d).getByRole('button', { name: '重试' }))
    expect(await within(d).findByRole('button', { name: '赵敏' })).toBeTruthy()
  })

  it("lets a bot owner set this group's tier; others only read the effective one", async () => {
    const mine = bot({ id: 'b2', name: '小王的 Codex', agentKind: 'codex' })
    const state = (botId: string, tier: Tier | null) => ({
      botId,
      workspace: 'managed',
      state: 'ready',
      path: null,
      git: null,
      error: null,
      tier,
    })
    const calls = mockApi(
      routes([group({ botIds: ['b1', 'b2', 'b3'] })], {
        'GET /bots': [...bots.slice(0, 1), mine, bots[2]],
        'GET /groups/g1/bot-states': [state('b3', 'read-only')],
        'PUT /groups/g1/bots/b2/tier': () => undefined,
      }),
    )
    renderAt('/g/g1')
    const d = await openDrawer()
    fireEvent.click(within(d).getByRole('button', { name: /^Bot/ }))
    const row = (name: string) => within(d).getByText(name).closest('.gs-bot') as HTMLElement
    expect(within(row('小周的 Codex')).queryByRole('button', { name: '本群档位' })).toBeNull()
    await waitFor(() => expect(row('小周的 Codex').textContent).toContain('档位 只读 · 本群'))

    fireEvent.click(within(row('小王的 Codex')).getByRole('button', { name: '本群档位' }))
    fireEvent.click(await screen.findByRole('menuitemcheckbox', { name: '完全访问' }))
    await waitFor(() =>
      expect(calls.find((c) => c.method === 'PUT' && c.path.endsWith('/bots/b2/tier'))?.body).toEqual({
        tier: 'full',
      }),
    )

    fireEvent.click(within(row('小王的 Codex')).getByRole('button', { name: '全局设置' }))
    const detail = await screen.findByRole('complementary', { name: 'Bot 详情' })
    expect(within(detail).getByRole('radio', { name: '工作区写入' })).toBeTruthy()
  })
})

describe('group settings dialog', () => {
  it('edits only the P1 group params', async () => {
    const calls = mockApi(routes([group()], { 'PUT /groups/g1/params': (b: unknown) => b }))
    renderAt('/g/g1')
    const d = await openDrawer()
    fireEvent.click(await within(d).findByRole('button', { name: /群级参数/ }))
    const dlg = await screen.findByRole('dialog', { name: '群级参数 · 支付服务重构' })
    expect(within(dlg).queryByText(/\/hold/)).toBeNull()
    const hops = (await within(dlg).findByLabelText('接力链长上限（跳）')) as HTMLInputElement
    expect(hops.value).toBe('3')
    expect((within(dlg).getByLabelText('权限审批等待 · 分区（分钟）') as HTMLInputElement).value).toBe('30')
    expect((within(dlg).getByLabelText('Bot 离线等待上线（分钟）') as HTMLInputElement).value).toBe('30')
    fireEvent.change(hops, { target: { value: '1' } })
    fireEvent.blur(hops)
    fireEvent.click(within(dlg).getByRole('button', { name: '保存' }))
    await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull())
    expect(calls.find((c) => c.method === 'PUT')?.body).toEqual({ ...params, chainMaxHops: 1 })
  })

  it('reports invalid params and keeps the dialog open', async () => {
    mockApi(
      routes([group()], { 'PUT /groups/g1/params': () => apiError(400, 'invalid', '参数超出允许范围') }),
    )
    renderAt('/g/g1')
    fireEvent.click(await within(await openDrawer()).findByRole('button', { name: /群级参数/ }))
    const dlg = await screen.findByRole('dialog', { name: '群级参数 · 支付服务重构' })
    const hops = await within(dlg).findByLabelText('接力链长上限（跳）')
    fireEvent.change(hops, { target: { value: '0' } })
    fireEvent.blur(hops)
    expect(within(dlg).getByRole('button', { name: '保存' }).hasAttribute('disabled')).toBe(true)
    fireEvent.change(hops, { target: { value: '11' } })
    fireEvent.blur(hops)
    expect(within(dlg).getByRole('button', { name: '保存' }).hasAttribute('disabled')).toBe(true)
    fireEvent.change(hops, { target: { value: '5' } })
    fireEvent.blur(hops)
    fireEvent.click(within(dlg).getByRole('button', { name: '保存' }))
    expect(await screen.findByText('参数超出允许范围')).toBeTruthy()
    expect(screen.getByRole('dialog', { name: '群级参数 · 支付服务重构' })).toBeTruthy()
  })

  it('shows the sync mode as partition with forced sync not yet available', async () => {
    mockApi(routes([group()]))
    renderAt('/g/g1')
    fireEvent.click(within(await openDrawer()).getByRole('button', { name: /同步模式/ }))
    const dlg = await screen.findByRole('dialog', { name: '同步模式 · 支付服务重构' })
    expect(within(dlg).getAllByText('分区模式').length).toBeGreaterThan(0)
    expect(within(dlg).getByRole('button', { name: '切换到强制同步' }).hasAttribute('disabled')).toBe(true)
    expect(within(dlg).getByText('强制同步暂未开放')).toBeTruthy()
    fireEvent.click(within(dlg).getByRole('button', { name: '群级参数' }))
    expect(await screen.findByRole('dialog', { name: '群级参数 · 支付服务重构' })).toBeTruthy()
  })
})

describe('run cards folded by default', () => {
  it('folds finished cards for me but keeps approval cards open', async () => {
    mockApi(
      routes([group({ foldRuns: true })], {
        'GET /groups/g1/timeline?limit=50': {
          messages: [message],
          runs: [
            run({}),
            run({
              id: 'r2',
              botId: 'b2',
              status: 'awaiting_approval',
              step: '等待审批',
              queuedAt: '2026-09-23T02:22:00.000Z',
            }),
          ],
        },
      }),
    )
    renderAt('/g/g1')
    const cards = await screen.findAllByTestId('run-card')
    expect(cards).toHaveLength(2)
    expect(within(cards[0]!).queryByText('改动 1 个文件')).toBeNull()
    expect(within(cards[1]!).getByText('改动 1 个文件')).toBeTruthy()
    const toggle = within(cards[0]!).getByRole('button', { name: '展开' })
    expect(toggle.getAttribute('aria-expanded')).toBe('false')
    fireEvent.click(toggle)
    expect(within(cards[0]!).getByText('改动 1 个文件')).toBeTruthy()
    const body = cards[0]!.querySelector('.run-card__body') as HTMLElement
    expect(body.dataset.state).toBe('open')
    expect(body.hasAttribute('inert')).toBe(false)
    expect(cards[1]!.querySelector('.run-card__body')?.hasAttribute('data-state')).toBe(false)

    fireEvent.click(within(cards[0]!).getByRole('button', { name: '收起' }))
    expect(within(cards[0]!).getByRole('button', { name: '展开' }).getAttribute('aria-expanded')).toBe(
      'false',
    )
    expect(body.dataset.state).toBe('closed')
    expect(body.hasAttribute('inert')).toBe(true)
    fireEvent.animationEnd(body)
    expect(within(cards[0]!).queryByText('改动 1 个文件')).toBeNull()
  })
})
