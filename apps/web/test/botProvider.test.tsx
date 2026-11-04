import type { AgentCatalog, BotDto, MachineDto, ProviderStoreView, UserDto } from '@gonggong/protocol'
import { fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import { MemoryRouter } from 'react-router'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { useWorkspace } from '../src/app/workspace'
import { BotDetail } from '../src/features/bots/BotSettings'
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

const mbp: MachineDto = {
  id: 'm1',
  ownerId: 'u1',
  name: 'wanglei-mbp',
  os: 'macos',
  arch: 'aarch64',
  online: true,
  agents: [],
  daemonVersion: '0.9.0',
  features: ['tools', 'providers', 'agentSettings'],
  lastSeenAt: null,
  hostname: 'wanglei-mbp',
  system: null,
  boundAt: '2026-09-01T00:00:00Z',
  createdAt: '2026-09-01T00:00:00Z',
}

const OFFICIAL: AgentCatalog = {
  current: 'sonnet',
  efforts: [],
  effort: null,
  models: [{ value: 'sonnet', name: 'Sonnet', efforts: [], effort: null }],
}
const KIMI: AgentCatalog = {
  current: 'kimi-for-coding',
  efforts: [],
  effort: null,
  models: [
    { value: 'kimi-for-coding', name: 'kimi-for-coding', efforts: [], effort: null },
    { value: 'kimi-k2', name: 'kimi-k2', efforts: [], effort: null },
  ],
}

const bot = (o: Partial<BotDto> = {}): BotDto => ({
  id: 'b1',
  teamId: 't1',
  name: '小王的 Claude',
  ownerId: 'u1',
  ownerName: '王磊',
  agentKind: 'claude',
  avatar: 'role-no',
  avatarUrl: null,
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
  model: null,
  effort: null,
  catalog: OFFICIAL,
  ...o,
})

const provider = (id: string, name: string, agent: 'claude' | 'codex' = 'claude') => ({
  id,
  agent,
  name,
  presetId: null,
  revision: 1,
  baseUrl: 'https://x.example.com',
  apiKey: '****abcd',
  apiKeyField: null,
  model: null,
  models: null,
  env: {},
  proxy: null,
  args: [],
  wireApi: null,
  effort: null,
  source: null,
})

const VIEW: ProviderStoreView = {
  official: {},
  machine: { claude: 'p1' },
  bots: {},
  providers: [provider('p1', 'Kimi'), provider('p2', 'GLM'), provider('p3', 'Codex 中转', 'codex')],
  sessions: [],
  agentSettings: {},
  cli: {},
}

beforeEach(() => {
  useWorkspace.setState({ machines: [mbp], groups: [], bots: [] })
})
afterEach(() => vi.unstubAllGlobals())

/** Renders the settings on the 运行配置 tab, where the provider and models are. */
const renderDetail = (b: BotDto = bot(), user: UserDto = me) => {
  const out = render(
    <MemoryRouter>
      <BotDetail bot={b} me={user} users={[]} />
    </MemoryRouter>,
  )
  fireEvent.click(screen.getByRole('tab', { name: '运行配置' }))
  return out
}

describe('bot provider', () => {
  it('offers inherit (naming the machine default), official and the same-agent providers', async () => {
    mockApi({
      'GET /machines/m1/providers': VIEW,
      'GET /bots/b1/catalog': { catalog: KIMI },
    })
    renderDetail()
    const select = await screen.findByRole('button', { name: '供应商' })
    await waitFor(() => expect(select.textContent).toContain('继承机器（当前：Kimi）'))
    fireEvent.click(select)
    const names = screen.getAllByRole('menuitemcheckbox').map((i) => i.textContent)
    expect(names).toEqual(['继承机器（当前：Kimi）', '官方登录', 'Kimi', 'GLM'])
  })

  it('offers the models of the provider picked, and sets both on 保存, the provider first', async () => {
    const calls = mockApi({
      'GET /machines/m1/providers': { ...VIEW, machine: {} },
      'GET /bots/b1/catalog': { catalog: OFFICIAL },
      'GET /machines/m1/catalog?agent=claude&provider=p2': { catalog: KIMI },
      'PUT /bots/b1/provider': { ...VIEW, machine: {}, bots: { b1: 'p2' } },
      'PATCH /bots/b1': bot({ model: 'kimi-k2' }),
    })
    renderDetail()
    const save = screen.getByRole('button', { name: '保存' }) as HTMLButtonElement
    expect(save.disabled).toBe(true)
    fireEvent.click(await screen.findByRole('button', { name: '供应商' }))
    fireEvent.click(await screen.findByRole('menuitemcheckbox', { name: 'GLM' }))
    expect(calls.some((c) => c.method === 'PUT')).toBe(false)
    fireEvent.click(await screen.findByRole('button', { name: '模型' }))
    fireEvent.click(await screen.findByRole('menuitemcheckbox', { name: 'kimi-k2' }))
    expect(screen.queryByRole('menuitemcheckbox', { name: 'Sonnet' })).toBeNull()
    fireEvent.click(save)
    await waitFor(() => expect(calls.some((c) => c.method === 'PATCH')).toBe(true))
    const writes = calls.filter((c) => c.method !== 'GET')
    expect(writes).toEqual([
      { method: 'PUT', path: '/bots/b1/provider', body: { choice: 'p2' } },
      { method: 'PATCH', path: '/bots/b1', body: { model: 'kimi-k2' } },
    ])
  })

  it('confirms on 保存 when sessions of the bot keep the old provider; 取消 saves nothing', async () => {
    const view = {
      ...VIEW,
      sessions: [{ groupId: 'g1', botId: 'b1', agent: 'claude' as const, provider: 'p1' }],
    }
    useWorkspace.setState({ groups: [{ id: 'g1', name: '前端组' } as never], bots: [bot()] })
    const calls = mockApi({
      'GET /machines/m1/providers': view,
      'GET /bots/b1/catalog': { catalog: KIMI },
      'GET /machines/m1/catalog?agent=claude&provider=official': { catalog: OFFICIAL },
      'PUT /bots/b1/provider': { ...view, bots: { b1: 'official' } },
    })
    renderDetail()
    fireEvent.click(await screen.findByRole('button', { name: '供应商' }))
    fireEvent.click(await screen.findByRole('menuitemcheckbox', { name: '官方登录' }))
    fireEvent.click(screen.getByRole('button', { name: '保存' }))
    let alert = await screen.findByRole('alertdialog')
    expect(alert.textContent).toContain('1 个群的会话仍在使用 Kimi，开启新会话后才会切换到 官方登录')
    expect(within(alert).getByText('前端组（小王的 Claude）')).toBeTruthy()
    fireEvent.click(within(alert).getByRole('button', { name: '取消' }))
    await waitFor(() => expect(screen.queryByRole('alertdialog')).toBeNull())
    expect(calls.some((c) => c.method !== 'GET')).toBe(false)
    fireEvent.click(screen.getByRole('button', { name: '保存' }))
    alert = await screen.findByRole('alertdialog')
    fireEvent.click(within(alert).getByRole('button', { name: '切换' }))
    await waitFor(() => expect(calls.find((c) => c.method === 'PUT')?.body).toEqual({ choice: 'official' }))
  })

  it('is disabled with the reason when the machine is offline', async () => {
    const calls = mockApi({})
    useWorkspace.setState({ machines: [{ ...mbp, online: false }] })
    renderDetail()
    const select = screen.getByRole('button', { name: '供应商' }) as HTMLButtonElement
    expect(select.disabled).toBe(true)
    expect(screen.getByText(/机器离线/)).toBeTruthy()
    expect(calls.some((c) => c.path.includes('/providers'))).toBe(false)
  })

  it('is disabled for someone who does not own the bot', () => {
    mockApi({})
    renderDetail(bot(), { ...me, id: 'u9', role: 'sysadmin' })
    expect((screen.getByRole('button', { name: '供应商' }) as HTMLButtonElement).disabled).toBe(true)
    expect(screen.getByText('只有 Bot 主人可以设置其供应商')).toBeTruthy()
  })

  it("offers a sysadmin the models of the bot's provider though they cannot set it", async () => {
    mockApi({ 'GET /bots/b1/catalog': { catalog: KIMI } })
    renderDetail(bot(), { ...me, id: 'u9', role: 'sysadmin' })
    fireEvent.click(await screen.findByRole('button', { name: '模型' }))
    await waitFor(() => expect(screen.getByRole('menuitemcheckbox', { name: 'kimi-k2' })).toBeTruthy())
  })
})

describe('bot agent settings', () => {
  const view = { ...VIEW, agentSettings: { claude: { values: { thinking: 'true' }, inheritCli: true } } }

  it('follows the machine until overridden, and saves the overrides', async () => {
    const calls = mockApi({
      'GET /machines/m1/providers': view,
      'GET /bots/b1/catalog': { catalog: KIMI },
      'PATCH /bots/b1': bot(),
    })
    renderDetail()
    const thinking = await screen.findByRole('button', { name: '扩展思考' })
    await waitFor(() => expect(thinking.textContent).toContain('跟随机器设置（当前：开）'))
    fireEvent.click(thinking)
    fireEvent.click(screen.getByRole('menuitemcheckbox', { name: '关' }))
    fireEvent.click(screen.getByRole('button', { name: '提交署名' }))
    fireEvent.click(screen.getByRole('menuitemcheckbox', { name: '不署名' }))
    fireEvent.change(screen.getByRole('textbox', { name: '语言' }), { target: { value: 'english' } })
    fireEvent.click(screen.getByRole('button', { name: '保存' }))
    await waitFor(() =>
      expect(calls.find((c) => c.method === 'PATCH')?.body).toEqual({
        agentSettings: { thinking: 'false', attribution: 'none', language: 'english' },
      }),
    )
  })

  it('goes back to following the machine', async () => {
    const calls = mockApi({
      'GET /machines/m1/providers': view,
      'GET /bots/b1/catalog': { catalog: KIMI },
      'PATCH /bots/b1': bot(),
    })
    renderDetail(bot({ agentSettings: { thinking: 'false' } }))
    const thinking = await screen.findByRole('button', { name: '扩展思考' })
    expect(thinking.textContent).toBe('关')
    fireEvent.click(thinking)
    fireEvent.click(await screen.findByRole('menuitemcheckbox', { name: /跟随机器设置/ }))
    fireEvent.click(screen.getByRole('button', { name: '保存' }))
    await waitFor(() => expect(calls.find((c) => c.method === 'PATCH')?.body).toEqual({ agentSettings: {} }))
  })

  it('caps the language override and warns when the daemon cannot apply overrides', async () => {
    mockApi({ 'GET /machines/m1/providers': view, 'GET /bots/b1/catalog': { catalog: KIMI } })
    useWorkspace.setState({ machines: [{ ...mbp, features: ['tools', 'providers'] }] })
    renderDetail()
    const language = await screen.findByRole('textbox', { name: '语言' })
    expect(language.getAttribute('maxlength')).toBe('64')
    expect(screen.getByText('该机器的 daemon 版本过旧，覆盖不会生效')).toBeTruthy()
  })

  it('does not warn on a daemon that applies the overrides', async () => {
    mockApi({ 'GET /machines/m1/providers': view, 'GET /bots/b1/catalog': { catalog: KIMI } })
    renderDetail()
    await screen.findByRole('textbox', { name: '语言' })
    expect(screen.queryByText('该机器的 daemon 版本过旧，覆盖不会生效')).toBeNull()
  })

  it("shows the overrides read-only to anyone but the bot's owner", () => {
    mockApi({})
    renderDetail(bot({ agentSettings: { thinking: 'false' } }), { ...me, id: 'u9', role: 'sysadmin' })
    expect(screen.queryByRole('button', { name: '扩展思考' })).toBeNull()
    expect(screen.getByText('只有 Bot 主人可以修改 Agent 设置')).toBeTruthy()
    expect(screen.getByText('语言：跟随机器设置 · 扩展思考：关 · 提交署名：跟随机器设置')).toBeTruthy()
  })
})
