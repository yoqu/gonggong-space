/**
 * Typed bridge to the Rust side (`src-tauri/src/commands/*`). Every command is mirrored here; pages never call
 * `invoke` directly, so tests can mock this module.
 */
import type { AgentInfo, AgentKind, BotDto, Permission, RunEvent, RunStatus } from '@gonggong/protocol'
import { invoke } from '@tauri-apps/api/core'
import { listen, type UnlistenFn } from '@tauri-apps/api/event'
import { readText } from '@tauri-apps/plugin-clipboard-manager'
import { getCurrent, onOpenUrl } from '@tauri-apps/plugin-deep-link'

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

/** A run's process as executed on this machine (kept for the last finished runs too). */
export interface RunProcess {
  run: RunInfo
  events: { id: number; atMs: number; event: RunEvent }[]
  endedMs: number | null
  outcome: 'completed' | 'interrupted' | 'failed' | null
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

/** A bot bound to this machine, as the server reports it; managed on the Web only (plan J11). */
export type MachineBot = Pick<
  BotDto,
  | 'id'
  | 'name'
  | 'agentKind'
  | 'binding'
  | 'presence'
  | 'systemPrompt'
  | 'concurrency'
  | 'approval'
  | 'allowlist'
>

/** A parsed 接入链接 (or `gg login` command); `fingerprint` like `sha256:AB:CD:…`. */
export interface BindLink {
  server: string
  code: string
  fingerprint: string | null
}

/** 概览 · 工作区 card: `count` workspaces, `detail` like `托管 4 · /cd 1 · 1.8 GB`. */
export interface Overview {
  workspaces: { count: number; detail: string }
}

export type WorkspaceState = 'running' | 'idle' | 'removed' | 'unused'

/** One row of 工作区, labels already in the prototype's wording. */
export interface WorkspaceRow {
  groupId: string
  botId: string
  group: string
  bot: string
  kind: 'managed' | 'empty' | 'cd'
  kindLabel: string
  path: string
  state: WorkspaceState
  stateLabel: string
  deletable: boolean
}

export interface BackupRow {
  name: string
  path: string
  size: string
  modifiedMs: number | null
}

export interface Workspaces {
  rows: WorkspaceRow[]
  backups: BackupRow[]
  /** The server was unreachable: rows come from disk only, without names or /cd bindings. */
  offline: boolean
}

/** 穿透与服务: this machine's open preview tunnels and live hosted services, as the server lists them. */
export interface Tunnels {
  previews: {
    id: string
    title: string
    groupName: string
    botName: string
    port: number | null
    path: string
    serviceId: string | null
    serviceName: string | null
    status: 'online' | 'offline'
  }[]
  services: {
    id: string
    name: string
    groupName: string
    botName: string
    command: string
    cwd: string
    port: number | null
    status: 'starting' | 'running' | 'exited' | 'failed'
  }[]
}

export type CheckStatus = 'ok' | 'warn' | 'error' | 'skipped'

export interface Check {
  kind: 'server' | 'agent' | 'git' | 'disk' | 'eol' | 'screen_recording' | 'accessibility'
  label: string
  status: CheckStatus
  detail: string
}

export type LogLevel = 'error' | 'warn' | 'info' | 'debug'

export interface LogLine {
  level: LogLevel
  text: string
}

export interface NetResult {
  latencyMs: number
  bandwidthMbps: number
}

export interface Settings {
  autoUpgrade: boolean
  launchAtLogin: boolean
}

export interface AgentCard extends AgentInfo {
  /** Set with 更换路径 instead of detected on PATH. */
  customPath: boolean
  login: string | null
}

/** A macOS permission of this app; none are listed where none is needed (Windows, Linux). */
export interface PermissionState {
  kind: Permission
  granted: boolean
}

export const ipc = {
  appInfo: () => invoke<AppInfo>('app_info'),
  snapshot: () => invoke<Snapshot>('snapshot'),
  /** Rejects with the reason when `input` is neither a 接入链接 nor a `gg login` command. */
  parseLink: (input: string) => invoke<BindLink>('parse_link', { input }),
  login: (link: BindLink) => invoke<void>('login', { ...link }),
  startDaemon: () => invoke<void>('start_daemon'),
  readClipboard: () => readText(),
  overview: () => invoke<Overview>('overview'),
  runProcess: (runId: string) => invoke<RunProcess | null>('run_process', { runId }),
  settings: () => invoke<Settings>('get_settings'),
  setAutoUpgrade: (on: boolean) => invoke<void>('set_auto_upgrade', { on }),
  setLaunchAtLogin: (on: boolean) => invoke<void>('set_launch_at_login', { on }),
  unbind: () => invoke<void>('unbind'),
  workspaces: () => invoke<Workspaces>('workspaces'),
  reveal: (path: string) => invoke<void>('reveal', { path }),
  resetCd: (groupId: string, botId: string) => invoke<void>('reset_cd', { groupId, botId }),
  deleteWorkspace: (groupId: string, botId: string, path: string) =>
    invoke<void>('delete_workspace', { groupId, botId, path }),
  diagnostics: () => invoke<Check[]>('diagnostics'),
  measureNet: () => invoke<NetResult>('measure_net'),
  /** Asks where to save; resolves with the written path, or null when cancelled. */
  exportDiagnostics: () => invoke<string | null>('export_diagnostics'),
  recentLogs: (level: LogLevel, limit: number) => invoke<LogLine[]>('recent_logs', { level, limit }),
  agents: () => invoke<AgentCard[]>('agents'),
  /** Resolves false when the file dialog was cancelled. */
  pickAgentPath: (kind: AgentKind) => invoke<boolean>('pick_agent_path', { kind }),
  resetAgentPath: (kind: AgentKind) => invoke<void>('reset_agent_path', { kind }),
  bots: () => invoke<MachineBot[]>('bots'),
  /** 在 Web 中管理 / 确认: `<server>/?bot=<id>` in the default browser. */
  openBotInWeb: (id: string) => invoke<void>('open_bot_in_web', { id }),
  tunnels: () => invoke<Tunnels>('tunnels'),
  /** Closes the tunnel and, with `stopService`, stops the service behind it (same as 停止 on the Web). */
  closeTunnel: (id: string, stopService: boolean) => invoke<void>('close_tunnel', { id, stopService }),
  stopService: (id: string) => invoke<void>('stop_service', { id }),
  /** The forwarded port in the default browser: `http://localhost:<port><path>`. */
  openLocal: (port: number, path: string) => invoke<void>('open_local', { port, path }),
  permissions: () => invoke<PermissionState[]>('permissions'),
  /** Shows the system prompt where macOS still does and opens the permission's pane in System Settings. */
  requestPermission: (kind: Permission) => invoke<void>('request_permission', { kind }),
  restartApp: () => invoke<void>('restart_app'),
}

export function onSnapshot(cb: (s: Snapshot) => void): Promise<UnlistenFn> {
  return listen<Snapshot>('daemon://snapshot', (e) => cb(e.payload))
}

/** URLs this app is opened with (`gonggong://bind?…`): the one it was launched with, then every later one. */
export async function onOpenLinks(cb: (urls: string[]) => void): Promise<UnlistenFn> {
  const unlisten = await onOpenUrl(cb)
  const current = await getCurrent()
  if (current?.length) cb(current)
  return unlisten
}
