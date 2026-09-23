/**
 * Typed bridge to the Rust side (`src-tauri/src/commands/*`). Every command is mirrored here; pages never call
 * `invoke` directly, so tests can mock this module.
 */
import type { AgentInfo, AgentKind, BotDto, RunStatus } from '@aiws/protocol'
import { invoke } from '@tauri-apps/api/core'
import { listen, type UnlistenFn } from '@tauri-apps/api/event'

export type RejectReason = 'protocol' | 'revoked' | 'unauthorized' | 'workspace' | 'readonly'

export type Conn =
  | { state: 'connecting' }
  | { state: 'online'; sinceMs: number }
  | { state: 'offline'; retryAtMs: number; error: string }
  | { state: 'rejected'; reason: RejectReason; message: string; wiped: string[] }

export interface RunInfo {
  runId: string
  groupId: string
  groupName: string
  botId: string
  botName: string
  triggeredBy: string
  /** null while the workspace / attachments are being prepared. */
  status: RunStatus | null
  step: string
  queued: boolean
  startedMs: number
}

export interface DaemonStatus {
  conn: Conn
  heartbeatSec: number | null
  lastHeartbeatMs: number | null
  latencyMs: number | null
  agents: AgentInfo[]
  runs: RunInfo[]
}

export type Snapshot =
  | { phase: 'unbound' }
  | { phase: 'blocked'; message: string }
  | { phase: 'running'; status: DaemonStatus }

export interface AppInfo {
  version: string
  protocol: number
  machine: { name: string; os: string; arch: string }
  ownerName: string | null
  server: string | null
  certPinned: boolean
  workspacesDir: string
  backupsDir: string
  adapters: { kind: AgentKind; package: string; version: string }[]
}

export type MachineBot = Pick<
  BotDto,
  'id' | 'name' | 'agentKind' | 'binding' | 'presence' | 'systemPrompt' | 'concurrency'
>

export interface Overview {
  managedWorkspaces: number
}

export interface Settings {
  autoUpgrade: boolean
  launchAtLogin: boolean
}

/** An entry of an adapter's model / effort select. */
export interface Choice {
  value: string
  name: string
  description?: string
}

/** What the adapter offered in its latest new session (`<home>/models.json`). */
export interface AgentModels {
  models: Choice[]
  /** The adapter's own default. */
  current: string | null
  efforts: Choice[]
  currentEffort: string | null
}

export interface AgentCard extends AgentInfo {
  /** Set with 更换路径 instead of detected on PATH. */
  customPath: boolean
  /** null = the adapter's default. */
  defaultModel: string | null
  effort: string | null
  /** null until the agent ran once on this machine. */
  catalog: AgentModels | null
  login: string | null
}

export type Approval = 'ask' | 'allowlist' | 'all'

/** A machine bot with its 本机设置. */
export interface BotCard extends MachineBot {
  /** null = follow the agent's default. */
  model: string | null
  approval: Approval
  allowlist: string[]
}

export interface BotChange {
  model: string | null
  approval: Approval
  allowlist: string[]
  /** Only when changed. */
  concurrency: number | null
}

export const ipc = {
  appInfo: () => invoke<AppInfo>('app_info'),
  snapshot: () => invoke<Snapshot>('snapshot'),
  login: (server: string, code: string) => invoke<void>('login', { server, code }),
  detectAgents: () => invoke<AgentInfo[]>('detect_agents'),
  startDaemon: () => invoke<void>('start_daemon'),
  machineBots: () => invoke<MachineBot[]>('machine_bots'),
  confirmBots: (ids: string[]) => invoke<void>('confirm_bots', { ids }),
  overview: () => invoke<Overview>('overview'),
  settings: () => invoke<Settings>('get_settings'),
  setAutoUpgrade: (on: boolean) => invoke<void>('set_auto_upgrade', { on }),
  setLaunchAtLogin: (on: boolean) => invoke<void>('set_launch_at_login', { on }),
  unbind: () => invoke<void>('unbind'),
  agents: () => invoke<AgentCard[]>('agents'),
  setAgentModel: (kind: AgentKind, model: string | null) => invoke<void>('set_agent_model', { kind, model }),
  setAgentEffort: (kind: AgentKind, effort: string | null) =>
    invoke<void>('set_agent_effort', { kind, effort }),
  /** Resolves false when the file dialog was cancelled. */
  pickAgentPath: (kind: AgentKind) => invoke<boolean>('pick_agent_path', { kind }),
  resetAgentPath: (kind: AgentKind) => invoke<void>('reset_agent_path', { kind }),
  bots: () => invoke<BotCard[]>('bots'),
  saveBot: (id: string, change: BotChange) => invoke<void>('save_bot', { id, change }),
}

export function onSnapshot(cb: (s: Snapshot) => void): Promise<UnlistenFn> {
  return listen<Snapshot>('daemon://snapshot', (e) => cb(e.payload))
}
