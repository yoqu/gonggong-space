import type {
  AgentState,
  MachineAgentsDto,
  ProviderEndpoint,
  ProviderStoreView,
  ProviderView,
} from '@gonggong/protocol'
import { vi } from 'vitest'
import type { AppInfo, DaemonStatus, MachineBot, RunInfo } from '../src/ipc'

/** Hoisted with the mock: its factory reads them. */
const { STATE, VIEW } = vi.hoisted(() => ({
  STATE: {
    node: { installed: true, version: '22.3.0', latest: '22.3.0', managed: true, path: '/n/node' },
    agents: [] as AgentState[],
    settings: { mirror: { kind: 'npmmirror' } },
  } as MachineAgentsDto,
  VIEW: {
    machine: {},
    official: {},
    bots: {},
    providers: [],
    sessions: [],
    agentSettings: {},
    cli: {},
  } as ProviderStoreView,
}))

export { STATE, VIEW }

vi.mock('../src/ipc', () => ({
  ipc: {
    appInfo: vi.fn(),
    setLocale: vi.fn(async () => {}),
    snapshot: vi.fn(),
    parseLink: vi.fn(),
    login: vi.fn(),
    startDaemon: vi.fn(),
    readClipboard: vi.fn(),
    overview: vi.fn(),
    runProcess: vi.fn(),
    settings: vi.fn(async () => ({
      autoUpgrade: false,
      launchAtLogin: false,
      hideDockOnClose: false,
      mirror: { kind: 'npmmirror' },
      env: {},
    })),
    setAutoUpgrade: vi.fn(),
    setMirror: vi.fn(),
    setEnv: vi.fn(),
    setLaunchAtLogin: vi.fn(),
    setHideDockOnClose: vi.fn(),
    unbind: vi.fn(),
    workspaces: vi.fn(),
    reveal: vi.fn(),
    resetCd: vi.fn(),
    deleteWorkspace: vi.fn(),
    workspaceChanges: vi.fn(),
    diagnostics: vi.fn(),
    measureNet: vi.fn(),
    exportDiagnostics: vi.fn(),
    recentLogs: vi.fn(),
    agentFeatures: vi.fn(async () => ['tools', 'providers', 'protocolProviders']),
    tools: vi.fn(async () => STATE),
    runTool: vi.fn(),
    providers: vi.fn(async () => ({ view: VIEW })),
    ccSwitchPreview: vi.fn(async () => []),
    ccSwitchApply: vi.fn(),
    claudeDirs: vi.fn(async () => []),
    claudeDefaultDir: vi.fn(async () => ({ path: '/Users/me/.claude', exists: true })),
    pickDir: vi.fn(async () => null),
    agentLocal: vi.fn(async () => ({ customPath: false, login: null, adapterVersion: null })),
    pickAgentPath: vi.fn(async () => false),
    resetAgentPath: vi.fn(async () => {}),
    groupNames: vi.fn(async () => ({})),
    bots: vi.fn(),
    openBotInWeb: vi.fn(),
    openWeb: vi.fn(),
    marketInstalls: vi.fn(async () => []),
    marketListings: vi.fn(async () => []),
    openMarketInWeb: vi.fn(async () => {}),
    tunnels: vi.fn(async () => ({ previews: [], services: [] })),
    closeTunnel: vi.fn(),
    startPreview: vi.fn(),
    retryCast: vi.fn(),
    stopService: vi.fn(),
    openLocal: vi.fn(),
    castComponent: vi.fn(),
    permissions: vi.fn(async () => []),
    requestPermission: vi.fn(),
    restartApp: vi.fn(),
    checkUpdate: vi.fn(async () => null),
    stopDaemon: vi.fn(async () => {}),
    relaunch: vi.fn(async () => {}),
  },
  onSnapshot: vi.fn(async () => () => {}),
  onToolProgress: vi.fn(async () => () => {}),
  onOpenLinks: vi.fn(async () => () => {}),
}))

export const INFO: AppInfo = {
  version: '0.1.0',
  protocol: 1,
  machine: { name: 'wanglei-mbp', os: 'macos', arch: 'aarch64' },
  ownerName: '王磊',
  server: 'https://gonggong.corp.cn',
  workspacesDir: '/Users/wl/.gonggong/workspaces',
  backupsDir: '/Users/wl/.gonggong/backups',
  adapters: [
    { kind: 'claude', package: '@agentclientprotocol/claude-agent-acp', version: '0.81.0' },
    { kind: 'codex', package: '@agentclientprotocol/codex-acp', version: '2.2.2' },
  ],
}

export function run(over: Partial<RunInfo>): RunInfo {
  return {
    runId: 'r1',
    groupId: 'g1',
    groupName: '支付服务重构',
    botId: 'b1',
    botName: '小王的 Claude',
    triggeredBy: '王磊',
    status: 'running',
    step: 'go build ./...',
    queued: false,
    startedMs: 0,
    context: null,
    ...over,
  }
}

export function status(over: Partial<DaemonStatus> = {}): DaemonStatus {
  return {
    conn: { state: 'online', sinceMs: 0 },
    heartbeatSec: 15,
    lastHeartbeatMs: Date.now() - 3000,
    latencyMs: 38,
    agents: [
      {
        kind: 'claude',
        available: true,
        version: '2.1.4',
        path: '/opt/homebrew/bin/claude',
        minVersion: '2.0.0',
        catalog: null,
        latest: null,
        managed: false,
        upgradeCommand: null,
        installCommand: null,
      },
      {
        kind: 'codex',
        available: false,
        version: null,
        path: null,
        minVersion: '0.160.1',
        catalog: null,
        latest: null,
        managed: false,
        upgradeCommand: null,
        installCommand: null,
      },
    ],
    runs: [],
    ...over,
  }
}

export function agent(kind: AgentState['kind'], over: Partial<AgentState> = {}): AgentState {
  return {
    kind,
    available: true,
    version: '1.0.0',
    path: `/opt/homebrew/bin/${kind}`,
    minVersion: null,
    catalog: null,
    latest: null,
    managed: false,
    upgradeCommand: null,
    installCommand: null,
    ...over,
  }
}

export const CLAUDE = agent('claude', { version: '2.1.4', minVersion: '2.0.0', latest: '2.1.4' })
export const CODEX = agent('codex', { available: false, version: null, path: null, minVersion: '0.160.1' })

export function endpoint(over: Partial<ProviderEndpoint> = {}): ProviderEndpoint {
  return {
    protocol: 'anthropic',
    baseUrl: 'https://api.kimi.com/coding/',
    apiKeyField: 'ANTHROPIC_AUTH_TOKEN',
    wireApi: null,
    model: 'kimi-for-coding',
    models: null,
    effort: null,
    env: {},
    args: [],
    configDir: null,
    executablePath: null,
    modelOptions: [],
    ...over,
  }
}

export function provider(over: Partial<ProviderView>): ProviderView {
  return {
    id: 'kimi-coding-a1b2',
    name: 'Kimi For Coding',
    presetId: 'kimi-coding',
    revision: 1,
    apiKey: '****abcd',
    proxy: null,
    source: null,
    endpoints: [endpoint()],
    ...over,
  }
}

export function bot(over: Partial<MachineBot>): MachineBot {
  return {
    id: 'b1',
    name: '小王的 Claude',
    agentKind: 'claude',
    binding: 'bound',
    presence: 'online',
    systemPrompt: '',
    concurrency: 2,
    tier: 'workspace',
    aiReview: false,
    alwaysAllow: [],
    avatar: 'role-gong',
    followAgent: false,
    teamId: 't1',
    teamName: '默认团队',
    ...over,
  }
}
