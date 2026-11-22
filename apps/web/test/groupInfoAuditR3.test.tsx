import { readFileSync } from 'node:fs'
import type { BotDto, GroupDto, UserBriefDto, UserDto } from '@gonggong/protocol'
import { fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import { MemoryRouter } from 'react-router'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { App } from '../src/App'
import { useInspector } from '../src/app/inspector'
import { useSession } from '../src/app/session'
import { useWorkspace } from '../src/app/workspace'
import { BotsView, GroupInfo, MembersView } from '../src/features/groups/GroupInfo'
import { GroupNotice, RemoveNoticeDialog } from '../src/features/groups/GroupNotice'
import { MemberPicker } from '../src/features/groups/pickers'
import { Button, useToasts } from '../src/ui'
import { apiError, mockApi } from './mockApi'

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

const TOPIC = '发布前确认单测与日志'
const LONG_NOTICE = `${TOPIC}\n${'详细说明内容'.repeat(70)}`

const group = (o: Partial<GroupDto> = {}): GroupDto => ({
  id: 'g1',
  teamId: 't1',
  name: '支付服务重构',
  kind: 'group',
  mode: 'partition',
  adminOnlyInvite: false,
  protectBase: false,
  notice: LONG_NOTICE,
  noticeHidden: false,
  avatar: null,
  repo: { url: 'git@git.corp:pay/pay-server.git', branch: 'main' },
  members: [
    { userId: 'u1', name: '王磊', avatar: null, isAdmin: true },
    { userId: 'u2', name: '李建国', avatar: null, isAdmin: false },
  ],
  botIds: ['b1', 'b2'],
  unread: 0,
  lastSeq: 1,
  last: '',
  pinned: false,
  notifyLevel: 'mentions',
  foldRuns: false,
  liveRunIds: [],
  liveRuns: [],
  ...o,
})

const bot = (o: Partial<BotDto> = {}): BotDto => ({
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

const bots = [
  bot(),
  bot({ id: 'b2', name: '老李的 Codex', ownerId: 'u2', ownerName: '李建国', agentKind: 'codex' }),
]

const users: UserBriefDto[] = [
  { id: 'u1', name: '王磊', account: 'wanglei', avatar: null },
  { id: 'u2', name: '李建国', account: 'lijg', avatar: null },
  { id: 'u3', name: '赵敏', account: 'zhaomin', avatar: null },
  { id: 'u4', name: '周芳', account: 'zhoufang', avatar: null },
]

const at = '2026-09-23T02:21:00.000Z'

class FakeSocket {
  onopen: (() => void) | null = null
  onmessage: ((e: { data: string }) => void) | null = null
  onclose: (() => void) | null = null
  close() {}
}

const appRoutes = (groups: GroupDto[], extra: Record<string, unknown> = {}) => ({
  'GET /groups': groups,
  'GET /users': users,
  'GET /bots': bots,
  'GET /machines': [],
  'GET /notifications/unread': { n: 0 },
  'GET /groups/g1/timeline?limit=50': { messages: [], runs: [] },
  'GET /groups/g1/bot-states': [],
  'GET /groups/g1/params': { approvalTimeoutMin: 30, chainMaxHops: 3, offlineWaitMin: 30 },
  'GET /groups/g1/notices': [
    { id: 'n1', body: LONG_NOTICE, authorName: '王磊', createdAt: at, removedAt: null },
  ],
  'POST /groups/g1/read': groups[0],
  ...extra,
})

function renderApp(path: string) {
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
  useWorkspace.setState({ groups: [], bots, machines: [], activeGroupId: null, botStates: {}, pins: {} })
  useInspector.getState().close()
  useToasts.setState({ items: [] })
})

afterEach(() => {
  useInspector.getState().close()
  vi.unstubAllGlobals()
})

describe('R3A P1-1: GroupNotice full notice reading, topic jump and 2-line clamp', () => {
  it('opens inspector notices view when a member clicks the top notice banner', async () => {
    mockApi(appRoutes([group()]))
    renderApp('/g/g1')
    const bar = await screen.findByTestId('group-notice')
    const btn = within(bar).getByRole('button', { name: new RegExp(TOPIC) })
    expect(btn.textContent).toBe(LONG_NOTICE)
    expect(btn.getAttribute('title')).toBe(LONG_NOTICE)
    expect(btn.getAttribute('aria-expanded')).toBeNull()
    fireEvent.click(btn)

    const panel = await screen.findByRole('complementary', { name: '群设置' })
    expect(within(panel).getByRole('heading', { name: '群公告' })).toBeTruthy()
    await waitFor(() => expect(panel.querySelector('.gs-notice__body')?.textContent).toBe(LONG_NOTICE))
    expect(screen.queryByTestId('group-notice-expanded')).toBeNull()
  })

  it('toggles an inline expanded notice for readOnly viewers without opening inspector', () => {
    render(<GroupNotice group={group()} readOnly />)
    const bar = screen.getByTestId('group-notice')
    expect(within(bar).queryByRole('button', { name: '移除' })).toBeNull()
    expect(within(bar).queryByRole('button', { name: '不再显示' })).toBeNull()

    const btn = within(bar).getByRole('button', { name: new RegExp(TOPIC) })
    expect(btn.textContent).toBe(LONG_NOTICE)
    expect(btn.getAttribute('title')).toBe(LONG_NOTICE)
    expect(btn.getAttribute('aria-expanded')).toBe('false')
    expect(screen.queryByTestId('group-notice-expanded')).toBeNull()

    fireEvent.click(btn)
    expect(btn.getAttribute('aria-expanded')).toBe('true')
    const expanded = screen.getByTestId('group-notice-expanded')
    expect(expanded.textContent).toBe(LONG_NOTICE)
    expect(useInspector.getState().view).toBeNull()

    fireEvent.click(btn)
    expect(btn.getAttribute('aria-expanded')).toBe('false')
    expect(screen.queryByTestId('group-notice-expanded')).toBeNull()
  })

  it('jumps directly to the notices sub-view when clicking the header channel topic', async () => {
    mockApi(appRoutes([group({ noticeHidden: true })]))
    renderApp('/g/g1')
    const main = screen.getByRole('main')
    const topic = await within(main).findByRole('button', { name: TOPIC })
    expect(topic.getAttribute('title')).toBe(LONG_NOTICE)
    fireEvent.click(topic)

    const panel = await screen.findByRole('complementary', { name: '群设置' })
    expect(within(panel).getByRole('heading', { name: '群公告' })).toBeTruthy()
    await waitFor(() => expect(panel.querySelector('.gs-notice__body')?.textContent).toBe(LONG_NOTICE))
  })

  it('clamps the notice description to 2 lines in GroupInfo without clamping Bot chips', () => {
    mockApi({ 'GET /groups/g1/params': { approvalTimeoutMin: 30, chainMaxHops: 3, offlineWaitMin: 30 } })
    const { container } = render(
      <MemoryRouter>
        <GroupInfo group={group()} onClose={() => {}} onSettings={() => {}} />
      </MemoryRouter>,
    )
    const clamped = container.querySelector('.pn-info__rowdesc--clamp') as HTMLElement | null
    expect(clamped).toBeTruthy()
    expect(clamped?.textContent).toBe(LONG_NOTICE)
    expect(clamped?.getAttribute('title')).toBe(LONG_NOTICE)
    expect(container.querySelector('.gs-chips')?.closest('.pn-info__rowdesc--clamp')).toBeNull()

    const css = readFileSync('src/ui/im/panels.css', 'utf8')
    const start = css.indexOf('.pn-info__rowdesc--clamp {')
    expect(start).toBeGreaterThan(-1)
    const block = css.slice(start, css.indexOf('}', start))
    expect(block).toContain('-webkit-line-clamp: 2')
    expect(block).toContain('overflow: hidden')
  })
})

describe('R3A P1-4: MemberPicker loading vs search-empty vs all-in-group states', () => {
  it('shows Spinner on load, search-empty on mismatch, and all-in-group only when full', async () => {
    let resolveUsers: (v: UserBriefDto[]) => void = () => {}
    mockApi({
      'GET /users': () => new Promise<UserBriefDto[]>((r) => (resolveUsers = r)),
    })

    const { unmount } = render(<MembersView group={group()} isAdmin canInvite initialAdding={false} />)
    fireEvent.click(screen.getByRole('button', { name: '添加成员' }))
    const pop = await screen.findByRole('dialog', { name: '添加成员' })
    expect(within(pop).getByRole('status', { name: '加载中' })).toBeTruthy()
    expect(within(pop).queryByText('所有账号都已在群里')).toBeNull()
    expect(within(pop).queryByText('没有可添加的成员')).toBeNull()

    resolveUsers(users)
    expect(await within(pop).findByRole('menuitemcheckbox', { name: /赵敏/ })).toBeTruthy()
    expect(within(pop).queryByRole('status', { name: '加载中' })).toBeNull()

    const search = within(pop).getByRole('searchbox', { name: '搜索成员' })
    fireEvent.change(search, { target: { value: 'does-not-exist' } })
    expect(within(pop).getByText('没有匹配的成员')).toBeTruthy()
    expect(within(pop).queryByText('所有账号都已在群里')).toBeNull()
    expect(within(pop).queryByText('没有可添加的成员')).toBeNull()

    fireEvent.change(search, { target: { value: '' } })
    expect(within(pop).getByRole('menuitemcheckbox', { name: /周芳/ })).toBeTruthy()
    unmount()

    // When every account is already in the group, show 所有账号都已在群里.
    mockApi({ 'GET /users': users.slice(0, 2) })
    render(<MembersView group={group()} isAdmin canInvite initialAdding={false} />)
    fireEvent.click(screen.getByRole('button', { name: '添加成员' }))
    const allIn = await screen.findByRole('dialog', { name: '添加成员' })
    expect(await within(allIn).findByText('所有账号都已在群里')).toBeTruthy()
    expect(within(allIn).queryByText('没有匹配的成员')).toBeNull()
  })

  it('shows LoadError with retry when /users fails in MembersView', async () => {
    let fail = true
    mockApi({ 'GET /users': () => (fail ? apiError(500, 'internal', 'boom') : users) })
    render(<MembersView group={group()} isAdmin canInvite initialAdding={false} />)
    fireEvent.click(screen.getByRole('button', { name: '添加成员' }))
    const pop = await screen.findByRole('dialog', { name: '添加成员' })
    expect(await within(pop).findByText('成员列表加载失败')).toBeTruthy()
    expect(within(pop).queryByRole('status', { name: '加载中' })).toBeNull()
    fail = false
    fireEvent.click(within(pop).getByRole('button', { name: '重试' }))
    expect(await within(pop).findByRole('menuitemcheckbox', { name: /赵敏/ })).toBeTruthy()
  })

  it('falls back to default empty text when idle and shows search-empty over status', async () => {
    const { rerender } = render(
      <MemberPicker
        trigger={<Button size="small">添加成员</Button>}
        users={[]}
        loading
        defaultOpen
        onAdd={() => {}}
      />,
    )
    const pop = await screen.findByRole('dialog', { name: '添加成员' })
    expect(within(pop).getByRole('status', { name: '加载中' })).toBeTruthy()

    rerender(
      <MemberPicker
        trigger={<Button size="small">添加成员</Button>}
        users={[]}
        loading={false}
        defaultOpen
        onAdd={() => {}}
      />,
    )
    expect(within(pop).getByText('没有可添加的成员')).toBeTruthy()

    rerender(
      <MemberPicker
        trigger={<Button size="small">添加成员</Button>}
        users={[users[2]!]}
        status={<span>自定义空态</span>}
        defaultOpen
        onAdd={() => {}}
      />,
    )
    fireEvent.change(within(pop).getByRole('searchbox', { name: '搜索成员' }), { target: { value: 'zzz' } })
    expect(within(pop).getByText('没有匹配的成员')).toBeTruthy()
    expect(within(pop).queryByText('自定义空态')).toBeNull()
  })
})

describe('R3A P1-6: danger zone AlertDialog and busy guards', () => {
  it('confirms dissolve in a cancelable AlertDialog locked against retries and Escape', async () => {
    let finish: () => void = () => {}
    const calls = mockApi({
      'GET /groups/g1/params': { approvalTimeoutMin: 30, chainMaxHops: 3, offlineWaitMin: 30 },
      'POST /groups/g1/dissolve': () =>
        new Promise<{ ok: boolean }>((r) => {
          finish = () => r({ ok: true })
        }),
    })
    const onClose = vi.fn()
    render(
      <MemoryRouter>
        <GroupInfo group={group()} onClose={onClose} onSettings={() => {}} />
      </MemoryRouter>,
    )

    fireEvent.click(screen.getByRole('button', { name: '解散群' }))
    const first = await screen.findByRole('alertdialog', { name: '解散群「支付服务重构」？' })
    expect(within(first).getByText(/解散后群归档，消息与审计记录保留/)).toBeTruthy()
    fireEvent.click(screen.getByTestId('dialog-overlay'))
    expect(screen.getByRole('alertdialog')).toBe(first)
    fireEvent.click(within(first).getByRole('button', { name: '取消' }))
    await waitFor(() => expect(screen.queryByRole('alertdialog')).toBeNull())
    expect(calls.filter((c) => c.path === '/groups/g1/dissolve')).toHaveLength(0)

    fireEvent.click(screen.getByRole('button', { name: '解散群' }))
    const dlg = await screen.findByRole('alertdialog', { name: '解散群「支付服务重构」？' })
    const confirmBtn = within(dlg).getByRole('button', { name: '解散群' }) as HTMLButtonElement
    const cancelBtn = within(dlg).getByRole('button', { name: '取消' }) as HTMLButtonElement
    fireEvent.click(confirmBtn)
    expect(confirmBtn.disabled).toBe(true)
    expect(cancelBtn.disabled).toBe(true)
    fireEvent.click(confirmBtn)
    fireEvent.keyDown(document, { key: 'Escape' })
    expect(screen.getByRole('alertdialog')).toBe(dlg)
    expect(onClose).not.toHaveBeenCalled()
    expect(calls.filter((c) => c.path === '/groups/g1/dissolve')).toHaveLength(1)

    finish()
    await waitFor(() => expect(onClose).toHaveBeenCalledOnce())
  })

  it('shows a clear AlertDialog with 前往群成员 when the sole admin clicks 退出群', async () => {
    const calls = mockApi({
      'GET /groups/g1/params': { approvalTimeoutMin: 30, chainMaxHops: 3, offlineWaitMin: 30 },
    })
    render(
      <MemoryRouter>
        <GroupInfo group={group()} onClose={() => {}} onSettings={() => {}} />
      </MemoryRouter>,
    )

    fireEvent.click(screen.getByRole('button', { name: '退出群' }))
    const dlg = await screen.findByRole('alertdialog', { name: '先指定其他群管理员' })
    expect(within(dlg).getByText('你是唯一的群管理员，退出前先在「群成员」里指定其他群管理员。')).toBeTruthy()
    fireEvent.click(within(dlg).getByRole('button', { name: '取消' }))
    await waitFor(() => expect(screen.queryByRole('alertdialog')).toBeNull())
    expect(screen.getByRole('heading', { name: '群设置' })).toBeTruthy()

    fireEvent.click(screen.getByRole('button', { name: '退出群' }))
    const again = await screen.findByRole('alertdialog', { name: '先指定其他群管理员' })
    fireEvent.click(within(again).getByRole('button', { name: '前往群成员' }))
    expect(await screen.findByRole('heading', { name: '群成员 · 2' })).toBeTruthy()
    expect(calls.some((c) => c.path === '/groups/g1/leave')).toBe(false)
  })

  it('confirms non-admin leave and DM delete via AlertDialog', async () => {
    const calls = mockApi({
      'GET /groups/g1/params': { approvalTimeoutMin: 30, chainMaxHops: 3, offlineWaitMin: 30 },
      'POST /groups/g1/leave': { ok: true },
      'POST /groups/d1/dissolve': { ok: true },
      'GET /groups/d1/params': { approvalTimeoutMin: 30, chainMaxHops: 3, offlineWaitMin: 30 },
    })
    const plainGroup = group({
      members: [
        { userId: 'u2', name: '李建国', avatar: null, isAdmin: true },
        { userId: 'u1', name: '王磊', avatar: null, isAdmin: false },
      ],
    })
    const first = render(
      <MemoryRouter>
        <GroupInfo group={plainGroup} onClose={() => {}} onSettings={() => {}} />
      </MemoryRouter>,
    )
    fireEvent.click(screen.getByRole('button', { name: '退出群' }))
    const leaveDlg = await screen.findByRole('alertdialog', { name: '退出群「支付服务重构」？' })
    fireEvent.click(within(leaveDlg).getByRole('button', { name: '退出群' }))
    await waitFor(() => expect(calls.some((c) => c.path === '/groups/g1/leave')).toBe(true))
    first.unmount()

    const dmGroup = group({
      id: 'd1',
      kind: 'dm',
      name: '小王的 Claude',
      members: [{ userId: 'u1', name: '王磊', avatar: null, isAdmin: true }],
    })
    render(
      <MemoryRouter>
        <GroupInfo group={dmGroup} onClose={() => {}} onSettings={() => {}} />
      </MemoryRouter>,
    )
    fireEvent.click(screen.getByRole('button', { name: '删除私聊' }))
    const dmDlg = await screen.findByRole('alertdialog', { name: '删除私聊「小王的 Claude」？' })
    expect(within(dmDlg).getByText(/删除后消息与审计记录保留/)).toBeTruthy()
    fireEvent.click(within(dmDlg).getByRole('button', { name: '删除私聊' }))
    await waitFor(() => expect(calls.some((c) => c.path === '/groups/d1/dissolve')).toBe(true))
  })

  it('locks ConfirmRemove against backdrop, Escape, Cancel and double submit', async () => {
    let finish: () => void = () => {}
    const calls = mockApi({
      'DELETE /groups/g1/members/u2': () =>
        new Promise<GroupDto>((r) => {
          finish = () => r(group({ members: [group().members[0]!] }))
        }),
    })
    render(<MembersView group={group()} isAdmin canInvite initialAdding={false} />)
    fireEvent.click(within(screen.getByTestId('member-u2')).getByRole('button', { name: '移出' }))
    const dlg = await screen.findByRole('dialog', { name: '移出成员 李建国' })

    // Backdrop clicks never dismiss ConfirmRemove.
    fireEvent.click(screen.getByTestId('dialog-overlay'))
    expect(screen.getByRole('dialog', { name: '移出成员 李建国' })).toBe(dlg)

    const confirmBtn = within(dlg).getByRole('button', { name: '移出' }) as HTMLButtonElement
    const cancelBtn = within(dlg).getByRole('button', { name: '取消' }) as HTMLButtonElement
    fireEvent.click(confirmBtn)
    expect(confirmBtn.getAttribute('aria-busy')).toBe('true')
    expect(confirmBtn.disabled).toBe(true)
    expect(cancelBtn.disabled).toBe(true)

    fireEvent.click(confirmBtn)
    fireEvent.keyDown(document, { key: 'Escape' })
    fireEvent.click(within(dlg).getByRole('button', { name: '关闭' }))
    expect(screen.getByRole('dialog', { name: '移出成员 李建国' })).toBe(dlg)
    expect(calls.filter((c) => c.method === 'DELETE')).toHaveLength(1)

    finish()
    await waitFor(() => expect(screen.queryByRole('dialog', { name: '移出成员 李建国' })).toBeNull())
  })

  it('locks RemoveNoticeDialog while busy and unlocks on error', async () => {
    let settle: (res: GroupDto | Response) => void = () => {}
    const calls = mockApi({
      'DELETE /groups/g1/notice': () =>
        new Promise<GroupDto | Response>((r) => {
          settle = r
        }),
    })
    const onClose = vi.fn()
    render(<RemoveNoticeDialog groupId="g1" onClose={onClose} />)
    const dlg = screen.getByRole('dialog', { name: '移除群公告' })

    fireEvent.click(screen.getByTestId('dialog-overlay'))
    expect(onClose).not.toHaveBeenCalled()

    const confirmBtn = within(dlg).getByRole('button', { name: '移除' }) as HTMLButtonElement
    const cancelBtn = within(dlg).getByRole('button', { name: '取消' }) as HTMLButtonElement
    fireEvent.click(confirmBtn)
    expect(confirmBtn.getAttribute('aria-busy')).toBe('true')
    expect(confirmBtn.disabled).toBe(true)
    expect(cancelBtn.disabled).toBe(true)

    fireEvent.click(confirmBtn)
    fireEvent.keyDown(document, { key: 'Escape' })
    fireEvent.click(within(dlg).getByRole('button', { name: '关闭' }))
    expect(onClose).not.toHaveBeenCalled()
    expect(calls.filter((c) => c.method === 'DELETE')).toHaveLength(1)

    // Failure re-enables Cancel and Escape.
    settle(apiError(500, 'internal', '移除失败'))
    await waitFor(() => expect(cancelBtn.disabled).toBe(false))
    expect(onClose).not.toHaveBeenCalled()
    fireEvent.keyDown(document, { key: 'Escape' })
    expect(onClose).toHaveBeenCalledOnce()
  })
})

describe('R3B P1-5: BotsView row MenuButton uses portal and ghost icon button', () => {
  it('renders ghost icon classes, weight 2.4 dots and portalled menu', async () => {
    mockApi({ 'GET /bots/b2/share-requests': [] })
    const { container } = render(
      <MemoryRouter>
        <div style={{ overflow: 'hidden' }}>
          <BotsView group={group()} isAdmin member />
        </div>
      </MemoryRouter>,
    )
    const trigger = screen.getByRole('button', { name: '小王的 Claude 的更多操作' })
    for (const cls of ['ui-btn', 'ui-btn--ghost', 'ui-btn--small', 'ui-btn--icon', 'ui-icon-btn'])
      expect(trigger.classList.contains(cls)).toBe(true)
    expect(trigger.classList.contains('ui-btn--plain')).toBe(false)
    expect(trigger.querySelector('svg')?.getAttribute('stroke-width')).toBe('2.4')

    fireEvent.click(trigger)
    const menu = await screen.findByRole('menu')
    expect(menu.classList.contains('ui-menu--fixed')).toBe(true)
    expect(menu.parentElement).toBe(document.body)
    expect(container.contains(menu)).toBe(false)
  })

  it('explains group approval override as owner replacement and ceiling for others without stale full-tier copy', () => {
    mockApi({ 'GET /bots/b2/share-requests': [] })
    const { container } = render(
      <MemoryRouter>
        <BotsView group={group()} isAdmin member />
      </MemoryRouter>,
    )
    const foot = container.querySelector('.gs-foot')?.textContent ?? ''
    expect(foot).toContain('单独设置时会覆盖主人的审批方式，并对其他成员作为权限上限')
    expect(foot).not.toContain('本群为「完全允许」时仅指定名单可触发')
  })
})
