import { vi } from 'vitest'
import type {
  AgentCard,
  AppInfo,
  DaemonStatus,
  MachineBot,
  Preset,
  ProviderView,
  RunInfo,
  ToolStatus,
} from '../src/ipc'

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
    settings: vi.fn(),
    setAutoUpgrade: vi.fn(),
    setMirror: vi.fn(),
    setLaunchAtLogin: vi.fn(),
    unbind: vi.fn(),
    workspaces: vi.fn(),
    reveal: vi.fn(),
    resetCd: vi.fn(),
    deleteWorkspace: vi.fn(),
    diagnostics: vi.fn(),
    measureNet: vi.fn(),
    exportDiagnostics: vi.fn(),
    recentLogs: vi.fn(),
    agents: vi.fn(),
    pickAgentPath: vi.fn(),
    resetAgentPath: vi.fn(),
    tools: vi.fn(async () => []),
    runTool: vi.fn(),
    providers: vi.fn(async () => ({ machine: {}, bots: {}, providers: [], ccSwitch: false })),
    providerPresets: vi.fn(async () => []),
    saveProvider: vi.fn(),
    removeProvider: vi.fn(),
    chooseProvider: vi.fn(),
    providerImpact: vi.fn(async () => []),
    ccswitchPreview: vi.fn(),
    ccswitchImport: vi.fn(),
    importProviderLink: vi.fn(),
    openKeyPage: vi.fn(),
    bots: vi.fn(),
    openBotInWeb: vi.fn(),
    tunnels: vi.fn(async () => ({ previews: [], services: [] })),
    closeTunnel: vi.fn(),
    retryCast: vi.fn(),
    stopService: vi.fn(),
    openLocal: vi.fn(),
    castComponent: vi.fn(),
    permissions: vi.fn(async () => []),
    requestPermission: vi.fn(),
    restartApp: vi.fn(),
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
  certPinned: true,
  workspacesDir: '/Users/wl/.gonggong/workspaces',
  backupsDir: '/Users/wl/.gonggong/backups',
  adapters: [
    { kind: 'claude', package: '@agentclientprotocol/claude-agent-acp', version: '0.81.0' },
    { kind: 'codex', package: '@agentclientprotocol/codex-acp', version: '1.13.0' },
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
      },
      {
        kind: 'codex',
        available: false,
        version: null,
        path: null,
        minVersion: '0.40.0',
        catalog: null,
        latest: null,
        managed: false,
      },
    ],
    runs: [],
    ...over,
  }
}

export const CLAUDE: AgentCard = {
  kind: 'claude',
  available: true,
  version: '2.1.4',
  path: '/opt/homebrew/bin/claude',
  minVersion: '2.0.0',
  customPath: false,
  catalog: {
    models: [
      { value: 'sonnet', name: 'Sonnet 5', efforts: [], effort: null },
      { value: 'haiku', name: 'Haiku 4.5', efforts: [], effort: null },
    ],
    current: null,
    efforts: [],
    effort: null,
  },
  login: '已登录 · Claude Max',
  latest: null,
  managed: false,
}

export const CODEX: AgentCard = {
  kind: 'codex',
  available: false,
  version: null,
  path: null,
  minVersion: '0.40.0',
  customPath: false,
  catalog: null,
  login: null,
  latest: null,
  managed: false,
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
    approval: 'ask',
    allowlist: [],
    avatar: 'role-gong',
    ...over,
  }
}

export function tool(over: Partial<ToolStatus> & Pick<ToolStatus, 'kind'>): ToolStatus {
  return { installed: true, version: null, latest: null, managed: false, path: null, ...over }
}

export function provider(over: Partial<ProviderView>): ProviderView {
  return {
    id: 'kimi-coding-a1b2',
    agent: 'claude',
    name: 'Kimi For Coding',
    presetId: 'kimi-coding',
    revision: 1,
    baseUrl: 'https://api.kimi.com/coding/',
    apiKey: '****abcd',
    apiKeyField: 'ANTHROPIC_AUTH_TOKEN',
    model: 'kimi-for-coding',
    models: null,
    env: {},
    wireApi: null,
    effort: null,
    source: null,
    ...over,
  }
}

export const KIMI: Preset = {
  id: 'kimi-coding',
  agent: 'claude',
  name: 'Kimi For Coding',
  group: 'cn',
  websiteUrl: 'https://www.kimi.com/code/',
  apiKeyUrl: null,
  baseUrl: 'https://api.kimi.com/coding/',
  model: 'kimi-for-coding',
  models: { haiku: 'kimi-for-coding', sonnet: 'kimi-for-coding', opus: 'kimi-for-coding' },
  modelOptions: ['kimi-for-coding', 'kimi-k2'],
  env: { CLAUDE_CODE_MAX_CONTEXT_TOKENS: '262144' },
}

export const OPENROUTER: Preset = {
  ...KIMI,
  id: 'openrouter',
  name: 'OpenRouter',
  group: 'aggregator',
  websiteUrl: null,
  baseUrl: 'https://openrouter.ai/api',
  model: null,
  models: null,
  modelOptions: [],
  env: {},
}
