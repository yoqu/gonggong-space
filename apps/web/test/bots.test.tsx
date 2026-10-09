import { readFileSync } from 'node:fs'
import type { AgentCatalog, BotDto, BotOwnerDto, MachineDto, UserDto } from '@gonggong/protocol'
import { fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import { MemoryRouter, useLocation } from 'react-router'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { App } from '../src/App'
import { useSession } from '../src/app/session'
import { loadWorkspace, useWorkspace } from '../src/app/workspace'
import { botStateText } from '../src/features/bots/model'

const wang: UserDto = {
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
const admin: UserDto = { ...wang, id: 'u9', account: 'chenchen', name: '陈晨', role: 'sysadmin' }

const mbp: MachineDto = {
  id: 'm1',
  ownerId: 'u1',
  name: 'wanglei-mbp',
  os: 'macos',
  arch: 'aarch64',
  online: true,
  agents: [
    {
      kind: 'claude',
      available: true,
      version: '2.1.4',
      path: '/bin/claude',
      minVersion: '2.0.0',
      catalog: null,
    },
    { kind: 'codex', available: false, version: null, path: null, minVersion: '0.40.0', catalog: null },
  ],
  daemonVersion: '0.1.0',
  features: [],
  lastSeenAt: null,
  hostname: 'wanglei-mbp',
  system: null,
  boundAt: '2026-09-01T00:00:00Z',
  createdAt: '2026-09-01T00:00:00Z',
}

const level = (value: string) => ({ value, name: value })
const CATALOG: AgentCatalog = {
  current: 'sonnet',
  efforts: ['low', 'medium', 'high'].map(level),
  effort: 'medium',
  models: [
    { value: 'sonnet', name: 'Sonnet', efforts: ['low', 'medium', 'high'].map(level), effort: 'medium' },
    { value: 'opus', name: 'Opus', efforts: ['low', 'high', 'max'].map(level), effort: 'high' },
    { value: 'haiku', name: 'Haiku', efforts: [], effort: null },
  ],
}

const bot = (o: Partial<BotDto>): BotDto => ({
  id: 'b1',
  teamId: 't1',
  name: '小王的 Claude',
  ownerId: 'u1',
  ownerName: '王磊',
  agentKind: 'claude',
  avatar: 'role-no',
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
  defaultWorkspace: null,
  approval: 'ask',
  allowlist: [],
  model: null,
  effort: null,
  catalog: null,
  gitName: null,
  gitEmail: null,
  gitDefaultEmail: 'b1@bots.gonggong.local',
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
    'GET /api/bots/b1/activity': () => [],
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
      // 管理后台 · Bot lists every team's bots; here they are the open team's.
      const h = routes[key] ?? (key === 'GET /api/admin/bots' ? routes['GET /api/bots'] : undefined)
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

/** Members open their bots from the chat sidebar: an overview in the main area, settings in a dialog. */
async function openMyBot(name = '小王的 Claude') {
  const nav = screen.getByRole('navigation', { name: '会话列表' })
  fireEvent.click(await within(nav).findByRole('link', { name: new RegExp(name) }))
  const page = await screen.findByRole('region', { name: 'Bot 概况' })
  fireEvent.click(within(page).getByRole('button', { name: '编辑 Bot' }))
  return screen.findByRole('complementary', { name: 'Bot 详情' })
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
      notification: {
        id: 'n3',
        teamId: 't1',
        type: 'bot_confirm',
        payload: {},
        readAt: null,
        resolvedAt: null,
        createdAt: '',
      },
    })
    expect(useWorkspace.getState()).toMatchObject({ bots: [], notifCount: 2 })
  })
})

describe('botStateText', () => {
  it('joins machine and state, leaving out missing parts', () => {
    expect(botStateText(bot({}))).toBe('wanglei-mbp · 在线')
    expect(botStateText(bot({ machineName: null }))).toBe('在线')
    expect(botStateText(bot({ presence: 'pending_bind' }))).toBe('wanglei-mbp')
    expect(botStateText(bot({ binding: 'pending_confirm', presence: 'pending_confirm' }))).toBe('待确认')
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
    const row = within(nav).getByRole('link', { name: /小王的 Claude/ })
    expect(row.querySelector('.ui-avatar img')?.getAttribute('src')).toMatch(/^data:image\/svg/)
    expect(row.getAttribute('href')).toBe('/bot/b1')
    fireEvent.click(within(nav).getByRole('button', { name: '确认' }))
    expect(await within(nav).findByText('wanglei-mbp · agent 缺失')).toBeTruthy()
    expect(within(nav).queryByRole('button', { name: '确认' })).toBeNull()
    await waitFor(() => expect(useWorkspace.getState().notifCount).toBe(0))
  })
})

describe('新建 Bot', () => {
  const owners = (): BotOwnerDto[] => [
    { id: 'u9', name: '陈晨', machines: [] },
    { id: 'u1', name: '王磊', machines: [mbp] },
    { id: 'u3', name: '赵敏', machines: [] },
  ]

  it('creates a bot for myself on my machine', async () => {
    routes['GET /api/bots/owners'] = () => [{ id: 'u1', name: '王磊', machines: [mbp] }]
    routes['POST /api/bots'] = (b) => bot({ name: (b as { name: string }).name })
    renderAt('/', wang)
    fireEvent.click(screen.getByRole('button', { name: '新建 Bot…' }))
    const dialog = await screen.findByRole('dialog', { name: '新建 Bot' })
    const name = await within(dialog).findByLabelText('名称')
    expect((name as HTMLInputElement).value).toBe('王磊的 Claude Code')
    expect(
      within(dialog)
        .getByRole('radio', { name: /Codex\s*未安装/ })
        .hasAttribute('disabled'),
    ).toBe(true)
    expect(within(dialog).getByText('创建后立即可用')).toBeTruthy()
    fireEvent.change(name, { target: { value: '小王的 Claude' } })
    const roles = within(dialog).getByRole('radiogroup', { name: '角色' })
    expect(within(roles).getAllByRole('radio')).toHaveLength(13)
    expect((within(roles).getByRole('radio', { name: /共字君/ }) as HTMLInputElement).checked).toBe(true)
    fireEvent.click(within(roles).getByRole('radio', { name: /反推/ }))
    fireEvent.click(within(dialog).getByRole('button', { name: '创建并绑定' }))
    expect(await within(dialog).findByText('已就绪，可以在群里 @ 它了')).toBeTruthy()
    fireEvent.click(within(dialog).getByRole('button', { name: '完成' }))
    await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull())
    expect(calls.find((c) => c.key === 'POST /api/bots')?.body).toEqual({
      name: '小王的 Claude',
      ownerId: 'u1',
      agentKind: 'claude',
      machineId: 'm1',
      systemPrompt: '',
      avatar: 'role-invert',
      model: null,
      effort: null,
    })
    expect(screen.getAllByText('小王的 Claude').length).toBeGreaterThan(0)
  })

  it('says to open the desktop app when the machine is offline', async () => {
    routes['GET /api/bots/owners'] = () => [{ id: 'u1', name: '王磊', machines: [{ ...mbp, online: false }] }]
    routes['POST /api/bots'] = () => bot({ presence: 'offline' })
    renderAt('/', wang)
    fireEvent.click(screen.getByRole('button', { name: '新建 Bot…' }))
    const dialog = await screen.findByRole('dialog', { name: '新建 Bot' })
    fireEvent.click(await within(dialog).findByRole('button', { name: '创建并绑定' }))
    expect(
      await within(dialog).findByText('机器 wanglei-mbp 当前离线，打开该机器上的共工空间客户端后即可使用'),
    ).toBeTruthy()
  })

  it('hands out the 接入链接 right away when I have no machine yet', async () => {
    routes['GET /api/bots/owners'] = () => [{ id: 'u1', name: '王磊', machines: [] }]
    routes['POST /api/bots'] = () =>
      bot({ machineId: null, machineName: null, binding: 'pending_bind', presence: 'pending_bind' })
    routes['POST /api/bind-codes'] = () => ({
      code: 'K7QM-4X2P',
      expiresAt: new Date(Date.now() + 600_000).toISOString(),
      link: 'gonggong://bind?server=x&code=K7QM-4X2P',
    })
    renderAt('/', wang)
    fireEvent.click(screen.getByRole('button', { name: '新建 Bot…' }))
    const dialog = await screen.findByRole('dialog', { name: '新建 Bot' })
    fireEvent.click(await within(dialog).findByRole('button', { name: '创建' }))
    const open = await within(dialog).findByRole('link', { name: '在客户端中打开' })
    expect(open.getAttribute('href')).toBe('gonggong://bind?server=x&code=K7QM-4X2P')
    expect(within(dialog).getByRole('button', { name: '复制接入链接' })).toBeTruthy()
  })

  it('tells an admin the owner was asked to confirm', async () => {
    routes['GET /api/bots/owners'] = () => [
      { id: 'u9', name: '陈晨', machines: [] },
      { id: 'u1', name: '王磊', machines: [mbp] },
    ]
    routes['POST /api/bots'] = () =>
      bot({ createdBy: 'u9', binding: 'pending_confirm', presence: 'pending_confirm' })
    renderAt('/admin/bots', admin)
    fireEvent.click((await screen.findAllByRole('button', { name: '新建 Bot…' }))[0]!)
    const dialog = await screen.findByRole('dialog', { name: '新建 Bot' })
    fireEvent.click(await within(dialog).findByRole('button', { name: '归属人' }))
    fireEvent.click(screen.getByRole('menuitemcheckbox', { name: '王磊 · 1 台机器' }))
    fireEvent.click(within(dialog).getByRole('button', { name: '创建并发送确认' }))
    expect(await within(dialog).findByText('已发送确认通知给 王磊')).toBeTruthy()
    expect(within(dialog).queryByRole('link', { name: '在客户端中打开' })).toBeNull()
  })

  it('picks the model and thought level the machine reports', async () => {
    const withCatalog = { ...mbp, agents: [{ ...mbp.agents[0]!, catalog: CATALOG }, mbp.agents[1]!] }
    routes['GET /api/bots/owners'] = () => [{ id: 'u1', name: '王磊', machines: [withCatalog] }]
    routes['POST /api/bots'] = () => bot({})
    renderAt('/', wang)
    fireEvent.click(screen.getByRole('button', { name: '新建 Bot…' }))
    const dialog = await screen.findByRole('dialog', { name: '新建 Bot' })
    const model = await within(dialog).findByRole('button', { name: '模型' })
    expect(model.textContent).toContain('默认（Sonnet）')
    expect(within(dialog).getByRole('button', { name: '推理强度' }).textContent).toContain('默认（中）')
    fireEvent.click(model)
    fireEvent.click(screen.getByRole('menuitemcheckbox', { name: 'Opus' }))
    fireEvent.click(within(dialog).getByRole('button', { name: '推理强度' }))
    fireEvent.click(screen.getByRole('menuitemcheckbox', { name: '最高' }))
    fireEvent.click(within(dialog).getByRole('button', { name: '模型' }))
    fireEvent.click(screen.getByRole('menuitemcheckbox', { name: 'Haiku' }))
    expect(within(dialog).queryByRole('button', { name: '推理强度' })).toBeNull()
    fireEvent.click(within(dialog).getByRole('button', { name: '模型' }))
    fireEvent.click(screen.getByRole('menuitemcheckbox', { name: 'Opus' }))
    fireEvent.click(within(dialog).getByRole('button', { name: '推理强度' }))
    fireEvent.click(screen.getByRole('menuitemcheckbox', { name: '最高' }))
    fireEvent.click(within(dialog).getByRole('button', { name: '创建并绑定' }))
    await waitFor(() =>
      expect(calls.find((c) => c.key === 'POST /api/bots')?.body).toMatchObject({
        model: 'opus',
        effort: 'max',
      }),
    )
  })

  it('lets the owner pick a default workspace on their online machine and saves it after creating', async () => {
    routes['GET /api/bots/owners'] = () => [{ id: 'u1', name: '王磊', machines: [mbp] }]
    routes['POST /api/bots'] = () => bot({})
    routes['GET /api/machines/m1/dirs'] = () => ({ path: '/Users/w', entries: [], git: null, unusable: null })
    routes['PUT /api/bots/b1/default-workspace'] = (b) => bot(b as Partial<BotDto>)
    renderAt('/', wang)
    fireEvent.click(screen.getByRole('button', { name: '新建 Bot…' }))
    const dialog = await screen.findByRole('dialog', { name: '新建 Bot' })
    fireEvent.click(await within(dialog).findByRole('button', { name: '选择目录…' }))
    const picker = await screen.findByRole('dialog', { name: '默认工作区' })
    await within(picker).findByText('没有子目录')
    fireEvent.click(within(picker).getByRole('button', { name: '选择此目录' }))
    expect(await within(dialog).findByRole('button', { name: 'w' })).toBeTruthy()
    fireEvent.click(within(dialog).getByRole('button', { name: '创建并绑定' }))
    await waitFor(() =>
      expect(calls.find((c) => c.key === 'PUT /api/bots/b1/default-workspace')?.body).toEqual({
        path: '/Users/w',
      }),
    )
  })

  it('previews confirmation and pending_bind when an admin creates for others', async () => {
    routes['GET /api/bots/owners'] = owners
    renderAt('/admin/bots', admin)
    fireEvent.click((await screen.findAllByRole('button', { name: '新建 Bot…' }))[0]!)
    const dialog = await screen.findByRole('dialog', { name: '新建 Bot' })
    await within(dialog).findByText('陈晨 还没有绑定机器。Bot 会以「待绑定」创建，可先选 agent 种类。')
    const owner = within(dialog).getByRole('button', { name: '归属人' })
    expect(owner.textContent).toContain('陈晨（我）')
    expect(within(dialog).getByRole('button', { name: '创建' })).toBeTruthy()
    fireEvent.click(owner)
    fireEvent.click(screen.getByRole('menuitemcheckbox', { name: '王磊 · 1 台机器' }))
    expect(within(dialog).getByText('等待 王磊 确认')).toBeTruthy()
    expect(within(dialog).getByRole('button', { name: '创建并发送确认' })).toBeTruthy()
    expect((within(dialog).getByLabelText('名称') as HTMLInputElement).value).toBe('王磊的 Claude Code')
  })
})

describe('bot detail', () => {
  it('forces the trigger list for the full tier and saves', async () => {
    routes['GET /api/bots'] = () => [bot({ triggerScope: 'list', triggerList: ['u2'] })]
    routes['PATCH /api/bots/b1'] = (b) => bot(b as Partial<BotDto>)
    renderAt('/', wang)
    const detail = await openMyBot()
    expect(within(detail).getByText('李建国')).toBeTruthy()
    for (const t of ['只读', '工作区写入', '完全访问'])
      expect(within(detail).getByRole('radio', { name: t })).toBeTruthy()
    fireEvent.click(within(detail).getByRole('radio', { name: '任何群成员' }))
    fireEvent.click(within(detail).getByRole('radio', { name: '完全访问' }))
    expect(within(detail).queryByRole('alert')).toBeNull()
    const anyone = within(detail).getByRole('radio', { name: '任何群成员' })
    expect(anyone.hasAttribute('disabled')).toBe(true)
    expect(anyone.closest('[title]')?.getAttribute('title')).toBe('完全访问档位只允许指定名单触发')
    expect(within(detail).getByText('完全访问档位只允许指定名单触发')).toBeTruthy()
    expect(within(detail).getByRole('combobox', { name: '触发名单' })).toBeTruthy()
    expect(within(detail).getByRole('radio', { name: '指定名单' }).getAttribute('aria-checked')).toBe('true')
    fireEvent.click(within(detail).getByRole('radio', { name: /算盘/ }))
    fireEvent.click(within(detail).getByRole('button', { name: '保存' }))
    await waitFor(() =>
      expect(calls.find((c) => c.key === 'PATCH /api/bots/b1')?.body).toEqual({
        avatar: 'role-abacus',
        systemPrompt: '',
        triggerScope: 'list',
        triggerList: ['u2'],
        tier: 'full',
      }),
    )
  })

  it('lets the owner set concurrency and command approval with an allowlist', async () => {
    routes['GET /api/bots'] = () => [bot({})]
    routes['PATCH /api/bots/b1'] = (b) => bot(b as Partial<BotDto>)
    renderAt('/', wang)
    const detail = await openMyBot()
    expect((within(detail).getByRole('spinbutton', { name: '并发上限' }) as HTMLInputElement).value).toBe('2')
    fireEvent.click(within(detail).getByRole('button', { name: '增加' }))
    expect(within(detail).getByRole('radio', { name: '每次询问' }).getAttribute('aria-checked')).toBe('true')
    expect(within(detail).queryByRole('combobox', { name: '命令白名单' })).toBeNull()
    fireEvent.click(within(detail).getByRole('radio', { name: '白名单自动' }))
    const field = within(detail).getByRole('combobox', { name: '命令白名单' })
    for (const t of ['  go   build ', 'pnpm test', 'go build']) {
      fireEvent.change(field, { target: { value: t } })
      fireEvent.keyDown(field, { key: 'Enter' })
    }
    expect(within(detail).getByText(/以这些前缀开头的命令自动批准/)).toBeTruthy()
    fireEvent.click(within(detail).getByRole('button', { name: '保存' }))
    await waitFor(() =>
      expect(calls.find((c) => c.key === 'PATCH /api/bots/b1')?.body).toMatchObject({
        concurrency: 3,
        approval: 'allowlist',
        allowlist: ['go build', 'pnpm test'],
      }),
    )
  })

  it('shows command approval read-only to a sysadmin who is not the owner', async () => {
    routes['GET /api/bots'] = () => [bot({ approval: 'allowlist', allowlist: ['go build'] })]
    routes['PATCH /api/bots/b1'] = (b) => bot(b as Partial<BotDto>)
    renderAt('/admin/bots', admin)
    const detail = await screen.findByRole('complementary', { name: 'Bot 详情' })
    expect(within(detail).queryByRole('radio', { name: '每次询问' })).toBeNull()
    expect(within(detail).getByText('白名单自动 · go build')).toBeTruthy()
    expect(within(detail).getByText('只有 Bot 主人能修改命令审批')).toBeTruthy()
    fireEvent.click(within(detail).getByRole('button', { name: '增加' }))
    fireEvent.click(within(detail).getByRole('button', { name: '保存' }))
    await waitFor(() => expect(calls.find((c) => c.key === 'PATCH /api/bots/b1')).toBeTruthy())
    const body = calls.find((c) => c.key === 'PATCH /api/bots/b1')?.body as Record<string, unknown>
    expect(body.concurrency).toBe(3)
    expect('approval' in body || 'allowlist' in body).toBe(false)
  })

  it('lets the owner set the git commit identity, blank = default', async () => {
    routes['GET /api/bots'] = () => [bot({ gitEmail: 'old@corp.com' })]
    routes['PATCH /api/bots/b1'] = (b) => bot(b as Partial<BotDto>)
    renderAt('/', wang)
    const detail = await openMyBot()
    const name = within(detail).getByRole('textbox', { name: 'Git 提交名' }) as HTMLInputElement
    const email = within(detail).getByRole('textbox', { name: 'Git 提交邮箱' }) as HTMLInputElement
    expect([name.placeholder, email.placeholder, email.value]).toEqual([
      '小王的 Claude',
      'b1@bots.gonggong.local',
      'old@corp.com',
    ])
    fireEvent.change(name, { target: { value: ' CC Bot ' } })
    fireEvent.change(email, { target: { value: ' ' } })
    fireEvent.click(within(detail).getByRole('button', { name: '保存' }))
    await waitFor(() =>
      expect(calls.find((c) => c.key === 'PATCH /api/bots/b1')?.body).toMatchObject({
        gitName: 'CC Bot',
        gitEmail: null,
      }),
    )
  })

  it('shows the git commit identity read-only to a sysadmin who is not the owner', async () => {
    routes['GET /api/bots'] = () => [bot({})]
    routes['PATCH /api/bots/b1'] = (b) => bot(b as Partial<BotDto>)
    renderAt('/admin/bots', admin)
    const detail = await screen.findByRole('complementary', { name: 'Bot 详情' })
    expect(within(detail).queryByRole('textbox', { name: 'Git 提交名' })).toBeNull()
    expect(within(detail).getByText('小王的 Claude <b1@bots.gonggong.local>')).toBeTruthy()
    fireEvent.click(within(detail).getByRole('button', { name: '保存' }))
    await waitFor(() => expect(calls.find((c) => c.key === 'PATCH /api/bots/b1')).toBeTruthy())
    const body = calls.find((c) => c.key === 'PATCH /api/bots/b1')?.body as Record<string, unknown>
    expect('gitName' in body || 'gitEmail' in body).toBe(false)
  })

  it('opens a bot page from the ?bot= deep link', async () => {
    routes['GET /api/bots'] = () => [bot({})]
    // Home redirects to the last group; the dialog must survive that.
    routes['GET /api/groups'] = () => [
      {
        id: 'g1',
        name: '退款 v2 迁移',
        kind: 'group',
        members: [],
        botIds: [],
        unread: 0,
        lastSeq: 0,
        liveRunIds: [],
      },
    ]
    useSession.setState({ user: wang, status: 'ready' })
    let search = ''
    let pathname = ''
    function Probe() {
      ;({ search, pathname } = useLocation())
      return null
    }
    render(
      <MemoryRouter initialEntries={['/?bot=b1']}>
        <App />
        <Probe />
      </MemoryRouter>,
    )
    const page = await screen.findByRole('region', { name: 'Bot 概况' })
    expect(within(page).getByRole('heading', { name: '小王的 Claude' })).toBeTruthy()
    await waitFor(() => expect([pathname, search]).toEqual(['/bot/b1', '']))
  })

  it('changes the default model, keeping a thought level the new model offers', async () => {
    routes['GET /api/bots'] = () => [bot({ catalog: CATALOG, model: 'sonnet', effort: 'low' })]
    routes['PATCH /api/bots/b1'] = (b) => bot(b as Partial<BotDto>)
    renderAt('/', wang)
    const detail = await openMyBot()
    fireEvent.click(within(detail).getByRole('button', { name: '模型' }))
    fireEvent.click(screen.getByRole('menuitemcheckbox', { name: 'Opus' }))
    expect(within(detail).getByRole('button', { name: '推理强度' }).textContent).toContain('低')
    fireEvent.click(within(detail).getByRole('button', { name: '保存' }))
    await waitFor(() =>
      expect(calls.find((c) => c.key === 'PATCH /api/bots/b1')?.body).toMatchObject({ model: 'opus' }),
    )
  })

  it('says models become selectable once the machine reports them', async () => {
    routes['GET /api/bots'] = () => [bot({})]
    renderAt('/', wang)
    const detail = await openMyBot()
    expect(within(detail).getByText('跟随默认 · 机器上报可选模型后可设置')).toBeTruthy()
  })

  it('shows the default workspace to its owner only, who can clear it', async () => {
    routes['GET /api/bots'] = () => [bot({ defaultWorkspace: '/src/pay' })]
    routes['PUT /api/bots/b1/default-workspace'] = () => bot({})
    const { unmount } = renderAt('/admin/bots', admin)
    const other = await screen.findByRole('complementary', { name: 'Bot 详情' })
    expect(within(other).queryByTestId('default-workspace')).toBeNull()
    unmount()
    renderAt('/', wang)
    const detail = await openMyBot()
    expect(within(detail).getByTestId('default-workspace').title).toBe('/src/pay')
    fireEvent.click(within(detail).getByRole('button', { name: '清除' }))
    await waitFor(() => expect(within(detail).getByTestId('default-workspace').textContent).toBe('未设置'))
    expect(calls.find((c) => c.key === 'PUT /api/bots/b1/default-workspace')?.body).toEqual({ path: null })
  })

  it('deletes a bot from its row menu in the admin list', async () => {
    routes['GET /api/bots'] = () => [bot({})]
    renderAt('/admin/bots', admin)
    const grid = await screen.findByRole('grid', { name: 'Bot 列表' })
    fireEvent.click(within(grid).getByRole('button', { name: '操作' }))
    fireEvent.click(screen.getByRole('menuitem', { name: '删除 Bot…' }))
    expect(within(await screen.findByRole('alertdialog')).getByText('要删除 小王的 Claude 吗？')).toBeTruthy()
  })

  it('keeps the Bot name column wide while machine and Agent shrink beside the detail panel', async () => {
    routes['GET /api/bots'] = () => [bot({})]
    renderAt('/admin/bots', admin)
    const grid = await screen.findByRole('grid', { name: 'Bot 列表' })
    const template = (grid.querySelector('.ui-table__head') as HTMLElement).style.gridTemplateColumns
    expect(
      template.startsWith('minmax(160px, 1fr) minmax(0, 150px) 96px 96px 64px minmax(0, 200px) 104px'),
    ).toBe(true)
  })

  it('warns when the bot waits for its owner', async () => {
    routes['GET /api/bots'] = () => [
      bot({ binding: 'pending_confirm', presence: 'pending_confirm', createdBy: 'u9', agentVersion: null }),
    ]
    renderAt('/admin/bots', admin)
    const detail = await screen.findByRole('complementary', { name: 'Bot 详情' })
    expect(within(detail).getByText('等待 王磊 确认')).toBeTruthy()
    expect(within(detail).queryByRole('button', { name: '确认' })).toBeNull()
  })

  it('warns when the agent CLI is older than the adapter supports', async () => {
    routes['GET /api/bots'] = () => [bot({ agentVersion: '1.0.128', agentMinVersion: '2.0.0' })]
    renderAt('/admin/bots', admin)
    const detail = await screen.findByRole('complementary', { name: 'Bot 详情' })
    expect(within(detail).getByText('agent 版本低于适配器要求')).toBeTruthy()
    expect(within(detail).getByText(/claude-code 1.0.128 低于 ACP 适配器要求的 2.0.0/)).toBeTruthy()
  })

  it('shows last-7-day usage and who used the bot', async () => {
    routes['GET /api/bots'] = () => [bot({})]
    routes['GET /api/usage?by=user&days=7&botId=b1'] = () => [
      { key: 'u1', name: '王磊', runs: 3, totalTokens: 256_000, unreported: 0 },
      { key: 'u2', name: '李建国', runs: 1, totalTokens: 0, unreported: 1 },
    ]
    renderAt('/', wang)
    const detail = await openMyBot()
    expect(await within(detail).findByText('256k tokens · 4 轮')).toBeTruthy()
    const rows = within(detail)
      .getAllByTestId('usage-row')
      .map((r) => r.textContent)
    expect(rows).toEqual(['王磊256k', '李建国未上报'])
  })
})

describe('bot page', () => {
  it('shows where the bot works, its live turn and token usage in the main area', async () => {
    routes['GET /api/bots'] = () => [bot({ presence: 'running', groupCount: 2 })]
    routes['GET /api/bots/b1/activity'] = () => [
      {
        groupId: 'g1',
        groupName: '支付服务重构',
        groupKind: 'group',
        workspacePath: '/Users/wang/pay',
        run: { id: 'r1', status: 'running', step: '编辑 src/pay.ts', startedAt: new Date().toISOString() },
        lastRunAt: new Date().toISOString(),
      },
      {
        groupId: 'g2',
        groupName: '官网改版',
        groupKind: 'group',
        workspacePath: null,
        run: null,
        lastRunAt: null,
      },
    ]
    routes['GET /api/usage?by=user&days=30&botId=b1'] = () => [
      { key: 'u1', name: '王磊', runs: 3, totalTokens: 256_000, unreported: 0 },
      { key: 'u2', name: '李建国', runs: 1, totalTokens: 0, unreported: 1 },
    ]
    routes['GET /api/usage?by=group&days=30&botId=b1'] = () => [
      { key: 'g1', name: '支付服务重构', runs: 4, totalTokens: 256_000, unreported: 1 },
    ]
    renderAt('/bot/b1', wang)
    const page = await screen.findByRole('region', { name: 'Bot 概况' })
    expect(within(page).getByRole('heading', { name: '小王的 Claude' })).toBeTruthy()

    const live = await within(page).findByRole('list', { name: '正在工作' })
    expect(within(live).getByText('运行中')).toBeTruthy()
    expect(within(live).getByText('支付服务重构')).toBeTruthy()
    expect(within(live).getByText('编辑 src/pay.ts')).toBeTruthy()
    const places = within(page).getByRole('list', { name: '工作位置' })
    expect(within(places).getByText('~/pay')).toBeTruthy()
    expect(within(places).getByText('官网改版')).toBeTruthy()

    const tile = (label: string) => within(page).getByText(label).closest('.usage-stat')?.textContent
    await waitFor(() => expect(tile('token 合计')).toBe('token 合计256k'))
    expect(tile('运行轮次')).toBe('运行轮次4')
    expect(tile('所在群')).toBe('所在群2')

    fireEvent.click(within(places).getByRole('link', { name: /官网改版/ }))
    await waitFor(() => expect(screen.queryByRole('region', { name: 'Bot 概况' })).toBeNull())
  })

  it('says the bot is idle when nothing runs', async () => {
    routes['GET /api/bots'] = () => [bot({})]
    renderAt('/bot/b1', wang)
    const page = await screen.findByRole('region', { name: 'Bot 概况' })
    expect(await within(page).findByText('空闲，在群里 @ 它即可开工')).toBeTruthy()
  })
})

describe('bot page ux', () => {
  it('lets the page body scroll inside the fixed-height main area', () => {
    const css = readFileSync('src/features/bots/bots.css', 'utf8')
    const block = css.slice(css.indexOf('.bot-page {'), css.indexOf('}', css.indexOf('.bot-page {')))
    expect(block).toContain('min-height: 0')
  })

  it('names managed workspaces instead of showing their internal path', async () => {
    routes['GET /api/bots'] = () => [bot({ groupCount: 2 })]
    routes['GET /api/bots/b1/activity'] = () => [
      {
        groupId: 'g1',
        groupName: '支付服务重构',
        groupKind: 'group',
        workspacePath: '/Users/wang/.gonggong/workspaces/g1/b1/_empty',
        run: null,
        lastRunAt: null,
      },
      {
        groupId: 'g2',
        groupName: '官网改版',
        groupKind: 'group',
        workspacePath: '/home/wang/site',
        run: null,
        lastRunAt: null,
      },
    ]
    renderAt('/bot/b1', wang)
    const page = await screen.findByRole('region', { name: 'Bot 概况' })
    const places = await within(page).findByRole('list', { name: '工作位置' })
    const managed = within(places).getByText('托管工作区')
    expect(managed.getAttribute('title')).toBe('/Users/wang/.gonggong/workspaces/g1/b1/_empty')
    expect(within(places).getByText('~/site').getAttribute('title')).toBe('/home/wang/site')
    expect(within(places).queryByText(/\.gonggong/)).toBeNull()
  })

  it('labels the header button that opens the bot editor', async () => {
    routes['GET /api/bots'] = () => [bot({})]
    renderAt('/bot/b1', wang)
    const page = await screen.findByRole('region', { name: 'Bot 概况' })
    const edit = within(page).getByRole('button', { name: '编辑 Bot' })
    expect(edit.textContent).toBe('编辑')
    fireEvent.click(edit)
    const dialog = await screen.findByRole('dialog', { name: /Bot 详情/ })
    expect(within(dialog).getByText(/作为 Bot 的角色说明/)).toBeTruthy()
    expect(within(dialog).queryByText(/优先级/)).toBeNull()
  })

  it('lists the bots running on a machine on its page', async () => {
    routes['GET /api/bots'] = () => [
      bot({}),
      bot({ id: 'b2', name: '小王的 Codex', agentKind: 'codex', presence: 'running' }),
      bot({ id: 'b3', name: '别处的 Bot', machineId: 'm2', machineName: 'other' }),
    ]
    routes['GET /api/machines'] = () => [mbp]
    renderAt('/', wang)
    const nav = screen.getByRole('navigation', { name: '会话列表' })
    const section = await within(nav).findByRole('region', { name: '我的机器' })
    fireEvent.click(await within(section).findByRole('link', { name: /wanglei-mbp/ }))
    const dialog = await screen.findByRole('region', { name: '机器详情' })
    const list = within(dialog).getByRole('list', { name: '运行的 Bot' })
    const rows = within(list)
      .getAllByRole('listitem')
      .map((r) => r.textContent)
    expect(rows).toEqual(['小王的 Claude在线空闲', '小王的 Codex运行中'])
    fireEvent.click(within(list).getByRole('link', { name: /小王的 Codex/ }))
    expect(await screen.findByRole('region', { name: 'Bot 概况' })).toBeTruthy()
    expect(screen.queryByRole('region', { name: '机器详情' })).toBeNull()
  })
})
