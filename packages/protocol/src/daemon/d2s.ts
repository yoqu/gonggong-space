import { z } from 'zod'
import { RunSettingsSnapshot } from '../agent-settings.js'
import {
  AiReview,
  ApprovalMcp,
  DevtoolsBlocker,
  DiffRepo,
  GitStatus,
  Permission,
  Question,
  Usage,
} from '../common.js'
import { RunSyncDone, SyncApplied, SyncState, SyncSubmit } from '../sync.js'
import { AgentState, RuntimeState } from './agent-state.js'
import {
  AgentsReprobeResult,
  BotsProviderState,
  CcSwitchCandidate,
  DiagResult,
  GitAccessResult,
  ProviderPreset,
  ProviderStoreView,
  ToolsProgress,
  ToolsSettings,
  UpgradeResult,
} from './agent-tools.js'
import { ConnectorsAuth, ConnectorsProgress, ConnectorsResult, ConnectorsUpdate } from './connectors.js'
import {
  FilesReadResult,
  FilesTreeResult,
  GitActionResult,
  GitBlameResult,
  GitChangesResult,
  GitCompareResult,
  GitConflictResult,
  GitDiffResult,
  GitLogResult,
  GitReadResult,
  GitRefreshResult,
  GitRefsResult,
  GitShowResult,
  GitStashesResult,
  GitTreeResult,
} from './git.js'
import {
  LegacyCcSwitchCandidate,
  LegacyProviderPreset,
  LegacyProviderStoreView,
  LegacyToolStatus,
} from './legacy.js'
import { AgentCatalog, MachineInfo } from './machine.js'
import { RepoAccessReason, RunEvent } from './run-payloads.js'

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
  agents: z.array(AgentState),
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
    .enum([
      'high_risk',
      'protected_base',
      'network',
      'write',
      'unparsed',
      'not_allowed',
      'ai_denied',
      'ai_timeout',
      'ai_unparsed',
      'ai_error',
    ])
    .default('not_allowed'),
  options: z.array(PermissionOption),
  /** Rules an allow_always answer adds to the bot's alwaysAllow; empty → the scope can't be shown, so don't offer it. */
  remember: z.array(z.string()).default([]),
  /** Rules a 本次会话不再问 answer trusts until the agent session ends; empty → don't offer it. */
  rememberSession: z.array(z.string()).default([]),
  /** The AI pre-review's assessment: only daemons before its removal send one (and the `ai_*` reasons). */
  review: AiReview.nullable().default(null),
  /** Set when the request is an MCP tool call; older daemons omit it. */
  mcp: ApprovalMcp.nullable().default(null),
})
export type ApprovalRequest = z.infer<typeof ApprovalRequest>

/** A request the bot's rules allowed without asking the owner (or, from older daemons, their AI pre-review): audited. */
export const ApprovalAiApproved = z.object({
  t: z.literal('approval.ai_approved'),
  runId: z.string(),
  title: z.string(),
  toolKind: z.string(),
  /** Command line / path / URL, as an approval.request would show it. */
  detail: z.string(),
  source: z.enum(['ai', 'rule']).default('ai'),
  /** The AI pre-review's assessment; null when the rules allowed it. */
  review: AiReview.nullable().default(null),
})
export type ApprovalAiApproved = z.infer<typeof ApprovalAiApproved>

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
 * The files of a checked-out artifact (RunStart.artifacts) the agent wrote, added or deleted since this turn checked
 * it out, as paths in the artifact folder (plan 原型协作 P1): the whole set, sent again whenever it changes while the
 * turn runs. Only shown live; the server keeps nothing once the run ends.
 */
export const ArtifactActivity = z.object({
  t: z.literal('artifact.activity'),
  runId: z.string(),
  artifactId: z.string(),
  paths: z.array(z.string().max(500)).max(500),
})
export type ArtifactActivity = z.infer<typeof ArtifactActivity>

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
export const AgentsUpdate = z.object({ t: z.literal('agents.update'), agents: z.array(AgentState) })

/*
 * Answers about agents and providers. Daemons without `agentState` / `protocolProviders` answer in the legacy.ts
 * shapes; the server normalizes them (normalizeStoreView, normalizePresets, normalizeCandidate, agentStatesFromLegacy).
 */
export const ToolsResult = z.object({
  t: z.literal('tools.result'),
  requestId: z.string(),
  ok: z.boolean(),
  error: z.string().nullable(),
  /** Only from daemons without `agentState`. */
  tools: z.array(LegacyToolStatus).default([]),
  node: RuntimeState.nullable().default(null),
  agents: z.array(AgentState).default([]),
  settings: ToolsSettings,
})
export type ToolsResult = z.infer<typeof ToolsResult>
const AnyStoreView = z.union([ProviderStoreView, LegacyProviderStoreView])
export const ProvidersResult = z.object({
  t: z.literal('providers.result'),
  requestId: z.string(),
  ok: z.boolean(),
  error: z.string().nullable(),
  view: AnyStoreView.optional(),
  presets: z.array(z.union([ProviderPreset, LegacyProviderPreset])).optional(),
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
  candidates: z.array(z.union([CcSwitchCandidate, LegacyCcSwitchCandidate])),
  /** Local ids written by ccswitch.apply. */
  imported: z.array(z.string()),
  view: AnyStoreView.optional(),
})
export type CcSwitchResult = z.infer<typeof CcSwitchResult>

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
  /** When a turn last worked in it (ms since epoch); null when never recorded or a /cd dir, absent from older daemons. */
  lastUsedAt: z.number().int().nullable().default(null),
  /** Work not on any remote yet: changed files and local-only commits; null without a repo or for /cd dirs. */
  changes: z
    .object({ uncommitted: z.number().int().nonnegative(), unpushed: z.number().int().nonnegative() })
    .nullable()
    .default(null),
})
export type MachineWorkspace = z.infer<typeof MachineWorkspace>

/** Answer to workspaces.list. */
export const WorkspacesResult = z.object({
  t: z.literal('workspaces.result'),
  requestId: z.string(),
  entries: z.array(MachineWorkspace),
  /** The volume holding the daemon home, in bytes; null when unreadable, absent from older daemons. */
  disk: z
    .object({ free: z.number().int().nonnegative(), total: z.number().int().nonnegative() })
    .nullable()
    .default(null),
  error: z.string().nullable(),
})

/** Answer to workspace.delete. */
export const WorkspaceDeleteResult = z.object({
  t: z.literal('workspace.delete.result'),
  requestId: z.string(),
  error: z.string().nullable(),
})

/** Answer to workspace.gc: the workspace's bytes on disk before and after. */
export const WorkspaceGcResult = z.object({
  t: z.literal('workspace.gc.result'),
  requestId: z.string(),
  before: z.number().int().nonnegative(),
  after: z.number().int().nonnegative(),
  error: z.string().nullable(),
})

/** One subdirectory in a listing; `modified` in ms since epoch, null when unreadable or from an older daemon. */
export const DirEntry = z.object({
  name: z.string(),
  git: z.boolean(),
  modified: z.number().int().nullable().default(null),
})
export type DirEntry = z.infer<typeof DirEntry>

/** A quick location of the picker, like Finder's sidebar; the web names the user folders by `kind`. */
export const DirPlace = z.object({
  kind: z.enum(['home', 'desktop', 'documents', 'downloads', 'volume']),
  name: z.string(),
  path: z.string(),
})
export type DirPlace = z.infer<typeof DirPlace>

/** Answer to dir.create: the new directory's absolute path. */
export const DirCreateResult = z.object({
  t: z.literal('dir.create.result'),
  requestId: z.string(),
  path: z.string().nullable(),
  error: z.string().nullable(),
})

/** Answer to dir.list. */
export const DirResult = z.object({
  t: z.literal('dir.result'),
  requestId: z.string(),
  /** Absolute path listed (the home dir when the request had none). */
  path: z.string(),
  /** Immediate subdirectories, hidden ones skipped; `git` = the subdirectory is a work tree root. */
  entries: z.array(DirEntry),
  /** Repo containing `path`, if any. */
  git: z.object({ root: z.string(), remotes: z.array(z.string()), branch: z.string().nullable() }).nullable(),
  /** Why `path` cannot be a workspace (root, home, system dir, …); null = usable. */
  unusable: z.string().nullable(),
  /** Filesystem roots to browse from (Windows drives, `/` elsewhere); older daemons omit it. */
  roots: z.array(z.string()).default([]),
  /** The picker's sidebar: the user's folders and mounted volumes that exist; older daemons omit it. */
  places: z.array(DirPlace).default([]),
  /** The daemon answers dir.create; false from older daemons. */
  canCreate: z.boolean().default(false),
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
/** Answer to site.host once the version is up; `error` in the daemon's words. */
export const SiteHostResult = z.object({
  t: z.literal('site.host.result'),
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
  AppsListResult,
  LogsResult,
  WorkspacesResult,
  WorkspaceDeleteResult,
  WorkspaceGcResult,
  WorkspaceOpenResult,
  SessionForkResult,
  CommandsUpdate,
  DirResult,
  DirCreateResult,
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
  ApprovalAiApproved,
  RunDiscarded,
  RunContinue,
  ArtifactActivity,
  SessionConfig,
  Hello,
  Heartbeat,
  RunEventMsg,
  RunDone,
  WorkspaceState,
  RepoProbeResult,
  ServiceState,
  ServiceRestartResult,
  SiteHostResult,
  CastState,
  ToolsProgress,
  ToolsResult,
  ConnectorsProgress,
  ConnectorsAuth,
  ConnectorsResult,
  ConnectorsUpdate,
  ProvidersResult,
  CcSwitchResult,
  AgentsReprobeResult,
  GitAccessResult,
  DiagResult,
  UpgradeResult,
  BotsProviderState,
  SyncSubmit,
  SyncApplied,
  SyncState,
])
export type DaemonToServer = z.infer<typeof DaemonToServer>
