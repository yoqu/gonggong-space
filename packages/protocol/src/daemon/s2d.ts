import { z } from 'zod'
import { AgentSettings } from '../agent-settings.js'
import { AgentKind, Answer, Attachment, Tier } from '../common.js'
import { SyncAction, SyncAvailable, SyncInit, SyncResult } from '../sync.js'
import {
  Mirror,
  OfficialInput,
  ProviderInput,
  ProviderPreset,
  TOOL_VERSION,
  ToolKind,
} from './agent-tools.js'
import { ConnectorsCmd, ConnectorsSync } from './connectors.js'
import { LogLevelName } from './d2s.js'
import {
  GitAction,
  GitBlame,
  GitChanges,
  GitCompare,
  GitConflictRead,
  GitDiff,
  GitLog,
  GitRead,
  GitRefresh,
  GitRefs,
  GitShow,
  GitStashes,
  GitTree,
} from './git.js'
import { LegacyProviderInput, LegacyProviderPreset } from './legacy.js'
import { GitProtocol, RepoSpec, RunStart, WorkspaceSpec } from './run-payloads.js'

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

/** Group and Bot names a managed workspace's directory is named after when the daemon first places it. */
export const WorkspaceNames = z.object({ group: z.string(), bot: z.string() })

/** Create (clone) the managed workspace when a bot joins a group, or re-create it after the group binds a repo. */
export const WorkspaceEnsure = z.object({
  t: z.literal('workspace.ensure'),
  requestId: z.string(),
  groupId: z.string(),
  botId: z.string(),
  repo: RepoSpec.nullable(),
  /** The group's extra repos, cloned beside `repo` (see WorkspaceSpec.extraRepos). */
  extraRepos: z.array(RepoSpec).optional(),
  names: WorkspaceNames.optional(),
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
  names: WorkspaceNames.optional(),
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
  /** 本次会话不再问: the daemon trusts the request's rememberSession rules until the session ends. */
  session: z.boolean().optional(),
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
  names: WorkspaceNames.optional(),
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

/** 空间 → 瘦身: `git gc --prune=now` in a managed workspace no turn is in (needs storageAdmin). */
export const WorkspaceGc = z.object({
  t: z.literal('workspace.gc'),
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
  /** List dot-directories too (a Claude config dir is usually `~/.claude*`); older daemons ignore it. */
  hidden: z.boolean(),
})

/** The picker's 新建文件夹: makes `name` (one path segment) in `parent`; only when dir.result said canCreate. */
export const DirCreate = z.object({
  t: z.literal('dir.create'),
  requestId: z.string(),
  parent: z.string(),
  name: z.string(),
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
  /** The artifact's plugin: its installed version's shell (manifest `artifact.kit`) frames the screens. */
  plugin: z.string().nullable().default(null),
})
/**
 * 托管到服务器 on a static preview's card: the daemon uploads the dir its static service `serviceId` serves as a new
 * version of the site artifact (POST /api/daemon/artifacts/:id/…), answered by site.host.result. Feature `siteHost`.
 */
export const SiteHost = z.object({
  t: z.literal('site.host'),
  requestId: z.string(),
  serviceId: z.string(),
  artifactId: z.string(),
})
/**
 * Provider presets from platform-layer plugins (plan 插件扩展点 §6), sent on connect and whenever they change to
 * daemons with `presetSync`: the daemon lists them with its built-in ones, the same id replacing a built-in. Daemons
 * without `protocolProviders` get them through presetsToLegacy (same (agent, id) replacing).
 */
export const PresetsSync = z.object({
  t: z.literal('presets.sync'),
  presets: z.array(z.union([ProviderPreset, LegacyProviderPreset])),
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
 * (`agent` = the bot's agentKind, `choice` also `inherit`); `model` for the machine default only. `catalog`: the
 * models provider `id` declares for `agent`. `botCatalog`: what a new session of `botId` (absent: a new bot) on `agent`
 * may pick, from the provider it would use — the adapter's catalog when official (absent until probed), else the
 * provider's declared models. Daemons without `protocolProviders` get a LegacyProviderInput and no `model`.
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
  /** null = the endpoint's model (else the adapter's default). */
  model: z.string().nullable().optional(),
  // Legacy first: every ProviderInput field is optional, so it would also take (and strip) an old one.
  provider: z.union([LegacyProviderInput, ProviderInput]).optional(),
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

export const GitTokenInput = z.object({
  host: z
    .string()
    .trim()
    .regex(/^[A-Za-z0-9.-]+(:\d+)?$/, '主机名只能包含字母、数字、点、短横线和端口'),
  username: z.string().trim().min(1).max(200),
  secret: z.string().trim().min(1).max(4096),
})
export type GitTokenInput = z.infer<typeof GitTokenInput>
/**
 * The machine's git access (feature `gitAccess`), answered by gitaccess.result. `saveToken` carries a plaintext
 * token: the server never persists or logs it.
 */
export const GitAccessCmd = z.object({
  t: z.literal('gitaccess.cmd'),
  requestId: z.string(),
  action: z.enum(['status', 'genKey', 'saveToken', 'removeToken', 'test', 'trustHost']),
  token: GitTokenInput.optional(),
  /** For removeToken / trustHost. */
  host: z.string().optional(),
  /** For test. */
  url: z.string().optional(),
})
export type GitAccessCmd = z.infer<typeof GitAccessCmd>
/** Run `gg doctor`'s checks (feature `diag`), answered by diag.result. */
export const DiagRun = z.object({ t: z.literal('diag.run'), requestId: z.string() })
/** Download `upgrade` now and restart into it once idle (feature `upgrade`), answered by upgrade.result. */
export const UpgradeStart = z.object({
  t: z.literal('upgrade.start'),
  requestId: z.string(),
  upgrade: UpgradeInfo,
})

export const ServerToDaemon = z.discriminatedUnion('t', [
  DirList,
  DirCreate,
  AppsList,
  LogsGet,
  WorkspacesList,
  WorkspaceDelete,
  WorkspaceGc,
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
  SiteHost,
  PresetsSync,
  ToolsCmd,
  ConnectorsCmd,
  ConnectorsSync,
  ProvidersCmd,
  CcSwitchRead,
  CcSwitchApply,
  AgentsReprobe,
  GitAccessCmd,
  DiagRun,
  UpgradeStart,
  SyncResult,
  SyncAvailable,
  SyncAction,
  SyncInit,
])
export type ServerToDaemon = z.infer<typeof ServerToDaemon>
