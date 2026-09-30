import { z } from 'zod'
import {
  AgentKind,
  Answer,
  Approval,
  Attachment,
  ContextUsage,
  DevtoolsBlocker,
  GitStatus,
  Permission,
  Question,
  RunStatus,
  Tier,
  Usage,
} from './common.js'

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
    /** Messages since the last @ left out of `context` (over `contextInlineMax`); the agent reads them with gonggong tools. */
    omitted: z.number().int().min(0),
    /** Last N group messages, replayed only if resuming `resumeSessionId` fails. Empty when not resuming. */
    fallbackContext: z.array(ContextMessage),
    /** Files of the trigger message: written into the workspace; images also sent as ACP image content if supported. */
    attachments: z.array(Attachment),
    /** Quoted bot message / run card (spec §8.6: quoting a bot = @ it, the quoted content is sent along). */
    quote: z.object({ author: z.string(), body: z.string() }).nullable(),
  }),
  /** Global MCP servers (spec §7.2, P1 global layer), injected on session creation only (§7.4). */
  mcpServers: z.array(McpServer),
  /** An agent command (`/compact …`): sent verbatim as the prompt so the adapter runs it; `prompt` is not composed. */
  command: z.string().nullable().default(null),
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
  z.object({ kind: z.literal('usage'), usage: Usage, context: ContextUsage.optional() }),
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
  /** run.append messages actually fed into this run; the server queues the rest as new runs (spec §8.9 fallback). */
  appendsApplied: z.number().int(),
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
  options: z.array(PermissionOption),
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

export const FilesResult = z.object({
  t: z.literal('files.result'),
  requestId: z.string(),
  entries: z.array(z.object({ path: z.string(), dir: z.boolean(), uncommitted: z.boolean() })),
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

export const DaemonToServer = z.discriminatedUnion('t', [
  AgentsUpdate,
  CommandsUpdate,
  DirResult,
  FilesResult,
  FilesTreeResult,
  FilesReadResult,
  WorkspaceDiffResult,
  QuestionAsk,
  QuestionWithdraw,
  ApprovalRequest,
  RunDiscarded,
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
])
export type DaemonToServer = z.infer<typeof DaemonToServer>

// ── server → daemon ─────────────────────────────────────────────────────────
/** Published daemon build for this machine's OS/arch (plan D17); the daemon verifies sha256 before replacing itself. */
export const UpgradeInfo = z.object({ version: z.string(), url: z.string(), sha256: z.string() })
export type UpgradeInfo = z.infer<typeof UpgradeInfo>

export const Welcome = z.object({
  t: z.literal('welcome'),
  machineId: z.string(),
  heartbeatSec: z.number().int(),
  /** Newer build available; null when up to date or none published. */
  upgrade: UpgradeInfo.nullable(),
  /** This server serves previews: the daemon opens `/ws/daemon/tunnel` (older servers leave it out). */
  tunnel: z.boolean().default(false),
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

export const ServerToDaemon = z.discriminatedUnion('t', [
  DirList,
  FilesList,
  FilesTree,
  FilesRead,
  WorkspaceDiff,
  QuestionAnswer,
  RunAppend,
  ApprovalDecision,
  RunDiscard,
  Welcome,
  Reject,
  RunStart,
  RunCancel,
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
])
export type ServerToDaemon = z.infer<typeof ServerToDaemon>
