import { z } from 'zod'
import {
  AgentSettings,
  AgentSettingValues,
  CliSettingsSnapshot,
  RunSettingsSnapshot,
} from './agent-settings.js'
import { ArtifactDir, DaemonArtifactRef } from './artifacts.js'
import {
  AgentKind,
  Answer,
  Approval,
  Attachment,
  ContextUsage,
  DevtoolsBlocker,
  DiffRepo,
  GitOngoingKind,
  GitStatus,
  Permission,
  Question,
  RunStatus,
  Tier,
  Usage,
} from './common.js'
import {
  RunSyncDone,
  RunSyncStart,
  SyncAction,
  SyncApplied,
  SyncAvailable,
  SyncInit,
  SyncResult,
  SyncState,
  SyncSubmit,
} from './sync.js'

/** Bumped on any breaking change of the daemon <-> server wire format. */
export const PROTOCOL_VERSION = 1

export const ConfigChoice = z.object({
  value: z.string(),
  name: z.string(),
  description: z.string().optional(),
})
export type ConfigChoice = z.infer<typeof ConfigChoice>
/** Thought levels depend on the model (both adapters), so each model carries its own and the one it starts with. */
export const ModelChoice = ConfigChoice.extend({
  efforts: z.array(ConfigChoice),
  effort: z.string().nullable(),
})
export type ModelChoice = z.infer<typeof ModelChoice>
/**
 * Adapter "default" rows are left out: a null model / effort already means the adapter's default. `current`,
 * `efforts` and `effort` describe the model a fresh session starts with (current null = the adapter's unnamed default).
 */
export const AgentCatalog = z.object({
  models: z.array(ModelChoice),
  current: z.string().nullable(),
  efforts: z.array(ConfigChoice),
  effort: z.string().nullable(),
})
export type AgentCatalog = z.infer<typeof AgentCatalog>

/** Levels and starting level of `model`; null = the model a fresh session starts with. Undefined if not offered. */
export function modelEfforts(catalog: AgentCatalog, model: string | null) {
  return model === null ? catalog : catalog.models.find((m) => m.value === model)
}

/** `effort` if `model` offers it, else the model's starting level; unchanged without a catalog to check. */
export function fitEffort(catalog: AgentCatalog | null, model: string | null, effort: string | null) {
  const m = catalog && modelEfforts(catalog, model)
  if (!m) return effort
  return effort && m.efforts.some((e) => e.value === effort) ? effort : m.effort
}

const EFFORT_NAMES: Record<string, string> = {
  none: '关闭',
  minimal: '极低',
  low: '低',
  medium: '中',
  high: '高',
  xhigh: '超高',
  max: '最高',
}
export const effortName = (value: string) => EFFORT_NAMES[value] ?? value
export const modelName = (catalog: AgentCatalog | null, value: string) =>
  catalog?.models.find((m) => m.value === value)?.name ?? value
/** e.g. `Opus · 高`; a null model reads as 默认模型. */
export const agentConfigLabel = (catalog: AgentCatalog | null, model: string | null, effort: string | null) =>
  [model === null ? '默认模型' : modelName(catalog, model), ...(effort ? [effortName(effort)] : [])].join(
    ' · ',
  )

export const AgentInfo = z.object({
  kind: AgentKind,
  available: z.boolean(),
  version: z.string().nullable(),
  path: z.string().nullable(),
  /** Oldest CLI version the bundled ACP adapter supports; older ones still run but the bot shows a warning. */
  minVersion: z.string().nullable().default(null),
  /** What the adapter offers, probed by the daemon; null until probed or when unavailable. */
  catalog: AgentCatalog.nullable().default(null),
  /** Latest version on the machine's mirror (last check, cached by the daemon); absent from older daemons. */
  latest: z.string().nullable().optional(),
  /** Installed by Gonggong under its home, so it can upgrade it; absent from older daemons. */
  managed: z.boolean().optional(),
})
export type AgentInfo = z.infer<typeof AgentInfo>

/** Host facts shown to the owner and sysadmin; any of them may be unavailable on a given OS. */
export const SystemInfo = z.object({
  osVersion: z.string().nullable(),
  kernel: z.string().nullable(),
  cpuModel: z.string().nullable(),
  cpuCores: z.number().int().nullable(),
  memoryBytes: z.number().nullable(),
  macAddress: z.string().nullable(),
})
export type SystemInfo = z.infer<typeof SystemInfo>

export const MachineInfo = z.object({
  name: z.string().min(1),
  os: z.enum(['macos', 'linux', 'windows']),
  arch: z.string(),
  /**
   * sha256 of the OS machine id (IOPlatformUUID / machine-id / MachineGuid): logging in again from the same host
   * restores its machine instead of adding one. Null from daemons that predate it.
   */
  hardwareId: z.string().nullable().default(null),
  system: SystemInfo.nullable().default(null),
})
export type MachineInfo = z.infer<typeof MachineInfo>

// ── REST: POST /api/daemon/login (bind code → long-lived machine token) ──────
export const DaemonLoginReq = z.object({ code: z.string(), machine: MachineInfo })
/** `restored`: this host was bound before, so its machine (and the bots on it) is reused. */
export const DaemonLoginRes = z.object({
  token: z.string(),
  machineId: z.string(),
  ownerName: z.string(),
  restored: z.boolean(),
})
export type DaemonLoginRes = z.infer<typeof DaemonLoginRes>

// ── REST for the daemon / desktop app (machine token, `Authorization: Bearer`) ─
/** POST /api/daemon/net: a measured round trip + throughput to the server. */
export const NetReportReq = z.object({ latencyMs: z.number().min(0), bandwidthMbps: z.number().min(0) })
/** GET /api/daemon/net/probe?bytes=N streams N random bytes for the bandwidth measurement (max 16 MiB). */
export const NET_PROBE_MAX_BYTES = 16 * 1024 * 1024
/**
 * POST /api/daemon/runs/:runId/tools/:name: an gonggong MCP tool call made during that run (see tools.ts). Tool-level
 * failures come back as `isError` text for the agent; `attachments` are written into the workspace by the daemon.
 */
export const ToolCallReq = z.object({ arguments: z.unknown() })
export const ToolCallRes = z.object({
  text: z.string(),
  isError: z.boolean(),
  attachments: z.array(Attachment),
})
export type ToolCallRes = z.infer<typeof ToolCallRes>
/**
 * GET /api/daemon/workspaces: every (group, bot) pair of this machine's bots, removed ones included, so the desktop
 * app can name and classify the dirs under `<home>/workspaces`. `removed` = bot left the group, bot deleted or group
 * archived; `repoId` = the group's current repo (the managed dir name). POST …/:groupId/:botId/reset-cd = `/cd --reset`.
 */
export const DaemonWorkspaceDto = z.object({
  groupId: z.string(),
  groupName: z.string(),
  groupKind: z.enum(['group', 'dm']),
  botId: z.string(),
  botName: z.string(),
  kind: z.enum(['managed', 'cd']),
  cdPath: z.string().nullable(),
  repoId: z.string().nullable(),
  removed: z.boolean(),
  running: z.boolean(),
})
export type DaemonWorkspaceDto = z.infer<typeof DaemonWorkspaceDto>

// ── Shared run payloads ─────────────────────────────────────────────────────
export const McpServer = z.discriminatedUnion('transport', [
  z.object({
    transport: z.literal('stdio'),
    name: z.string(),
    command: z.string(),
    args: z.array(z.string()),
    env: z.record(z.string(), z.string()),
  }),
  z.object({
    transport: z.literal('http'),
    name: z.string(),
    url: z.string(),
    headers: z.record(z.string(), z.string()),
  }),
])
export type McpServer = z.infer<typeof McpServer>

/** A file of a team skill folder; `path` is relative (`SKILL.md`, `scripts/run.sh`), binary files in base64. */
export const SkillFile = z.object({
  path: z.string().min(1).max(255),
  content: z.string(),
  encoding: z.enum(['utf8', 'base64']).default('utf8'),
})
export type SkillFile = z.infer<typeof SkillFile>
/** Both agents list team skills under this plugin namespace (plan 团队Skill · K0). */
export const SKILL_PLUGIN = 'gonggong-team'
/** A merged team skill for the run (plan 团队Skill); the daemon fetches its files by `versionId`, cached by `digest`. */
export const SkillRef = z.object({ name: z.string(), versionId: z.string(), digest: z.string() })
export type SkillRef = z.infer<typeof SkillRef>
/** `GET /api/daemon/skills/:versionId` */
export const DaemonSkillRes = z.object({ files: z.array(SkillFile) })
export type DaemonSkillRes = z.infer<typeof DaemonSkillRes>
/** Plugin files for a run (plan 插件体系-方案); the daemon fetches them by `versionId`, cached by `digest`. */
export const PluginRef = z.object({ name: z.string(), versionId: z.string(), digest: z.string() })
export type PluginRef = z.infer<typeof PluginRef>
/** `GET /api/daemon/plugins/:versionId` */
export const DaemonPluginRes = z.object({ files: z.array(SkillFile) })
export type DaemonPluginRes = z.infer<typeof DaemonPluginRes>

/** The bot owner's preferred protocol; the daemon tries it first, then falls back to the other (ssh ↔ https). */
export const GitProtocol = z.enum(['auto', 'ssh', 'https'])
export type GitProtocol = z.infer<typeof GitProtocol>

export const RepoSpec = z.object({
  id: z.string(),
  url: z.string(),
  branch: z.string(),
  protocol: GitProtocol.default('auto'),
})

/** Why the machine cannot use the repo; git cannot tell "no access" from "no such repo", both are `denied`. */
export const RepoAccessReason = z.enum(['denied', 'branch_missing', 'network', 'timeout'])
export type RepoAccessReason = z.infer<typeof RepoAccessReason>

/** A group message replayed to a bot as context ("since you were last @-ed"). */
export const ContextMessage = z.object({
  seq: z.number().int(),
  author: z.string(),
  /** 'user' for humans, 'bot' for other bots' final replies. */
  kind: z.enum(['user', 'bot']),
  body: z.string(),
  at: z.string(),
  /** Attachments of unmentioned messages are written into the workspace with the context (plan D6). */
  attachments: z.array(Attachment),
})
export type ContextMessage = z.infer<typeof ContextMessage>

/** Which directory a (group, bot) works in. */
export const WorkspaceSpec = z.object({
  /** null → managed empty workspace (group without repo). Managed path: <home>/workspaces/<groupId>/<botId>/<repo.id | _empty>/ */
  repo: RepoSpec.nullable(),
  /** Absolute local path when the owner used /cd; null → managed path. */
  cdPath: z.string().nullable(),
  /** 禁止直推基准分支 (run.start only): pushing to `repo.branch` always asks the owner. */
  protectBase: z.boolean().optional(),
  /**
   * Additional directories (absolute local paths) of the session besides the workspace (run.start, workspace.diff):
   * the agent may read and write them; their git changes are reported as `extra` repos. Not shared by sync.
   */
  extraDirs: z.array(z.string()).optional(),
})

export const RunStart = z.object({
  t: z.literal('run.start'),
  runId: z.string(),
  groupId: z.string(),
  groupName: z.string(),
  bot: z.object({
    id: z.string(),
    name: z.string(),
    agentKind: AgentKind,
    systemPrompt: z.string(),
    tier: Tier,
    /** Resolved by the server (message pick → group default → bot default); null = the adapter's default. */
    model: z.string().nullable().default(null),
    effort: z.string().nullable().default(null),
    approval: Approval.default('ask'),
    allowlist: z.array(z.string()).default([]),
    /** Rules the owner chose 始终允许 for, applied in `ask` and `allowlist` mode: command prefixes or `tool:<title>`. */
    alwaysAllow: z.array(z.string()).default([]),
    /** Author and committer of the agent's git commits; null = the machine's git config. */
    git: z.object({ name: z.string(), email: z.string() }).nullable().default(null),
    /** The bot's overrides of `botOverride` agent settings (field id → value). */
    agentSettings: AgentSettingValues.default({}),
  }),
  workspace: WorkspaceSpec,
  /** Resume this ACP session if possible; null → start a new one. */
  resumeSessionId: z.string().nullable(),
  /** Why the server asks for a new session (e.g. 'requested' after /new); reported back in run.done. null → 'first'. */
  newSessionReason: z.string().nullable(),
  prompt: z.object({
    text: z.string(),
    triggeredBy: z.string(),
    /** The latest group messages since this bot was last @-ed (humans + other bots' final replies). */
    context: z.array(ContextMessage),
    /** Messages since the last @ left out of `context` (over the `contextInlineTokens` budget); the agent reads them with gonggong tools. */
    omitted: z.number().int().min(0),
    /** Latest group messages within `sessionReplayTokens`, replayed only if resuming `resumeSessionId` fails. Empty when not resuming. */
    fallbackContext: z.array(ContextMessage),
    /** Files of the trigger message: written into the workspace; images also sent as ACP image content if supported. */
    attachments: z.array(Attachment),
    /** Quoted bot message / run card, sent along as context (spec §8.6: a quote never triggers a bot). */
    quote: z.object({ author: z.string(), body: z.string() }).nullable(),
  }),
  /** Global MCP servers (spec §7.2, P1 global layer), injected on session creation only (§7.4). */
  mcpServers: z.array(McpServer),
  /** Platform → team → group skills merged by name; applied every turn (content) and on adapter start (the set). */
  skills: z.array(SkillRef).default([]),
  /**
   * Plugins enabled in the group that this bot may use (only sent to daemons with the `plugins` feature): each is
   * loaded like a Claude plugin named `name`; Codex links its skills as `<name>-<skill>`. Same timing as `skills`.
   */
  plugins: z.array(PluginRef).default([]),
  /** gonggong tools left out of the session's `tools/list` (useless in this group, e.g. Feishu ones when unbound). */
  hiddenTools: z.array(z.string()).default([]),
  /** An agent command (`/compact …`): sent verbatim as the prompt so the adapter runs it; `prompt` is not composed. */
  command: z.string().nullable().default(null),
  /** Force groups only (null in partition groups). */
  sync: RunSyncStart.nullable().default(null),
  /** Hosted artifacts checked out before the agent starts (only to daemons with the `artifacts` feature). */
  artifacts: z.array(DaemonArtifactRef).default([]),
  /** Directories of the group's artifacts: force sync skips them (artifact hosting owns them). */
  artifactExclude: z.array(ArtifactDir).default([]),
  /** Resolved secrets (plan 团队密钥-方案): env of the adapter process, kept in memory only, never logged or written. */
  env: z.record(z.string(), z.string()).default({}),
})
export type RunStart = z.infer<typeof RunStart>

/** A subagent's ACP session id; absent on the main agent's events. */
const AgentId = z.string().optional()

/** Incremental process events streamed while a run is in progress. */
export const RunEvent = z.discriminatedUnion('kind', [
  z.object({ kind: z.literal('status'), status: RunStatus, step: z.string() }),
  z.object({ kind: z.literal('text'), delta: z.string(), agentId: AgentId }),
  z.object({ kind: z.literal('thought'), delta: z.string(), agentId: AgentId }),
  z.object({
    kind: z.literal('tool'),
    agentId: AgentId,
    toolCallId: z.string(),
    title: z.string(),
    /** ACP ToolKind: read | edit | delete | move | search | execute | think | fetch | other */
    toolKind: z.string(),
    status: z.enum(['pending', 'in_progress', 'completed', 'failed']),
    /** Redaction happens server-side before persistence. */
    detail: z.string().optional(),
    /** An MCP tool call: arguments as compact JSON and the head of its result (redacted like `detail`). */
    mcp: z
      .object({
        server: z.string(),
        tool: z.string(),
        input: z.string().optional(),
        output: z.string().optional(),
      })
      .optional(),
  }),
  /** `usage` carries what the run spent (cost so far); `context` is occupancy, never folded into `usage`. */
  z.object({ kind: z.literal('usage'), usage: Usage, context: ContextUsage.optional() }),
  /**
   * A context compaction (ACP compaction_update), sent when it starts and again when it ends. Tokens before and
   * after and the trigger come with the end; `summary` (clipped, redacted server-side) is what the agent kept.
   */
  z.object({
    kind: z.literal('compaction'),
    compactionId: z.string(),
    status: z.enum(['running', 'completed', 'failed', 'cancelled']),
    trigger: z.enum(['manual', 'auto']).optional(),
    preTokens: z.number().int().optional(),
    postTokens: z.number().int().optional(),
    summary: z.string().optional(),
    error: z.string().optional(),
  }),
  /** Full snapshot of a delegated subagent (Claude Agent/Task tool, Codex spawn_agent), sent on every change. */
  z.object({
    kind: z.literal('subagent'),
    agentId: z.string(),
    /** The spawning subagent; absent when spawned by the main agent. */
    parentId: AgentId,
    name: z.string(),
    task: z.string(),
    state: z.enum(['running', 'completed', 'failed', 'cancelled', 'disconnected']),
  }),
  /** Full snapshot of a background task (backgrounded shell, monitor…); may keep arriving after run.done. */
  z.object({
    kind: z.literal('task'),
    taskId: z.string(),
    agentId: AgentId,
    toolCallId: z.string().optional(),
    name: z.string(),
    taskType: z.string(),
    state: z.enum(['running', 'paused', 'completed', 'failed', 'stopped']),
    summary: z.string().optional(),
    outputPath: z.string().optional(),
    /** The adapter can stop it (`task.stop`). */
    canStop: z.boolean().optional(),
  }),
])
export type RunEvent = z.infer<typeof RunEvent>

// ── daemon → server ─────────────────────────────────────────────────────────
/** A process the daemon hosts for a (group, bot) workspace (built-in `service_start`). */
export const ServiceStatus = z.enum(['starting', 'running', 'exited', 'failed'])
export type ServiceStatus = z.infer<typeof ServiceStatus>
export const ServiceInfo = z.object({
  /** Chosen by the daemon; a restart under the same name gets a new id. */
  id: z.string(),
  groupId: z.string(),
  botId: z.string(),
  /** The run whose agent started it. */
  runId: z.string().nullable(),
  name: z.string(),
  command: z.string(),
  /** Relative to the workspace root; '' = the root. */
  cwd: z.string(),
  port: z.number().int().nullable(),
  status: ServiceStatus,
  exitCode: z.number().int().nullable(),
})
export type ServiceInfo = z.infer<typeof ServiceInfo>
/** A web terminal shell the daemon still runs. */
export const TerminalLive = z.object({
  sessionId: z.string().uuid(),
  groupId: z.string().uuid(),
  botId: z.string().uuid(),
  cols: z.number().int().min(2).max(500),
  rows: z.number().int().min(2).max(500),
  createdAt: z.string(),
})
export type TerminalLive = z.infer<typeof TerminalLive>
export const Hello = z.object({
  t: z.literal('hello'),
  protocol: z.number().int(),
  token: z.string(),
  daemonVersion: z.string(),
  machine: MachineInfo,
  agents: z.array(AgentInfo),
  /** Runs this daemon is still executing (spec §14: server outage → turns go on locally). Others marked running
   * on this machine were lost (daemon restart) and are reconciled as interrupted. */
  activeRuns: z.array(z.string()).default([]),
  /** Services this daemon still hosts; the server marks the machine's other live ones exited. */
  services: z.array(ServiceInfo).default([]),
  /** Optional capabilities (DaemonFeature); unknown ones are kept, older daemons send none. */
  features: z.array(z.string()).default([]),
  /** Running web terminal shells: the server adopts them after its own restart and forgets the ones missing. */
  terminals: z.array(TerminalLive).default([]),
})
export const Heartbeat = z.object({ t: z.literal('heartbeat') })
export const RunEventMsg = z.object({ t: z.literal('run.event'), runId: z.string(), event: RunEvent })
export const RunDone = z.object({
  t: z.literal('run.done'),
  runId: z.string(),
  outcome: z.enum(['completed', 'interrupted', 'failed']),
  /** Final agent reply (markdown); posted to the group as the bot's message. */
  reply: z.string(),
  filesChanged: z.number().int(),
  usage: Usage.nullable(),
  sessionId: z.string().nullable(),
  /** Set when a new session was opened, e.g. 'resume_failed' | 'first' | 'requested'. */
  newSessionReason: z.string().nullable(),
  error: z.string().nullable(),
  /** Workspace git state after the turn; null for workspaces without a repo. */
  git: GitStatus.nullable(),
  /** Unified diff of what this turn changed (repo workspaces; capped by the daemon, see PATCH_MAX_BYTES). */
  patch: z.string().nullable(),
  /** The repos `patch` spans, root first. */
  repos: z.array(DiffRepo).default([]),
  /** run.append messages actually fed into this run; the server queues the rest as new runs (spec §8.9 fallback). */
  appendsApplied: z.number().int(),
  /** Force groups only (null in partition groups). */
  sync: RunSyncDone.nullable().default(null),
})
export type RunDone = z.infer<typeof RunDone>

/** Result of workspace.ensure / workspace.cd, and any later state change of a (group, bot) workspace. */
export const WorkspaceState = z.object({
  t: z.literal('workspace.state'),
  groupId: z.string(),
  botId: z.string(),
  /** Echoes the server's requestId when answering workspace.ensure / workspace.cd. */
  requestId: z.string().nullable(),
  state: z.enum(['cloning', 'ready', 'failed']),
  /** Absolute local path in use (managed or /cd). */
  path: z.string().nullable(),
  git: GitStatus.nullable(),
  error: z.string().nullable(),
  /** Set with `failed` when the clone failed on repo access. */
  reason: RepoAccessReason.nullable().default(null),
  /** Remote URLs of a ready /cd directory, so the server can remember which repos live where on the machine. */
  remotes: z.array(z.string()).default([]),
})
export type WorkspaceState = z.infer<typeof WorkspaceState>

/** Answer to repo.probe: the first candidate URL that worked, with the branch list (at most REPO_BRANCHES_MAX). */
export const RepoProbeResult = z.object({
  t: z.literal('repo.probe.result'),
  requestId: z.string(),
  ok: z.boolean(),
  reason: RepoAccessReason.nullable(),
  usedUrl: z.string().nullable(),
  defaultBranch: z.string().nullable(),
  branches: z.array(z.string()),
  /** Last git error line, credentials removed. */
  detail: z.string().nullable(),
})
export type RepoProbeResult = z.infer<typeof RepoProbeResult>
export const REPO_BRANCHES_MAX = 200

export const PATCH_MAX_BYTES = 512 * 1024

export const PermissionOption = z.object({
  optionId: z.string(),
  name: z.string(),
  /** ACP PermissionOptionKind */
  kind: z.enum(['allow_once', 'allow_always', 'reject_once', 'reject_always']),
})
export type PermissionOption = z.infer<typeof PermissionOption>

/** An agent permission request beyond the bot's tier (plan D15), forwarded for the bot owner's decision. */
export const ApprovalRequest = z.object({
  t: z.literal('approval.request'),
  runId: z.string(),
  /** Daemon-unique; echoed in approval.decision. */
  requestId: z.string(),
  title: z.string(),
  toolKind: z.string(),
  /** Command line / path / URL the agent wants to touch. */
  detail: z.string(),
  /** Why the daemon forwarded this request; older daemons omit it. */
  reason: z
    .enum(['high_risk', 'protected_base', 'network', 'write', 'unparsed', 'not_allowed'])
    .default('not_allowed'),
  options: z.array(PermissionOption),
  /** Rules an allow_always answer adds to the bot's alwaysAllow; empty → the scope can't be shown, so don't offer it. */
  remember: z.array(z.string()).default([]),
})
export type ApprovalRequest = z.infer<typeof ApprovalRequest>

/** Result of run.discard (partition /stop → 丢弃本轮改动). */
export const RunDiscarded = z.object({
  t: z.literal('run.discarded'),
  runId: z.string(),
  ok: z.boolean(),
  /** Files restored to their pre-turn state. */
  files: z.number().int(),
  error: z.string().nullable(),
})
export type RunDiscarded = z.infer<typeof RunDiscarded>

/**
 * The agent went on by itself after `runId` ended (a background task it started finished): the daemon asks for a new
 * run of the same conversation to report that work under; answered with run.continued.
 */
export const RunContinue = z.object({
  t: z.literal('run.continue'),
  requestId: z.string(),
  runId: z.string(),
})
export type RunContinue = z.infer<typeof RunContinue>

/** ACP available_commands_update for a (group, bot) session, for the / candidates (spec §8.7). */
export const CommandsUpdate = z.object({
  t: z.literal('commands.update'),
  groupId: z.string(),
  botId: z.string(),
  commands: z.array(z.object({ name: z.string(), description: z.string() })),
})

/** Model and thought level in effect for a run once the daemon applied the requested ones. */
export const SessionConfig = z.object({
  t: z.literal('session.config'),
  runId: z.string(),
  model: z.string().nullable(),
  effort: z.string().nullable(),
  /** Claude: what the run's settings came from; absent = codex / an older daemon. */
  settings: RunSettingsSnapshot.optional(),
})

/** Local agent detection changed after hello (path set / reset, re-check); replaces the machine's agents. */
export const AgentsUpdate = z.object({ t: z.literal('agents.update'), agents: z.array(AgentInfo) })

/** Answer to files.list. */
/** Answer to workspace.diff; patch null = no changes, base = the main branch compared against (scope `base`). */
export const WorkspaceDiffResult = z.object({
  t: z.literal('workspace.diff.result'),
  requestId: z.string(),
  patch: z.string().nullable(),
  base: z.string().nullable(),
  branch: z.string().nullable(),
  /** Every repo of the workspace (root first, then submodules / nested repos by path), each with its own base. */
  repos: z.array(DiffRepo).default([]),
  error: z.string().nullable(),
})

/** One directory level of the files browser (files.tree), dirs first then files, each by name. */
export const FILE_TREE_MAX_ENTRIES = 1000
/** files.read returns text up to this size; bigger files only carry their metadata. */
export const FILE_TEXT_MAX_BYTES = 2 * 1024 * 1024
export const FileTreeEntry = z.object({
  name: z.string(),
  dir: z.boolean(),
  /** Bytes; 0 for directories. */
  size: z.number().int(),
  /** Last modification, ms since epoch. */
  mtime: z.number().int(),
  /** Changed or untracked against HEAD (for a directory: anything below it). */
  uncommitted: z.boolean(),
  /** Matched by .gitignore; only listed when asked with showIgnored. */
  ignored: z.boolean(),
})
export type FileTreeEntry = z.infer<typeof FileTreeEntry>
/** Answer to files.tree; `truncated` = the directory had more than FILE_TREE_MAX_ENTRIES entries. */
export const FilesTreeResult = z.object({
  t: z.literal('files.tree.result'),
  requestId: z.string(),
  entries: z.array(FileTreeEntry),
  truncated: z.boolean(),
  error: z.string().nullable(),
})
/** Answer to files.read; `text` only for valid UTF-8 within maxBytes. */
export const FilesReadResult = z.object({
  t: z.literal('files.read.result'),
  requestId: z.string(),
  size: z.number().int(),
  binary: z.boolean(),
  mime: z.string(),
  text: z.string().nullable(),
  error: z.string().nullable(),
})

// ── Manual git (plan Git增强): read-only views at any ref, and owner-gated writes ──────────────────────────────────
/** A local branch, or a remote-tracking one (`name` = `origin/feat`). */
export const GitBranch = z.object({
  name: z.string(),
  kind: z.enum(['local', 'remote']),
  current: z.boolean(),
  /** Local only: its upstream (`origin/feat`) and how far apart they are; null without one. */
  upstream: z.string().nullable(),
  ahead: z.number().int().nullable(),
  behind: z.number().int().nullable(),
  /** Tip commit. */
  commit: z.string(),
  subject: z.string(),
  at: z.string(),
})
export type GitBranch = z.infer<typeof GitBranch>
export const GitRemote = z.object({ name: z.string(), url: z.string() })
export type GitRemote = z.infer<typeof GitRemote>
/** `commit`: the commit it points at (an annotated tag peeled); `subject`/`at`: that commit's. */
export const GitTag = z.object({
  name: z.string(),
  commit: z.string(),
  annotated: z.boolean(),
  subject: z.string(),
  at: z.string(),
})
export type GitTag = z.infer<typeof GitTag>
export const GitRefsResult = z.object({
  t: z.literal('git.refs.result'),
  requestId: z.string(),
  branches: z.array(GitBranch),
  remotes: z.array(GitRemote),
  /** gitOps3: tags newest first, and up to 5 local branches checked out lately (reflog), latest first. */
  tags: z.array(GitTag).default([]),
  recent: z.array(z.string()).default([]),
  error: z.string().nullable(),
})
export type GitRefsResult = z.infer<typeof GitRefsResult>

export const GitCommit = z.object({
  hash: z.string(),
  shortHash: z.string(),
  author: z.string(),
  email: z.string(),
  at: z.string(),
  subject: z.string(),
  parents: z.array(z.string()),
  /** Decorations: branch and tag names pointing at it. */
  refs: z.array(z.string()),
})
export type GitCommit = z.infer<typeof GitCommit>
export const GitLogResult = z.object({
  t: z.literal('git.log.result'),
  requestId: z.string(),
  commits: z.array(GitCommit),
  hasMore: z.boolean(),
  error: z.string().nullable(),
})
export type GitLogResult = z.infer<typeof GitLogResult>

/** A directory listing read from a ref (ls-tree): `mtime` 0, `uncommitted` and `ignored` false. */
export const GitTreeResult = z.object({
  t: z.literal('git.tree.result'),
  requestId: z.string(),
  entries: z.array(FileTreeEntry),
  truncated: z.boolean(),
  error: z.string().nullable(),
})
export type GitTreeResult = z.infer<typeof GitTreeResult>
export const GitReadResult = z.object({
  t: z.literal('git.read.result'),
  requestId: z.string(),
  size: z.number().int(),
  binary: z.boolean(),
  mime: z.string(),
  text: z.string().nullable(),
  error: z.string().nullable(),
})
export type GitReadResult = z.infer<typeof GitReadResult>

/** Answer to git.show: one commit with its whole message, its committer and the branches that contain it. */
export const GitShowResult = z.object({
  t: z.literal('git.show.result'),
  requestId: z.string(),
  commit: GitCommit.nullable(),
  /** The whole message, subject included. */
  body: z.string(),
  committer: z.string(),
  committerEmail: z.string(),
  committedAt: z.string(),
  /** Local and remote-tracking branches containing it, at most 100. */
  branches: z.array(z.string()),
  error: z.string().nullable(),
})
export type GitShowResult = z.infer<typeof GitShowResult>

export const GitChange = z.object({
  path: z.string(),
  change: z.enum(['added', 'modified', 'deleted', 'renamed']),
  /** Renamed only. */
  oldPath: z.string().nullable(),
})
export type GitChange = z.infer<typeof GitChange>

/** A change of the work tree against HEAD; `add`/`del` lines, null for binary files. */
export const GitWorkChange = GitChange.extend({
  /** Not tracked by git yet (IDEA's Unversioned Files). */
  untracked: z.boolean(),
  add: z.number().int().nullable(),
  del: z.number().int().nullable(),
})
export type GitWorkChange = z.infer<typeof GitWorkChange>
export const GitConflictSide = z.enum(['modified', 'added', 'deleted'])
export type GitConflictSide = z.infer<typeof GitConflictSide>
/** An unmerged path and what each side did to it (`ours` = HEAD; in a rebase that is the branch being rebased onto). */
export const GitConflict = z.object({ path: z.string(), ours: GitConflictSide, theirs: GitConflictSide })
export type GitConflict = z.infer<typeof GitConflict>
/** What stopped midway. */
export const GitOngoing = z.object({
  kind: GitOngoingKind,
  /** What is merged, picked or reverted, or the branch being rebased: a branch name or a short hash. */
  subject: z.string().nullable(),
  /** Rebase progress: commit `step` of `total`. */
  step: z.number().int().nullable(),
  total: z.number().int().nullable(),
  /** The message git prepared for the commit that finishes it (MERGE_MSG). */
  message: z.string().nullable(),
})
export type GitOngoing = z.infer<typeof GitOngoing>
/** HEAD's commit, to amend; `pushed` = already on its upstream or another remote branch. */
export const GitHeadCommit = z.object({
  hash: z.string(),
  shortHash: z.string(),
  message: z.string(),
  pushed: z.boolean(),
})
export type GitHeadCommit = z.infer<typeof GitHeadCommit>
/** Answer to git.changes: what a commit could take, unmerged paths apart; `head` null on an unborn branch. */
export const GitChangesResult = z.object({
  t: z.literal('git.changes.result'),
  requestId: z.string(),
  changes: z.array(GitWorkChange),
  conflicts: z.array(GitConflict),
  ongoing: GitOngoing.nullable(),
  head: GitHeadCommit.nullable(),
  error: z.string().nullable(),
})
export type GitChangesResult = z.infer<typeof GitChangesResult>

/** Who last changed each line: `start` is 1-based; `commit` '' = not committed yet. */
export const GitBlameRange = z.object({
  start: z.number().int(),
  count: z.number().int(),
  commit: z.string(),
})
export type GitBlameRange = z.infer<typeof GitBlameRange>
export const GitBlameCommit = z.object({
  hash: z.string(),
  shortHash: z.string(),
  author: z.string(),
  email: z.string(),
  at: z.string(),
  subject: z.string(),
})
export type GitBlameCommit = z.infer<typeof GitBlameCommit>
export const GitBlameResult = z.object({
  t: z.literal('git.blame.result'),
  requestId: z.string(),
  ranges: z.array(GitBlameRange),
  commits: z.array(GitBlameCommit),
  error: z.string().nullable(),
})
export type GitBlameResult = z.infer<typeof GitBlameResult>

/** `stash@{index}`; `untracked`: it holds untracked files too (a third parent). */
export const GitStash = z.object({
  index: z.number().int(),
  hash: z.string(),
  message: z.string(),
  /** The branch it was made on; null on a detached HEAD. */
  branch: z.string().nullable(),
  at: z.string(),
  untracked: z.boolean(),
})
export type GitStash = z.infer<typeof GitStash>
export const GitStashesResult = z.object({
  t: z.literal('git.stashes.result'),
  requestId: z.string(),
  stashes: z.array(GitStash),
  error: z.string().nullable(),
})
export type GitStashesResult = z.infer<typeof GitStashesResult>

/**
 * Answer to git.conflict: an unmerged path's three versions (null = absent on that side, or binary) and git's own merge
 * of them with diff3 markers (`<<<<<<<`, `|||||||`, `=======`, `>>>>>>>`), null unless all three are text.
 */
export const GitConflictResult = z.object({
  t: z.literal('git.conflict.result'),
  requestId: z.string(),
  base: z.string().nullable(),
  ours: z.string().nullable(),
  theirs: z.string().nullable(),
  merged: z.string().nullable(),
  binary: z.boolean(),
  error: z.string().nullable(),
})
export type GitConflictResult = z.infer<typeof GitConflictResult>
export const GitCompareResult = z.object({
  t: z.literal('git.compare.result'),
  requestId: z.string(),
  changes: z.array(GitChange),
  error: z.string().nullable(),
})
export type GitCompareResult = z.infer<typeof GitCompareResult>

/** Answer to git.diff: the unified patch (`git diff` format, untracked files included when `to` is the work tree). */
export const GitDiffResult = z.object({
  t: z.literal('git.diff.result'),
  requestId: z.string(),
  patch: z.string().nullable(),
  /** The patch was cut at `maxBytes`. */
  truncated: z.boolean(),
  error: z.string().nullable(),
})
export type GitDiffResult = z.infer<typeof GitDiffResult>
/** Answer to git.refresh, sent after the fresh status went out as workspace.state. */
export const GitRefreshResult = z.object({
  t: z.literal('git.refresh.result'),
  requestId: z.string(),
  error: z.string().nullable(),
})
export type GitRefreshResult = z.infer<typeof GitRefreshResult>

/** gitOps3 added all but the first four. */
export const GitActionKind = z.enum([
  'checkout',
  'pull',
  'commit',
  'push',
  'branch-create',
  'branch-rename',
  'branch-delete',
  'merge',
  'rebase',
  'cherry-pick',
  'revert',
  'reset',
  'discard',
  'stash',
  'unstash',
  'stash-drop',
  'tag-create',
  'tag-delete',
  'tag-push',
  'continue',
  'abort',
  'skip',
  'resolve',
  /** gitOps4 */
  'add',
  'ignore',
  'apply',
  'restore',
])
export type GitActionKind = z.infer<typeof GitActionKind>
export const GitConflictPick = z.enum(['ours', 'theirs'])
export type GitConflictPick = z.infer<typeof GitConflictPick>
/** One line of an interactive rebase's todo (IDEA's Pick / Reword / Squash / Fixup / Drop); `message` for reword and squash. */
export const GitRebaseStep = z.object({
  action: z.enum(['pick', 'reword', 'squash', 'fixup', 'drop']),
  commit: z.string().min(4).max(64),
  message: z.string().min(1).max(10_000).optional(),
})
export type GitRebaseStep = z.infer<typeof GitRebaseStep>
/**
 * git.action parameters beyond branch/remote/message/paths (gitOps3); each action reads its own, see GitAction. Absent
 * when the action has none, so a daemon without gitOps3 gets the same message as before.
 */
export const GitActionArgs = z.object({
  name: z.string().optional(),
  from: z.string().optional(),
  onto: z.string().optional(),
  commit: z.string().optional(),
  commits: z.array(z.string()).optional(),
  mode: z.string().optional(),
  detach: z.boolean().optional(),
  force: z.boolean().optional(),
  tags: z.boolean().optional(),
  checkout: z.boolean().optional(),
  amend: z.boolean().optional(),
  noCommit: z.boolean().optional(),
  untracked: z.boolean().optional(),
  stash: z.number().int().optional(),
  pop: z.boolean().optional(),
  index: z.boolean().optional(),
  path: z.string().optional(),
  side: GitConflictPick.optional(),
  content: z.string().optional(),
  /** gitOps4 */
  target: z.string().optional(),
  expect: z.string().optional(),
  keepAdded: z.boolean().optional(),
  patch: z.string().optional(),
  localCommits: z.enum(['rebase', 'drop']).optional(),
  todo: z.array(GitRebaseStep).optional(),
  reverse: z.boolean().optional(),
})
export type GitActionArgs = z.infer<typeof GitActionArgs>

/** One controlled Git process, in execution order. No environment or stdin is included; long text is marked cut. */
export const GitCommandRecord = z.object({
  command: z.string(),
  startedAt: z.string(),
  durationMs: z.number().int().nonnegative(),
  exitCode: z.number().int().nullable(),
  stdout: z.string(),
  stderr: z.string(),
  truncated: z.boolean(),
})
export type GitCommandRecord = z.infer<typeof GitCommandRecord>
/**
 * gitOps4: what an action's outcome needs beyond its text. `code` overwritten: local changes in the way (`paths`), nothing
 * done; diverged: a checked out remote branch's local one has commits of its own (`ahead`, `behind`), nothing done —
 * ask whether to rebase them or drop them (checkout `args.localCommits`); conflicts: it went through but left `paths`
 * conflicted (a smart checkout restoring the changes, an update stashing around). `updated`: what a pull brought in.
 */
export const GitActionDetail = z.object({
  code: z.enum(['overwritten', 'diverged', 'conflicts']).nullable(),
  paths: z.array(z.string()),
  ahead: z.number().int().nullable(),
  behind: z.number().int().nullable(),
  updated: z
    .object({ from: z.string(), to: z.string(), commits: z.number().int(), files: z.number().int() })
    .nullable(),
  commands: z.array(GitCommandRecord).nullable(),
})
export type GitActionDetail = z.infer<typeof GitActionDetail>
export const GitActionResultDetail = GitActionDetail.extend({
  commands: GitCommandRecord.array().nullable().default(null),
})
export type GitActionResultDetail = z.infer<typeof GitActionResultDetail>
/**
 * Answer to git.action. `busy`: a turn holds the directory (plan W10), nothing was run. `output`: git's summary
 * (new HEAD, pushed range…), credentials stripped.
 */
export const GitActionResult = z.object({
  t: z.literal('git.action.result'),
  requestId: z.string(),
  ok: z.boolean(),
  busy: z.boolean(),
  output: z.string().nullable(),
  error: z.string().nullable(),
  detail: GitActionResultDetail.nullable().default(null),
})
export type GitActionResult = z.infer<typeof GitActionResult>

/** Answer to files.find: workspace paths whose name or path suffix equals the query (at most `limit`). */
export const FilesFindResult = z.object({
  t: z.literal('files.find.result'),
  requestId: z.string(),
  paths: z.array(z.string()),
  error: z.string().nullable(),
})

export const FilesResult = z.object({
  t: z.literal('files.result'),
  requestId: z.string(),
  entries: z.array(z.object({ path: z.string(), dir: z.boolean(), uncommitted: z.boolean() })),
  error: z.string().nullable(),
})

/** Answer to repo.find. */
export const RepoFound = z.object({
  t: z.literal('repo.found'),
  requestId: z.string(),
  /** Where a managed clone for this (group, bot) would go. */
  managedPath: z.string(),
  /** Local work trees whose origin is the group repo. */
  paths: z.array(z.string()),
})
export type RepoFound = z.infer<typeof RepoFound>

/** Apps a workspace can be opened with: macOS checks which are installed; elsewhere only the file manager. */
export const OPEN_APPS = ['finder', 'cursor', 'idea', 'vscode', 'warp', 'iterm', 'terminal', 'files'] as const
export type OpenApp = (typeof OPEN_APPS)[number]
/** Answer to apps.list: ids of OPEN_APPS (unknown ones from newer daemons are ignored). */
export const AppsListResult = z.object({
  t: z.literal('apps.list.result'),
  requestId: z.string(),
  apps: z.array(z.string()),
})
/** Answer to workspace.open. */
export const WorkspaceOpenResult = z.object({
  t: z.literal('workspace.open.result'),
  requestId: z.string(),
  error: z.string().nullable(),
})

/** Answer to session.fork: the forked session's id, or why the adapter could not fork. */
export const SessionForkResult = z.object({
  t: z.literal('session.fork.result'),
  requestId: z.string(),
  sessionId: z.string().nullable(),
  error: z.string().nullable(),
})

export const LogLevelName = z.enum(['error', 'warn', 'info', 'debug'])

/** Answer to logs.get: oldest first, credentials masked before they leave the machine. */
export const LogsResult = z.object({
  t: z.literal('logs.result'),
  requestId: z.string(),
  lines: z.array(z.object({ level: LogLevelName, text: z.string() })),
  error: z.string().nullable(),
})

/** One workspace on the machine, as its desktop app's 工作区 page lists it; names are null once the server forgot them. */
export const MachineWorkspace = z.object({
  groupId: z.string(),
  groupName: z.string().nullable(),
  dm: z.boolean(),
  botId: z.string(),
  botName: z.string().nullable(),
  kind: z.enum(['managed', 'empty', 'cd']),
  path: z.string(),
  /** Bytes on disk (a lower bound on huge trees); null for /cd dirs, the owner's own checkout. */
  size: z.number().int().nonnegative().nullable(),
  state: z.enum(['running', 'idle', 'removed', 'unused']),
})
export type MachineWorkspace = z.infer<typeof MachineWorkspace>

/** Answer to workspaces.list. */
export const WorkspacesResult = z.object({
  t: z.literal('workspaces.result'),
  requestId: z.string(),
  entries: z.array(MachineWorkspace),
  error: z.string().nullable(),
})

/** Answer to workspace.delete. */
export const WorkspaceDeleteResult = z.object({
  t: z.literal('workspace.delete.result'),
  requestId: z.string(),
  error: z.string().nullable(),
})

/** Answer to dir.list. */
export const DirResult = z.object({
  t: z.literal('dir.result'),
  requestId: z.string(),
  /** Absolute path listed (the home dir when the request had none). */
  path: z.string(),
  /** Immediate subdirectories, hidden ones skipped; `git` = the subdirectory is a work tree root. */
  entries: z.array(z.object({ name: z.string(), git: z.boolean() })),
  /** Repo containing `path`, if any. */
  git: z.object({ root: z.string(), remotes: z.array(z.string()), branch: z.string().nullable() }).nullable(),
  /** Why `path` cannot be a workspace (root, home, system dir, …); null = usable. */
  unusable: z.string().nullable(),
  /** Filesystem roots to browse from (Windows drives, `/` elsewhere); older daemons omit it. */
  roots: z.array(z.string()).default([]),
  error: z.string().nullable(),
})
export type DirResult = z.infer<typeof DirResult>

/** The built-in ask tool was called; blocks the agent until question.answer arrives. */
export const QuestionAsk = z.object({
  t: z.literal('question.ask'),
  runId: z.string(),
  requestId: z.string(),
  questions: z.array(Question).min(1).max(4),
})

/** The daemon no longer needs an answer to a pending card (the shared-directory confirmation resolved on its own). */
export const QuestionWithdraw = z.object({
  t: z.literal('question.withdraw'),
  runId: z.string(),
  requestId: z.string(),
})

/** Every status change of a hosted service. */
export const ServiceState = z.object({ t: z.literal('service.state'), service: ServiceInfo })
/** Answer to service.restart once the service is ready or failed to; `error` in the daemon's words. */
export const ServiceRestartResult = z.object({
  t: z.literal('service.restart.result'),
  requestId: z.string(),
  error: z.string().nullable(),
})

/**
 * gg-cast for a live preview (plan B2), as asked by cast.sync: starting (fetching gg-cast, finding the window,
 * joining the room), live (publishing), failed (`error` in the daemon's words; retried while still asked for).
 * `missing`: permissions the machine lacks — no screen recording fails, no accessibility leaves control inert.
 * `devtools`: a mini program waits on its owner in the WeChat devtools; retried every few seconds meanwhile.
 * `retryIn`: seconds until a failed one is tried again (cast.retry tries at once).
 */
export const CastState = z.object({
  t: z.literal('cast.state'),
  previewId: z.string(),
  state: z.enum(['starting', 'live', 'failed']),
  error: z.string().nullable(),
  missing: z.array(Permission).default([]),
  devtools: DevtoolsBlocker.optional(),
  retryIn: z.number().int().nonnegative().optional(),
})

// ── Agent tools and providers (docs/plan/Agent工具与供应商统一管理-设计.md) ─────
/**
 * `tools`: tools.cmd; `providers`: providers.cmd; `ccSwitch`: ccswitch.* (only when the machine has CC Switch).
 * Provider settings live on the machine only: the server relays them in memory and never stores or logs them.
 */
/** `sync`: takes part in force sync; a replica on a daemon without it sits out (runs go unsynced). */
export const DaemonFeature = z.enum([
  'tools',
  'providers',
  'ccSwitch',
  'sync',
  'sessionFork',
  'agentSettings',
  'reprobe',
  'plugins',
  'gitOps',
  /** git.diff, git.refresh and commit `paths`: a daemon without it would commit everything. */
  'gitOps2',
  /** `repo` of git.refs / git.action: a daemon without it would act on the root repo instead. */
  'gitRepos',
  /**
   * The IDEA-style git tools: git.changes / show / blame / stashes / conflict, `repo` on every git read, log filters,
   * diff options, tags and recent branches in git.refs, the new git.action kinds and their `args`.
   */
  'gitOps3',
  /**
   * The second IDEA pass (docs/plan/Git管理-IDEA对标-五轮迭代.md): push `target` with explicit refs, stash `expect`,
   * discard `keepAdded` / `patch`, the add / ignore actions, git.diff `oldPath` / `whitespace`, git.action.result
   * `detail`, checkout `localCommits`, pull `from`, branch-create `force`, push `commit`, reset / amend `expect`,
   * rebase `todo`, resolve `paths`, the apply / restore actions.
   */
  'gitOps4',
  'terminal-v2',
  /** A terminal open's `cwd`: machine terminals in a directory of their own. */
  'terminal-dir',
  /** 我的机器管理 on the web: logs.get, workspaces.list and workspace.delete. */
  'machineAdmin',
  /** Hosted artifacts: RunStart.artifacts / artifactExclude and the artifact version routes. */
  'artifacts',
  /** artifact.snapshot: screenshots of versions the daemon did not make. */
  'artifactSnapshot',
])
export type DaemonFeature = z.infer<typeof DaemonFeature>

export const ToolKind = z.enum(['node', 'claude', 'codex'])
export type ToolKind = z.infer<typeof ToolKind>
export const ToolStatus = z.object({
  kind: ToolKind,
  installed: z.boolean(),
  version: z.string().nullable(),
  /** Latest version on the mirror; null when it could not be checked. */
  latest: z.string().nullable(),
  /** Installed by Gonggong (and so upgradable by it). */
  managed: z.boolean(),
  path: z.string().nullable(),
  /** How the user's own install is upgraded (Gonggong runs it on 升级); null when managed or unknown, absent from older daemons. */
  upgradeCommand: z.string().nullable().optional(),
})
export type ToolStatus = z.infer<typeof ToolStatus>
/** Where Node and the agent CLIs are downloaded from; npmmirror by default. */
export const Mirror = z.discriminatedUnion('kind', [
  z.object({ kind: z.literal('npmmirror') }),
  z.object({ kind: z.literal('official') }),
  z.object({
    kind: z.literal('custom'),
    registry: z.url({ protocol: /^https?$/ }),
    node: z.url({ protocol: /^https?$/ }),
  }),
])
export type Mirror = z.infer<typeof Mirror>
export const ToolsSettings = z.object({ mirror: Mirror })
export type ToolsSettings = z.infer<typeof ToolsSettings>
/** `latest` or an exact x.y.z (optionally v-prefixed); anything else never reaches npm. */
export const TOOL_VERSION = /^(latest|v?\d+\.\d+\.\d+(-[0-9A-Za-z.-]+)?)$/

export const ModelMap = z.object({
  haiku: z.string().optional(),
  sonnet: z.string().optional(),
  opus: z.string().optional(),
})
export type ModelMap = z.infer<typeof ModelMap>
export const PresetGroup = z.enum(['cn', 'aggregator', 'global'])
/** A built-in vendor (adapted from CC Switch): choosing one only leaves the API key to fill in. */
export const ProviderPreset = z.object({
  id: z.string(),
  agent: AgentKind,
  name: z.string(),
  group: PresetGroup,
  websiteUrl: z.string().nullable(),
  apiKeyUrl: z.string().nullable(),
  baseUrl: z.string(),
  apiKeyField: z.string().nullable(),
  model: z.string().nullable(),
  models: ModelMap.nullable(),
  modelOptions: z.array(z.string()),
  env: z.record(z.string(), z.string()),
  wireApi: z.string().nullable(),
  effort: z.string().nullable(),
  /** Claude: context window per model id, filled into CLAUDE_CODE_MAX_CONTEXT_TOKENS unless the provider sets it. */
  modelContext: z.record(z.string(), z.number().int()).default({}),
})
export type ProviderPreset = z.infer<typeof ProviderPreset>
/** A machine's provider as it may leave the machine: `apiKey` masked to its last 4 characters at most. */
export const ProviderView = z.object({
  id: z.string(),
  agent: AgentKind,
  name: z.string(),
  presetId: z.string().nullable(),
  revision: z.number().int(),
  baseUrl: z.string(),
  apiKey: z.string(),
  apiKeyField: z.string().nullable(),
  model: z.string().nullable(),
  models: ModelMap.nullable(),
  /** Values of `isSecretEnv` variables masked like the API key. */
  env: z.record(z.string(), z.string()),
  /** Password masked; null = direct. */
  proxy: z.string().nullable(),
  wireApi: z.string().nullable(),
  effort: z.string().nullable(),
  source: z.object({ kind: z.enum(['cc-switch', 'link']), id: z.string().optional() }).nullable(),
})
export type ProviderView = z.infer<typeof ProviderView>
/** `official` = the CLI's own login (nothing injected); a bot without an override inherits the machine default. */
export const OFFICIAL_PROVIDER = 'official'
export const INHERIT_PROVIDER = 'inherit'
/** What an official login runs with besides the CLI's own config; proxy password masked, null = direct. */
export const OfficialSettings = z.object({
  env: z.record(z.string(), z.string()),
  proxy: z.string().nullable(),
})
export type OfficialSettings = z.infer<typeof OfficialSettings>
export const ProviderStoreView = z.object({
  /** Default per agent: a provider id or `official`; absent = official. */
  machine: z.partialRecord(AgentKind, z.string()),
  /** Official login extras per agent; absent = none. */
  official: z.partialRecord(AgentKind, OfficialSettings).default({}),
  /** Bot overrides: bot id → provider id or `official`; absent = inherit. */
  bots: z.record(z.string(), z.string()),
  providers: z.array(ProviderView),
  /** Machine defaults per agent kind; absent = Claude Code's defaults, CLI config inherited. */
  agentSettings: z.partialRecord(AgentKind, AgentSettings).default({}),
  /** The CLI's own user-level config per agent kind; absent = none found / not read. */
  cli: z.partialRecord(AgentKind, CliSettingsSnapshot).default({}),
  /** Latest session of each (group, bot) and the provider it is pinned to, for the switch confirmation. */
  sessions: z.array(
    z.object({ groupId: z.string(), botId: z.string(), agent: AgentKind, provider: z.string() }),
  ),
})
export type ProviderStoreView = z.infer<typeof ProviderStoreView>
/**
 * Adds a provider (no `id`: from `presetId` or by hand) or edits one. Absent fields keep what is there (or the
 * preset's value); `apiKey` is required for a new one and replaced only when given.
 */
export const ProviderInput = z.object({
  id: z.string().optional(),
  agent: AgentKind,
  presetId: z.string().optional(),
  name: z.string().trim().min(1).max(64).optional(),
  baseUrl: z.url({ protocol: /^https?$/ }).optional(),
  apiKey: z.string().trim().min(1).max(4096).optional(),
  apiKeyField: z.enum(['ANTHROPIC_AUTH_TOKEN', 'ANTHROPIC_API_KEY']).optional(),
  model: z.string().trim().max(128).optional(),
  models: ModelMap.optional(),
  env: z.record(z.string(), z.string()).optional(),
  /** '' = direct; the masked one from the view = unchanged. */
  proxy: z.union([z.literal(''), z.url({ protocol: /^https?$/ })]).optional(),
  effort: z.string().max(32).optional(),
})
export type ProviderInput = z.infer<typeof ProviderInput>
/** Sets an official login's extras; absent fields keep what is there. */
export const OfficialInput = z.object({
  env: ProviderInput.shape.env,
  proxy: ProviderInput.shape.proxy,
})
export type OfficialInput = z.infer<typeof OfficialInput>
/** CC Switch import preview row: `key` is what ccswitch.apply takes; `existing` = the local provider it updates. */
export const CcSwitchCandidate = z.object({
  key: z.string(),
  agent: AgentKind,
  name: z.string(),
  baseUrl: z.string(),
  apiKey: z.string(),
  model: z.string().nullable(),
  current: z.boolean(),
  existing: z.string().nullable(),
})
export type CcSwitchCandidate = z.infer<typeof CcSwitchCandidate>
/** A (group, bot) whose session keeps a provider other than a new session would use (names only). */
export const ProviderStateItem = z.object({
  groupId: z.string(),
  botId: z.string(),
  session: z.string(),
  effective: z.string(),
})
export type ProviderStateItem = z.infer<typeof ProviderStateItem>

/** Streamed output of a running tools.cmd install / upgrade (lines capped by the daemon). */
export const ToolsProgress = z.object({
  t: z.literal('tools.progress'),
  requestId: z.string(),
  line: z.string(),
})
export const ToolsResult = z.object({
  t: z.literal('tools.result'),
  requestId: z.string(),
  ok: z.boolean(),
  error: z.string().nullable(),
  tools: z.array(ToolStatus),
  settings: ToolsSettings,
})
export type ToolsResult = z.infer<typeof ToolsResult>
export const ProvidersResult = z.object({
  t: z.literal('providers.result'),
  requestId: z.string(),
  ok: z.boolean(),
  error: z.string().nullable(),
  view: ProviderStoreView.optional(),
  presets: z.array(ProviderPreset).optional(),
  catalog: AgentCatalog.optional(),
  /** The provider saved or imported. */
  id: z.string().optional(),
})
export type ProvidersResult = z.infer<typeof ProvidersResult>
export const CcSwitchResult = z.object({
  t: z.literal('ccswitch.result'),
  requestId: z.string(),
  ok: z.boolean(),
  error: z.string().nullable(),
  candidates: z.array(CcSwitchCandidate),
  /** Local ids written by ccswitch.apply. */
  imported: z.array(z.string()),
  view: ProviderStoreView.optional(),
})
export type CcSwitchResult = z.infer<typeof CcSwitchResult>
/** agents.reprobe done; on success the new catalog has been sent in an agents.update first. */
export const AgentsReprobeResult = z.object({
  t: z.literal('agents.reprobe.result'),
  requestId: z.string(),
  ok: z.boolean(),
  error: z.string().nullable(),
})
/** Replaces the machine's list; sent after welcome, after each run and whenever providers change. */
export const BotsProviderState = z.object({
  t: z.literal('bots.providerState'),
  items: z.array(ProviderStateItem),
})

export const DaemonToServer = z.discriminatedUnion('t', [
  AgentsUpdate,
  AppsListResult,
  LogsResult,
  WorkspacesResult,
  WorkspaceDeleteResult,
  WorkspaceOpenResult,
  SessionForkResult,
  CommandsUpdate,
  DirResult,
  RepoFound,
  FilesResult,
  FilesTreeResult,
  FilesReadResult,
  FilesFindResult,
  GitRefsResult,
  GitLogResult,
  GitShowResult,
  GitChangesResult,
  GitBlameResult,
  GitStashesResult,
  GitConflictResult,
  GitTreeResult,
  GitReadResult,
  GitCompareResult,
  GitDiffResult,
  GitRefreshResult,
  GitActionResult,
  WorkspaceDiffResult,
  QuestionAsk,
  QuestionWithdraw,
  ApprovalRequest,
  RunDiscarded,
  RunContinue,
  SessionConfig,
  Hello,
  Heartbeat,
  RunEventMsg,
  RunDone,
  WorkspaceState,
  RepoProbeResult,
  ServiceState,
  ServiceRestartResult,
  CastState,
  ToolsProgress,
  ToolsResult,
  ProvidersResult,
  CcSwitchResult,
  AgentsReprobeResult,
  BotsProviderState,
  SyncSubmit,
  SyncApplied,
  SyncState,
])
export type DaemonToServer = z.infer<typeof DaemonToServer>

// ── server → daemon ─────────────────────────────────────────────────────────
/** Published daemon build for this machine's OS/arch (plan D17); the daemon verifies sha256 before replacing itself. */
export const UpgradeInfo = z.object({
  version: z.string(),
  url: z.string(),
  sha256: z.string(),
  /** Optional so older servers and fixtures remain compatible. */
  releaseNotes: z.string().trim().min(1).optional(),
})
export type UpgradeInfo = z.infer<typeof UpgradeInfo>

export const Welcome = z.object({
  t: z.literal('welcome'),
  machineId: z.string(),
  heartbeatSec: z.number().int(),
  /** Newer build available; null when up to date or none published. */
  upgrade: UpgradeInfo.nullable(),
  /** This server serves previews: the daemon opens `/ws/daemon/tunnel` (older servers leave it out). */
  tunnel: z.boolean().default(false),
  /**
   * This server publishes a daemon build for this machine's OS/arch: the daemon upgrades from it only. Otherwise (and
   * with older servers, which leave it out) it checks GitHub Releases itself.
   */
  release: z.boolean().default(false),
})
export const RejectReason = z.enum(['protocol', 'revoked', 'unauthorized'])
export const Reject = z.object({
  t: z.literal('reject'),
  reason: RejectReason,
  message: z.string(),
  minProtocol: z.number().int().optional(),
  /** For protocol rejects: where to get a compatible build. */
  upgrade: UpgradeInfo.optional(),
})
export const RunCancel = z.object({ t: z.literal('run.cancel'), runId: z.string() })
/** Answer to run.continue: the run opened for the continuation, already running; null = refused. */
export const RunContinued = z.object({
  t: z.literal('run.continued'),
  requestId: z.string(),
  runId: z.string().nullable(),
})
/** Stops a background task a run started; its end arrives as a `task` run event. */
export const TaskStop = z.object({ t: z.literal('task.stop'), runId: z.string(), taskId: z.string() })
/** The bot's effective tier changed mid-run: permission requests from now on follow it. */
export const RunTier = z.object({ t: z.literal('run.tier'), runId: z.string(), tier: Tier })

/** Create (clone) the managed workspace when a bot joins a group, or re-create it after the group binds a repo. */
export const WorkspaceEnsure = z.object({
  t: z.literal('workspace.ensure'),
  requestId: z.string(),
  groupId: z.string(),
  botId: z.string(),
  repo: RepoSpec.nullable(),
})

/**
 * /cd: bind to an existing local directory (validated on the machine), or `path: null` to go back to managed.
 * `repo` null (group without repo) → any usable directory, git or not.
 */
export const WorkspaceCd = z.object({
  t: z.literal('workspace.cd'),
  requestId: z.string(),
  groupId: z.string(),
  botId: z.string(),
  repo: RepoSpec.nullable(),
  path: z.string().nullable(),
  /** The owner confirmed `path` although it is not a work tree of `repo`. */
  force: z.boolean(),
})

/** Can this machine read `url` with its own credentials (`git ls-remote`), and does `branch` exist there? */
export const RepoProbe = z.object({
  t: z.literal('repo.probe'),
  requestId: z.string(),
  url: z.string(),
  branch: z.string(),
  protocol: GitProtocol,
})

/** optionId null → the request is cancelled (run stopped / timed out without a reject option). */
export const ApprovalDecision = z.object({
  t: z.literal('approval.decision'),
  runId: z.string(),
  requestId: z.string(),
  optionId: z.string().nullable(),
})

/** Restore only the files this (finished, interrupted) turn touched; earlier uncommitted work stays (plan D7). */
export const RunDiscard = z.object({ t: z.literal('run.discard'), runId: z.string() })

/** @ file candidates from a bot's workspace, incl. uncommitted files (spec §8.7). */
/**
 * A workspace's changes: `turn` = the live turn `runId` since it started, `uncommitted` = work tree (untracked
 * included) against HEAD, `base` = against the merge base with the main branch (origin/HEAD, main or master).
 */
export const DiffScope = z.enum(['turn', 'uncommitted', 'base'])
export type DiffScope = z.infer<typeof DiffScope>
export const WorkspaceDiff = z.object({
  t: z.literal('workspace.diff'),
  requestId: z.string(),
  groupId: z.string(),
  botId: z.string(),
  workspace: WorkspaceSpec,
  scope: DiffScope,
  runId: z.string().nullable(),
})

export const FilesList = z.object({
  t: z.literal('files.list'),
  requestId: z.string(),
  groupId: z.string(),
  botId: z.string(),
  workspace: WorkspaceSpec,
  /** Path prefix / fuzzy fragment typed after @. */
  query: z.string(),
  limit: z.number().int(),
})

/** One directory level of a workspace; `path` relative to its root ('' = the root). Read-only. */
export const FilesTree = z.object({
  t: z.literal('files.tree'),
  requestId: z.string(),
  groupId: z.string(),
  botId: z.string(),
  workspace: WorkspaceSpec,
  path: z.string(),
  showIgnored: z.boolean(),
})

/** Workspace files named `name` (a file name, or a path suffix such as `ui/Button.tsx`), honoring .gitignore. */
export const FILE_FIND_MAX_RESULTS = 20
export const FilesFind = z.object({
  t: z.literal('files.find'),
  requestId: z.string(),
  groupId: z.string(),
  botId: z.string(),
  workspace: WorkspaceSpec,
  name: z.string(),
  limit: z.number().int(),
})

/** A workspace file's metadata and, when it is UTF-8 text within `maxBytes`, its content. */
export const FilesRead = z.object({
  t: z.literal('files.read'),
  requestId: z.string(),
  groupId: z.string(),
  botId: z.string(),
  workspace: WorkspaceSpec,
  path: z.string(),
  maxBytes: z.number().int(),
})

/** `ref`: a branch, remote branch, tag or commit; null = HEAD. */
const GitRef = z.string().min(1).max(255).nullable()
const gitTarget = { requestId: z.string(), groupId: z.string(), botId: z.string(), workspace: WorkspaceSpec }

/**
 * Which repo of the workspace a git message works on, as reported in GitStatus.repos: a submodule or nested repo
 * relative to the workspace root, or an `extra` repo's absolute path inside one of `workspace.extraDirs`; omitted = the
 * root repo. git.refs and git.action since gitRepos, every other git read since gitOps3.
 */
const GitRepo = z.string().min(1).max(4096).optional()

/** Local and remote-tracking branches, the remotes, and (gitOps3) tags and recent branches. */
export const GitRefs = z.object({ t: z.literal('git.refs'), ...gitTarget, repo: GitRepo })
/**
 * gitOps3 log filters, all combined. `all`: every branch, remote branch and tag instead of `ref`; `text`: the message,
 * a fixed string unless `regexp` (extended), case-insensitive unless `matchCase`; `since`/`until`: ISO dates; `path`:
 * work-tree-relative, a file's history following renames; `order` date (default) or topo.
 */
export const GitLogFilter = z.object({
  all: z.boolean().optional(),
  author: z.string().optional(),
  text: z.string().optional(),
  regexp: z.boolean().optional(),
  matchCase: z.boolean().optional(),
  since: z.string().optional(),
  until: z.string().optional(),
  path: z.string().optional(),
  firstParent: z.boolean().optional(),
  noMerges: z.boolean().optional(),
  order: z.enum(['date', 'topo']).optional(),
})
export type GitLogFilter = z.infer<typeof GitLogFilter>
/** Newest first from `ref` (a branch, tag, commit or a range like `main..feat`); `skip` pages. */
export const GitLog = z.object({
  t: z.literal('git.log'),
  ...gitTarget,
  repo: GitRepo,
  ref: GitRef,
  skip: z.number().int().min(0),
  limit: z.number().int().min(1).max(200),
  filter: GitLogFilter.optional(),
})
/** gitOps3: one commit's whole message, its committer and the branches containing it. */
export const GitShow = z.object({
  t: z.literal('git.show'),
  ...gitTarget,
  repo: GitRepo,
  commit: z.string().min(1),
})
/** One directory of `ref`'s tree, without touching the work tree. */
export const GitTree = z.object({
  t: z.literal('git.tree'),
  ...gitTarget,
  repo: GitRepo,
  ref: GitRef,
  path: z.string(),
})
/** One file of `ref`'s tree, without touching the work tree. */
export const GitRead = z.object({
  t: z.literal('git.read'),
  ...gitTarget,
  repo: GitRepo,
  ref: GitRef,
  path: z.string(),
  maxBytes: z.number().int(),
})
/** Paths that differ from `from` to `to`; `to` null = the work tree (uncommitted changes included). */
export const GitCompare = z.object({
  t: z.literal('git.compare'),
  ...gitTarget,
  repo: GitRepo,
  from: z.string().min(1),
  to: GitRef,
})
/**
 * The patch from `from` to `to` (null = the work tree, untracked files included), of `path` only when given; cut at
 * `maxBytes`. Never touches the work tree or the index. gitOps3: `ignoreWhitespace` (-w), `context` lines (-U).
 */
export const GitDiff = z.object({
  t: z.literal('git.diff'),
  ...gitTarget,
  repo: GitRepo,
  from: z.string().min(1),
  to: GitRef,
  path: z.string().nullable(),
  maxBytes: z.number().int(),
  ignoreWhitespace: z.boolean().optional(),
  context: z.number().int().min(0).optional(),
  /** gitOps4: a rename's source, diffed with `path` as one file. */
  oldPath: z.string().nullable().optional(),
  /** gitOps4, IDEA's modes: trim = -b, ignore = -w, ignore-blank = -w --ignore-blank-lines (over ignoreWhitespace). */
  whitespace: z.enum(['trim', 'ignore', 'ignore-blank']).optional(),
})
/**
 * gitOps3: the work tree against HEAD as a commit would take it (untracked files flagged, line counts), unmerged paths
 * apart, what stopped midway and HEAD's commit. Never touches the index.
 */
export const GitChanges = z.object({ t: z.literal('git.changes'), ...gitTarget, repo: GitRepo })
/** gitOps3: who last changed each line of `path` at `ref` (null = the work tree, uncommitted lines included). */
export const GitBlame = z.object({
  t: z.literal('git.blame'),
  ...gitTarget,
  repo: GitRepo,
  ref: GitRef,
  path: z.string().min(1),
})
/** gitOps3: the stash list, newest first. */
export const GitStashes = z.object({ t: z.literal('git.stashes'), ...gitTarget, repo: GitRepo })
/** gitOps3: an unmerged path's base, ours and theirs (each up to `maxBytes`) and git's diff3 merge of them. */
export const GitConflictRead = z.object({
  t: z.literal('git.conflict'),
  ...gitTarget,
  repo: GitRepo,
  path: z.string().min(1),
  maxBytes: z.number().int(),
})
/**
 * Re-reads the workspace git status and sends it as workspace.state (same as after a turn); `fetch` first runs
 * `git fetch --prune` of every remote, so ahead/behind and remote branches are current. Not held by a turn.
 */
export const GitRefresh = z.object({ t: z.literal('git.refresh'), ...gitTarget, fetch: z.boolean() })
/**
 * A manual write, refused (`busy`) while a turn holds the directory; commits are made as `identity` (else the machine's
 * git config). Each action reads (`args` = GitActionArgs, gitOps3):
 * - checkout: `branch` (a remote branch creates its tracking local one); `args.detach`: a commit or tag, detached;
 *   `args.mode` keep (default: git refuses to overwrite changes) | smart (stash, switch, restore) | force (discard).
 *   gitOps4: changes in the way fail with detail overwritten; a smart checkout whose restore conflicts succeeds with
 *   detail conflicts; a remote branch whose local one exists brings it up to the remote one (fast-forward), or when
 *   that one has commits of its own fails with detail diverged unless `args.localCommits` rebase (onto the remote one)
 *   | drop (reset to it)
 * - pull: the upstream into the current branch, `args.mode` ff-only (default) | merge | rebase, stashing changes
 *   around a merge or rebase; a `branch` other than the current one is fast-forwarded without checking it out.
 *   gitOps4: `args.from` a remote branch (`origin/feat`) instead of the upstream, fetched first; changes stashed
 *   around every mode; detail updated
 * - commit: `paths` only (work tree relative; deletions and untracked files included) or everything when null, with
 *   `message`; `args.amend` rewrites the last commit (`paths` [] = only its message), refused when HEAD is no longer
 *   `args.expect` (gitOps4)
 * - push: local `branch` to `remote`, setting the upstream when missing; `args.force` = --force-with-lease, `args.tags`
 *   = all tags too. gitOps4: to the remote branch `args.target` (default: the upstream's branch when it is on `remote`,
 *   else the same name), always as explicit refs (`refs/heads/a:refs/heads/b`), never a refspec taken from input;
 *   `args.commit` pushes only up to that commit of the branch (`<hash>:refs/heads/b`), refused when it is not on it
 * - branch-create: new `branch` at `args.from` (default HEAD), switched to when `args.checkout`; gitOps4: `args.force`
 *   overwrites an existing one (not the current branch)
 * - branch-rename: `branch` to `args.name`
 * - branch-delete: `branch`, `args.force` even when unmerged; a remote-tracking `origin/x` deletes x on that remote
 * - merge: `branch` into the current one, `args.mode` default | no-ff | ff-only | squash, `args.noCommit`, `message`
 * - rebase: the current branch, or `branch` (switched to first), onto `args.onto`. gitOps4 `args.todo`: interactive, the
 *   current branch's `onto..HEAD` rewritten as listed (refused unless it lists each of those commits once, none a
 *   merge); reword and squash take their `message`; stops on conflicts as any rebase
 * - apply (gitOps4): `args.commit`'s changes to `paths` applied to the work tree, undone when `args.reverse`; conflicts
 *   left as markers (git apply --3way)
 * - restore (gitOps4): `paths` as they are at `args.commit`, written into the work tree (deleted when absent there)
 * - cherry-pick, revert: `args.commits`, oldest first
 * - reset: the current branch to `args.commit`, `args.mode` soft | mixed | hard | keep; gitOps4: `args.expect` = the
 *   HEAD it must still be at, refused otherwise (as with commit `args.amend`)
 * - discard: `paths` back to HEAD, untracked ones deleted; files added to the index are deleted too unless
 *   `args.keepAdded` (gitOps4), then only unstaged. gitOps4: `args.patch` (a `git diff` of the work tree against HEAD
 *   for the one path) reverts only those hunks, refused when it no longer applies
 * - add (gitOps4): untracked `paths` staged (`git add`)
 * - ignore (gitOps4): `paths` appended to the repo's root .gitignore as `/path` lines (glob characters escaped), the
 *   file created when missing
 * - stash: `message`, `args.untracked` too, only `paths` when given
 * - unstash: `stash@{args.stash}`, dropped when `args.pop`, `args.index` reinstating the index; with `branch`: as that
 *   new branch. gitOps4: `args.expect` = the stash commit it must still be, refused otherwise (the list moved)
 * - stash-drop: `stash@{args.stash}`, every stash without it; `args.expect` as unstash's
 * - tag-create: `args.name` at `args.from` (default HEAD), annotated with `message` when given
 * - tag-delete: `args.name`, on `remote` too when given (gitOps4: as `refs/tags/<name>`)
 * - tag-push: `args.name` to `remote` (gitOps4: as `refs/tags/<name>`)
 * - continue: the stopped merge / rebase / cherry-pick / revert, a merge commit with `message` when given
 * - abort, skip: the stopped operation
 * - resolve: `args.path` taking `args.side`, or written with `args.content`, then marked resolved; gitOps4: with
 *   `args.side`, `paths` as well
 * A merge, rebase, cherry-pick, revert, pull, unstash or continue that stops on conflicts fails with an error naming them
 * and leaves them to resolve. Pushes are never forced but by `args.force`.
 */
export const GitAction = z.object({
  t: z.literal('git.action'),
  ...gitTarget,
  repo: GitRepo,
  action: GitActionKind,
  branch: z.string().nullable(),
  remote: z.string().nullable(),
  message: z.string().nullable(),
  paths: z.array(z.string()).nullable().default(null),
  identity: z.object({ name: z.string(), email: z.string() }).nullable(),
  args: GitActionArgs.optional(),
})
export type GitAction = z.infer<typeof GitAction>

/**
 * Forks the ACP session `sessionId` (session/fork) in the bot's workspace directory, which is where the adapter keeps
 * the session; answered by session.fork.result with the new session's id.
 */
export const SessionFork = z.object({
  t: z.literal('session.fork'),
  requestId: z.string(),
  agent: AgentKind,
  groupId: z.string(),
  botId: z.string(),
  workspace: WorkspaceSpec,
  sessionId: z.string(),
})

/** Look for local clones of the group repo under the home dir, for confirming a joining bot's workspace. */
export const RepoFind = z.object({
  t: z.literal('repo.find'),
  requestId: z.string(),
  groupId: z.string(),
  botId: z.string(),
  repo: RepoSpec,
})

/** Which OPEN_APPS the machine has. */
export const AppsList = z.object({ t: z.literal('apps.list'), requestId: z.string() })
/** Open the bot's workspace in `app` on the machine (the daemon resolves the directory; no path is sent). */
export const WorkspaceOpen = z.object({
  t: z.literal('workspace.open'),
  requestId: z.string(),
  groupId: z.string(),
  botId: z.string(),
  workspace: WorkspaceSpec,
  app: z.string(),
})

/** 我的机器管理 → 日志: the newest `limit` daemon log lines at or below `level`. */
export const LogsGet = z.object({
  t: z.literal('logs.get'),
  requestId: z.string(),
  level: LogLevelName,
  limit: z.number().int().min(1).max(2000),
})

/** 我的机器管理 → 工作区: every workspace on the machine with its size. */
export const WorkspacesList = z.object({ t: z.literal('workspaces.list'), requestId: z.string() })

/** Deletes a removed or unused managed workspace (never a running one or a /cd dir), as the desktop app does. */
export const WorkspaceDelete = z.object({
  t: z.literal('workspace.delete'),
  requestId: z.string(),
  groupId: z.string(),
  botId: z.string(),
  path: z.string(),
})

/** Browse the machine's directories for the workspace picker; `path` null → the home dir. */
export const DirList = z.object({
  t: z.literal('dir.list'),
  requestId: z.string(),
  path: z.string().nullable(),
})

/** answers null → nobody answered in time: the tool tells the agent to proceed with recommendations (spec §8.8). */
export const QuestionAnswer = z.object({
  t: z.literal('question.answer'),
  runId: z.string(),
  requestId: z.string(),
  answers: z.array(Answer).nullable(),
  attachments: z.array(Attachment),
  answeredBy: z.string().nullable(),
})

/** 打断并追加 (spec §8.9): cancel the current prompt, keep edits, continue the same session with this text. */
export const RunAppend = z.object({
  t: z.literal('run.append'),
  runId: z.string(),
  text: z.string(),
  from: z.string(),
  attachments: z.array(Attachment),
})

/** Stop a hosted service (sidebar 停止, preview idle timeout); the daemon answers with service.state. */
export const ServiceStop = z.object({ t: z.literal('service.stop'), serviceId: z.string() })
/** Start a hosted service again as it was started (the card's 启动); answered by service.restart.result. */
export const ServiceRestart = z.object({
  t: z.literal('service.restart'),
  requestId: z.string(),
  serviceId: z.string(),
})
/**
 * The machine's open previews, replaced wholesale after welcome and on every change: the tunnel only forwards to
 * ports listed here (plan P9).
 */
export const PreviewsSync = z.object({
  t: z.literal('previews.sync'),
  previews: z.array(z.object({ id: z.string(), port: z.number().int().min(1).max(65535) })),
})

/**
 * A window to publish: a hosted service's (its process tree's largest window), or a mini program project's simulator
 * in the machine's WeChat devtools (absolute project dir; macOS only for now); at `fps`, which may change while it runs.
 */
export const CastTarget = z.union([
  z.object({ previewId: z.string(), service: z.string(), fps: z.number().int().positive() }),
  z.object({ previewId: z.string(), miniprogram: z.string(), fps: z.number().int().positive() }),
])
export type CastTarget = z.infer<typeof CastTarget>
/**
 * The live previews someone is watching on this machine, replaced wholesale: the daemon runs one gg-cast per entry
 * and stops the others (plan B2).
 */
export const CastSync = z.object({ t: z.literal('cast.sync'), casts: z.array(CastTarget) })
/** A viewer asks to try a failed live preview again now, e.g. once its window shows. */
export const CastRetry = z.object({ t: z.literal('cast.retry'), previewId: z.string() })

/**
 * Screenshot a version of an artifact whose bot runs here but which this machine did not make (a canvas edit, a
 * restore): the daemon fetches its files from the server into a temporary folder and uploads the thumbnail and the
 * screen PNGs (PUT /api/daemon/artifacts/:id/versions/:vid/…), as after a run. Feature `artifactSnapshot`.
 */
export const ArtifactSnapshot = z.object({
  t: z.literal('artifact.snapshot'),
  artifactId: z.string(),
  versionId: z.string(),
})

/** Status, install / upgrade (answered by tools.progress lines then tools.result) or mirror settings. */
export const ToolsCmd = z.object({
  t: z.literal('tools.cmd'),
  requestId: z.string(),
  action: z.enum(['status', 'install', 'upgrade', 'settings']),
  kind: ToolKind.optional(),
  version: z.string().regex(TOOL_VERSION).optional(),
  mirror: Mirror.optional(),
})
export type ToolsCmd = z.infer<typeof ToolsCmd>
/**
 * The machine's providers; answered by providers.result. `save` / `importLink` may carry a plaintext key (never
 * persisted or logged by the server). `use`: the machine default of `agent`, or with `botId` that bot's override
 * (`agent` = the bot's agentKind, `choice` also `inherit`). `catalog`: the models provider `id` declares.
 * `botCatalog`: what a new session of `botId` (absent: a new bot) on `agent` may pick, from the provider it would use —
 * the adapter's catalog when official (absent until probed), else the provider's declared models.
 */
export const ProvidersCmd = z.object({
  t: z.literal('providers.cmd'),
  requestId: z.string(),
  action: z.enum([
    'presets',
    'list',
    'save',
    'remove',
    'use',
    'importLink',
    'catalog',
    'botCatalog',
    'official',
    'agentSettings',
  ]),
  agent: AgentKind.optional(),
  botId: z.string().optional(),
  id: z.string().optional(),
  choice: z.string().optional(),
  provider: ProviderInput.optional(),
  /** For `official`, with `agent`. */
  official: OfficialInput.optional(),
  /** For `agentSettings`, with `agent`: replaces that agent kind's machine defaults. */
  agentSettings: AgentSettings.optional(),
  link: z.string().optional(),
  setDefault: z.boolean().optional(),
})
export type ProvidersCmd = z.infer<typeof ProvidersCmd>
/** Preview this machine's CC Switch providers (keys masked). */
export const CcSwitchRead = z.object({ t: z.literal('ccswitch.read'), requestId: z.string() })
/** Import the previewed `keys`; `setDefault` also makes CC Switch's current ones the machine defaults. */
export const CcSwitchApply = z.object({
  t: z.literal('ccswitch.apply'),
  requestId: z.string(),
  keys: z.array(z.string()),
  setDefault: z.boolean(),
})
/** Probe the agent's adapter for its models again now, e.g. after its CLI config was edited (feature `reprobe`). */
export const AgentsReprobe = z.object({
  t: z.literal('agents.reprobe'),
  requestId: z.string(),
  kind: AgentKind,
})

export const ServerToDaemon = z.discriminatedUnion('t', [
  DirList,
  AppsList,
  LogsGet,
  WorkspacesList,
  WorkspaceDelete,
  WorkspaceOpen,
  SessionFork,
  RepoFind,
  FilesList,
  FilesTree,
  FilesRead,
  FilesFind,
  GitRefs,
  GitLog,
  GitShow,
  GitChanges,
  GitBlame,
  GitStashes,
  GitConflictRead,
  GitTree,
  GitRead,
  GitCompare,
  GitDiff,
  GitRefresh,
  GitAction,
  WorkspaceDiff,
  QuestionAnswer,
  RunAppend,
  ApprovalDecision,
  RunDiscard,
  Welcome,
  Reject,
  RunStart,
  RunCancel,
  RunContinued,
  TaskStop,
  RunTier,
  WorkspaceEnsure,
  WorkspaceCd,
  RepoProbe,
  ServiceStop,
  ServiceRestart,
  PreviewsSync,
  CastSync,
  CastRetry,
  ArtifactSnapshot,
  ToolsCmd,
  ProvidersCmd,
  CcSwitchRead,
  CcSwitchApply,
  AgentsReprobe,
  SyncResult,
  SyncAvailable,
  SyncAction,
  SyncInit,
])
export type ServerToDaemon = z.infer<typeof ServerToDaemon>
