import type {
  AgentState,
  MachineAgentsDto,
  MachineDto,
  ProviderEndpoint,
  ProviderStoreView,
  ProviderView,
  UserDto,
} from '@gonggong/protocol'
import { act, fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import { MemoryRouter } from 'react-router'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { useSession } from '../src/app/session'
import { useWorkspace } from '../src/app/workspace'
import { AgentsPanel } from '../src/features/agents/AgentsPanel'
import { loginDisplay, needsOfficialLogin } from '../src/features/agents/model'
import type { AgentLoginDriver, AgentLoginEvent, AgentsSource } from '../src/features/agents/source'
import { AgentLoginDialog } from '../src/features/machines/AgentLoginDialog'
import { MachinePage } from '../src/features/machines/MachinePage'
import { MachinesOverview } from '../src/features/machines/MachinesOverview'
import { Toaster } from '../src/ui'
import { mockApi } from './mockApi'

const agent = (kind: AgentState['kind'], o: Partial<AgentState> = {}): AgentState => ({
  kind,
  available: true,
  version: '2.186.0',
  path: `/tools/${kind}`,
  minVersion: null,
  catalog: null,
  latest: '2.186.0',
  managed: true,
  upgradeCommand: null,
  installCommand: null,
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

const codebuddyEndpoint: ProviderEndpoint = {
  protocol: 'codebuddy',
  baseUrl: 'https://api.example.com',
  apiKeyField: null,
  wireApi: null,
  model: 'glm-5',
  models: null,
  effort: null,
  env: {},
  args: [],
  configDir: null,
  executablePath: null,
  modelOptions: [],
}

const customProvider: ProviderView = {
  id: 'p-cb',
  name: 'Custom CB',
  presetId: null,
  revision: 1,
  apiKey: '****1234',
  proxy: null,
  source: null,
  endpoints: [codebuddyEndpoint],
}

const winMachine = (o: Partial<MachineDto> = {}): MachineDto => ({
  id: 'm1',
  ownerId: 'u1',
  name: 'win-box',
  os: 'windows',
  arch: 'x86_64',
  online: true,
  agents: [],
  daemonVersion: '0.4.35',
  features: ['tools', 'providers', 'protocolProviders', 'codebuddy', 'agent_login'],
  lastSeenAt: null,
  hostname: 'win-box',
  system: null,
  boundAt: '2026-10-01T00:00:00Z',
  createdAt: '2026-10-01T00:00:00Z',
  ...o,
})

function fakeSource(
  state: MachineAgentsDto,
  view: ProviderStoreView,
  o: Partial<AgentsSource> = {},
): AgentsSource {
  return {
    key: 'local',
    features: ['tools', 'providers', 'protocolProviders', 'codebuddy', 'agent_login'],
    loadAgents: vi.fn(async () => state),
    runTool: vi.fn(async () => null),
    loadProviders: vi.fn(async () => view),
    presets: vi.fn(async () => []),
    saveProvider: vi.fn(),
    removeProvider: vi.fn(),
    setDefault: vi.fn(async () => view),
    saveOfficial: vi.fn(),
    saveAgentSettings: vi.fn(),
    importLink: vi.fn(),
    renderLogin: ({ agent: kind, agentState, onClose, onAddProvider, onLoggedIn }) => (
      <AgentLoginDialog
        agent={kind}
        agentState={agentState}
        onClose={onClose}
        onAddProvider={onAddProvider}
        onLoggedIn={onLoggedIn}
      />
    ),
    ...o,
  }
}

beforeEach(() => {
  useSession.setState({ user: { id: 'u1', name: '王磊', role: 'member' } as UserDto, status: 'ready' })
  useWorkspace.setState({ machines: [], bots: [] })
})
afterEach(() => {
  vi.restoreAllMocks()
  vi.unstubAllGlobals()
})

describe('needsOfficialLogin & AgentsPanel collapsed login CTA', () => {
  it('shows orange 未登录 tag and direct 登录 button alongside 升级到 on collapsed row', async () => {
    const cb = agent('codebuddy', {
      version: '2.186.0',
      latest: '2.187.0',
      loginState: 'logged_out',
      loginFlow: 'acp',
    })
    const state: MachineAgentsDto = {
      node: { installed: true, version: '22.3.0', latest: '22.3.0', managed: true, path: '/n' },
      agents: [cb],
      settings: { mirror: { kind: 'npmmirror' } },
    }
    render(
      <MemoryRouter>
        <AgentsPanel source={fakeSource(state, VIEW)} bots={[]} />
      </MemoryRouter>,
    )
    const rowBtn = await screen.findByRole('button', { name: /^CodeBuddy/ })
    const row = rowBtn.closest('.ag-agent') as HTMLElement
    expect(within(row).getByText('未登录')).toBeTruthy()
    // Same words as 去登录 on the machine overview and in the expanded detail.
    expect(within(row).getByRole('button', { name: '去登录' })).toBeTruthy()
    expect(within(row).getByRole('button', { name: '升级到 2.187.0' })).toBeTruthy()
    expect(rowBtn.getAttribute('aria-expanded')).toBe('false')

    // Clicking 登录 directly opens the login dialog without needing to expand the row first.
    fireEvent.click(within(row).getByRole('button', { name: '去登录' }))
    expect(await screen.findByRole('dialog', { name: /登录 CodeBuddy.*官方账号/ })).toBeTruthy()
  })

  it('hides 未登录 tag and direct 登录 button when a custom API-key provider is default', async () => {
    const cb = agent('codebuddy', { loginState: 'logged_out', loginFlow: 'acp' })
    const viewWithCustom: ProviderStoreView = {
      ...VIEW,
      providers: [customProvider],
      machine: { codebuddy: { provider: 'p-cb', model: null } },
    }
    expect(needsOfficialLogin(cb, VIEW)).toBe(true)
    expect(needsOfficialLogin(cb, viewWithCustom)).toBe(false)

    const state: MachineAgentsDto = {
      node: { installed: true, version: '22.3.0', latest: '22.3.0', managed: true, path: '/n' },
      agents: [cb],
      settings: { mirror: { kind: 'npmmirror' } },
    }
    render(
      <MemoryRouter>
        <AgentsPanel source={fakeSource(state, viewWithCustom)} bots={[]} />
      </MemoryRouter>,
    )
    const rowBtn = await screen.findByRole('button', { name: /^CodeBuddy/ })
    const row = rowBtn.closest('.ag-agent') as HTMLElement
    expect(within(row).queryByText('未登录')).toBeNull()
    expect(within(row).queryByRole('button', { name: '去登录' })).toBeNull()
  })

  it('shows 已登录（账号登录） in expanded AgentDetail on Web without agentLocal', async () => {
    const cb = agent('codebuddy', { loginState: 'logged_in', loginLabel: '账号登录', loginFlow: 'acp' })
    const state: MachineAgentsDto = {
      node: { installed: true, version: '22.3.0', latest: '22.3.0', managed: true, path: '/n' },
      agents: [cb],
      settings: { mirror: { kind: 'npmmirror' } },
    }
    render(
      <MemoryRouter>
        <AgentsPanel source={fakeSource(state, VIEW)} bots={[]} />
      </MemoryRouter>,
    )
    fireEvent.click(await screen.findByRole('button', { name: /^CodeBuddy/ }))
    expect(screen.getByText('已登录（账号登录）')).toBeTruthy()
  })

  it('classifies prefixed Chinese and English logged-out local.login strings as logged_out', () => {
    const local = (login: string) => ({ customPath: false, login, adapterVersion: null })
    expect(loginDisplay({}, local('未登录 · 个人账号已不再支持'))).toEqual({
      state: 'logged_out',
      text: '未登录 · 个人账号已不再支持',
    })
    expect(loginDisplay({}, local('Not logged in'))).toEqual({
      state: 'logged_out',
      text: 'Not logged in',
    })
    expect(loginDisplay({ loginState: 'unknown' }, local('Not logged in · expired'))).toEqual({
      state: 'logged_out',
      text: 'Not logged in · expired',
    })
    expect(loginDisplay({}, local('已登录 · Claude Max'))).toEqual({
      state: 'logged_in',
      text: '已登录 · Claude Max',
    })
  })
})

describe('MachinesOverview & MachineDetails login visibility and URL query', () => {
  it('shows 未登录 tag on MachinesOverview for logged-out official agents and opens login dialog via ?tab=agents&login=codebuddy', async () => {
    const cb = agent('codebuddy', { loginState: 'logged_out', loginFlow: 'acp' })
    const m = winMachine({ agents: [cb] })
    mockApi({
      'GET /machines/m1/providers': VIEW,
      'GET /machines/m1/tools': {
        node: { installed: true, version: '22.3.0', latest: '22.3.0', managed: true, path: '/n' },
        agents: [cb],
        settings: { mirror: { kind: 'npmmirror' } },
      },
    })

    const { unmount } = render(
      <MemoryRouter>
        <MachinesOverview machines={[m]} bots={[]} onBindMachine={() => {}} onNewBot={() => {}} />
      </MemoryRouter>,
    )
    expect(await screen.findByText('未登录')).toBeTruthy()
    unmount()

    render(
      <MemoryRouter initialEntries={['/machine/m1?tab=agents&login=codebuddy']}>
        <MachinePage machine={m} bots={[]} />
      </MemoryRouter>,
    )
    expect(await screen.findByRole('dialog', { name: /登录 CodeBuddy.*官方账号/ })).toBeTruthy()
  })
})

describe('AgentLoginDialog flows', () => {
  it('runs Flow A native ACP OAuth: method selection -> QR & browser button -> onLoggedIn on result.ok', async () => {
    let emit: (e: AgentLoginEvent) => void = () => {}
    const startAcp = vi.fn(async () => ({ opId: 'op-42' }))
    const cancelAcp = vi.fn(async () => {})
    const openExternalUrl = vi.fn()
    const refresh = vi.fn(async () => {})
    const onLoggedIn = vi.fn()
    const driver: AgentLoginDriver = {
      mode: 'web',
      supportsAcp: true,
      startAcp,
      cancelAcp,
      subscribeAcp: (cb) => {
        emit = cb
        return () => {}
      },
      openExternalUrl,
      refresh,
    }
    const cb = agent('codebuddy', { loginState: 'logged_out', loginFlow: 'acp' })
    render(
      <>
        <AgentLoginDialog
          machine={winMachine()}
          agent="codebuddy"
          agentState={cb}
          loginDriver={driver}
          onAddProvider={() => {}}
          onLoggedIn={onLoggedIn}
          onClose={() => {}}
        />
        <Toaster />
      </>,
    )
    const dialog = screen.getByRole('dialog', { name: /登录 CodeBuddy.*官方账号/ })
    expect(within(dialog).getByLabelText(/微信登录（国内版）/)).toBeTruthy()
    fireEvent.click(within(dialog).getByLabelText(/Google \/ GitHub（国际版）/))
    fireEvent.click(within(dialog).getByRole('button', { name: '开始登录授权' }))
    await waitFor(() =>
      expect(startAcp).toHaveBeenCalledWith({
        kind: 'codebuddy',
        methodId: 'external',
        openBrowser: false,
      }),
    )

    act(() =>
      emit({
        t: 'agent.login.progress',
        opId: 'op-42',
        kind: 'codebuddy',
        stage: 'authenticating',
      }),
    )
    expect(await within(dialog).findByText('正在获取授权链接…')).toBeTruthy()
    expect(within(dialog).queryByText('authenticating')).toBeNull()

    act(() =>
      emit({
        t: 'agent.login.auth',
        opId: 'op-42',
        kind: 'codebuddy',
        url: 'https://codebuddy.ai/oauth?state=abc',
        methodId: 'external',
      }),
    )
    expect(await within(dialog).findByTitle('授权二维码')).toBeTruthy()
    expect(within(dialog).getByText('请在浏览器或微信中完成登录…')).toBeTruthy()
    fireEvent.click(within(dialog).getByRole('button', { name: '在浏览器中打开' }))
    expect(openExternalUrl).toHaveBeenCalledWith('https://codebuddy.ai/oauth?state=abc')

    act(() =>
      emit({
        t: 'agent.login.result',
        opId: 'op-42',
        kind: 'codebuddy',
        ok: true,
        user: 'wanglei@corp.cn',
      }),
    )
    expect(await within(dialog).findByText('登录成功')).toBeTruthy()
    expect(within(dialog).getByText('已登录账号：wanglei@corp.cn')).toBeTruthy()
    expect(onLoggedIn).toHaveBeenCalledTimes(1)
    expect(refresh).toHaveBeenCalledTimes(1)
  })

  it('offers the API Key fallback once, in the same words, after a failed ACP login', async () => {
    let emit: (e: AgentLoginEvent) => void = () => {}
    const driver: AgentLoginDriver = {
      mode: 'web',
      supportsAcp: true,
      startAcp: vi.fn(async () => ({ opId: 'op-7' })),
      cancelAcp: vi.fn(async () => {}),
      subscribeAcp: (cb) => {
        emit = cb
        return () => {}
      },
    }
    render(
      <AgentLoginDialog
        machine={winMachine()}
        agent="codebuddy"
        agentState={agent('codebuddy', { loginState: 'logged_out', loginFlow: 'acp' })}
        loginDriver={driver}
        onAddProvider={() => {}}
        onClose={() => {}}
      />,
    )
    const dialog = screen.getByRole('dialog', { name: /登录 CodeBuddy.*官方账号/ })
    fireEvent.click(within(dialog).getByRole('button', { name: '开始登录授权' }))
    await waitFor(() => expect(driver.startAcp).toHaveBeenCalled())
    act(() => emit({ t: 'agent.login.result', opId: 'op-7', kind: 'codebuddy', ok: false, error: '超时' }))
    expect(await within(dialog).findByText('登录失败')).toBeTruthy()
    expect(within(dialog).getAllByRole('button', { name: '改用 API Key 供应商' })).toHaveLength(1)
    expect(within(dialog).queryByText('改为配置 API Key')).toBeNull()
  })

  it('offers Desktop terminal launcher and manual refresh for non-ACP agents (Flow B)', async () => {
    const launchTerminal = vi.fn(async () => {})
    const refresh = vi.fn(async () => {})
    const onLoggedIn = vi.fn()
    const driver: AgentLoginDriver = {
      mode: 'desktop',
      supportsAcp: true,
      launchTerminal,
      refresh,
    }
    render(
      <>
        <AgentLoginDialog
          agent="claude"
          agentState={agent('claude', { loginState: 'logged_out', loginFlow: 'terminal' })}
          loginDriver={driver}
          onAddProvider={() => {}}
          onLoggedIn={onLoggedIn}
          onClose={() => {}}
        />
        <Toaster />
      </>,
    )
    const dialog = screen.getByRole('dialog', { name: '登录 Claude Code 官方账号' })
    fireEvent.click(within(dialog).getByRole('button', { name: '打开终端登录' }))
    await waitFor(() => expect(launchTerminal).toHaveBeenCalledWith('claude'))

    fireEvent.click(within(dialog).getByRole('button', { name: '已完成登录，刷新状态' }))
    await waitFor(() => expect(refresh).toHaveBeenCalledTimes(1))
    expect(onLoggedIn).toHaveBeenCalledTimes(1)
  })

  it('shows gonggong:// deep link on Web for older Windows client without agent_login (Flow C)', () => {
    const oldWin = winMachine({ features: ['tools', 'providers', 'codebuddy'] })
    render(
      <AgentLoginDialog
        machine={oldWin}
        agent="codebuddy"
        agentState={agent('codebuddy', { loginState: 'logged_out' })}
        loginDriver={{ mode: 'web', supportsAcp: false }}
        onAddProvider={() => {}}
        onClose={() => {}}
      />,
    )
    const dialog = screen.getByRole('dialog', { name: /登录 CodeBuddy.*官方账号/ })
    const link = within(dialog).getByRole('link', { name: '在共工桌面端打开登录' })
    expect(link.getAttribute('href')).toBe('gonggong://agents?kind=codebuddy&action=login')
    expect(within(dialog).getByText(/%USERPROFILE%\\\.gonggong\\tools/)).toBeTruthy()
  })
})
