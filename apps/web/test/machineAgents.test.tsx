import type {
  AgentState,
  BotDto,
  CcSwitchCandidate,
  MachineAgentsDto,
  MachineDto,
  ProviderEndpoint,
  ProviderPreset,
  ProviderStoreView,
  ProviderView,
  UserDto,
  WebEvent,
} from '@gonggong/protocol'
import { act, fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import { MemoryRouter } from 'react-router'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { useSession } from '../src/app/session'
import { useWorkspace } from '../src/app/workspace'
import { MachinePage } from '../src/features/machines/MachinePage'
import { realtime } from '../src/lib/realtime'
import { Toaster } from '../src/ui'
import { apiError, type Call, mockApi } from './mockApi'

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
  features: ['tools', 'providers', 'ccSwitch', 'agentSettings', 'claudeProfile', 'protocolProviders'],
  lastSeenAt: null,
  hostname: 'wanglei-mbp',
  system: null,
  boundAt: '2026-09-01T00:00:00Z',
  createdAt: '2026-09-01T00:00:00Z',
}

const agent = (kind: AgentState['kind'], o: Partial<AgentState> = {}): AgentState => ({
  kind,
  available: true,
  version: null,
  path: null,
  minVersion: null,
  catalog: null,
  latest: null,
  managed: false,
  upgradeCommand: null,
  installCommand: null,
  ...o,
})

const TOOLS: MachineAgentsDto = {
  node: { installed: true, version: '22.1.0', latest: '22.9.0', managed: true, path: '/n' },
  agents: [
    agent('claude', {
      version: '2.1.0',
      latest: '2.1.285',
      path: '/c',
      upgradeCommand: 'claude update',
      catalog: {
        current: 'sonnet',
        efforts: [],
        effort: null,
        models: [{ value: 'sonnet', name: 'Sonnet', efforts: [], effort: null }],
      },
    }),
    agent('codex', { available: false, latest: '0.159.2' }),
  ],
  settings: { mirror: { kind: 'npmmirror' } },
}

const kimiPreset: ProviderPreset = {
  id: 'kimi-coding',
  name: 'Kimi For Coding',
  group: 'cn',
  websiteUrl: 'https://www.kimi.com/code/',
  apiKeyUrl: 'https://platform.kimi.com/keys',
  endpoints: [
    {
      protocol: 'anthropic',
      baseUrl: 'https://api.kimi.com/coding/',
      apiKeyField: 'ANTHROPIC_AUTH_TOKEN',
      model: 'kimi-for-coding',
      models: null,
      modelOptions: ['kimi-for-coding', 'kimi-k2'],
      env: {},
      wireApi: null,
      effort: null,
      modelContext: {},
    },
  ],
}
const PRESETS: ProviderPreset[] = [
  kimiPreset,
  {
    ...kimiPreset,
    id: 'openrouter',
    name: 'OpenRouter',
    group: 'aggregator',
    endpoints: [{ ...kimiPreset.endpoints[0]!, baseUrl: 'https://openrouter.ai/api' }],
  },
]

const endpoint = (o: Partial<ProviderEndpoint> = {}): ProviderEndpoint => ({
  protocol: 'anthropic',
  baseUrl: 'https://api.kimi.com/coding/',
  apiKeyField: 'ANTHROPIC_AUTH_TOKEN',
  model: 'kimi-for-coding',
  models: null,
  env: {},
  args: [],
  wireApi: null,
  effort: null,
  configDir: null,
  executablePath: null,
  modelOptions: ['kimi-for-coding', 'kimi-k2'],
  ...o,
})
const kimi: ProviderView = {
  id: 'p1',
  name: 'Kimi',
  presetId: 'kimi-coding',
  revision: 1,
  apiKey: '****abcd',
  proxy: 'http://bob:****@10.0.0.2:3128',
  source: null,
  endpoints: [endpoint()],
}
/** `kimi` with its one endpoint changed. */
const kimiWith = (o: Partial<ProviderEndpoint>, p: Partial<ProviderView> = {}): ProviderView => ({
  ...kimi,
  ...p,
  endpoints: [endpoint(o)],
})
const VIEW: ProviderStoreView = {
  machine: {},
  official: {},
  bots: {},
  providers: [kimi],
  sessions: [
    { groupId: 'g1', botId: 'b1', agent: 'claude', provider: 'official' },
    { groupId: 'g2', botId: 'b1', agent: 'claude', provider: 'official' },
    { groupId: 'g3', botId: 'b2', agent: 'claude', provider: 'official' },
  ],
  agentSettings: {},
  cli: {},
}

const group = (id: string, name: string) => ({ id, name }) as never
const bot = (id: string, name: string) => ({ id, name }) as BotDto

let handlers: Set<(e: WebEvent) => void>
const emit = (e: WebEvent) =>
  act(() => {
    for (const h of handlers) h(e)
  })

beforeEach(() => {
  handlers = new Set()
  vi.spyOn(realtime, 'subscribe').mockImplementation((h) => {
    handlers.add(h)
    return () => handlers.delete(h)
  })
  useSession.setState({ user: me, status: 'ready' })
  useWorkspace.setState({
    groups: [group('g1', '前端组'), group('g2', '后端组'), group('g3', '测试组')],
    bots: [bot('b1', '小王的 Claude'), bot('b2', '审查员')],
    machines: [mbp],
  })
})
afterEach(() => {
  vi.restoreAllMocks()
  vi.unstubAllGlobals()
})

const open = (machine: MachineDto = mbp, url = '/') =>
  render(
    <MemoryRouter initialEntries={[url]}>
      <MachinePage machine={machine} bots={[]} ownerName={machine.ownerId === me.id ? undefined : '周婷'} />
      <Toaster />
    </MemoryRouter>,
  )

const tab = (name: string) => screen.getByRole('tab', { name }) as HTMLButtonElement

const AGENTS_TAB = 'Agent 与供应商'
const LIVE = {
  'GET /machines/m1/tools': TOOLS,
  'GET /machines/m1/providers': VIEW,
  'GET /machines/m1/providers/presets': PRESETS,
}

/** The row of an agent (its open button), in whichever group it is listed. */
const agentButton = (name: string) => screen.getByRole('button', { name: new RegExp(`^${name}`) })
/** Opens an agent's details; returns its row. */
const openAgent = async (name: string) => {
  const button = await screen.findByRole('button', { name: new RegExp(`^${name}`) })
  if (button.getAttribute('aria-expanded') !== 'true') fireEvent.click(button)
  return button.closest('.ag-agent') as HTMLElement
}
/** The Agent tab with Claude Code's details open; returns its 默认「供应商/模型」. */
const openDefault = async (machine: MachineDto = mbp, name = 'Claude Code') => {
  open(machine)
  fireEvent.click(tab(AGENTS_TAB))
  const row = await openAgent(name)
  return within(row).getByRole('region', { name: '默认「供应商/模型」' })
}

describe('machine details sections', () => {
  it('gives the owner 概览, Agent 与供应商, 工作区, Git 访问 and 诊断', () => {
    open({ ...mbp, features: [...mbp.features, 'machineAdmin', 'gitAccess'] })
    expect(screen.getAllByRole('tab').map((t) => t.textContent)).toEqual([
      '概览',
      'Agent 与供应商',
      '工作区',
      'Git 访问',
      '诊断',
    ])
    expect(tab('概览').getAttribute('aria-selected')).toBe('true')
    for (const name of [AGENTS_TAB, '工作区', 'Git 访问', '诊断']) expect(tab(name).disabled).toBe(false)
  })

  it('has no tabs for someone else (a sysadmin looking at a member machine), saying whose it is', () => {
    open({ ...mbp, ownerId: 'u2' })
    expect(screen.queryByRole('tab')).toBeNull()
    expect(screen.getByRole('note').textContent).toContain('正在以管理员身份查看 周婷 的机器')
    expect(screen.getByRole('link', { name: '返回后台' }).getAttribute('href')).toBe('/admin/machines')
    expect(screen.queryByRole('button', { name: '新建终端' })).toBeNull()
    expect(screen.getByText('wanglei-mbp', { selector: '.machine__host' })).toBeTruthy()
  })

  it('keeps the live sections open while offline, saying when it was last seen and how to bring it back', () => {
    const calls = mockApi(LIVE)
    const lastSeenAt = '2026-11-01T08:00:00Z'
    open({ ...mbp, online: false, lastSeenAt, features: [...mbp.features, 'machineAdmin', 'gitAccess'] })
    for (const name of [AGENTS_TAB, '工作区', 'Git 访问', '诊断']) {
      expect(tab(name).disabled).toBe(false)
      fireEvent.click(tab(name))
      const note = screen.getByRole('region', { name: '机器离线' })
      expect(note.textContent).toContain(new Date(lastSeenAt).toLocaleString())
      expect(note.textContent).toContain('共工空间客户端')
      expect(within(note).getByText('gg run')).toBeTruthy()
    }
    // Nothing of the machine's live configuration is kept off it: no request while it is away.
    expect(calls.filter((c) => c.path.startsWith('/machines/m1/'))).toEqual([])
    fireEvent.click(tab('概览'))
    expect(screen.getByText('wanglei-mbp', { selector: '.machine__host' })).toBeTruthy()
  })

  it('asks for a daemon upgrade when the daemon predates the features', () => {
    open({ ...mbp, features: [] })
    expect(tab(AGENTS_TAB).disabled).toBe(true)
    expect(screen.getByText(/请先升级该机器的 daemon/)).toBeTruthy()
  })

  it('leaves out only Agent 设置 on a daemon without agentSettings', async () => {
    mockApi(LIVE)
    open({ ...mbp, features: ['tools', 'providers', 'ccSwitch', 'machineAdmin'] })
    expect(tab(AGENTS_TAB).disabled).toBe(false)
    expect(screen.getByText('请先升级该机器的 daemon，才能管理Agent 设置与Git 访问')).toBeTruthy()
    fireEvent.click(tab(AGENTS_TAB))
    const row = await openAgent('Claude Code')
    expect(within(row).getByRole('region', { name: '默认「供应商/模型」' })).toBeTruthy()
    expect(within(row).queryByRole('region', { name: 'Claude Code Agent 设置' })).toBeNull()
  })

  it('names every outdated part in one note', () => {
    open({ ...mbp, features: [] })
    expect(
      screen.getByText(
        '请先升级该机器的 daemon，才能管理Agent 工具、供应商、Agent 设置、工作区、Git 访问与日志',
      ),
    ).toBeTruthy()
  })

  it.each(['agents', 'providers', 'agent', 'tools'])(
    'opens Agent 与供应商 alone from ?tab=%s (old desktop links included)',
    async (value) => {
      mockApi(LIVE)
      open(mbp, `/?tab=${value}`)
      expect(tab(AGENTS_TAB).getAttribute('aria-selected')).toBe('true')
      expect(await screen.findByRole('region', { name: '供应商' })).toBeTruthy()
      expect(document.querySelector('.machine__host')).toBeNull()
    },
  )

  it.each([
    ['workspaces', '工作区'],
    ['diagnostics', '诊断'],
  ])('opens ?tab=%s on %s', (value, name) => {
    mockApi(LIVE)
    open({ ...mbp, features: [...mbp.features, 'machineAdmin'] }, `/?tab=${value}`)
    expect(tab(name).getAttribute('aria-selected')).toBe('true')
  })

  it('lists Node.js, the agents, those to install and the providers, reading each once', async () => {
    const calls = mockApi(LIVE)
    open()
    fireEvent.click(tab(AGENTS_TAB))
    const providers = await screen.findByRole('region', { name: '供应商' })
    const node = screen.getByRole('region', { name: 'Node.js' })
    const agents = screen.getByRole('region', { name: 'Agent' })
    const installable = screen.getByRole('region', { name: '可安装' })
    for (const [a, b] of [
      [node, agents],
      [agents, providers],
      [providers, installable],
    ] as const)
      expect(a.compareDocumentPosition(b) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy()
    expect(within(agents).getByRole('button', { name: /^Claude Code/ })).toBeTruthy()
    expect(within(installable).getByRole('button', { name: /^Codex/ })).toBeTruthy()
    // Details open one agent at a time: where it is, its default, its settings, the bots using it.
    const row = await openAgent('Claude Code')
    const parts = [
      within(row).getByText('/c'),
      within(row).getByRole('region', { name: '默认「供应商/模型」' }),
      within(row).getByRole('region', { name: 'Claude Code Agent 设置' }),
      within(row).getByRole('region', { name: '使用它的 Bot' }),
    ]
    for (let i = 1; i < parts.length; i++)
      expect(parts[i - 1]!.compareDocumentPosition(parts[i]!) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy()
    fireEvent.click(agentButton('Claude Code'))
    expect(within(row).queryByRole('region', { name: '默认「供应商/模型」' })).toBeNull()
    expect(calls.filter((c) => c.path === '/machines/m1/providers')).toHaveLength(1)
    expect(calls.filter((c) => c.path === '/machines/m1/tools')).toHaveLength(1)
  })
})

describe('重命名', () => {
  it('renames in place from the title: Enter saves, Esc cancels', async () => {
    const calls = mockApi({ 'PATCH /machines/m1': { ...mbp, name: '主力机' } })
    render(
      <MemoryRouter>
        <MachinePage machine={mbp} bots={[]} />
      </MemoryRouter>,
    )
    const dialog = screen.getByRole('region', { name: '机器详情' })
    expect(within(dialog).queryByRole('textbox', { name: '名称' })).toBeNull()
    fireEvent.click(within(dialog).getByRole('button', { name: '重命名' }))
    const draft = within(dialog).getByRole('textbox', { name: '名称' })
    fireEvent.change(draft, { target: { value: '临时' } })
    fireEvent.keyDown(draft, { key: 'Escape' })
    expect(within(dialog).queryByRole('textbox', { name: '名称' })).toBeNull()
    expect(screen.getByRole('region', { name: '机器详情' })).toBeTruthy()
    expect(calls.some((c) => c.method === 'PATCH')).toBe(false)

    fireEvent.click(within(dialog).getByRole('button', { name: '重命名' }))
    const name = within(dialog).getByRole('textbox', { name: '名称' })
    fireEvent.change(name, { target: { value: '主力机' } })
    fireEvent.keyDown(name, { key: 'Enter' })
    await waitFor(() =>
      expect(calls).toContainEqual({ method: 'PATCH', path: '/machines/m1', body: { name: '主力机' } }),
    )
    await waitFor(() => expect(within(dialog).queryByRole('textbox', { name: '名称' })).toBeNull())
  })

  it('saves on blur, and treats an unchanged or empty name as cancel', async () => {
    const calls = mockApi({ 'PATCH /machines/m1': { ...mbp, name: '主力机' } })
    const named = { ...mbp, name: '旧名' }
    open(named)
    const dialog = screen.getByRole('region', { name: '机器详情' })
    const edit = (value?: string) => {
      fireEvent.click(within(dialog).getByRole('button', { name: '重命名' }))
      const field = within(dialog).getByRole('textbox', { name: '名称' })
      if (value !== undefined) fireEvent.change(field, { target: { value } })
      fireEvent.blur(field)
    }
    edit()
    edit('  ')
    expect(within(dialog).queryByRole('textbox', { name: '名称' })).toBeNull()
    expect(calls.some((c) => c.method === 'PATCH')).toBe(false)

    edit('主力机')
    await waitFor(() =>
      expect(calls.filter((c) => c.method === 'PATCH')).toEqual([
        { method: 'PATCH', path: '/machines/m1', body: { name: '主力机' } },
      ]),
    )
    await waitFor(() => expect(within(dialog).queryByRole('textbox', { name: '名称' })).toBeNull())
  })
})

describe('Agent 工具', () => {
  const openTools = async (routes: Record<string, unknown> = {}, machine: MachineDto = mbp) => {
    const calls = mockApi({ ...LIVE, ...routes })
    open(machine)
    fireEvent.click(tab(AGENTS_TAB))
    await screen.findByRole('region', { name: '供应商' })
    return calls
  }
  const row = (name: string) => agentButton(name).closest('.ag-agent') as HTMLElement

  it('shows Node.js as one line and each agent with the one action its state calls for', async () => {
    await openTools()
    const node = screen.getByRole('region', { name: 'Node.js' })
    expect(node.textContent).toContain('Node.js 22.1.0 · 共工空间托管')
    expect(within(node).getByRole('button', { name: '升级到 22.9.0' })).toBeTruthy()
    const claude = row('Claude Code')
    expect(claude.textContent).toContain('有更新')
    expect(
      within(claude)
        .getAllByRole('button')
        .map((b) => b.textContent),
    ).toEqual([expect.stringMatching(/^Claude Code/), '升级到 2.1.285'])
    await openAgent('Claude Code')
    expect(claude.textContent).toContain('自行安装')
    expect(claude.textContent).toContain('claude update')
    const codex = within(screen.getByRole('region', { name: '可安装' })).getByRole('button', {
      name: /^Codex/,
    })
    expect((codex.closest('.ag-agent') as HTMLElement).textContent).not.toContain('有更新')
    expect(
      within(codex.closest('.ag-agent') as HTMLElement).getByRole('button', { name: '安装' }),
    ).toBeTruthy()
  })

  it('puts a missing or too old Node.js first, with its install', async () => {
    const calls = await openTools({
      'GET /machines/m1/tools': { ...TOOLS, node: { ...TOOLS.node!, version: '20.1.0' } },
      'POST /machines/m1/tools/node/install': { opId: 'op1' },
    })
    const node = screen.getByRole('region', { name: 'Node.js' })
    expect(node.textContent).toContain('Node.js 20.1.0 版本过低，Agent 需要 ≥ 22')
    fireEvent.click(within(node).getByRole('button', { name: '安装 Node.js' }))
    await waitFor(() => expect(calls.some((c) => c.path === '/machines/m1/tools/node/install')).toBe(true))
    expect(within(node).getByRole('log', { name: '安装日志' })).toBeTruthy()
  })

  it('gives Antigravity CLI, which is off npm, a copyable install command and its own login', async () => {
    const command = 'curl -fsSL https://antigravity.google/cli/install.sh | bash'
    const agy = (available: boolean) =>
      agent('antigravity', {
        available,
        version: available ? '1.5.9' : null,
        path: available ? '/Users/wl/.local/bin/agy' : null,
        installCommand: command,
      })
    const writeText = vi.fn(async () => {})
    vi.stubGlobal('navigator', { ...navigator, clipboard: { writeText } })
    const features = [...mbp.features, 'antigravity']
    const { unmount } = await (async () => {
      mockApi({ ...LIVE, 'GET /machines/m1/tools': { ...TOOLS, agents: [...TOOLS.agents, agy(false)] } })
      const out = open({ ...mbp, features })
      fireEvent.click(tab(AGENTS_TAB))
      await screen.findByRole('region', { name: '供应商' })
      return out
    })()
    const installable = screen.getByRole('region', { name: '可安装' })
    const card = within(installable)
      .getByRole('button', { name: /^Antigravity CLI/ })
      .closest('.ag-agent') as HTMLElement
    expect(card.textContent).toContain('需自行安装')
    expect(within(card).queryByRole('button', { name: '安装' })).toBeNull()
    fireEvent.click(within(card).getByRole('button', { name: '复制安装命令' }))
    await waitFor(() => expect(writeText).toHaveBeenCalledWith(command))
    await openAgent('Antigravity CLI')
    expect(card.textContent).toContain(command)
    expect(card.textContent).toContain('Antigravity CLI 使用它自己的登录')
    expect(within(card).queryByRole('region', { name: '默认「供应商/模型」' })).toBeNull()
    unmount()

    mockApi({ ...LIVE, 'GET /machines/m1/tools': { ...TOOLS, agents: [...TOOLS.agents, agy(true)] } })
    open({ ...mbp, features })
    fireEvent.click(tab(AGENTS_TAB))
    const installed = await openAgent('Antigravity CLI')
    expect(
      within(screen.getByRole('region', { name: 'Agent' })).getByRole('button', { name: /^Antigravity CLI/ }),
    ).toBeTruthy()
    expect(within(installed).queryByRole('button', { name: '复制安装命令' })).toBeNull()
    expect(installed.textContent).toContain('自行安装')
    expect(installed.textContent).not.toContain(command)
    expect(installed.textContent).not.toContain('无法获取，请检查镜像源')
  })

  it('streams the install log from realtime and takes the new state from the result', async () => {
    const calls = await openTools({ 'POST /machines/m1/tools/codex/install': { opId: 'op1' } })
    fireEvent.click(within(row('Codex')).getByRole('button', { name: '安装' }))
    await waitFor(() => expect(calls.some((c) => c.path === '/machines/m1/tools/codex/install')).toBe(true))
    emit({ t: 'machine.tools.progress', machineId: 'm1', opId: 'op1', line: 'added 3 packages' })
    emit({ t: 'machine.tools.progress', machineId: 'other', opId: 'op9', line: 'not mine' })
    const log = screen.getByRole('log', { name: '安装日志' })
    expect(log.textContent).toContain('added 3 packages')
    expect(log.textContent).not.toContain('not mine')
    expect(screen.getByText('正在安装…')).toBeTruthy()
    // Nothing else installs meanwhile: the machine runs one at a time.
    expect(
      (within(row('Claude Code')).getByRole('button', { name: '升级到 2.1.285' }) as HTMLButtonElement)
        .disabled,
    ).toBe(true)
    const done: MachineAgentsDto = {
      ...TOOLS,
      agents: TOOLS.agents.map((a) =>
        a.kind === 'codex' ? { ...a, available: true, version: '0.159.2', managed: true } : a,
      ),
    }
    emit({ t: 'machine.tools.result', machineId: 'm1', opId: 'op1', ok: true, error: null, state: done })
    expect(await screen.findByText('安装完成')).toBeTruthy()
    const agents = screen.getByRole('region', { name: 'Agent' })
    expect(within(agents).getByRole('button', { name: /^Codex/ }).textContent).toContain('0.159.2')
    expect(screen.queryByRole('region', { name: '可安装' })).toBeNull()
  })

  it('shows a failed install with its error', async () => {
    await openTools({ 'POST /machines/m1/tools/codex/install': { opId: 'op1' } })
    fireEvent.click(within(row('Codex')).getByRole('button', { name: '安装' }))
    await screen.findByRole('log', { name: '安装日志' })
    await waitFor(() => expect(screen.getByText('正在安装…')).toBeTruthy())
    emit({
      t: 'machine.tools.result',
      machineId: 'm1',
      opId: 'op1',
      ok: false,
      error: '机器离线',
      state: null,
    })
    expect(await screen.findByText('安装失败')).toBeTruthy()
    expect(screen.getByRole('log', { name: '安装日志' }).textContent).toContain('机器离线')
  })

  it('upgrades the user’s own install; when that fails it offers the managed install', async () => {
    const calls = await openTools({
      'POST /machines/m1/tools/claude/upgrade': { opId: 'op1' },
      'POST /machines/m1/tools/claude/install': { opId: 'op2' },
    })
    expect(within(row('Claude Code')).queryByRole('button', { name: '改用共工空间托管安装' })).toBeNull()
    fireEvent.click(within(row('Claude Code')).getByRole('button', { name: '升级到 2.1.285' }))
    await waitFor(() => expect(calls.some((c) => c.path === '/machines/m1/tools/claude/upgrade')).toBe(true))
    emit({
      t: 'machine.tools.result',
      machineId: 'm1',
      opId: 'op1',
      ok: false,
      error: '没有写入权限，无法升级 Claude Code',
      state: null,
    })
    expect(await screen.findByText('升级失败')).toBeTruthy()
    fireEvent.click(within(row('Claude Code')).getByRole('button', { name: '改用共工空间托管安装' }))
    await waitFor(() => expect(calls.some((c) => c.path === '/machines/m1/tools/claude/install')).toBe(true))
  })

  it('upgrades every agent with an update in turn from 全部升级', async () => {
    const tools: MachineAgentsDto = {
      ...TOOLS,
      agents: [
        TOOLS.agents[0]!,
        agent('codex', { version: '0.150.0', latest: '0.159.2', managed: true, path: '/x' }),
        agent('gemini', { version: '0.1.0', latest: '0.2.0', path: '/g' }),
      ],
    }
    const calls = await openTools(
      {
        'GET /machines/m1/tools': tools,
        'POST /machines/m1/tools/claude/upgrade': { opId: 'op1' },
        'POST /machines/m1/tools/codex/upgrade': { opId: 'op2' },
      },
      { ...mbp, features: [...mbp.features, 'gemini'] },
    )
    // Gemini CLI's own install has an update 共工 cannot run: listed, not counted.
    expect(row('Gemini CLI').textContent).toContain('有更新')
    const all = screen.getByRole('button', { name: '全部升级（2）' })
    fireEvent.click(all)
    await waitFor(() => expect(calls.some((c) => c.path === '/machines/m1/tools/claude/upgrade')).toBe(true))
    expect(screen.getByRole('button', { name: '正在升级 1/2…' })).toBeTruthy()
    expect(calls.some((c) => c.path === '/machines/m1/tools/codex/upgrade')).toBe(false)
    emit({ t: 'machine.tools.result', machineId: 'm1', opId: 'op1', ok: true, error: null, state: null })
    await waitFor(() => expect(calls.some((c) => c.path === '/machines/m1/tools/codex/upgrade')).toBe(true))
    expect(screen.getByRole('button', { name: '正在升级 2/2…' })).toBeTruthy()
    const done: MachineAgentsDto = {
      ...tools,
      agents: tools.agents.map((a) => (a.kind === 'gemini' ? a : { ...a, version: a.latest })),
    }
    emit({ t: 'machine.tools.result', machineId: 'm1', opId: 'op2', ok: true, error: null, state: done })
    await waitFor(() => expect(screen.queryByRole('button', { name: /全部升级|正在升级/ })).toBeNull())
  })
})

describe('诊断', () => {
  it('shows the daemon version', () => {
    mockApi(LIVE)
    open(mbp, '/?tab=diagnostics')
    expect(screen.getByText('v0.9.0')).toBeTruthy()
    expect(screen.queryByRole('region', { name: '如何升级' })).toBeNull()
  })

  it('explains how to upgrade an outdated daemon, with a command to copy, in 诊断 and on the overview', async () => {
    mockApi({ ...LIVE, 'GET /client-downloads': { version: '1.0.0', builds: [], desktop: [] } })
    const writeText = vi.fn(async () => {})
    vi.stubGlobal('navigator', { ...navigator, clipboard: { writeText } })
    open(mbp, '/?tab=diagnostics')
    const guide = await screen.findByRole('region', { name: '如何升级' })
    expect(guide.textContent).toContain('可升级到 1.0.0')
    expect(guide.textContent).toContain('检查更新')
    fireEvent.click(within(guide).getByRole('button', { name: '复制命令' }))
    await waitFor(() => expect(writeText).toHaveBeenCalledWith('gg run'))
    fireEvent.click(tab('概览'))
    fireEvent.click(screen.getByRole('button', { name: '如何升级' }))
    expect(screen.getByRole('region', { name: '如何升级' }).textContent).toContain('gg run')
  })

  it('saves a custom mirror by itself once both addresses are in', async () => {
    const calls = mockApi({ ...LIVE, 'PUT /machines/m1/tools/settings': TOOLS })
    open(mbp, '/?tab=diagnostics')
    await screen.findByRole('button', { name: '镜像源' })
    expect(screen.queryByRole('button', { name: '保存' })).toBeNull()
    fireEvent.click(screen.getByRole('button', { name: '镜像源' }))
    fireEvent.click(screen.getByRole('menuitemcheckbox', { name: '自定义' }))
    const registry = screen.getByRole('textbox', { name: 'npm registry' })
    fireEvent.change(registry, { target: { value: 'https://r.example.com' } })
    fireEvent.blur(registry)
    expect(screen.getByText('还需要填写 Node.js 下载地址')).toBeTruthy()
    const node = screen.getByRole('textbox', { name: 'Node.js 下载地址' })
    fireEvent.change(node, { target: { value: 'https://n.example.com' } })
    expect(calls.some((c) => c.method === 'PUT')).toBe(false)
    expect(screen.queryByText('还需要填写 Node.js 下载地址')).toBeNull()
    fireEvent.keyDown(node, { key: 'Enter' })
    fireEvent.blur(node)
    await waitFor(() =>
      expect(calls.filter((c) => c.method === 'PUT').map((c) => c.body)).toEqual([
        { mirror: { kind: 'custom', registry: 'https://r.example.com', node: 'https://n.example.com' } },
      ]),
    )
    expect(await screen.findByText('已保存')).toBeTruthy()
  })

  it('saves a listed mirror as soon as it is picked', async () => {
    const calls = mockApi({ ...LIVE, 'PUT /machines/m1/tools/settings': TOOLS })
    open(mbp, '/?tab=diagnostics')
    fireEvent.click(await screen.findByRole('button', { name: '镜像源' }))
    fireEvent.click(screen.getByRole('menuitemcheckbox', { name: '官方源' }))
    await waitFor(() =>
      expect(calls.find((c) => c.method === 'PUT')?.body).toEqual({ mirror: { kind: 'official' } }),
    )
  })
})

describe('供应商', () => {
  const openProviders = async (
    routes: Record<string, unknown> = {},
    view = VIEW,
    machine: MachineDto = mbp,
  ) => {
    const calls = mockApi({ ...LIVE, 'GET /machines/m1/providers': view, ...routes })
    open(machine)
    fireEvent.click(tab(AGENTS_TAB))
    return { calls, list: await screen.findByRole('region', { name: '供应商' }) }
  }
  const keyIn = (calls: Call[]) => calls.filter((c) => JSON.stringify(c.body ?? {}).includes('sk-new'))
  const providerRow = (list: HTMLElement, name: string) =>
    within(list).getByText(name).closest('.mx-row') as HTMLElement

  it('lists the machine’s providers once for all agents, with their protocols and masked keys', async () => {
    const { list } = await openProviders(
      {},
      {
        ...VIEW,
        machine: { claude: { provider: 'p1', model: null } },
        providers: [
          kimi,
          {
            ...kimi,
            id: 'p2',
            name: 'GLM',
            endpoints: [
              endpoint({ baseUrl: 'https://open.bigmodel.cn/api/anthropic' }),
              endpoint({ protocol: 'openai', baseUrl: 'https://open.bigmodel.cn/api/coding/paas/v4' }),
            ],
          },
        ],
      },
    )
    const kimiRow = providerRow(list, 'Kimi')
    expect(kimiRow.textContent).toContain('Anthropic 兼容')
    expect(kimiRow.textContent).toContain('Claude Code 的默认')
    expect(kimiRow.textContent).toContain('Key ****abcd')
    const glm = providerRow(list, 'GLM')
    expect(glm.textContent).toContain('Anthropic 兼容')
    expect(glm.textContent).toContain('OpenAI 兼容')
    expect(screen.queryByRole('region', { name: 'Codex 供应商' })).toBeNull()
  })

  it('creates one from a preset, sending the key only when saving and making it a default', async () => {
    const { calls, list } = await openProviders({ 'POST /machines/m1/providers': { id: 'p2', view: VIEW } })
    fireEvent.click(within(list).getByRole('button', { name: '新增…' }))
    const picker = await screen.findByRole('dialog', { name: '新增供应商' })
    expect(within(picker).getByText('国内厂商')).toBeTruthy()
    expect(within(picker).getByText('聚合平台')).toBeTruthy()
    fireEvent.change(within(picker).getByRole('searchbox'), { target: { value: 'open' } })
    expect(within(picker).queryByRole('button', { name: /Kimi For Coding/ })).toBeNull()
    fireEvent.change(within(picker).getByRole('searchbox'), { target: { value: '' } })
    const vendor = await within(picker).findByRole('button', { name: /Kimi For Coding/ })
    expect(vendor.textContent).toContain('Anthropic 兼容')
    fireEvent.click(vendor)

    const form = await screen.findByRole('form', { name: '新增供应商' })
    expect((within(form).getByRole('textbox', { name: '名称' }) as HTMLInputElement).value).toBe(
      'Kimi For Coding',
    )
    expect(
      (within(form).getByRole('combobox', { name: 'Anthropic 兼容 模型' }) as HTMLInputElement).value,
    ).toBe('kimi-for-coding')
    const link = within(form).getByRole('link', { name: /获取 Key/ })
    expect(link.getAttribute('href')).toBe('https://platform.kimi.com/keys')
    expect(link.getAttribute('target')).toBe('_blank')
    expect(link.getAttribute('rel')).toContain('noopener')
    // Only the agents speaking Anthropic can take it.
    const defaults = within(form)
      .getAllByRole('checkbox')
      .map((c) => c.closest('label')?.textContent)
    expect(defaults).toContain('Claude Code')
    expect(defaults).not.toContain('Codex')
    fireEvent.click(within(form).getByRole('checkbox', { name: 'Claude Code' }))

    fireEvent.change(within(form).getByLabelText('API Key'), { target: { value: 'sk-new' } })
    expect(keyIn(calls)).toEqual([])
    fireEvent.click(screen.getByRole('button', { name: '保存' }))
    await waitFor(() => expect(keyIn(calls)).toHaveLength(1))
    expect(keyIn(calls)[0]).toMatchObject({
      method: 'POST',
      path: '/machines/m1/providers',
      body: {
        presetId: 'kimi-coding',
        name: 'Kimi For Coding',
        apiKey: 'sk-new',
        endpoints: [
          { protocol: 'anthropic', baseUrl: 'https://api.kimi.com/coding/', model: 'kimi-for-coding' },
        ],
        setDefault: ['claude'],
      },
    })
  })

  const twoProtocols: ProviderPreset = {
    ...kimiPreset,
    id: 'glm',
    name: 'GLM',
    endpoints: [
      { ...kimiPreset.endpoints[0]!, baseUrl: 'https://open.bigmodel.cn/api/anthropic', model: 'glm-4.6' },
      {
        ...kimiPreset.endpoints[0]!,
        protocol: 'openai',
        baseUrl: 'https://open.bigmodel.cn/api/coding/paas/v4',
        apiKeyField: null,
        model: 'glm-4.6',
      },
    ],
  }

  it('adds a vendor with an endpoint per protocol, dropping the ones unchecked', async () => {
    const { calls, list } = await openProviders({
      'GET /machines/m1/providers/presets': [twoProtocols],
      'POST /machines/m1/providers': { id: 'p2', view: VIEW },
    })
    fireEvent.click(within(list).getByRole('button', { name: '新增…' }))
    fireEvent.click(await screen.findByRole('button', { name: /^GLM/ }))
    const form = await screen.findByRole('form', { name: '新增供应商' })
    expect(within(form).getByRole('region', { name: 'Anthropic 兼容 端点' })).toBeTruthy()
    expect(within(form).getByRole('region', { name: 'OpenAI 兼容 端点' })).toBeTruthy()
    expect((within(form).getByRole('checkbox', { name: 'Codex' }) as HTMLInputElement).disabled).toBe(false)
    fireEvent.change(within(form).getByLabelText('API Key'), { target: { value: 'sk-new' } })
    fireEvent.click(screen.getByRole('button', { name: '保存' }))
    await waitFor(() => expect(keyIn(calls)).toHaveLength(1))
    expect(
      (keyIn(calls)[0]!.body as { endpoints: { protocol: string }[] }).endpoints.map((e) => e.protocol),
    ).toEqual(['anthropic', 'openai'])

    calls.length = 0
    fireEvent.click(within(list).getByRole('button', { name: '新增…' }))
    fireEvent.click(await screen.findByRole('button', { name: /^GLM/ }))
    const again = await screen.findByRole('form', { name: '新增供应商' })
    fireEvent.click(within(again).getByRole('checkbox', { name: 'OpenAI 兼容' }))
    expect(within(again).queryByRole('region', { name: 'OpenAI 兼容 端点' })).toBeNull()
    expect(within(again).queryByRole('checkbox', { name: 'Codex' })).toBeNull()
    fireEvent.change(within(again).getByLabelText('API Key'), { target: { value: 'sk-new' } })
    fireEvent.click(screen.getByRole('button', { name: '保存' }))
    await waitFor(() => expect(keyIn(calls)).toHaveLength(1))
    expect(
      (keyIn(calls)[0]!.body as { endpoints: { protocol: string }[] }).endpoints.map((e) => e.protocol),
    ).toEqual(['anthropic'])
  })

  it('keeps one protocol per provider on an older client', async () => {
    const old = { ...mbp, features: mbp.features.filter((f) => f !== 'protocolProviders') }
    useWorkspace.setState({ machines: [old] })
    const { list } = await openProviders({ 'GET /machines/m1/providers/presets': [twoProtocols] }, VIEW, old)
    expect(list.textContent).toContain('升级客户端后可登记多种')
    fireEvent.click(within(list).getByRole('button', { name: '新增…' }))
    fireEvent.click(await screen.findByRole('button', { name: /^GLM/ }))
    const form = await screen.findByRole('form', { name: '新增供应商' })
    const anthropic = within(form).getByRole('checkbox', { name: 'Anthropic 兼容' }) as HTMLInputElement
    const openai = within(form).getByRole('checkbox', { name: 'OpenAI 兼容' }) as HTMLInputElement
    expect([anthropic.checked, openai.checked]).toEqual([true, false])
    fireEvent.click(openai)
    expect([anthropic.checked, openai.checked]).toEqual([false, true])
    expect(within(form).queryByRole('region', { name: 'Anthropic 兼容 端点' })).toBeNull()
  })

  it('refuses to add one without an API key', async () => {
    const { calls, list } = await openProviders()
    fireEvent.click(within(list).getByRole('button', { name: '新增…' }))
    fireEvent.click(await screen.findByRole('button', { name: /Kimi For Coding/ }))
    await screen.findByRole('form', { name: '新增供应商' })
    fireEvent.click(screen.getByRole('button', { name: '保存' }))
    expect(await screen.findByText('请填写 API Key')).toBeTruthy()
    expect(calls.some((c) => c.method === 'POST')).toBe(false)
  })

  const listing = (path: string, entries: string[]) => ({
    path,
    entries: entries.map((name) => ({ name, git: false })),
    git: null,
    unusable: path === '/Users/test' ? '目录范围过大，请选择具体的项目目录' : null,
    roots: ['/'],
  })
  const HOME_DIRS = {
    'GET /machines/m1/dirs?hidden=1': listing('/Users/test', [
      '.claude',
      '.qorz-claude',
      'claude-code',
      'code',
    ]),
  }
  const openProfile = async (routes: Record<string, unknown> = {}) => {
    const opened = await openProviders({ ...HOME_DIRS, ...routes })
    fireEvent.click(within(opened.list).getByRole('button', { name: '新增…' }))
    fireEvent.click(await screen.findByRole('button', { name: /该机器 Claude 配置目录/ }))
    return { ...opened, form: await screen.findByRole('form', { name: '新增供应商' }) }
  }
  const sent = (calls: Call[], method: string) =>
    calls.find((c) => c.method === method && c.path.startsWith('/machines/m1/providers'))?.body as {
      endpoints: Record<string, unknown>[]
    } & Record<string, unknown>

  it('adds a local Claude profile from its own entry, picking a suggested directory', async () => {
    const { calls, form } = await openProfile({ 'POST /machines/m1/providers': { id: 'p2', view: VIEW } })
    expect(within(form).queryByLabelText('API Key')).toBeNull()
    fireEvent.click(within(form).getByRole('button', { name: '显示选项' }))
    const options = await screen.findAllByRole('option')
    // Not the official login's own ~/.claude, nor a mere name match like a claude-code checkout.
    expect(options.map((o) => o.textContent)).toEqual(['/Users/test/.qorz-claude'])
    fireEvent.mouseDown(options[0] as HTMLElement)
    expect((within(form).getByRole('textbox', { name: '名称' }) as HTMLInputElement).value).toBe(
      'qorz-claude',
    )
    // A profile is for Claude Code alone.
    expect(
      within(form)
        .getAllByRole('checkbox')
        .map((c) => c.closest('label')?.textContent),
    ).toEqual(['Claude Code'])
    fireEvent.click(within(form).getByRole('button', { name: '高级' }))
    expect(within(form).queryByLabelText('haiku 模型')).toBeNull()
    fireEvent.click(screen.getByRole('button', { name: '保存' }))
    await waitFor(() => expect(calls.some((c) => c.method === 'POST')).toBe(true))
    const body = sent(calls, 'POST')
    expect(body).toMatchObject({
      name: 'qorz-claude',
      endpoints: [{ protocol: 'anthropic', configDir: '/Users/test/.qorz-claude', model: '', models: {} }],
    })
    for (const key of ['apiKey', 'presetId']) expect(body).not.toHaveProperty(key)
    expect(body.endpoints[0]).not.toHaveProperty('baseUrl')
  })

  it("clears a profile's stale model mapping and leaves its small fast model alone", async () => {
    const profile = kimiWith(
      {
        baseUrl: '',
        configDir: '/Users/test/.qorz-claude',
        model: 'old',
        models: { haiku: 'old-haiku' },
        env: { ANTHROPIC_SMALL_FAST_MODEL: 'fast' },
      },
      { presetId: null, apiKey: '' },
    )
    const { calls, list } = await openProviders(
      { ...HOME_DIRS, 'PUT /machines/m1/providers/p1': { id: 'p1', view: VIEW } },
      { ...VIEW, providers: [profile] },
    )
    fireEvent.click(within(list).getByRole('button', { name: '编辑…' }))
    const form = await screen.findByRole('form', { name: '编辑供应商' })
    fireEvent.click(within(form).getByRole('button', { name: '高级' }))
    expect(within(form).queryByRole('button', { name: '改用 Haiku 映射' })).toBeNull()
    fireEvent.click(screen.getByRole('button', { name: '保存' }))
    await waitFor(() => expect(calls.some((c) => c.method === 'PUT')).toBe(true))
    expect(sent(calls, 'PUT').endpoints).toMatchObject([
      { model: '', models: {}, env: { ANTHROPIC_SMALL_FAST_MODEL: 'fast' } },
    ])
  })

  it('keeps a typed name and an executable for a local profile', async () => {
    const { calls, form } = await openProfile()
    fireEvent.change(within(form).getByRole('textbox', { name: '名称' }), { target: { value: 'Qorz' } })
    fireEvent.change(within(form).getByRole('combobox', { name: '配置目录' }), {
      target: { value: '/Users/test/.qorz-claude' },
    })
    fireEvent.change(within(form).getByLabelText('Claude 可执行文件'), {
      target: { value: '/Users/test/bin/claude-qorz' },
    })
    fireEvent.click(screen.getByRole('button', { name: '保存' }))
    await waitFor(() =>
      expect(sent(calls, 'POST')).toMatchObject({
        name: 'Qorz',
        endpoints: [{ configDir: '/Users/test/.qorz-claude', executablePath: '/Users/test/bin/claude-qorz' }],
      }),
    )
  })

  it("browses the machine's directories, hidden ones included, for the config directory", async () => {
    const { form } = await openProfile({
      [`GET /machines/m1/dirs?path=${encodeURIComponent('/Users/test/.qorz-claude')}&hidden=1`]: listing(
        '/Users/test/.qorz-claude',
        [],
      ),
    })
    fireEvent.click(within(form).getByRole('button', { name: '浏览…' }))
    const picker = await screen.findByRole('dialog', { name: '选择配置目录' })
    expect(await within(picker).findByText('进入配置目录后选择')).toBeTruthy()
    fireEvent.click(await within(picker).findByRole('button', { name: /\.qorz-claude/ }))
    await within(picker).findByText('没有子目录')
    fireEvent.click(within(picker).getByRole('button', { name: '选择此目录' }))
    await waitFor(() => expect(screen.queryByRole('dialog', { name: '选择配置目录' })).toBeNull())
    expect((within(form).getByRole('combobox', { name: '配置目录' }) as HTMLInputElement).value).toBe(
      '/Users/test/.qorz-claude',
    )
  })

  it('offers a local profile only when the daemon supports it', async () => {
    const { list } = await openProviders({}, VIEW, { ...mbp, features: ['tools', 'providers'] })
    fireEvent.click(within(list).getByRole('button', { name: '新增…' }))
    await screen.findByRole('button', { name: /自定义/ })
    expect(screen.queryByRole('button', { name: /该机器 Claude 配置目录/ })).toBeNull()
  })

  it('edits without the key when it is left empty, and restores preset values', async () => {
    const { calls, list } = await openProviders({ 'PUT /machines/m1/providers/p1': { id: 'p1', view: VIEW } })
    fireEvent.click(within(list).getByRole('button', { name: '编辑…' }))
    const form = await screen.findByRole('form', { name: '编辑供应商' })
    const key = within(form).getByLabelText('API Key') as HTMLInputElement
    expect(key.value).toBe('')
    expect(key.placeholder).toBe('****abcd')
    fireEvent.change(within(form).getByRole('textbox', { name: '名称' }), { target: { value: 'Kimi 2' } })
    fireEvent.click(await screen.findByRole('button', { name: '恢复为预设值' }))
    expect((within(form).getByRole('textbox', { name: '名称' }) as HTMLInputElement).value).toBe(
      'Kimi For Coding',
    )
    fireEvent.change(within(form).getByRole('textbox', { name: '名称' }), { target: { value: 'Kimi 2' } })
    fireEvent.click(screen.getByRole('button', { name: '保存' }))
    await waitFor(() => expect(calls.some((c) => c.method === 'PUT')).toBe(true))
    const body = sent(calls, 'PUT')
    expect(body).toMatchObject({ name: 'Kimi 2', endpoints: [{ protocol: 'anthropic' }] })
    expect(body).not.toHaveProperty('apiKey')
    expect(body).not.toHaveProperty('removeProtocols')
  })

  it('adds a protocol to an existing provider, or drops one', async () => {
    const { calls, list } = await openProviders({ 'PUT /machines/m1/providers/p1': { id: 'p1', view: VIEW } })
    fireEvent.click(within(list).getByRole('button', { name: '编辑…' }))
    const form = await screen.findByRole('form', { name: '编辑供应商' })
    fireEvent.click(within(form).getByRole('checkbox', { name: 'OpenAI 兼容' }))
    fireEvent.click(within(form).getByRole('checkbox', { name: 'Anthropic 兼容' }))
    fireEvent.change(within(form).getByRole('textbox', { name: 'OpenAI 兼容 Base URL' }), {
      target: { value: 'https://api.kimi.com/coding/v1' },
    })
    fireEvent.click(screen.getByRole('button', { name: '保存' }))
    await waitFor(() => expect(calls.some((c) => c.method === 'PUT')).toBe(true))
    expect(sent(calls, 'PUT')).toMatchObject({
      endpoints: [{ protocol: 'openai', baseUrl: 'https://api.kimi.com/coding/v1' }],
      removeProtocols: ['anthropic'],
    })
  })

  it('edits the proxy and environment under 高级', async () => {
    const codex = kimiWith(
      { protocol: 'openai', env: {} },
      { id: 'p2', name: 'GLM', presetId: null, proxy: null },
    )
    const { calls, list } = await openProviders(
      { 'PUT /machines/m1/providers/p2': { id: 'p2', view: VIEW } },
      { ...VIEW, providers: [codex] },
    )
    fireEvent.click(within(list).getByRole('button', { name: '编辑…' }))
    const form = await screen.findByRole('form', { name: '编辑供应商' })
    fireEvent.click(within(form).getByRole('button', { name: '高级' }))
    const disclosure = within(form).getByRole('button', { name: '高级' })
    const proxy = within(form).getByRole('textbox', { name: '代理地址' })
    const env = within(form).getByRole('textbox', { name: '环境变量' })
    expect(disclosure.compareDocumentPosition(proxy) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy()
    expect(disclosure.compareDocumentPosition(env) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy()
    fireEvent.change(proxy, {
      target: { value: ' http://127.0.0.1:7890 ' },
    })
    fireEvent.change(env, {
      target: { value: 'NODE_OPTIONS=--max-old-space-size=4096' },
    })
    fireEvent.click(screen.getByRole('button', { name: '保存' }))
    await waitFor(() => expect(calls.some((c) => c.method === 'PUT')).toBe(true))
    expect(sent(calls, 'PUT')).toMatchObject({
      proxy: 'http://127.0.0.1:7890',
      endpoints: [{ protocol: 'openai', env: { NODE_OPTIONS: '--max-old-space-size=4096' } }],
    })
  })

  it("sets an Anthropic endpoint's command-line arguments above the other variables", async () => {
    const { calls, list } = await openProviders(
      { 'PUT /machines/m1/providers/p1': { id: 'p1', view: VIEW } },
      { ...VIEW, providers: [kimiWith({ args: ['--debug'] })] },
    )
    fireEvent.click(within(list).getByRole('button', { name: '编辑…' }))
    const form = await screen.findByRole('form', { name: '编辑供应商' })
    fireEvent.click(within(form).getByRole('button', { name: '高级' }))
    const args = within(form).getByRole('textbox', { name: '命令行参数' }) as HTMLTextAreaElement
    const env = within(form).getByRole('textbox', { name: '其他环境变量' })
    expect(args.compareDocumentPosition(env) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy()
    expect(args.value).toBe('--debug')
    fireEvent.change(args, { target: { value: '--debug\n --settings ~/team.json ' } })
    fireEvent.click(screen.getByRole('button', { name: '保存' }))
    await waitFor(() => expect(calls.some((c) => c.method === 'PUT')).toBe(true))
    expect(sent(calls, 'PUT').endpoints).toMatchObject([{ args: ['--debug', '--settings ~/team.json'] }])
  })

  it('shows the stored proxy masked and sends it back untouched', async () => {
    const { calls, list } = await openProviders({ 'PUT /machines/m1/providers/p1': { id: 'p1', view: VIEW } })
    fireEvent.click(within(list).getByRole('button', { name: '编辑…' }))
    const form = await screen.findByRole('form', { name: '编辑供应商' })
    fireEvent.click(within(form).getByRole('button', { name: '高级' }))
    expect((within(form).getByRole('textbox', { name: '代理地址' }) as HTMLInputElement).value).toBe(
      'http://bob:****@10.0.0.2:3128',
    )
    fireEvent.click(screen.getByRole('button', { name: '保存' }))
    await waitFor(() => expect(calls.some((c) => c.method === 'PUT')).toBe(true))
    expect(sent(calls, 'PUT')).toMatchObject({ proxy: 'http://bob:****@10.0.0.2:3128' })
  })

  it('opens a fresh editor each time', async () => {
    const { list } = await openProviders()
    fireEvent.click(within(list).getByRole('button', { name: '新增…' }))
    fireEvent.click(await screen.findByRole('button', { name: /Kimi For Coding/ }))
    await screen.findByRole('form', { name: '新增供应商' })
    fireEvent.click(screen.getByRole('button', { name: '取消' }))
    fireEvent.click(within(list).getByRole('button', { name: '编辑…' }))
    const form = await screen.findByRole('form', { name: '编辑供应商' })
    expect((within(form).getByRole('textbox', { name: '名称' }) as HTMLInputElement).value).toBe('Kimi')
  })

  it('warns that sessions pinned to a deleted provider start over', async () => {
    const pinned = {
      ...VIEW,
      sessions: [{ groupId: 'g1', botId: 'b1', agent: 'claude' as const, provider: 'p1' }],
    }
    const { calls, list } = await openProviders(
      { 'DELETE /machines/m1/providers/p1': { ...pinned, providers: [] } },
      pinned,
    )
    fireEvent.click(within(list).getByRole('button', { name: '删除' }))
    const alert = await screen.findByRole('alertdialog')
    expect(alert.textContent).toContain('1 个群的会话正在使用 Kimi')
    expect(within(alert).getByText('前端组（小王的 Claude）')).toBeTruthy()
    fireEvent.click(within(alert).getByRole('button', { name: '删除' }))
    await waitFor(() => expect(calls.some((c) => c.method === 'DELETE')).toBe(true))
    await waitFor(() => expect(within(list).queryByText('Kimi')).toBeNull())
  })

  it('previews CC Switch providers of every agent masked, imports the chosen ones and makes the current the default', async () => {
    const cand = (o: Partial<CcSwitchCandidate>): CcSwitchCandidate => ({
      key: 'k1',
      agent: 'claude',
      protocol: 'anthropic',
      name: 'DeepSeek',
      baseUrl: 'https://api.deepseek.com/anthropic',
      apiKey: '****wxyz',
      model: 'deepseek-chat',
      current: true,
      existing: null,
      ...o,
    })
    const { calls, list } = await openProviders({
      'GET /machines/m1/ccswitch': {
        candidates: [
          cand({}),
          cand({ key: 'k2', name: 'GLM', current: false, existing: 'p9' }),
          cand({ key: 'k3', agent: 'codex', protocol: 'openai', name: 'Codex 中转', current: false }),
        ],
      },
      'POST /machines/m1/ccswitch/apply': { imported: ['p5', 'p6'], view: VIEW },
      'PUT /machines/m1/providers/default': VIEW,
    })
    fireEvent.click(within(list).getByRole('button', { name: '从 CC Switch 导入…' }))
    const dialog = await screen.findByRole('dialog', { name: '从 CC Switch 导入供应商' })
    await within(dialog).findByText('DeepSeek')
    expect(dialog.textContent).toContain('Key ****wxyz')
    expect(dialog.textContent).toContain('将更新已有项')
    expect(within(dialog).getByText('Codex 中转')).toBeTruthy()
    fireEvent.click(within(dialog).getByRole('checkbox', { name: /GLM/ }))
    fireEvent.click(within(dialog).getByRole('button', { name: '导入' }))
    await waitFor(() =>
      expect(calls.find((c) => c.path === '/machines/m1/ccswitch/apply')?.body).toEqual({
        keys: ['k1', 'k3'],
        setDefault: false,
      }),
    )
    await waitFor(() =>
      expect(calls.find((c) => c.path === '/machines/m1/providers/default')?.body).toEqual({
        agent: 'claude',
        choice: 'p5',
        model: null,
      }),
    )
  })

  it('has no CC Switch entry when the machine has none', async () => {
    const { list } = await openProviders({}, VIEW, { ...mbp, features: ['tools', 'providers'] })
    expect(within(list).queryByRole('button', { name: '从 CC Switch 导入…' })).toBeNull()
    expect(within(list).getByRole('button', { name: '粘贴链接导入…' })).toBeTruthy()
  })

  it('imports a pasted ccswitch:// link', async () => {
    const { calls, list } = await openProviders({
      'POST /machines/m1/providers/import-link': { id: 'p1', view: VIEW },
    })
    fireEvent.click(within(list).getByRole('button', { name: '粘贴链接导入…' }))
    const dialog = await screen.findByRole('dialog', { name: '粘贴链接导入' })
    const link = 'ccswitch://v1/import?resource=provider&app=claude&name=K'
    fireEvent.change(within(dialog).getByRole('textbox', { name: '导入链接' }), { target: { value: link } })
    fireEvent.click(within(dialog).getByRole('button', { name: '导入' }))
    await waitFor(() =>
      expect(calls.find((c) => c.path === '/machines/m1/providers/import-link')?.body).toEqual({
        link,
        setDefault: false,
      }),
    )
  })

  it('shows 机器离线 when the machine goes away while the tab is open', async () => {
    mockApi(LIVE)
    const view = open()
    fireEvent.click(tab(AGENTS_TAB))
    await screen.findByRole('region', { name: '供应商' })
    view.rerender(
      <MemoryRouter>
        <MachinePage machine={{ ...mbp, online: false }} bots={[]} />
      </MemoryRouter>,
    )
    expect(screen.getAllByText(/机器离线/).length).toBeGreaterThan(0)
    expect(screen.queryByRole('region', { name: '供应商' })).toBeNull()
  })
})

describe('默认「供应商/模型」', () => {
  const picker = (box: HTMLElement) => within(box).getByRole('button', { name: '供应商/模型' })
  const pick = async (box: HTMLElement, name: string) => {
    fireEvent.click(picker(box))
    fireEvent.click(await screen.findByRole('menuitemcheckbox', { name }))
  }

  it('switches provider and model at once, noting the sessions that keep the old one', async () => {
    const calls = mockApi({
      ...LIVE,
      'PUT /machines/m1/providers/default': {
        ...VIEW,
        machine: { claude: { provider: 'p1', model: 'kimi-k2' } },
      },
    })
    const box = await openDefault()
    expect(picker(box).textContent).toBe('官方登录 / 默认模型')
    fireEvent.click(picker(box))
    expect(screen.getAllByRole('menuitemcheckbox').map((i) => i.textContent)).toEqual([
      '官方登录 / 默认模型',
      '官方登录 / Sonnet',
      'Kimi / 默认（kimi-for-coding）',
      'Kimi / kimi-for-coding',
      'Kimi / kimi-k2',
    ])
    fireEvent.click(screen.getByRole('menuitemcheckbox', { name: 'Kimi / kimi-k2' }))
    expect(screen.queryByRole('alertdialog')).toBeNull()
    await waitFor(() =>
      expect(calls.find((c) => c.method === 'PUT')).toMatchObject({
        path: '/machines/m1/providers/default',
        body: { agent: 'claude', choice: 'p1', model: 'kimi-k2' },
      }),
    )
    await waitFor(() => expect(picker(box).textContent).toBe('Kimi / kimi-k2'))
    const status = within(box).getByRole('status')
    expect(status.textContent).toContain('已保存 · 3 个群的会话开启新会话后才切换')
    expect(within(status).queryByRole('link')).toBeNull()
    fireEvent.click(within(status).getByRole('button', { name: '3 个群的会话开启新会话后才切换' }))
    expect(
      within(status)
        .getAllByRole('link')
        .map((a) => [a.textContent, a.getAttribute('href')]),
    ).toEqual([
      ['前端组（小王的 Claude）', '/g/g1'],
      ['后端组（小王的 Claude）', '/g/g2'],
      ['测试组（审查员）', '/g/g3'],
    ])
  })

  it('greys out a provider of another protocol, saying why', async () => {
    mockApi(LIVE)
    const box = await openDefault(mbp, 'Codex')
    fireEvent.click(picker(box))
    const item = screen.getByRole('menuitemcheckbox', { name: 'Kimi' })
    expect(item.getAttribute('aria-disabled')).toBe('true')
    expect(item.textContent).toContain('该供应商只提供 Anthropic 兼容 接口，Codex 需要 OpenAI 兼容')
  })

  it('offers providers only on an older client, asking to update it', async () => {
    const old = { ...mbp, features: mbp.features.filter((f) => f !== 'protocolProviders') }
    const calls = mockApi({ ...LIVE, 'PUT /machines/m1/providers/default': VIEW })
    const box = await openDefault(old)
    expect(box.textContent).toContain('升级该机器的客户端后可以同时选择模型')
    fireEvent.click(picker(box))
    expect(screen.getAllByRole('menuitemcheckbox').map((i) => i.textContent)).toEqual(['官方登录', 'Kimi'])
    fireEvent.click(screen.getByRole('menuitemcheckbox', { name: 'Kimi' }))
    await waitFor(() =>
      expect(calls.find((c) => c.method === 'PUT')?.body).toEqual({
        agent: 'claude',
        choice: 'p1',
        model: null,
      }),
    )
  })

  it('says just 已保存 when no session is affected (bots with their own provider)', async () => {
    const view = { ...VIEW, bots: { b1: 'official', b2: 'official' } }
    mockApi({
      ...LIVE,
      'GET /machines/m1/providers': view,
      'PUT /machines/m1/providers/default': { ...view, machine: { claude: { provider: 'p1', model: null } } },
    })
    const box = await openDefault()
    await pick(box, 'Kimi / 默认（kimi-for-coding）')
    await waitFor(() => expect(within(box).getByRole('status').textContent).toBe('已保存'))
    // 已保存 fades after a few seconds.
    await waitFor(() => expect(within(box).getByRole('status').textContent).toBe(''), { timeout: 4000 })
  }, 10_000)

  it('keeps the old default when a switch fails, with the reason and a retry', async () => {
    let fail = true
    const calls = mockApi({
      ...LIVE,
      'PUT /machines/m1/providers/default': () =>
        fail
          ? apiError(503, 'machine_offline', '机器离线')
          : { ...VIEW, machine: { claude: { provider: 'p1', model: null } } },
    })
    const box = await openDefault()
    await pick(box, 'Kimi / 默认（kimi-for-coding）')
    await waitFor(() => expect(within(box).getByRole('status').textContent).toContain('保存失败：机器离线'))
    fail = false
    fireEvent.click(within(box).getByRole('button', { name: '重试' }))
    await waitFor(() => expect(picker(box).textContent).toBe('Kimi / 默认（kimi-for-coding）'))
    expect(calls.filter((c) => c.method === 'PUT')).toHaveLength(2)
  })

  it('names the bots using the agent and what they run on', async () => {
    useWorkspace.setState({
      bots: [
        { ...bot('b1', '小王的 Claude'), machineId: 'm1', agentKind: 'claude', agentSettings: {} },
        { ...bot('b2', '审查员'), machineId: 'm1', agentKind: 'claude', agentSettings: {} },
        { ...bot('b3', '别处的'), machineId: 'm9', agentKind: 'claude', agentSettings: {} },
      ],
    })
    mockApi({
      ...LIVE,
      'GET /machines/m1/providers': {
        ...VIEW,
        machine: { claude: { provider: 'p1', model: 'kimi-k2' } },
        bots: { b2: 'official' },
      },
    })
    open()
    fireEvent.click(tab(AGENTS_TAB))
    const row = await openAgent('Claude Code')
    const used = within(row).getByRole('region', { name: '使用它的 Bot' })
    expect(used.textContent).toContain('小王的 Claude')
    expect(used.textContent).toContain('继承机器默认（Kimi / kimi-k2）')
    expect(used.textContent).toContain('审查员')
    expect(used.textContent).toContain('官方登录')
    expect(used.textContent).not.toContain('别处的')
  })
})

describe('供应商 · 高级设置', () => {
  const PRESET: ProviderPreset = {
    ...kimiPreset,
    endpoints: [
      {
        ...kimiPreset.endpoints[0]!,
        env: { CLAUDE_CODE_AUTO_COMPACT_WINDOW: '262144' },
        modelContext: { 'kimi-for-coding': 262144, 'kimi-k2': 1000000 },
      },
    ],
  }
  const openEditor = async (provider: ProviderView, preset = PRESET) => {
    const calls = mockApi({
      ...LIVE,
      'GET /machines/m1/providers': { ...VIEW, providers: [provider] },
      'GET /machines/m1/providers/presets': [preset],
      'PUT /machines/m1/providers/p1': { id: 'p1', view: VIEW },
    })
    open()
    fireEvent.click(tab(AGENTS_TAB))
    const list = await screen.findByRole('region', { name: '供应商' })
    fireEvent.click(within(list).getByRole('button', { name: '编辑…' }))
    const form = await screen.findByRole('form', { name: '编辑供应商' })
    fireEvent.click(within(form).getByRole('button', { name: '高级' }))
    await within(form).findByText('预设：256K')
    return { calls, form }
  }
  const saved = async (calls: Call[]) => {
    fireEvent.click(screen.getByRole('button', { name: '保存' }))
    await waitFor(() => expect(calls.some((c) => c.method === 'PUT')).toBe(true))
    const body = calls.find((c) => c.method === 'PUT')?.body as {
      endpoints: { env: Record<string, string>; models?: unknown }[]
    }
    return body.endpoints[0]!
  }
  const radio = (form: HTMLElement, group: string, name: string) =>
    within(within(form).getByRole('radiogroup', { name: group })).getByRole('radio', { name })

  it('saves untouched settings exactly as they were (a provider setting only the auto-compact window)', async () => {
    const env = { CLAUDE_CODE_AUTO_COMPACT_WINDOW: '204800', GITHUB_TOKEN: '****wxyz' }
    const { calls, form } = await openEditor(kimiWith({ env }))
    expect((within(form).getByRole('textbox', { name: '其他环境变量' }) as HTMLTextAreaElement).value).toBe(
      'GITHUB_TOKEN=****wxyz',
    )
    expect((await saved(calls)).env).toEqual(env)
  })

  it('shows the window of the selected model until one is set', async () => {
    const { form } = await openEditor(kimi)
    const window = within(form).getByRole('button', { name: '上下文窗口' })
    expect(window.textContent).toContain('按模型：256K')
    fireEvent.change(within(form).getByRole('combobox', { name: 'Anthropic 兼容 模型' }), {
      target: { value: 'kimi-k2' },
    })
    expect(window.textContent).toContain('按模型：1M')
    fireEvent.click(window)
    fireEvent.click(screen.getByRole('menuitemcheckbox', { name: '200K' }))
    expect(window.textContent).toContain('200K')
    expect(window.textContent).not.toContain('按模型')
  })

  it('writes the controls into env with units and the three-state switch', async () => {
    const { calls, form } = await openEditor(kimi)
    fireEvent.click(within(form).getByRole('button', { name: '上下文窗口' }))
    fireEvent.click(screen.getByRole('menuitemcheckbox', { name: '自定义' }))
    fireEvent.change(within(form).getByRole('textbox', { name: '自定义上下文窗口' }), {
      target: { value: '1m' },
    })
    fireEvent.change(within(form).getByRole('textbox', { name: '输出上限' }), { target: { value: '128k' } })
    fireEvent.change(within(form).getByRole('textbox', { name: 'API 超时' }), { target: { value: '10m' } })
    fireEvent.click(radio(form, '工具搜索', '关'))
    fireEvent.click(within(form).getByRole('checkbox', { name: '关闭实验性 beta' }))
    expect((await saved(calls)).env).toEqual({
      CLAUDE_CODE_MAX_CONTEXT_TOKENS: '1000000',
      CLAUDE_CODE_MAX_OUTPUT_TOKENS: '128000',
      API_TIMEOUT_MS: '600000',
      ENABLE_TOOL_SEARCH: 'false',
      CLAUDE_CODE_DISABLE_EXPERIMENTAL_BETAS: '1',
    })
  })

  it('keeps a tool search of auto:N and a flag of true when saved untouched', async () => {
    const env = { ENABLE_TOOL_SEARCH: 'auto:5', CLAUDE_CODE_DISABLE_THINKING: 'true' }
    const { calls, form } = await openEditor(kimiWith({ env }))
    expect(radio(form, '工具搜索', '自动').getAttribute('aria-checked')).toBe('true')
    expect((within(form).getByRole('checkbox', { name: '关闭思考参数' }) as HTMLInputElement).checked).toBe(
      true,
    )
    expect((await saved(calls)).env).toEqual(env)
  })

  it('writes auto for tool search set to 自动', async () => {
    const { calls, form } = await openEditor(kimi)
    fireEvent.click(radio(form, '工具搜索', '自动'))
    expect((await saved(calls)).env).toEqual({ ENABLE_TOOL_SEARCH: 'auto' })
  })

  it('marks a value changed from the preset and restores it alone', async () => {
    const { calls, form } = await openEditor(
      kimiWith({
        env: { CLAUDE_CODE_AUTO_COMPACT_WINDOW: '204800', CLAUDE_CODE_MAX_OUTPUT_TOKENS: '64000' },
      }),
    )
    expect(form.textContent).toContain('预设：256K')
    expect(within(form).getAllByText('已修改')).toHaveLength(2)
    fireEvent.click(within(form).getByRole('button', { name: '恢复预设：自动压缩窗口' }))
    expect(within(form).getAllByText('已修改')).toHaveLength(1)
    expect((await saved(calls)).env).toEqual({
      CLAUDE_CODE_AUTO_COMPACT_WINDOW: '262144',
      CLAUDE_CODE_MAX_OUTPUT_TOKENS: '64000',
    })
  })

  it('refuses a known variable among the others', async () => {
    const { calls, form } = await openEditor(kimi)
    fireEvent.change(within(form).getByRole('textbox', { name: '其他环境变量' }), {
      target: { value: 'CLAUDE_CODE_MAX_OUTPUT_TOKENS=1000' },
    })
    fireEvent.click(screen.getByRole('button', { name: '保存' }))
    expect(await screen.findByText('请在上方「输出上限」设置')).toBeTruthy()
    expect(calls.some((c) => c.method === 'PUT')).toBe(false)
  })

  it('refuses an auto-compact window above the model window', async () => {
    const { calls, form } = await openEditor(kimi)
    fireEvent.change(within(form).getByRole('textbox', { name: '自动压缩窗口' }), {
      target: { value: '300k' },
    })
    fireEvent.click(screen.getByRole('button', { name: '保存' }))
    expect(await screen.findByText(/不能大于上下文窗口/)).toBeTruthy()
    expect(calls.some((c) => c.method === 'PUT')).toBe(false)
  })

  it('moves the deprecated small fast model to the Haiku mapping', async () => {
    const { calls, form } = await openEditor(
      kimiWith({ env: { ANTHROPIC_SMALL_FAST_MODEL: 'kimi-k2', X: '1' } }),
    )
    expect(form.textContent).toContain('ANTHROPIC_SMALL_FAST_MODEL 已废弃')
    fireEvent.click(within(form).getByRole('button', { name: '改用 Haiku 映射' }))
    expect((within(form).getByRole('textbox', { name: 'haiku 模型' }) as HTMLInputElement).value).toBe(
      'kimi-k2',
    )
    expect(form.textContent).not.toContain('已废弃')
    const body = await saved(calls)
    expect(body.env).toEqual({ X: '1' })
    expect(body.models).toEqual({ haiku: 'kimi-k2' })
  })

  it('summarises window and output in the provider list', async () => {
    const env = { CLAUDE_CODE_MAX_CONTEXT_TOKENS: '262144', CLAUDE_CODE_MAX_OUTPUT_TOKENS: '128000' }
    mockApi({ ...LIVE, 'GET /machines/m1/providers': { ...VIEW, providers: [kimiWith({ env })] } })
    open()
    fireEvent.click(tab(AGENTS_TAB))
    const list = await screen.findByRole('region', { name: '供应商' })
    expect(list.textContent).toContain('上下文 256K · 输出 128K')
  })

  it("sets the official login's controls, proxy and environment, showing the stored ones masked", async () => {
    const official = {
      claude: {
        env: { CLAUDE_CODE_MAX_OUTPUT_TOKENS: '64000', NO_PROXY: '.corp' },
        proxy: 'http://bob:****@10.0.0.2:3128',
        args: ['--debug'],
      },
    }
    const calls = mockApi({
      ...LIVE,
      'GET /machines/m1/providers': { ...VIEW, official },
      'PUT /machines/m1/providers/official': { ...VIEW, official },
    })
    const box = await openDefault()
    expect(box.textContent).toContain('http://bob:****@10.0.0.2:3128 · 2 个环境变量')
    fireEvent.click(within(box).getByRole('button', { name: '设置…' }))
    const form = await screen.findByRole('form', { name: 'Claude Code 官方登录设置' })
    expect((within(form).getByRole('textbox', { name: '输出上限' }) as HTMLInputElement).value).toBe('64K')
    expect(within(form).getByRole('button', { name: '上下文窗口' }).textContent).not.toContain('按模型')
    expect((within(form).getByRole('textbox', { name: '代理地址' }) as HTMLInputElement).value).toBe(
      'http://bob:****@10.0.0.2:3128',
    )
    const env = within(form).getByRole('textbox', { name: '其他环境变量' }) as HTMLTextAreaElement
    expect(env.value).toBe('NO_PROXY=.corp')
    const args = within(form).getByRole('textbox', { name: '命令行参数' }) as HTMLTextAreaElement
    expect(args.compareDocumentPosition(env) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy()
    expect(args.value).toBe('--debug')
    fireEvent.change(within(form).getByRole('textbox', { name: '输出上限' }), { target: { value: '32k' } })
    fireEvent.change(args, { target: { value: '--debug\n\n  --settings ~/team.json  ' } })
    fireEvent.click(screen.getByRole('button', { name: '保存' }))
    await waitFor(() => expect(calls.some((c) => c.method === 'PUT')).toBe(true))
    expect(calls.find((c) => c.method === 'PUT')).toMatchObject({
      path: '/machines/m1/providers/official',
      body: {
        agent: 'claude',
        proxy: 'http://bob:****@10.0.0.2:3128',
        env: { CLAUDE_CODE_MAX_OUTPUT_TOKENS: '32000', NO_PROXY: '.corp' },
        args: ['--debug', '--settings ~/team.json'],
      },
    })
  })

  it('leaves OpenAI endpoints with the plain variables', async () => {
    const codex = kimiWith({ protocol: 'openai' }, { id: 'p2', name: 'GLM', presetId: null })
    mockApi({ ...LIVE, 'GET /machines/m1/providers': { ...VIEW, providers: [codex] } })
    open()
    fireEvent.click(tab(AGENTS_TAB))
    const list = await screen.findByRole('region', { name: '供应商' })
    fireEvent.click(within(list).getByRole('button', { name: '编辑…' }))
    const form = await screen.findByRole('form', { name: '编辑供应商' })
    fireEvent.click(within(form).getByRole('button', { name: '高级' }))
    expect(within(form).queryByRole('button', { name: '上下文窗口' })).toBeNull()
    expect(within(form).getByRole('textbox', { name: '环境变量' })).toBeTruthy()
  })
})

describe('Agent 设置', () => {
  const SET_VIEW: ProviderStoreView = {
    ...VIEW,
    agentSettings: { claude: { values: { language: 'chinese', autoMemory: 'false' }, inheritCli: true } },
    cli: {
      claude: {
        values: { language: 'english', thinking: 'true' },
        conflicts: ['CLAUDE_CODE_EFFORT_LEVEL'],
        hooks: 2,
        permissionRules: 5,
        version: '2.1.296',
      },
    },
  }
  const openSettings = async (routes: Record<string, unknown> = {}, view = SET_VIEW) => {
    const calls = mockApi({ ...LIVE, 'GET /machines/m1/providers': view, ...routes })
    open()
    fireEvent.click(tab(AGENTS_TAB))
    const row = await openAgent('Claude Code')
    return { calls, region: within(row).getByRole('region', { name: 'Claude Code Agent 设置' }) }
  }
  const row = (region: HTMLElement, label: string) =>
    within(region)
      .getByText(label, { selector: '.ui-group__text > div' })
      .closest('.ui-group__row') as HTMLElement

  it('shows where each value comes from, striking the CLI value it overrides', async () => {
    const { region } = await openSettings()
    const language = row(region, '语言')
    expect(language.textContent).toContain('来源：机器设置')
    expect(language.querySelector('s')?.textContent).toContain('该机器 CLI：english')
    expect(row(region, '扩展思考').textContent).toContain('来源：该机器 CLI（开）')
    expect(row(region, 'Bash 默认超时').textContent).toContain('来源：默认')
    expect(region.textContent).toContain('该机器 CLI 设置了 CLAUDE_CODE_EFFORT_LEVEL')
    expect(region.textContent).toContain('2 个 hooks、5 条权限规则')
    expect(row(region, '由共工管理').textContent).toContain('permissions')
  })

  const puts = (calls: Call[]) => calls.filter((c) => c.method === 'PUT').map((c) => c.body)

  it('saves each change by itself, next to the control, from the next turn on', async () => {
    const { calls, region } = await openSettings({ 'PUT /machines/m1/agent-settings': SET_VIEW })
    expect(within(region).queryByRole('button', { name: /保存/ })).toBeNull()
    expect(region.textContent).toContain('改动立即保存，下一轮生效')
    const base = { agent: 'claude', values: { language: 'chinese', autoMemory: 'false' }, inheritCli: true }

    fireEvent.click(within(row(region, '扩展思考')).getByRole('radio', { name: '关' }))
    await waitFor(() =>
      expect(puts(calls)).toEqual([{ ...base, values: { ...base.values, thinking: 'false' } }]),
    )
    expect(within(row(region, '扩展思考')).getByRole('status').textContent).toBe('已保存')

    const timeout = within(region).getByRole('textbox', { name: 'Bash 默认超时' })
    fireEvent.change(timeout, { target: { value: '10m' } })
    expect(puts(calls)).toHaveLength(1)
    fireEvent.keyDown(timeout, { key: 'Enter' })
    fireEvent.blur(timeout)
    await waitFor(() => expect(puts(calls)).toHaveLength(2))
    expect(puts(calls)[1]).toEqual({
      ...base,
      values: { ...base.values, thinking: 'false', bashTimeout: '600000' },
    })
    await waitFor(() =>
      expect(within(row(region, 'Bash 默认超时')).getByRole('status').textContent).toBe('已保存'),
    )

    expect(region.textContent).not.toContain('个人 CLAUDE.md')
    fireEvent.click(within(region).getByRole('switch', { name: '继承该机器 CLI 配置' }))
    expect(region.textContent).toContain('个人 CLAUDE.md、记忆、hooks 和用户 Skill')
    await waitFor(() => expect(puts(calls)).toHaveLength(3))
    expect(puts(calls)[2]).toMatchObject({ inheritCli: false })
  })

  it('shows a failed save with its reason next to the control and retries it', async () => {
    let fail = true
    const { calls, region } = await openSettings({
      'PUT /machines/m1/agent-settings': () =>
        fail ? apiError(503, 'machine_offline', '机器离线') : SET_VIEW,
    })
    fireEvent.click(within(row(region, '扩展思考')).getByRole('radio', { name: '关' }))
    const status = () => within(row(region, '扩展思考')).getByRole('status')
    await waitFor(() => expect(status().textContent).toContain('保存失败：机器离线'))
    // A failure stays until it is retried or changed.
    await act(() => new Promise((r) => setTimeout(r, 3200)))
    expect(status().textContent).toContain('保存失败：机器离线')
    fail = false
    fireEvent.click(within(row(region, '扩展思考')).getByRole('button', { name: '重试' }))
    await waitFor(() => expect(status().textContent).toBe('已保存'))
    expect(puts(calls)).toHaveLength(2)
  }, 10_000)

  it('refuses an invalid value next to its field without saving', async () => {
    const { calls, region } = await openSettings()
    const timeout = within(region).getByRole('textbox', { name: 'Bash 默认超时' })
    fireEvent.change(timeout, { target: { value: 'abc' } })
    fireEvent.blur(timeout)
    await waitFor(() =>
      expect(within(row(region, 'Bash 默认超时')).getByRole('status').textContent).toContain('保存失败'),
    )
    expect(puts(calls)).toEqual([])
  })

  it('names the bots on this machine that override a setting', async () => {
    useWorkspace.setState({
      bots: [
        {
          ...bot('b1', '小王的 Claude'),
          machineId: 'm1',
          agentKind: 'claude',
          agentSettings: { thinking: 'true' },
        },
        {
          ...bot('b2', '别处的'),
          machineId: 'm9',
          agentKind: 'claude',
          agentSettings: { thinking: 'false' },
        },
      ],
    })
    const { region } = await openSettings()
    const thinking = row(region, '扩展思考').textContent
    expect(thinking).toContain('来源：该机器 CLI（开）')
    expect(thinking).toContain('Bot 覆盖：小王的 Claude（开）')
    expect(thinking).not.toContain('别处的')
    expect(row(region, '语言').textContent).not.toContain('Bot 覆盖')
  })

  it('starts from the defaults with the CLI inherited when nothing is set', async () => {
    const { region } = await openSettings({}, VIEW)
    expect(row(region, '语言').textContent).toContain('来源：默认')
    expect(
      (within(region).getByRole('switch', { name: '继承该机器 CLI 配置' }) as HTMLInputElement).checked,
    ).toBe(true)
  })
})
