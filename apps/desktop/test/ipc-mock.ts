import { vi } from 'vitest'
import type { AgentCard, AppInfo, DaemonStatus, MachineBot, RunInfo } from '../src/ipc'

vi.mock('../src/ipc', () => ({
  ipc: {
    appInfo: vi.fn(),
    snapshot: vi.fn(),
    parseLink: vi.fn(),
    login: vi.fn(),
    startDaemon: vi.fn(),
    readClipboard: vi.fn(),
    overview: vi.fn(),
    runProcess: vi.fn(),
    settings: vi.fn(),
    setAutoUpgrade: vi.fn(),
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
    bots: vi.fn(),
    openBotInWeb: vi.fn(),
  },
  onSnapshot: vi.fn(async () => () => {}),
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
      },
      { kind: 'codex', available: false, version: null, path: null, minVersion: '0.40.0', catalog: null },
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
    ...over,
  }
}
