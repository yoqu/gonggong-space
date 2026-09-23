import type { BotDto, BotOwnerDto, MachineDto, UserDto } from '@aiws/protocol'
import { fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import { MemoryRouter } from 'react-router'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { App } from '../src/App'
import { useSession } from '../src/app/session'
import { loadWorkspace, useWorkspace } from '../src/app/workspace'

const wang: UserDto = {
  id: 'u1',
  account: 'wanglei',
  name: '王磊',
  role: 'member',
  mustChangePassword: false,
  disabled: false,
}
const admin: UserDto = { ...wang, id: 'u9', account: 'chenchen', name: '陈晨', role: 'sysadmin' }

const mbp: MachineDto = {
  id: 'm1',
  ownerId: 'u1',
  name: 'wanglei-mbp',
  os: 'macos',
  arch: 'aarch64',
  online: true,
  agents: [
    { kind: 'claude', available: true, version: '2.1.4', path: '/bin/claude', minVersion: '2.0.0' },
    { kind: 'codex', available: false, version: null, path: null, minVersion: '0.40.0' },
  ],
  daemonVersion: '0.1.0',
  lastSeenAt: null,
}

const bot = (o: Partial<BotDto>): BotDto => ({
  id: 'b1',
  name: '小王的 Claude',
  ownerId: 'u1',
  ownerName: '王磊',
  agentKind: 'claude',
  machineId: 'm1',
  machineName: 'wanglei-mbp',
  binding: 'bound',
  presence: 'online',
  systemPrompt: '',
  tier: 'workspace',
  triggerScope: 'all',
  triggerList: [],
  concurrency: 2,
  createdBy: 'u1',
  agentVersion: '2.1.4',
  agentMinVersion: '2.0.0',
  groupCount: 0,
  ...o,
})

type Handler = (body: unknown) => unknown
let routes: Record<string, Handler>
let calls: { key: string; body: unknown }[]

beforeEach(() => {
  calls = []
  routes = {
    'GET /api/bots': () => [],
    'GET /api/machines': () => [],
    'GET /api/notifications': () => [],
    'GET /api/users': () => [
      { id: 'u1', name: '王磊', account: 'wanglei' },
      { id: 'u2', name: '李建国', account: 'lijg' },
    ],
  }
  vi.stubGlobal(
    'WebSocket',
    class {
      close() {}
    },
  )
  vi.stubGlobal(
    'fetch',
    vi.fn(async (url: string, init: RequestInit = {}) => {
      const key = `${init.method ?? 'GET'} ${url}`
      const body = init.body ? JSON.parse(String(init.body)) : undefined
      calls.push({ key, body })
      const h = routes[key]
      return h
        ? new Response(JSON.stringify(h(body)))
        : new Response(JSON.stringify({ error: 'not_found', message: key }), { status: 404 })
    }),
  )
  useWorkspace.setState({ groups: [], bots: [], machines: [], notifCount: 0 })
})
afterEach(() => vi.unstubAllGlobals())

function renderAt(path: string, user: UserDto) {
  useSession.setState({ user, status: 'ready' })
  return render(
    <MemoryRouter initialEntries={[path]}>
      <App />
    </MemoryRouter>,
  )
}

describe('workspace store', () => {
  it('loads bots, machines and unread notifications, then follows realtime events', async () => {
    routes['GET /api/bots'] = () => [bot({})]
    routes['GET /api/machines'] = () => [mbp]
    routes['GET /api/notifications'] = () => [
      { id: 'n1', type: 'bot_confirm', payload: {}, readAt: null, createdAt: '' },
      { id: 'n2', type: 'bot_confirm', payload: {}, readAt: '2026-01-01', createdAt: '' },
    ]
    await loadWorkspace()
    const s = useWorkspace.getState()
    expect([s.bots.length, s.machines.length, s.notifCount]).toEqual([1, 1, 1])
    s.applyEvent({ t: 'bot.removed', botId: 'b1' })
    s.applyEvent({
      t: 'notification.new',
      notification: { id: 'n3', type: 'bot_confirm', payload: {}, readAt: null, createdAt: '' },
    })
    expect(useWorkspace.getState()).toMatchObject({ bots: [], notifCount: 2 })
  })
})

describe('sidebar 我的 BOT', () => {
  it('shows presence per bot and lets the owner confirm a pending bot', async () => {
    routes['GET /api/bots'] = () => [
      bot({}),
      bot({ id: 'b2', name: '小王的 Codex', binding: 'pending_confirm', presence: 'pending_confirm' }),
      bot({ id: 'b3', name: '别人的', ownerId: 'u2' }),
    ]
    let readAt: string | null = null
    routes['GET /api/notifications'] = () => [
      { id: 'n1', type: 'bot_confirm', payload: {}, readAt, createdAt: '' },
    ]
    routes['POST /api/bots/b2/confirm'] = () => {
      readAt = '2026-09-23'
      return bot({ id: 'b2', name: '小王的 Codex', presence: 'agent_missing' })
    }
    renderAt('/', wang)
    const nav = screen.getByRole('navigation', { name: '会话列表' })
    expect(await within(nav).findByText('wanglei-mbp · 在线')).toBeTruthy()
    expect(within(nav).queryByText('别人的')).toBeNull()
    fireEvent.click(within(nav).getByRole('button', { name: '确认' }))
    expect(await within(nav).findByText('wanglei-mbp · agent 缺失')).toBeTruthy()
    expect(within(nav).queryByRole('button', { name: '确认' })).toBeNull()
    await waitFor(() => expect(useWorkspace.getState().notifCount).toBe(0))
  })
})

describe('新建 bot', () => {
  const owners = (): BotOwnerDto[] => [
    { id: 'u9', name: '陈晨', machines: [] },
    { id: 'u1', name: '王磊', machines: [mbp] },
    { id: 'u3', name: '赵敏', machines: [] },
  ]

  it('creates a bot for myself on my machine', async () => {
    routes['GET /api/bots/owners'] = () => [{ id: 'u1', name: '王磊', machines: [mbp] }]
    routes['POST /api/bots'] = (b) => bot({ name: (b as { name: string }).name })
    renderAt('/admin/bots', wang)
    fireEvent.click(screen.getByRole('button', { name: '新建 bot' }))
    const dialog = await screen.findByRole('dialog', { name: '新建 bot' })
    const name = await within(dialog).findByLabelText('名称')
    expect((name as HTMLInputElement).value).toBe('王磊的 Claude Code')
    expect(
      within(dialog)
        .getByRole('button', { name: /Codex\s*未安装/ })
        .hasAttribute('disabled'),
    ).toBe(true)
    expect(within(dialog).getByText('创建后立即可用')).toBeTruthy()
    fireEvent.change(name, { target: { value: '小王的 Claude' } })
    fireEvent.click(within(dialog).getByRole('button', { name: '创建并绑定' }))
    await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull())
    expect(calls.find((c) => c.key === 'POST /api/bots')?.body).toEqual({
      name: '小王的 Claude',
      ownerId: 'u1',
      agentKind: 'claude',
      machineId: 'm1',
      systemPrompt: '',
    })
    expect(screen.getAllByText('小王的 Claude').length).toBeGreaterThan(0)
  })

  it('previews confirmation and pending_bind when an admin creates for others', async () => {
    routes['GET /api/bots/owners'] = owners
    renderAt('/admin/bots', admin)
    fireEvent.click(screen.getByRole('button', { name: '新建 bot' }))
    const dialog = await screen.findByRole('dialog', { name: '新建 bot' })
    await within(dialog).findByText('陈晨 还没有绑定机器。bot 会以「待绑定」创建，可先选 agent 种类。')
    expect(within(dialog).getByRole('button', { name: /陈晨\s*我/ })).toBeTruthy()
    expect(within(dialog).getByRole('button', { name: '创建' })).toBeTruthy()

    fireEvent.click(within(dialog).getByRole('button', { name: /王磊\s*1 台/ }))
    expect(within(dialog).getByText('等待 王磊 确认')).toBeTruthy()
    expect(within(dialog).getByRole('button', { name: '创建并发送确认' })).toBeTruthy()
    expect((within(dialog).getByLabelText('名称') as HTMLInputElement).value).toBe('王磊的 Claude Code')
  })
})

describe('bot detail', () => {
  it('forces the trigger list for the full tier and saves', async () => {
    routes['GET /api/bots'] = () => [bot({ triggerScope: 'list', triggerList: ['u2'] })]
    routes['PATCH /api/bots/b1'] = (b) => bot(b as Partial<BotDto>)
    renderAt('/admin/bots', wang)
    const detail = await screen.findByRole('complementary', { name: 'bot 详情' })
    expect(within(detail).getByText('李建国')).toBeTruthy()
    fireEvent.click(within(detail).getByRole('tab', { name: '任何群成员' }))
    fireEvent.click(within(detail).getByRole('tab', { name: 'full' }))
    expect(within(detail).getByText('full 档位强制使用指定名单')).toBeTruthy()
    expect(within(detail).getByRole('tab', { name: '任何群成员' }).hasAttribute('disabled')).toBe(true)
    expect(within(detail).getByRole('tab', { name: '指定名单' }).getAttribute('aria-selected')).toBe('true')
    fireEvent.click(within(detail).getByRole('button', { name: '保存' }))
    await waitFor(() =>
      expect(calls.find((c) => c.key === 'PATCH /api/bots/b1')?.body).toEqual({
        systemPrompt: '',
        triggerScope: 'list',
        triggerList: ['u2'],
        tier: 'full',
      }),
    )
  })

  it('warns when the bot waits for its owner', async () => {
    routes['GET /api/bots'] = () => [
      bot({ binding: 'pending_confirm', presence: 'pending_confirm', createdBy: 'u9', agentVersion: null }),
    ]
    renderAt('/admin/bots', admin)
    const detail = await screen.findByRole('complementary', { name: 'bot 详情' })
    expect(within(detail).getByText('等待 王磊 确认')).toBeTruthy()
    expect(within(detail).queryByRole('button', { name: '确认' })).toBeNull()
  })

  it('warns when the agent CLI is older than the adapter supports', async () => {
    routes['GET /api/bots'] = () => [bot({ agentVersion: '1.0.128', agentMinVersion: '2.0.0' })]
    renderAt('/admin/bots', admin)
    const detail = await screen.findByRole('complementary', { name: 'bot 详情' })
    expect(within(detail).getByText('agent 版本低于适配器要求')).toBeTruthy()
    expect(within(detail).getByText(/claude-code 1.0.128 低于 ACP 适配器要求的 2.0.0/)).toBeTruthy()
  })

  it('shows last-7-day usage and who used the bot', async () => {
    routes['GET /api/bots'] = () => [bot({})]
    routes['GET /api/usage?by=user&days=7&botId=b1'] = () => [
      { key: 'u1', name: '王磊', runs: 3, totalTokens: 256_000, unreported: 0 },
      { key: 'u2', name: '李建国', runs: 1, totalTokens: 0, unreported: 1 },
    ]
    renderAt('/admin/bots', wang)
    const detail = await screen.findByRole('complementary', { name: 'bot 详情' })
    expect(await within(detail).findByText('256k tokens · 4 轮')).toBeTruthy()
    const rows = within(detail)
      .getAllByTestId('usage-row')
      .map((r) => r.textContent)
    expect(rows).toEqual(['王磊256k', '李建国未上报'])
  })
})
