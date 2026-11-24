import { readFileSync } from 'node:fs'
import {
  type BotDto,
  type FeishuChatChoicesDto,
  type FeishuIdentityView,
  type GroupDto,
  type GroupFeishuView,
  TERMINAL_DIR_FEATURE,
  type UserDto,
} from '@gonggong/protocol'
import { act, fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import { MemoryRouter } from 'react-router'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { useSession } from '../src/app/session'
import { useWorkspace } from '../src/app/workspace'
import { NewGroupDialog } from '../src/features/chat/NewGroupDialog'
import { FeishuGroupDialog } from '../src/features/feishu/FeishuGroupDialog'
import { GroupFeishuTab } from '../src/features/feishu/GroupFeishuTab'
import { useSettings } from '../src/features/settings/store'
import { useGet } from '../src/lib/useGet'
import { Alert } from '../src/ui'
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

const users = [
  { id: 'u1', name: '王磊', account: 'wanglei' },
  { id: 'u2', name: '李建国', account: 'lijg' },
  { id: 'u3', name: '赵敏', account: 'zhaomin' },
]

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
  groupCount: 0,
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

const group = (o: Partial<GroupDto> = {}): GroupDto => ({
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
  ...o,
})

const linkedIdentity: FeishuIdentityView = {
  identity: {
    name: '王磊',
    avatar: null,
    email: 'wanglei@corp.com',
    boundAt: '2026-10-01T00:00:00Z',
    notify: false,
  },
}

const bots = [
  bot(),
  bot({
    id: 'b2',
    name: '老李的 Codex',
    ownerId: 'u2',
    ownerName: '李建国',
    agentKind: 'codex',
    sharedWith: ['u1'],
  }),
]

async function pickBot(dialog: HTMLElement, name: RegExp) {
  fireEvent.click(within(dialog).getByRole('button', { name: '添加 Bot…' }))
  const pick = await screen.findByRole('dialog', { name: '添加 Bot' })
  fireEvent.click(within(pick).getByRole('menuitemcheckbox', { name }))
  fireEvent.click(within(dialog).getByRole('button', { name: '添加 Bot…' }))
}

function deferred<T>() {
  let resolve!: (v: T) => void
  const promise = new Promise<T>((r) => {
    resolve = r
  })
  return { promise, resolve }
}

beforeEach(() => {
  useSession.setState({ user: me, status: 'ready' })
  useWorkspace.setState({ groups: [], bots, machines: [], activeGroupId: null })
  useSettings.setState({ page: null })
})

afterEach(() => {
  vi.unstubAllGlobals()
  useSettings.setState({ page: null })
})

describe('NewGroupDialog · flat 3-way tabs, draft preservation, missing reason & close lock', () => {
  it('keeps 建群 fields stable when picking 1 Bot, suggests 切到私聊 with Bot pre-selected, and creates cleanly', async () => {
    const onClose = vi.fn()
    const calls = mockApi({
      'GET /auth/options': { registrationOpen: false, feishuLogin: false },
      'GET /users': users,
      'GET /bots/recent': [],
      'POST /groups': () => group({ id: 'g9', name: '共享协作', botIds: ['b2'] }),
    })
    render(
      <MemoryRouter>
        <NewGroupDialog me={me} onClose={onClose} />
      </MemoryRouter>,
    )
    const dialog = screen.getByRole('dialog', { name: '发起会话' })
    expect(within(dialog).getByRole('tab', { name: '建群' }).getAttribute('aria-selected')).toBe('true')
    expect(within(dialog).getByRole('tab', { name: '私聊' })).toBeTruthy()
    expect(within(dialog).getByRole('tab', { name: '新建终端' })).toBeTruthy()

    await pickBot(dialog, /老李的 Codex/)

    // 建群 stays stable: Name, Public switch, Members (including Bot owner), and 创建群 remain visible.
    expect(within(dialog).getByLabelText('名称')).toBeTruthy()
    expect(within(dialog).getByRole('switch', { name: '公开频道' })).toBeTruthy()
    expect(within(dialog).getByRole('button', { name: '创建群' })).toBeTruthy()
    expect(within(dialog).getByRole('heading', { name: '成员 · 2（Bot 主人自动加入）' })).toBeTruthy()
    const members = within(dialog).getByRole('group', { name: '成员' })
    expect(within(members).getByText('李建国')).toBeTruthy()

    // Calm inline suggestion under Bot section switches to 私聊 with the Bot pre-selected.
    expect(within(dialog).getByText('只有你和 老李的 Codex，也可以直接发起私聊')).toBeTruthy()
    fireEvent.click(within(dialog).getByRole('button', { name: '切到私聊' }))
    expect(within(dialog).getByRole('tab', { name: '私聊' }).getAttribute('aria-selected')).toBe('true')
    expect(within(dialog).queryByLabelText('名称')).toBeNull()
    expect(within(dialog).queryByRole('switch', { name: '公开频道' })).toBeNull()
    expect(within(dialog).queryByRole('group', { name: '成员' })).toBeNull()
    expect(within(dialog).getByText('老李的 Codex')).toBeTruthy()
    expect(within(dialog).getByRole('button', { name: '开始私聊' }).hasAttribute('disabled')).toBe(false)

    // Switching back to 建群 preserves the group draft and submits as a group.
    fireEvent.click(within(dialog).getByRole('tab', { name: '建群' }))
    expect(within(dialog).getByText('老李的 Codex')).toBeTruthy()
    fireEvent.change(within(dialog).getByLabelText('名称'), { target: { value: '共享协作' } })
    fireEvent.click(within(dialog).getByRole('button', { name: '创建群' }))
    await waitFor(() => expect(onClose).toHaveBeenCalledOnce())
    expect(calls.find((c) => c.method === 'POST' && c.path === '/groups')?.body).toEqual({
      name: '共享协作',
      kind: 'group',
      memberIds: [],
      botIds: ['b2'],
      repo: null,
      visibility: 'private',
    })
  })

  it('preserves drafts across 建群, 私聊 and 新建终端 tabs', async () => {
    useWorkspace.setState({
      groups: [],
      bots,
      machines: [
        {
          id: 'mc1',
          name: 'wanglei-mbp',
          ownerId: 'u1',
          online: true,
          os: 'macos',
          features: [TERMINAL_DIR_FEATURE],
        } as never,
      ],
      activeGroupId: null,
    })
    mockApi({
      'GET /auth/options': { registrationOpen: false, feishuLogin: false },
      'GET /users': users,
      'GET /bots/recent': [],
    })
    render(
      <MemoryRouter>
        <NewGroupDialog me={me} onClose={() => {}} />
      </MemoryRouter>,
    )
    const dialog = screen.getByRole('dialog', { name: '发起会话' })
    fireEvent.change(within(dialog).getByLabelText('名称'), { target: { value: '跨端联调' } })
    await pickBot(dialog, /小王的 Claude/)

    // Switch to 私聊 and select a Bot.
    fireEvent.click(within(dialog).getByRole('tab', { name: '私聊' }))
    fireEvent.click(within(dialog).getByRole('button', { name: '选择 Bot…' }))
    const dmPick = await screen.findByRole('dialog', { name: '添加 Bot' })
    fireEvent.click(within(dmPick).getByRole('menuitemcheckbox', { name: /老李的 Codex/ }))
    expect(within(dialog).getByText('老李的 Codex')).toBeTruthy()

    // Switch to 新建终端 and type cwd.
    fireEvent.click(within(dialog).getByRole('tab', { name: '新建终端' }))
    const dirInput = within(dialog).getByLabelText('目录') as HTMLInputElement
    fireEvent.change(dirInput, { target: { value: '/Users/w/code/api' } })
    expect((within(dialog).getByLabelText('名称') as HTMLInputElement).value).toBe('api')

    // Switch back through 建群 -> 私聊 -> 新建终端: all drafts intact.
    fireEvent.click(within(dialog).getByRole('tab', { name: '建群' }))
    expect((within(dialog).getByLabelText('名称') as HTMLInputElement).value).toBe('跨端联调')
    expect(within(dialog).getByText('小王的 Claude')).toBeTruthy()

    fireEvent.click(within(dialog).getByRole('tab', { name: '私聊' }))
    expect(within(dialog).getByText('老李的 Codex')).toBeTruthy()

    fireEvent.click(within(dialog).getByRole('tab', { name: '新建终端' }))
    expect((within(dialog).getByLabelText('目录') as HTMLInputElement).value).toBe('/Users/w/code/api')
    expect((within(dialog).getByLabelText('名称') as HTMLInputElement).value).toBe('api')
  })

  it('shows first missing reason in footer linked via aria-describedby, locks close while creating, and guards Safari IME Enter', async () => {
    const pending = deferred<GroupDto>()
    const onClose = vi.fn()
    const calls = mockApi({
      'GET /auth/options': { registrationOpen: false, feishuLogin: false },
      'GET /users': users,
      'GET /bots/recent': [],
      'POST /groups': () => pending.promise,
    })
    render(
      <MemoryRouter>
        <NewGroupDialog me={me} onClose={onClose} />
      </MemoryRouter>,
    )
    const dialog = screen.getByRole('dialog', { name: '发起会话' })

    // 建群 disabled reason: 请填写群名称, linked via aria-describedby and aria-live="polite".
    const submitGroup = within(dialog).getByRole('button', { name: '创建群' }) as HTMLButtonElement
    expect(submitGroup.disabled).toBe(true)
    const descId = submitGroup.getAttribute('aria-describedby')
    expect(descId).toBeTruthy()
    const desc = document.getElementById(descId!) as HTMLElement
    expect(desc.textContent).toBe('请填写群名称')
    expect(desc.getAttribute('aria-live')).toBe('polite')

    // 私聊 disabled reason: 请选择一个 Bot.
    fireEvent.click(within(dialog).getByRole('tab', { name: '私聊' }))
    const submitDm = within(dialog).getByRole('button', { name: '开始私聊' }) as HTMLButtonElement
    expect(submitDm.disabled).toBe(true)
    expect(document.getElementById(submitDm.getAttribute('aria-describedby')!)?.textContent).toBe(
      '请选择一个 Bot',
    )

    // Back to 建群: Safari IME Enter (keyCode 229 / isComposing) does not submit.
    fireEvent.click(within(dialog).getByRole('tab', { name: '建群' }))
    const nameInput = within(dialog).getByLabelText('名称')
    fireEvent.change(nameInput, { target: { value: '发版群' } })
    fireEvent.keyDown(nameInput, { key: 'Enter', keyCode: 229 })
    fireEvent.keyDown(nameInput, { key: 'Enter', isComposing: true })
    expect(calls.filter((c) => c.path === '/groups')).toHaveLength(0)

    // Real Enter submits; dialog close and Cancel are locked while creating.
    fireEvent.keyDown(nameInput, { key: 'Enter' })
    await waitFor(() => expect(calls.filter((c) => c.path === '/groups')).toHaveLength(1))
    expect((within(dialog).getByRole('button', { name: '取消' }) as HTMLButtonElement).disabled).toBe(true)
    fireEvent.keyDown(document, { key: 'Escape' })
    expect(onClose).not.toHaveBeenCalled()

    await act(async () => pending.resolve(group({ id: 'g8', name: '发版群' })))
    await waitFor(() => expect(onClose).toHaveBeenCalledOnce())
  })

  it('hides the DM suggestion once name, 公开频道 or 同时创建飞书群 is touched', async () => {
    mockApi({
      'GET /auth/options': { registrationOpen: false, feishuLogin: true },
      'GET /users': users,
      'GET /me/feishu': linkedIdentity,
      'GET /bots/recent': [],
    })

    const first = render(
      <MemoryRouter>
        <NewGroupDialog me={me} onClose={() => {}} />
      </MemoryRouter>,
    )
    const d1 = screen.getByRole('dialog', { name: '发起会话' })
    const nameInput = within(d1).getByLabelText('名称') as HTMLInputElement
    fireEvent.change(nameInput, { target: { value: '发版准备' } })
    await pickBot(d1, /小王的 Claude/)
    expect(nameInput.value).toBe('发版准备')
    expect(within(d1).queryByText(/也可以直接发起私聊/)).toBeNull()
    first.unmount()

    const second = render(
      <MemoryRouter>
        <NewGroupDialog me={me} onClose={() => {}} />
      </MemoryRouter>,
    )
    const d2 = screen.getByRole('dialog', { name: '发起会话' })
    const pub = within(d2).getByRole('switch', { name: '公开频道' }) as HTMLInputElement
    fireEvent.click(pub)
    await pickBot(d2, /小王的 Claude/)
    expect(pub.checked).toBe(true)
    expect(within(d2).queryByText(/也可以直接发起私聊/)).toBeNull()
    second.unmount()

    render(
      <MemoryRouter>
        <NewGroupDialog me={me} onClose={() => {}} />
      </MemoryRouter>,
    )
    const d3 = screen.getByRole('dialog', { name: '发起会话' })
    const feishuSw = (await within(d3).findByRole('switch', { name: '同时创建飞书群' })) as HTMLInputElement
    fireEvent.click(feishuSw)
    await pickBot(d3, /小王的 Claude/)
    expect(feishuSw.checked).toBe(true)
    expect(within(d3).queryByText(/也可以直接发起私聊/)).toBeNull()
  })

  it('wires /users loading and error + retry into MemberPicker', async () => {
    const pending = deferred<typeof users>()
    mockApi({
      'GET /auth/options': { registrationOpen: false, feishuLogin: false },
      'GET /users': () => pending.promise,
    })
    const first = render(
      <MemoryRouter>
        <NewGroupDialog me={me} onClose={() => {}} />
      </MemoryRouter>,
    )
    const d1 = screen.getByRole('dialog', { name: '发起会话' })
    fireEvent.click(within(d1).getByRole('button', { name: '添加成员' }))
    const pop1 = await screen.findByRole('dialog', { name: '添加成员' })
    expect(within(pop1).queryByText('没有可添加的成员')).toBeNull()
    expect(within(pop1).queryByRole('status') ?? within(pop1).queryByText(/加载/)).toBeTruthy()
    await act(async () => pending.resolve(users))
    expect(await within(pop1).findByRole('menuitemcheckbox', { name: /赵敏/ })).toBeTruthy()
    first.unmount()

    let next: () => unknown = () => apiError(500, 'internal', 'boom')
    mockApi({
      'GET /auth/options': { registrationOpen: false, feishuLogin: false },
      'GET /users': () => next(),
    })
    render(
      <MemoryRouter>
        <NewGroupDialog me={me} onClose={() => {}} />
      </MemoryRouter>,
    )
    const d2 = screen.getByRole('dialog', { name: '发起会话' })
    fireEvent.click(within(d2).getByRole('button', { name: '添加成员' }))
    const pop2 = await screen.findByRole('dialog', { name: '添加成员' })
    expect(await within(pop2).findByText('成员列表加载失败')).toBeTruthy()

    const retryReply = deferred<typeof users>()
    next = () => retryReply.promise
    const retryBtn = within(pop2).getByRole('button', { name: '重试' })
    fireEvent.click(retryBtn)
    await waitFor(() => expect(retryBtn.getAttribute('aria-busy')).toBe('true'))
    await act(async () => retryReply.resolve(users))
    expect(await within(pop2).findByRole('menuitemcheckbox', { name: /赵敏/ })).toBeTruthy()
    expect(within(pop2).queryByText('成员列表加载失败')).toBeNull()
  })
})

describe('useGet · loading and stale data preservation', () => {
  function Probe({ path }: { path: string | null }) {
    const q = useGet<{ label: string }>(path)
    return (
      <div>
        <span data-testid="loading">{String(q.loading)}</span>
        <span data-testid="data">{q.data?.label ?? 'none'}</span>
        <span data-testid="error">{q.error}</span>
        <button type="button" onClick={q.reload}>
          reload
        </button>
      </div>
    )
  }

  it('tracks loading across initial fetch and reload without clearing stale data', async () => {
    const first = deferred<{ label: string }>()
    let handler: () => unknown = () => first.promise
    mockApi({ 'GET /probe': () => handler() })

    const { rerender } = render(<Probe path={null} />)
    expect(screen.getByTestId('loading').textContent).toBe('false')

    rerender(<Probe path="/probe" />)
    expect(screen.getByTestId('loading').textContent).toBe('true')
    await act(async () => first.resolve({ label: 'v1' }))
    await waitFor(() => expect(screen.getByTestId('loading').textContent).toBe('false'))
    expect(screen.getByTestId('data').textContent).toBe('v1')

    const failed = deferred<Response>()
    handler = () => failed.promise
    fireEvent.click(screen.getByRole('button', { name: 'reload' }))
    expect(screen.getByTestId('loading').textContent).toBe('true')
    expect(screen.getByTestId('data').textContent).toBe('v1')
    await act(async () => failed.resolve(apiError(500, 'internal', 'boom')))
    await waitFor(() => expect(screen.getByTestId('loading').textContent).toBe('false'))
    expect(screen.getByTestId('data').textContent).toBe('v1')
    expect(screen.getByTestId('error').textContent).toBe('boom')

    handler = () => ({ label: 'v2' })
    fireEvent.click(screen.getByRole('button', { name: 'reload' }))
    await waitFor(() => expect(screen.getByTestId('data').textContent).toBe('v2'))
    expect(screen.getByTestId('error').textContent).toBe('')
    expect(screen.getByTestId('loading').textContent).toBe('false')
  })
})

describe('FeishuGroupDialog & GroupFeishuTab · R3A P1-3', () => {
  it('guides unlinked users to bind Feishu instead of showing 没有可关联的飞书群', async () => {
    const onClose = vi.fn()
    const emptyChats: FeishuChatChoicesDto = { available: true, mainAppName: '共工', chats: [] }
    mockApi({
      'GET /feishu/chats': emptyChats,
      'GET /me/feishu': { identity: null } satisfies FeishuIdentityView,
    })
    render(
      <MemoryRouter>
        <FeishuGroupDialog onClose={onClose} />
      </MemoryRouter>,
    )
    const dialog = await screen.findByRole('dialog', { name: '从飞书群创建' })
    expect(await within(dialog).findByText('先绑定你的飞书账号，共工才能列出你所在的飞书群')).toBeTruthy()
    expect(within(dialog).queryByText('没有可关联的飞书群')).toBeNull()
    expect(within(dialog).queryByRole('button', { name: '创建' })).toBeNull()

    fireEvent.click(within(dialog).getByRole('button', { name: '去绑定飞书账号' }))
    expect(onClose).toHaveBeenCalledOnce()
    expect(useSettings.getState().page).toBe('account')
  })

  it('shows loading on Refresh/Retry and renders FeishuLoadError even with stale chats data', async () => {
    let reply: () => unknown = () =>
      ({
        available: true,
        mainAppName: '共工',
        chats: [{ chatId: 'oc_1', name: '研发群' }],
      }) satisfies FeishuChatChoicesDto
    mockApi({
      'GET /feishu/chats': () => reply(),
      'GET /me/feishu': linkedIdentity,
    })
    render(
      <MemoryRouter>
        <FeishuGroupDialog onClose={() => {}} />
      </MemoryRouter>,
    )
    const dialog = await screen.findByRole('dialog', { name: '从飞书群创建' })
    const refresh = await within(dialog).findByRole('button', { name: '刷新' })

    const failReq = deferred<Response>()
    reply = () => failReq.promise
    fireEvent.click(refresh)
    await waitFor(() => expect(refresh.getAttribute('aria-busy')).toBe('true'))
    await act(async () => failReq.resolve(apiError(500, 'internal', 'feishu down')))

    const alert = await within(dialog).findByRole('alert')
    expect(alert.textContent).toContain('读取飞书群信息失败：feishu down')
    expect(alert.querySelector('.ui-alert__icon svg')).toBeTruthy()
    expect(within(dialog).getByRole('button', { name: '飞书群' })).toBeTruthy()

    const okReq = deferred<FeishuChatChoicesDto>()
    reply = () => okReq.promise
    const retry = within(alert).getByRole('button', { name: '重试' })
    fireEvent.click(retry)
    await waitFor(() => expect(retry.getAttribute('aria-busy')).toBe('true'))
    await act(async () =>
      okReq.resolve({ available: true, mainAppName: '共工', chats: [{ chatId: 'oc_2', name: '新研发群' }] }),
    )
    await waitFor(() => expect(within(dialog).queryByRole('alert')).toBeNull())
    expect(refresh.getAttribute('aria-busy')).toBeNull()
  })

  it('GroupFeishuTab shows Refresh loading, wraps multi-control rows, and surfaces stale errors', async () => {
    const view: GroupFeishuView = {
      available: true,
      mainAppName: '共工',
      chat: null,
      feishuError: null,
      chats: [{ chatId: 'oc_1', name: '研发群' }],
      bots: [],
      members: [{ userId: 'u1', name: '王磊', linked: true }],
    }
    let reply: () => unknown = () => view
    mockApi({ 'GET /groups/g1/feishu': () => reply() })
    const { container } = render(
      <MemoryRouter>
        <GroupFeishuTab group={group()} />
      </MemoryRouter>,
    )
    const refresh = await screen.findByRole('button', { name: '刷新' })
    const row = refresh.closest('.ui-group__row') as HTMLElement
    expect(row.classList.contains('ui-group__row--stacked')).toBe(true)
    expect((refresh.parentElement as HTMLElement).style.flexWrap).toBe('wrap')

    const failReq = deferred<Response>()
    reply = () => failReq.promise
    fireEvent.click(refresh)
    await waitFor(() => expect(refresh.getAttribute('aria-busy')).toBe('true'))
    await act(async () => failReq.resolve(apiError(500, 'internal', 'timeout')))

    const alert = await screen.findByRole('alert')
    expect(alert.textContent).toContain('读取飞书群信息失败：timeout')
    expect(alert.querySelector('.ui-alert__icon svg')).toBeTruthy()
    expect(container.querySelector('.ui-group__row--stacked')).toBeTruthy()
  })
})

describe('Alert · R3A P1-3 warning icon', () => {
  it('always renders a warning icon on error alerts when no custom icon is provided', () => {
    const { container, rerender } = render(<Alert variant="error" description="保存失败" />)
    expect(container.querySelector('.ui-alert__desc svg')).toBeTruthy()
    expect(container.querySelector('.ui-alert__icon')).toBeNull()

    rerender(<Alert variant="error" title="出错了" description="保存失败" />)
    expect(container.querySelector('.ui-alert__icon svg')).toBeTruthy()
    expect(container.querySelector('.ui-alert__desc svg')).toBeNull()

    rerender(
      <Alert variant="error" description="读取失败">
        <button type="button">重试</button>
      </Alert>,
    )
    expect(container.querySelector('.ui-alert__icon svg')).toBeTruthy()
    expect(container.querySelector('.ui-alert__desc svg')).toBeNull()

    rerender(<Alert variant="error" icon={<span data-testid="custom">!</span>} description="保存失败" />)
    expect(screen.getByTestId('custom')).toBeTruthy()
    expect(container.querySelector('.ui-alert__desc svg')).toBeNull()
  })
})

describe('Mobile 390px touch targets & narrow wrap CSS · R3A P1-5', () => {
  const read = (p: string) => readFileSync(`src/${p}`, 'utf8')

  it('enforces >=32px coarse touch targets and narrow wrapping across dialogs and pickers', () => {
    expect(read('ui/segmented.css')).toMatch(
      /@media \(pointer: coarse\) \{[\s\S]*?\.ui-seg \{[^}]*min-height: 32px;/,
    )
    expect(read('ui/form.css')).toMatch(
      /@media \(pointer: coarse\) \{[\s\S]*?\.ui-inputwrap \{[^}]*min-height: 34px;/,
    )
    const overlay = read('ui/overlay.css')
    expect(overlay).toMatch(
      /@media \(max-width: 767px\) \{[\s\S]*?\.ui-dialog__actions \{[^}]*flex-wrap: wrap;/,
    )
    expect(overlay).toMatch(
      /@media \(pointer: coarse\) \{[\s\S]*?\.ui-dialog__actions \.ui-btn \{[^}]*min-height: 34px;/,
    )
    const chat = read('features/chat/chat.css')
    expect(chat).toMatch(/@media \(pointer: coarse\) \{[\s\S]*?\.ng-member \{[^}]*min-height: 28px;/)
    expect(chat).toMatch(
      /@media \(pointer: coarse\) \{[\s\S]*?\.ng-member--add \{[^}]*width: 32px;\s*height: 32px;/,
    )
    expect(chat).toMatch(
      /@media \(pointer: coarse\) \{[\s\S]*?\.ng-member__x \{[^}]*min-width: 24px;\s*min-height: 24px;/,
    )
    expect(chat).toMatch(/@media \(max-width: 767px\) \{[\s\S]*?\.ng-foot \{[^}]*flex: 1 0 100%;/)
    expect(read('features/repos/repos.css')).toMatch(
      /@media \(pointer: coarse\) \{[\s\S]*?\.repo-picker__trigger \{[^}]*min-height: 32px;/,
    )
  })
})
