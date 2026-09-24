import { z } from 'zod'
import { AgentKind, Answer, Attachment, GitStatus, Question, RunStatus, Tier, Usage } from './common.js'

/** Bumped on any breaking change of the daemon <-> server wire format. */
export const PROTOCOL_VERSION = 1

export const AgentInfo = z.object({
  kind: AgentKind,
  available: z.boolean(),
  version: z.string().nullable(),
  path: z.string().nullable(),
  /** Oldest CLI version the bundled ACP adapter supports; older ones still run but the bot shows a warning. */
  minVersion: z.string().nullable().default(null),
})
export type AgentInfo = z.infer<typeof AgentInfo>

export const MachineInfo = z.object({
  name: z.string().min(1),
  os: z.enum(['macos', 'linux', 'windows']),
  arch: z.string(),
})
export type MachineInfo = z.infer<typeof MachineInfo>

// ── REST: POST /api/daemon/login (bind code → long-lived machine token) ──────
export const DaemonLoginReq = z.object({ code: z.string(), machine: MachineInfo })
export const DaemonLoginRes = z.object({ token: z.string(), machineId: z.string(), ownerName: z.string() })
export type DaemonLoginRes = z.infer<typeof DaemonLoginRes>

// ── REST for the daemon / desktop app (machine token, `Authorization: Bearer`) ─
/** POST /api/daemon/net: a measured round trip + throughput to the server. */
export const NetReportReq = z.object({ latencyMs: z.number().min(0), bandwidthMbps: z.number().min(0) })
/** GET /api/daemon/net/probe?bytes=N streams N random bytes for the bandwidth measurement (max 16 MiB). */
export const NET_PROBE_MAX_BYTES = 16 * 1024 * 1024
/** PATCH /api/daemon/bots/:id: the bot owner changes the concurrency from the desktop app (spec §4.7). */
export const DaemonBotPatchReq = z.object({ concurrency: z.number().int().min(1).max(8) })
/**
 * POST /api/daemon/runs/:runId/tools/:name: an aiws MCP tool call made during that run (see tools.ts). Tool-level
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

export const RepoSpec = z.object({ id: z.string(), url: z.string(), branch: z.string() })

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
    /** Messages since the last @ left out of `context` (over `contextInlineMax`); the agent reads them with aiws tools. */
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
})
export type RunStart = z.infer<typeof RunStart>

/** Incremental process events streamed while a run is in progress. */
export const RunEvent = z.discriminatedUnion('kind', [
  z.object({ kind: z.literal('status'), status: RunStatus, step: z.string() }),
  z.object({ kind: z.literal('text'), delta: z.string() }),
  z.object({ kind: z.literal('thought'), delta: z.string() }),
  z.object({
    kind: z.literal('tool'),
    toolCallId: z.string(),
    title: z.string(),
    /** ACP ToolKind: read | edit | delete | move | search | execute | think | fetch | other */
    toolKind: z.string(),
    status: z.enum(['pending', 'in_progress', 'completed', 'failed']),
    /** Redaction happens server-side before persistence. */
    detail: z.string().optional(),
  }),
  z.object({ kind: z.literal('usage'), usage: Usage }),
])
export type RunEvent = z.infer<typeof RunEvent>

// ── daemon → server ─────────────────────────────────────────────────────────
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
})
export type WorkspaceState = z.infer<typeof WorkspaceState>

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

/** Local agent detection changed after hello (path set / reset, re-check); replaces the machine's agents. */
export const AgentsUpdate = z.object({ t: z.literal('agents.update'), agents: z.array(AgentInfo) })

/** Answer to files.list. */
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

export const DaemonToServer = z.discriminatedUnion('t', [
  AgentsUpdate,
  CommandsUpdate,
  DirResult,
  FilesResult,
  QuestionAsk,
  ApprovalRequest,
  RunDiscarded,
  Hello,
  Heartbeat,
  RunEventMsg,
  RunDone,
  WorkspaceState,
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

export const ServerToDaemon = z.discriminatedUnion('t', [
  DirList,
  FilesList,
  QuestionAnswer,
  RunAppend,
  ApprovalDecision,
  RunDiscard,
  Welcome,
  Reject,
  RunStart,
  RunCancel,
  WorkspaceEnsure,
  WorkspaceCd,
])
export type ServerToDaemon = z.infer<typeof ServerToDaemon>
