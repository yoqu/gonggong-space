/**
 * Typed bridge to the Rust side (`src-tauri/src/commands/*`). Every command is mirrored here; pages never call
 * `invoke` directly, so tests can mock this module.
 */
import type {
  AgentInfo,
  AgentKind,
  BotDto,
  DevtoolsBlocker,
  Locale,
  Permission,
  RunEvent,
  RunStatus,
} from '@gonggong/protocol'
import { invoke } from '@tauri-apps/api/core'
import { listen, type UnlistenFn } from '@tauri-apps/api/event'
import { readText } from '@tauri-apps/plugin-clipboard-manager'
import { getCurrent, onOpenUrl } from '@tauri-apps/plugin-deep-link'
import { relaunch } from '@tauri-apps/plugin-process'
import { check, type Update } from '@tauri-apps/plugin-updater'

export type { Update }

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
  | 'avatar'
> & {
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
    /** gui / miniprogram are watched live (实时画面) through gg-cast; the others are tunnels. */
    kind: 'http' | 'static' | 'gui' | 'miniprogram'
    title: string
    groupName: string
    botName: string
    port: number | null
    path: string
    serviceId: string | null
    serviceName: string | null
    status: 'online' | 'offline'
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
  level: LogLevel
  text: string
}

export interface NetResult {
  latencyMs: number
  bandwidthMbps: number
}

/** 镜像源 of Node.js and the agent CLIs. */
export type Mirror =
  | { kind: 'npmmirror' }
  | { kind: 'official' }
  | { kind: 'custom'; registry: string; node: string }

export interface Settings {
  autoUpgrade: boolean
  launchAtLogin: boolean
  mirror: Mirror
  /** Extra environment of the agent processes. */
  env: Record<string, string>
}

export type ToolKind = 'node' | AgentKind

/** Node.js or an agent CLI as a managed tool (design §4.1). */
export interface ToolStatus {
  kind: ToolKind
  installed: boolean
  version: string | null
  /** Latest on the mirror; null when it could not be checked. */
  latest: string | null
  /** Installed by Gonggong (共工空间托管) rather than by the user (自行安装). */
  managed: boolean
  path: string | null
}

export type ToolOp = 'install' | 'upgrade'

export interface ModelMap {
  haiku?: string | null
  sonnet?: string | null
  opus?: string | null
}

/** A local provider as the page sees it: `apiKey` is masked (`****abcd`). */
export interface ProviderView {
  id: string
  agent: AgentKind
  name: string
  presetId: string | null
  revision: number
  baseUrl: string
  apiKey: string
  apiKeyField: string | null
  model: string | null
  models: ModelMap | null
  env: Record<string, string>
  wireApi: string | null
  effort: string | null
  source: { kind: 'cc-switch' | 'link'; id?: string } | null
}

/** `official`, a provider id, or (bots) `inherit`. */
export type ProviderChoice = string

export interface Providers {
  /** Machine default per agent; absent = official. */
  machine: Partial<Record<AgentKind, ProviderChoice>>
  /** Per-bot override; absent = inherit the machine default. */
  bots: Record<string, ProviderChoice>
  providers: ProviderView[]
  /** This machine has CC Switch (~/.cc-switch) to import from. */
  ccSwitch: boolean
  /** Provider id → its proxy; absent = direct. */
  proxies: Record<string, string>
}

/** A built-in vendor (CC Switch presets). */
export interface Preset {
  id: string
  agent: AgentKind
  name: string
  group: 'cn' | 'aggregator' | 'global'
  websiteUrl: string | null
  apiKeyUrl: string | null
  baseUrl: string
  model: string | null
  models: ModelMap | null
  modelOptions: string[]
  env: Record<string, string>
}

/** The provider form; an empty `apiKey` keeps the stored key when editing. */
export interface ProviderDraft {
  id: string | null
  agent: AgentKind
  presetId: string | null
  name: string
  baseUrl: string
  apiKey: string
  model: string | null
  models: ModelMap | null
  env: Record<string, string>
  /** null = direct. */
  proxy: string | null
}

/** A CC Switch provider that can be imported, key masked. */
export interface Candidate {
  key: string
  agent: AgentKind
  name: string
  baseUrl: string
  apiKey: string
  model: string | null
  /** CC Switch's current provider for that agent. */
  current: boolean
  /** The local provider it would update. */
  existing: string | null
}

/** A group's session that keeps `from` after a switch until a new session starts on `to`. */
export interface Impact {
  group: string
  bot: string
  from: string
  to: string
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
  /** Native texts (tray, dialogs, errors) and the daemon follow the UI's language. */
  setLocale: (locale: Locale) => invoke<void>('set_locale', { locale }),
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
  setMirror: (mirror: Mirror) => invoke<void>('set_mirror', { mirror }),
  setEnv: (env: Record<string, string>) => invoke<void>('set_env', { env }),
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
  tools: () => invoke<ToolStatus[]>('tools'),
  /** Output lines arrive through `onToolProgress(opId, …)`. */
  runTool: (op: ToolOp, kind: ToolKind, opId: string) => invoke<ToolStatus>('run_tool', { op, kind, opId }),
  providers: () => invoke<Providers>('providers'),
  providerPresets: () => invoke<Preset[]>('provider_presets'),
  /** Resolves with the provider id. */
  saveProvider: (draft: ProviderDraft) => invoke<string>('save_provider', { draft }),
  removeProvider: (id: string) => invoke<void>('remove_provider', { id }),
  /** The machine default of `agent`, or `bot`'s override. */
  chooseProvider: (agent: AgentKind, choice: ProviderChoice, bot?: string) =>
    invoke<void>('choose_provider', { agent, choice, bot: bot ?? null }),
  providerImpact: (agent: AgentKind, choice: ProviderChoice, bot?: string) =>
    invoke<Impact[]>('provider_impact', { agent, choice, bot: bot ?? null }),
  ccswitchPreview: () => invoke<Candidate[]>('ccswitch_preview'),
  /** Resolves with the local ids, in the order of `keys`. */
  ccswitchImport: (keys: string[]) => invoke<string[]>('ccswitch_import', { keys }),
  importProviderLink: (link: string) => invoke<ProviderView>('import_provider_link', { link }),
  /** 获取 Key: the preset's key page in the default browser. */
  openKeyPage: (agent: AgentKind, presetId: string) => invoke<void>('open_key_page', { agent, presetId }),
  bots: () => invoke<MachineBot[]>('bots'),
  /** 在 Web 中管理 / 确认: `<server>/?bot=<id>` in the default browser. */
  openBotInWeb: (id: string) => invoke<void>('open_bot_in_web', { id }),
  tunnels: () => invoke<Tunnels>('tunnels'),
  /** Closes the tunnel and, with `stopService`, stops the service behind it (same as 停止 on the Web). */
  closeTunnel: (id: string, stopService: boolean) => invoke<void>('close_tunnel', { id, stopService }),
  retryCast: (id: string) => invoke<void>('retry_cast', { id }),
  stopService: (id: string) => invoke<void>('stop_service', { id }),
  /** The forwarded port in the default browser: `http://localhost:<port><path>`. */
  openLocal: (port: number, path: string) => invoke<void>('open_local', { port, path }),
  castComponent: () => invoke<CastComponent>('cast_component'),
  permissions: () => invoke<PermissionState[]>('permissions'),
  /** Shows the system prompt where macOS still does and opens the permission's pane in System Settings. */
  requestPermission: (kind: Permission) => invoke<void>('request_permission', { kind }),
  restartApp: () => invoke<void>('restart_app'),
  /** The latest GitHub release when newer than this app (`plugins.updater` endpoint), else null. */
  checkUpdate: () => check({ timeout: 30_000 }),
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
