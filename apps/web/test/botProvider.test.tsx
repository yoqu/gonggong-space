import type {
  AgentCatalog,
  BotDto,
  MachineDto,
  ProviderStoreView,
  ProviderView,
  UserDto,
} from '@gonggong/protocol'
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

const OFFICIAL: AgentCatalog = {
  current: 'sonnet',
  efforts: [],
  effort: null,
  models: [{ value: 'sonnet', name: 'Sonnet', efforts: [], effort: null }],
}
const level = (value: string) => ({ value, name: value })
const KIMI: AgentCatalog = {
  current: 'kimi-for-coding',
  efforts: [],
  effort: null,
  models: [
    { value: 'kimi-for-coding', name: 'kimi-for-coding', efforts: [], effort: null },
    { value: 'kimi-k2', name: 'kimi-k2', efforts: ['low', 'high'].map(level), effort: 'low' },
  ],
}

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
      path: '/c',
      minVersion: null,
      catalog: OFFICIAL,
      latest: null,
      managed: false,
      upgradeCommand: null,
      installCommand: null,
    },
  ],
  daemonVersion: '0.9.0',
  features: ['tools', 'providers', 'agentSettings', 'protocolProviders'],
  lastSeenAt: null,
  hostname: 'wanglei-mbp',
  system: null,
  boundAt: '2026-09-01T00:00:00Z',
  createdAt: '2026-09-01T00:00:00Z',
}

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
  aiReview: false,
  model: null,
  effort: null,
  catalog: OFFICIAL,
  ...o,
})

const provider = (
  id: string,
  name: string,
  protocol: 'anthropic' | 'openai' = 'anthropic',
  o: Partial<ProviderView['endpoints'][number]> = {},
): ProviderView => ({
  id,
  name,
  presetId: null,
  revision: 1,
  apiKey: '****abcd',
  proxy: null,
  source: null,
  endpoints: [
    {
      protocol,
      baseUrl: 'https://x.example.com',
      apiKeyField: null,
      wireApi: null,
      model: null,
      models: null,
      effort: null,
      env: {},
      args: [],
      configDir: null,
      executablePath: null,
      modelOptions: [],
      ...o,
    },
  ],
})

const VIEW: ProviderStoreView = {
  official: {},
  machine: { claude: { provider: 'p1', model: 'kimi-k2' } },
  bots: {},
  providers: [
    provider('p1', 'Kimi', 'anthropic', { modelOptions: ['kimi-for-coding', 'kimi-k2'] }),
    provider('p2', 'GLM', 'anthropic', { model: 'glm-4.6' }),
    provider('p3', 'Codex 中转', 'openai'),
  ],
  sessions: [],
  agentSettings: {},
  cli: {},
}

/** The labels of the open menu, without the second lines. */
const menuLabels = () =>
  screen
    .getAllByRole('menuitemcheckbox')
    .map((i) => i.querySelector('[id$="-l"]')?.textContent ?? i.textContent)

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

describe('bot provider and model', () => {
  it('inherits the machine default, offering each provider with its models and greying out another protocol', async () => {
    mockApi({
      'GET /machines/m1/providers': VIEW,
      'GET /bots/b1/catalog': { catalog: KIMI },
    })
    renderDetail()
    const select = await screen.findByRole('button', { name: '供应商/模型' })
    await waitFor(() => expect(select.textContent).toContain('使用电脑默认（当前：Kimi / kimi-k2）'))
    fireEvent.click(select)
    expect(menuLabels()).toEqual([
      '使用电脑默认（当前：Kimi / kimi-k2）',
      '官方登录 / 默认模型',
      '官方登录 / Sonnet',
      'Kimi / 默认模型',
      'Kimi / kimi-for-coding',
      'Kimi / kimi-k2',
      'GLM / 默认（glm-4.6）',
      'Codex 中转',
    ])
    const codex = screen.getAllByRole('menuitemcheckbox').at(-1) as HTMLElement
    expect(codex.getAttribute('aria-disabled')).toBe('true')
    expect(codex.textContent).toContain('该供应商只提供 OpenAI 兼容 接口，Claude Code 需要 Anthropic 兼容')
    fireEvent.click(codex)
    expect(select.textContent).toContain('使用电脑默认')
  })

  it('overrides provider, model and level in one PUT on 保存', async () => {
    const calls = mockApi({
      'GET /machines/m1/providers': { ...VIEW, machine: {} },
      'GET /bots/b1/catalog': { catalog: OFFICIAL },
      'GET /machines/m1/catalog?agent=claude&provider=p1': { catalog: KIMI },
      'PUT /bots/b1/provider': { ...VIEW, machine: {}, bots: { b1: 'p1' } },
    })
    renderDetail()
    const save = screen.getByRole('button', { name: '保存' }) as HTMLButtonElement
    expect(save.disabled).toBe(true)
    fireEvent.click(await screen.findByRole('button', { name: '供应商/模型' }))
    fireEvent.click(await screen.findByRole('menuitemcheckbox', { name: 'Kimi / kimi-k2' }))
    expect(calls.some((c) => c.method === 'PUT')).toBe(false)
    fireEvent.click(await screen.findByRole('button', { name: '推理强度' }))
    fireEvent.click(await screen.findByRole('menuitemcheckbox', { name: '高' }))
    fireEvent.click(save)
    await waitFor(() => expect(calls.some((c) => c.method === 'PUT')).toBe(true))
    expect(calls.filter((c) => c.method !== 'GET')).toEqual([
      { method: 'PUT', path: '/bots/b1/provider', body: { choice: 'p1', model: 'kimi-k2', effort: 'high' } },
    ])
  })

  it('changes only the model of its own provider without asking', async () => {
    const view = {
      ...VIEW,
      bots: { b1: 'p1' },
      sessions: [{ groupId: 'g1', botId: 'b1', agent: 'claude' as const, provider: 'p1' }],
    }
    const calls = mockApi({
      'GET /machines/m1/providers': view,
      'GET /bots/b1/catalog': { catalog: KIMI },
      'PUT /bots/b1/provider': view,
    })
    renderDetail(bot({ model: 'kimi-k2' }))
    const select = await screen.findByRole('button', { name: '供应商/模型' })
    await waitFor(() => expect(select.textContent).toBe('Kimi / kimi-k2'))
    fireEvent.click(select)
    fireEvent.click(screen.getByRole('menuitemcheckbox', { name: 'Kimi / kimi-for-coding' }))
    fireEvent.click(screen.getByRole('button', { name: '保存' }))
    await waitFor(() =>
      expect(calls.find((c) => c.method === 'PUT')?.body).toEqual({ choice: 'p1', model: 'kimi-for-coding' }),
    )
    expect(screen.queryByRole('alertdialog')).toBeNull()
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
    fireEvent.click(await screen.findByRole('button', { name: '供应商/模型' }))
    fireEvent.click(await screen.findByRole('menuitemcheckbox', { name: '官方登录 / 默认模型' }))
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

  it('offers providers only on an older client, the model picked apart', async () => {
    useWorkspace.setState({ machines: [{ ...mbp, features: ['tools', 'providers', 'agentSettings'] }] })
    const calls = mockApi({
      'GET /machines/m1/providers': { ...VIEW, machine: { claude: { provider: 'p1', model: null } } },
      'GET /bots/b1/catalog': { catalog: KIMI },
      'PUT /bots/b1/provider': VIEW,
    })
    renderDetail()
    const select = await screen.findByRole('button', { name: '供应商/模型' })
    expect(screen.getByText('升级这台电脑的共工客户端后可同时选择模型')).toBeTruthy()
    await waitFor(() => expect(select.textContent).toContain('使用电脑默认（当前：Kimi）'))
    fireEvent.click(select)
    expect(menuLabels()).toEqual(['使用电脑默认（当前：Kimi）', '官方登录', 'Kimi', 'GLM', 'Codex 中转'])
    fireEvent.click(screen.getByRole('menuitemcheckbox', { name: '使用电脑默认（当前：Kimi）' }))
    fireEvent.click(screen.getByRole('button', { name: '模型' }))
    fireEvent.click(await screen.findByRole('menuitemcheckbox', { name: 'kimi-k2' }))
    fireEvent.click(screen.getByRole('button', { name: '保存' }))
    await waitFor(() =>
      expect(calls.find((c) => c.method === 'PUT')?.body).toEqual({ choice: 'inherit', model: 'kimi-k2' }),
    )
  })

  it('is disabled with the reason when the machine is offline', async () => {
    const calls = mockApi({})
    useWorkspace.setState({ machines: [{ ...mbp, online: false }] })
    renderDetail()
    const select = screen.getByRole('button', { name: '供应商/模型' }) as HTMLButtonElement
    expect(select.disabled).toBe(true)
    expect(screen.getByText(/电脑离线/)).toBeTruthy()
    expect(calls.some((c) => c.path.includes('/providers'))).toBe(false)
  })

  it('is disabled for someone who does not own the bot', () => {
    mockApi({})
    renderDetail(bot(), { ...me, id: 'u9', role: 'sysadmin' })
    expect((screen.getByRole('button', { name: '供应商/模型' }) as HTMLButtonElement).disabled).toBe(true)
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
    await waitFor(() => expect(thinking.textContent).toContain('跟随电脑设置（当前：开）'))
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
    fireEvent.click(await screen.findByRole('menuitemcheckbox', { name: /跟随电脑设置/ }))
    fireEvent.click(screen.getByRole('button', { name: '保存' }))
    await waitFor(() => expect(calls.find((c) => c.method === 'PATCH')?.body).toEqual({ agentSettings: {} }))
  })

  it('caps the language override and warns when the daemon cannot apply overrides', async () => {
    mockApi({ 'GET /machines/m1/providers': view, 'GET /bots/b1/catalog': { catalog: KIMI } })
    useWorkspace.setState({ machines: [{ ...mbp, features: ['tools', 'providers', 'protocolProviders'] }] })
    renderDetail()
    const language = await screen.findByRole('textbox', { name: '语言' })
    expect(language.getAttribute('maxlength')).toBe('64')
    expect(screen.getByText('这台电脑的共工客户端版本过旧，覆盖不会生效')).toBeTruthy()
  })

  it('does not warn on a daemon that applies the overrides', async () => {
    mockApi({ 'GET /machines/m1/providers': view, 'GET /bots/b1/catalog': { catalog: KIMI } })
    renderDetail()
    await screen.findByRole('textbox', { name: '语言' })
    expect(screen.queryByText('这台电脑的共工客户端版本过旧，覆盖不会生效')).toBeNull()
  })

  it("shows the overrides read-only to anyone but the bot's owner", () => {
    mockApi({})
    renderDetail(bot({ agentSettings: { thinking: 'false' } }), { ...me, id: 'u9', role: 'sysadmin' })
    expect(screen.queryByRole('button', { name: '扩展思考' })).toBeNull()
    expect(screen.getByText('只有 Bot 主人可以修改 Agent 设置')).toBeTruthy()
    expect(screen.getByText('语言：跟随电脑设置 · 扩展思考：关 · 提交署名：跟随电脑设置')).toBeTruthy()
  })
})
