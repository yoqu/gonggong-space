import type {
  AgentState,
  MachineAgentsDto,
  ProviderEndpoint,
  ProviderStoreView,
  ProviderView,
} from '@gonggong/protocol'
import { act, fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import { MemoryRouter } from 'react-router'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { AgentsPanel } from '../src/features/agents/AgentsPanel'
import { agentStatus, choiceOptions, whyNot } from '../src/features/agents/model'
import type { AgentsSource } from '../src/features/agents/source'

const agent = (kind: AgentState['kind'], o: Partial<AgentState> = {}): AgentState => ({
  kind,
  available: true,
  version: '1.0.0',
  path: `/bin/${kind}`,
  minVersion: null,
  catalog: null,
  latest: '1.0.0',
  managed: true,
  upgradeCommand: null,
  installCommand: null,
  ...o,
})

const endpoint = (o: Partial<ProviderEndpoint> = {}): ProviderEndpoint => ({
  protocol: 'anthropic',
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
})
const provider = (
  id: string,
  endpoints: ProviderEndpoint[],
  o: Partial<ProviderView> = {},
): ProviderView => ({
  id,
  name: id.toUpperCase(),
  presetId: null,
  revision: 1,
  apiKey: '****abcd',
  proxy: null,
  source: null,
  endpoints,
  ...o,
})
const VIEW: ProviderStoreView = {
  machine: {},
  official: {},
  bots: {},
  providers: [],
  sessions: [],
  agentSettings: {},
  cli: {},
}

const STATE: MachineAgentsDto = {
  node: { installed: true, version: '22.3.0', latest: '22.3.0', managed: true, path: '/n' },
  agents: [
    agent('claude'),
    agent('codex', { latest: '1.1.0' }),
    agent('gemini', {
      version: '0.1.0',
      latest: '0.2.0',
      managed: false,
      upgradeCommand: 'brew upgrade gemini-cli',
    }),
    agent('codebuddy', { available: false, version: null, path: null }),
    agent('antigravity', { available: false, version: null, path: null, installCommand: 'curl … | bash' }),
  ],
  settings: { mirror: { kind: 'npmmirror' } },
}

/** A source standing in for the desktop app's IPC: nothing goes over HTTP. */
function fakeSource(o: Partial<AgentsSource> = {}): AgentsSource {
  return {
    key: 'local',
    features: ['tools', 'providers', 'protocolProviders', 'gemini', 'codebuddy', 'antigravity'],
    loadAgents: vi.fn(async () => STATE),
    runTool: vi.fn(async () => null),
    loadProviders: vi.fn(async () => VIEW),
    presets: vi.fn(async () => []),
    saveProvider: vi.fn(),
    removeProvider: vi.fn(),
    setDefault: vi.fn(async () => VIEW),
    saveOfficial: vi.fn(),
    saveAgentSettings: vi.fn(),
    importLink: vi.fn(),
    ...o,
  }
}

const show = async (source: AgentsSource) => {
  render(
    <MemoryRouter>
      <AgentsPanel source={source} bots={[]} />
    </MemoryRouter>,
  )
  await screen.findByRole('region', { name: '供应商' })
}
const row = (name: string) =>
  screen.getByRole('button', { name: new RegExp(`^${name}`) }).closest('.ag-agent') as HTMLElement
const actions = (name: string) =>
  within(row(name))
    .getAllByRole('button')
    .slice(1)
    .map((b) => b.textContent)

beforeEach(() => {
  vi.stubGlobal(
    'fetch',
    vi.fn(() => {
      throw new Error('no HTTP from the Agent page')
    }),
  )
})
afterEach(() => vi.unstubAllGlobals())

describe('Agent page on any source', () => {
  it('lists installed agents, then those to install, each with the one action of its state', async () => {
    await show(fakeSource())
    const agents = screen.getByRole('region', { name: 'Agent' })
    const installable = screen.getByRole('region', { name: '可安装' })
    expect(
      within(agents)
        .getAllByRole('button', { expanded: false })
        .map((b) => b.textContent),
    ).toEqual([
      expect.stringMatching(/^Claude Code/),
      expect.stringMatching(/^Codex/),
      expect.stringMatching(/^Gemini CLI/),
    ])
    expect(
      within(installable)
        .getAllByRole('button', { expanded: false })
        .map((b) => b.textContent),
    ).toEqual([expect.stringMatching(/^CodeBuddy/), expect.stringMatching(/^Antigravity CLI/)])
    expect(actions('Claude Code')).toEqual([])
    expect(actions('Codex')).toEqual(['升级到 1.1.0'])
    expect(actions('Gemini CLI')).toEqual(['升级到 0.2.0'])
    expect(actions('CodeBuddy')).toEqual(['安装'])
    expect(actions('Antigravity CLI')).toEqual(['复制安装命令'])
    expect(screen.getByRole('region', { name: 'Node.js' }).textContent).toContain('Node.js 22.3.0')
    expect(within(screen.getByRole('region', { name: 'Node.js' })).queryByRole('button')).toBeNull()
  })

  it('hides the agents the client cannot run', async () => {
    await show(
      fakeSource({ features: ['tools', 'providers'], loadAgents: async () => ({ ...STATE, agents: [] }) }),
    )
    expect(screen.queryByRole('button', { name: /^Gemini CLI/ })).toBeNull()
    expect(screen.getByRole('button', { name: /^Claude Code/ })).toBeTruthy()
  })

  it('upgrades all that can be upgraded, one after another, streaming each log', async () => {
    const order: string[] = []
    let finish = () => {}
    const runTool = vi.fn(
      (kind: string, op: string, onLine: (l: string) => void) =>
        new Promise<MachineAgentsDto | null>((resolve) => {
          order.push(`${op} ${kind}`)
          onLine(`upgrading ${kind}`)
          finish = () => resolve(null)
        }),
    )
    await show(fakeSource({ runTool }))
    fireEvent.click(screen.getByRole('button', { name: '全部升级（2）' }))
    await waitFor(() => expect(order).toEqual(['upgrade codex']))
    expect(within(row('Codex')).getByRole('log').textContent).toContain('upgrading codex')
    expect((screen.getByRole('button', { name: '正在升级 1/2…' }) as HTMLButtonElement).disabled).toBe(true)
    await act(async () => finish())
    await waitFor(() => expect(order).toEqual(['upgrade codex', 'upgrade gemini']))
    await act(async () => finish())
    await waitFor(() => expect(screen.getByRole('button', { name: '全部升级（2）' })).toBeTruthy())
  })

  it('stops 全部升级 at the first failure, leaving its log open', async () => {
    const runTool = vi.fn(async (kind: string) => {
      if (kind === 'codex') throw new Error('网络错误')
      return null
    })
    await show(fakeSource({ runTool }))
    fireEvent.click(screen.getByRole('button', { name: '全部升级（2）' }))
    await waitFor(() => expect(within(row('Codex')).getByRole('log').textContent).toContain('网络错误'))
    expect(runTool).toHaveBeenCalledTimes(1)
    expect(within(row('Codex')).getByText('升级失败')).toBeTruthy()
  })

  it('asks for Node.js first when it is missing', async () => {
    const runTool = vi.fn(async () => null)
    await show(
      fakeSource({
        runTool,
        loadAgents: async () => ({
          ...STATE,
          node: { installed: false, version: null, latest: '22.9.0', managed: false, path: null },
        }),
      }),
    )
    const node = screen.getByRole('region', { name: 'Node.js' })
    expect(node.textContent).toContain('未安装 Node.js')
    fireEvent.click(within(node).getByRole('button', { name: '安装 Node.js' }))
    await waitFor(() => expect(runTool).toHaveBeenCalledWith('node', 'install', expect.any(Function)))
  })

  it('sets the default provider and model through the source', async () => {
    const view = {
      ...VIEW,
      providers: [provider('kimi', [endpoint({ model: 'k1', modelOptions: ['k2'] })])],
    }
    const setDefault = vi.fn(async () => ({
      ...view,
      machine: { claude: { provider: 'kimi', model: 'k2' } },
    }))
    await show(fakeSource({ loadProviders: async () => view, setDefault }))
    fireEvent.click(screen.getByRole('button', { name: /^Claude Code/ }))
    fireEvent.click(screen.getByRole('button', { name: '供应商/模型' }))
    fireEvent.click(screen.getByRole('menuitemcheckbox', { name: 'KIMI / k2' }))
    await waitFor(() => expect(setDefault).toHaveBeenCalledWith('claude', 'kimi', 'k2'))
  })
})

describe('「供应商/模型」 options', () => {
  const anthropic = provider('kimi', [endpoint({ model: 'k1', modelOptions: ['k1', 'k2'] })])
  const openai = provider('relay', [endpoint({ protocol: 'openai' })])
  const both = provider('glm', [endpoint(), endpoint({ protocol: 'openai', model: 'glm-oa' })])
  const profile = provider('pp', [endpoint({ configDir: '/Users/w/.pp' })])
  const legacy = provider('old', [endpoint()], { agents: ['deepseek'] })
  const view = { ...VIEW, providers: [anthropic, openai, both, profile, legacy] }
  const labels = (o: ReturnType<typeof choiceOptions>) =>
    o.map((x) => (x.disabled ? `(${x.label})` : x.label))

  it('groups each usable provider with its models and greys out the others', () => {
    expect(labels(choiceOptions(view, 'codex', { catalog: null, models: true }))).toEqual([
      '官方登录 / 默认模型',
      '(KIMI)',
      'RELAY / 默认模型',
      'GLM / 默认（glm-oa）',
      '(PP)',
      '(OLD)',
    ])
    expect(labels(choiceOptions(view, 'claude', { catalog: null, models: true }))).toEqual([
      '官方登录 / 默认模型',
      'KIMI / 默认（k1）',
      'KIMI / k1',
      'KIMI / k2',
      '(RELAY)',
      'GLM / 默认模型',
      'PP / 默认模型',
      '(OLD)',
    ])
  })

  it('says why a provider does not fit', () => {
    expect(whyNot(openai, 'claude')).toBe('该供应商只提供 OpenAI 兼容 接口，Claude Code 需要 Anthropic 兼容')
    expect(whyNot(profile, 'deepseek')).toBe('该机器 Claude 配置目录只能给 Claude Code 用')
    expect(whyNot(legacy, 'claude')).toBe('该供应商由旧版客户端登记，只能给 DeepSeek Harness 用')
    expect(whyNot(anthropic, 'claude')).toBeNull()
  })

  it('names the machine default a bot inherits, and offers providers only to an older client', () => {
    const withDefault = { ...view, machine: { claude: { provider: 'kimi', model: 'k2' } } }
    const o = choiceOptions(withDefault, 'claude', {
      catalog: null,
      models: false,
      inherit: withDefault.machine.claude,
    })
    expect(labels(o).slice(0, 3)).toEqual(['继承机器默认（当前：KIMI / k2）', '官方登录', 'KIMI'])
  })

  it('tells the states apart', () => {
    expect(agentStatus(agent('claude'))).toBe('current')
    expect(agentStatus(agent('claude', { latest: '2.0.0' }))).toBe('update')
    expect(agentStatus(agent('claude', { latest: '2.0.0', managed: false }))).toBe('stale')
    expect(agentStatus(agent('claude', { available: false }))).toBe('missing')
    expect(agentStatus(agent('antigravity', { available: false, installCommand: 'x' }))).toBe('command')
  })
})
