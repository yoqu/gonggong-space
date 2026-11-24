/**
 * Typed bridge to the Rust side (`src-tauri/src/commands/*`). Every command is mirrored here; pages never call
 * `invoke` directly, so tests can mock this module.
 */
import type {
  AgentKind,
  AgentSettings,
  AgentState,
  BotDto,
  CcSwitchCandidate,
  CcSwitchImportedDto,
  ContextUsage,
  ProvidersCmd as DaemonProvidersCmd,
  DevtoolsBlocker,
  InstallDto,
  Locale,
  MachineAgentsDto,
  MarketListingDto,
  Mirror,
  OfficialInput,
  Permission,
  ProviderInput,
  ProviderPreset,
  ProviderStoreView,
  RunEvent,
  RunStatus,
  ToolKind,
} from '@gonggong/protocol'
import { invoke } from '@tauri-apps/api/core'
import { listen, type UnlistenFn } from '@tauri-apps/api/event'
import { readText } from '@tauri-apps/plugin-clipboard-manager'
import { getCurrent, onOpenUrl } from '@tauri-apps/plugin-deep-link'
import { relaunch } from '@tauri-apps/plugin-process'
import { Update } from '@tauri-apps/plugin-updater'
import type { AgentLocal } from '@web/features/agents/source'

export type { Mirror, Update }

type RejectReason = 'protocol' | 'revoked' | 'unauthorized' | 'workspace' | 'readonly'

type Conn =
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
  /** The conversation's context occupancy as last reported; null until known. */
  context: ContextUsage | null
}

/** A run's process as executed on this machine (kept for the last finished runs too). */
export interface RunProcess {
  run: RunInfo
  events: { id: number; atMs: number; event: RunEvent }[]
  endedMs: number | null
  outcome: 'completed' | 'interrupted' | 'failed' | null
  /** The agent's error the run ended with. */
  error: string | null
  /** Bumped on every change. */
  rev: number
}

/** `runProcess`: the events from the asked one on (it may have grown), none while `rev` is unchanged. */
export interface ProcessPatch extends RunProcess {
  /** The oldest event the daemon still keeps. */
  firstId: number | null
}

export interface DaemonStatus {
  conn: Conn
  heartbeatSec: number | null
  lastHeartbeatMs: number | null
  latencyMs: number | null
  agents: AgentState[]
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
  | 'tier'
  | 'aiReview'
  | 'alwaysAllow'
  | 'avatar'
  | 'followAgent'
> & {
  /** The bot's own model (stored on the server); absent until the client reports it, null = the default. */
  model?: string | null
  /** Null from servers before teams (plan D20). */
  teamId: string | null
  teamName: string | null
}

/** A parsed 接入链接 (or `gg login` command). */
export interface BindLink {
  server: string
  code: string
}

/** 概览 · 工作区 card: `count` workspaces, `detail` like `托管 4 · 本机目录 1 · 1.8 GB`. */
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
  /** The conversation's context occupancy as this daemon last saw it (since it started); null when unknown. */
  context: ContextUsage | null
}

/** Work in a managed clone on no remote yet, across every local branch; `unknown` when git could not tell. */
export interface WorkspaceChanges {
  uncommitted: number
  unpushed: number
  unknown: boolean
}

interface BackupRow {
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

/** 在线预览: this machine's online previews and live hosted services, as the server lists them. */
export interface Tunnels {
  previews: {
    id: string
    /** gui / miniprogram are watched live (实时画面) through gg-cast; the others are tunnels. */
    kind: 'http' | 'static' | 'gui' | 'miniprogram'
    title: string
    groupName: string
    botName: string
    port: number | null
    path: string
    serviceId: string | null
    serviceName: string | null
    status: 'online' | 'offline' | 'stopped'
    /** This machine's gg-cast while someone watches; null otherwise. */
    live: {
      state: 'starting' | 'live' | 'failed'
      error: string | null
      missing: Permission[]
      /** A mini program waiting on this machine's owner in the WeChat devtools. */
      devtools?: DevtoolsBlocker
      /** When a failed one is tried again. */
      retryAt?: string
    } | null
    control: { controller: { name: string } | null } | null
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

/** Where this app's gg-cast (实时画面 publisher) comes from. */
export type CastComponent =
  | { source: 'bundled' | 'local'; path: string }
  /** A dev build without it: downloaded from the server on first use. */
  | { source: 'download' }

export type CheckStatus = 'ok' | 'warn' | 'error' | 'skipped'

export interface Check {
  kind: 'server' | 'agent' | 'git' | 'disk' | 'eol' | 'screen_recording' | 'accessibility'
  label: string
  status: CheckStatus
  detail: string
}

export type LogLevel = 'error' | 'warn' | 'info' | 'debug'

export interface LogLine {
  /** Arrival order in the app's log. */
  seq: number
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
  /** macOS only: closing the window leaves just the menu-bar icon. */
  hideDockOnClose: boolean
  mirror: Mirror
  /** Extra environment of the agent processes. */
  env: Record<string, string>
}

export type ToolOp = 'install' | 'upgrade'

/** One `providers.cmd`, as the daemon handles it for the Web (`requestId` filled in here). */
export type ProvidersCmd = Omit<
  DaemonProvidersCmd,
  't' | 'requestId' | 'provider' | 'official' | 'agentSettings'
> & {
  provider?: ProviderInput
  official?: OfficialInput
  agentSettings?: AgentSettings
}

/** What a `providers.cmd` answers with; the view's keys are masked. */
export interface ProvidersAnswer {
  view?: ProviderStoreView
  presets?: ProviderPreset[]
  id?: string
}

/** A macOS permission of this app; none are listed where none is needed (Windows, Linux). */
export interface PermissionState {
  kind: Permission
  granted: boolean
}

export const ipc = {
  appInfo: () => invoke<AppInfo>('app_info'),
  /** Native texts (tray, dialogs, errors) and the daemon follow the UI's language. */
  setLocale: (locale: Locale) => invoke<void>('set_locale', { locale }),
  snapshot: () => invoke<Snapshot>('snapshot'),
  /** Rejects with the reason when `input` is neither a 接入链接 nor a `gg login` command. */
  parseLink: (input: string) => invoke<BindLink>('parse_link', { input }),
  login: (link: BindLink) => invoke<void>('login', { ...link }),
  startDaemon: () => invoke<void>('start_daemon'),
  readClipboard: () => readText(),
  overview: () => invoke<Overview>('overview'),
  runProcess: (runId: string, since: number | null, rev: number | null) =>
    invoke<ProcessPatch | null>('run_process', { runId, since, rev }),
  settings: () => invoke<Settings>('get_settings'),
  setAutoUpgrade: (on: boolean) => invoke<void>('set_auto_upgrade', { on }),
  setMirror: (mirror: Mirror) => invoke<void>('set_mirror', { mirror }),
  setEnv: (env: Record<string, string>) => invoke<void>('set_env', { env }),
  setLaunchAtLogin: (on: boolean) => invoke<void>('set_launch_at_login', { on }),
  setHideDockOnClose: (on: boolean) => invoke<void>('set_hide_dock_on_close', { on }),
  unbind: () => invoke<void>('unbind'),
  workspaces: () => invoke<Workspaces>('workspaces'),
  reveal: (path: string) => invoke<void>('reveal', { path }),
  resetCd: (groupId: string, botId: string) => invoke<void>('reset_cd', { groupId, botId }),
  /** Refused when there is more to lose than `seen`, what the confirmation showed. */
  deleteWorkspace: (groupId: string, botId: string, path: string, seen: WorkspaceChanges) =>
    invoke<void>('delete_workspace', { groupId, botId, path, seen }),
  /** Zero without a repo; fails once the dir is no longer listed. */
  workspaceChanges: (path: string) => invoke<WorkspaceChanges>('workspace_changes', { path }),
  diagnostics: () => invoke<Check[]>('diagnostics'),
  measureNet: () => invoke<NetResult>('measure_net'),
  /** Asks where to save; resolves with the written path, or null when cancelled. */
  exportDiagnostics: () => invoke<string | null>('export_diagnostics'),
  /** The newest `limit` lines after line `after`. */
  recentLogs: (level: LogLevel, limit: number, after: number | null) =>
    invoke<LogLine[]>('recent_logs', { level, limit, after }),
  /** DaemonFeature values of this machine's client. */
  agentFeatures: () => invoke<string[]>('agent_features'),
  /** Node.js and the agents; every call detects again and reports a change to the server. */
  tools: () => invoke<MachineAgentsDto>('tools'),
  /** Output lines arrive through `onToolProgress(opId, …)`. */
  runTool: (op: ToolOp, kind: ToolKind, opId: string) =>
    invoke<MachineAgentsDto>('run_tool', { op, kind, opId }),
  providers: (cmd: ProvidersCmd) =>
    invoke<ProvidersAnswer>('providers_cmd', { cmd: { requestId: '', ...cmd } }),
  ccSwitchPreview: () => invoke<CcSwitchCandidate[]>('ccswitch_preview'),
  ccSwitchApply: (keys: string[]) => invoke<CcSwitchImportedDto>('ccswitch_apply', { keys }),
  /** Hidden Claude directories in the home (`~/.claude-work`). */
  claudeDirs: () => invoke<string[]>('claude_dirs'),
  /** The system folder dialog; null when cancelled. */
  pickDir: (start: string | null) => invoke<string | null>('pick_dir', { start }),
  /** The agent's path picked by hand, its CLI's login and the bundled adapter's version. */
  agentLocal: (kind: AgentKind) => invoke<AgentLocal>('agent_local', { kind }),
  /** 更换路径… with the system file dialog; false when cancelled. */
  pickAgentPath: (kind: AgentKind) => invoke<boolean>('pick_agent_path', { kind }),
  /** 恢复自动检测. */
  resetAgentPath: (kind: AgentKind) => invoke<void>('reset_agent_path', { kind }),
  /** Names of the groups of this machine's bots by id; empty when the server is unreachable. */
  groupNames: () => invoke<Record<string, string>>('group_names'),
  bots: () => invoke<MachineBot[]>('bots'),
  /** 在 Web 中管理 / 确认: `<server>/?bot=<id>` in the default browser. */
  openBotInWeb: (id: string) => invoke<void>('open_bot_in_web', { id }),
  /** 已连接 pill: the bound server's web app. */
  openWeb: () => invoke<void>('open_web'),
  /** The owner's personal Skill installs; read-only here, managed on the Web (plan Skill市场-M4 D14). */
  marketInstalls: () => invoke<InstallDto[]>('market_installs'),
  marketListings: () => invoke<MarketListingDto[]>('market_listings'),
  /** 在网页中打开: the bound server's `/market`, or the listing's detail there (`/market?listing=<id>`). */
  openMarketInWeb: (listing?: string) => invoke<void>('open_market_in_web', { listing: listing ?? null }),
  tunnels: () => invoke<Tunnels>('tunnels'),
  /** Closes the tunnel and, with `stopService`, stops the service behind it (same as 停止 on the Web). */
  closeTunnel: (id: string, stopService: boolean) => invoke<void>('close_tunnel', { id, stopService }),
  startPreview: (id: string) => invoke<void>('start_preview', { id }),
  retryCast: (id: string) => invoke<void>('retry_cast', { id }),
  stopService: (id: string) => invoke<void>('stop_service', { id }),
  /** The forwarded port in the default browser: `http://localhost:<port><path>`. */
  openLocal: (port: number, path: string) => invoke<void>('open_local', { port, path }),
  castComponent: () => invoke<CastComponent>('cast_component'),
  permissions: () => invoke<PermissionState[]>('permissions'),
  /** Shows the system prompt where macOS still does and opens the permission's pane in System Settings. */
  requestPermission: (kind: Permission) => invoke<void>('request_permission', { kind }),
  restartApp: () => invoke<void>('restart_app'),
  /** The bound server's update, else the latest GitHub release, when newer than this app; else null. */
  checkUpdate: () =>
    invoke<ConstructorParameters<typeof Update>[0] | null>('check_update').then((m) => m && new Update(m)),
  /** Stops the in-process daemon and its hosted services before an update relaunch. */
  stopDaemon: () => invoke<void>('stop_daemon'),
  relaunch: () => relaunch(),
}

export function onSnapshot(cb: (s: Snapshot) => void): Promise<UnlistenFn> {
  return listen<Snapshot>('daemon://snapshot', (e) => cb(e.payload))
}

export function onToolProgress(opId: string, cb: (line: string) => void): Promise<UnlistenFn> {
  return listen<{ opId: string; line: string }>('tools://progress', (e) => {
    if (e.payload.opId === opId) cb(e.payload.line)
  })
}

/** URLs this app is opened with (`gonggong://bind?…`): the one it was launched with, then every later one. */
export async function onOpenLinks(cb: (urls: string[]) => void): Promise<UnlistenFn> {
  const unlisten = await onOpenUrl(cb)
  const current = await getCurrent()
  if (current?.length) cb(current)
  return unlisten
}
