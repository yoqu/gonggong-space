import { z } from 'zod'
import { AgentSettingValues } from '../agent-settings.js'
import { ArtifactDir, DaemonArtifactRef } from '../artifacts.js'
import {
  AgentKind,
  Approval,
  Attachment,
  ContextBreakdown,
  ContextUsage,
  RunStatus,
  Tier,
  Usage,
} from '../common.js'
import { RunSyncStart } from '../sync.js'

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
/**
 * Plugin files for a run (plan 插件体系-方案); the daemon fetches them by `versionId`, cached by `digest`. `mcp`: its
 * MCP servers with secrets filled in, only to daemons with `pluginMcp`; the daemon replaces `{node}` and `{pkg}` in
 * stdio `command`, `args` and `env` and adds them to the run's servers.
 */
export const PluginRef = z.object({
  name: z.string(),
  versionId: z.string(),
  digest: z.string(),
  mcp: z.array(McpServer).default([]),
})
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
  /**
   * The group's extra repos besides `repo`: each cloned to its own managed path (as `repo` would be), and added to the
   * session like `extraDirs`. Older daemons ignore them.
   */
  extraRepos: z.array(RepoSpec).optional(),
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
    /** 帮我审批: the daemon's rules trust more on their own (or the agent's own reviewer decides); the rest asks. */
    aiReview: z.boolean().default(false),
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

export const PlanItem = z.object({
  content: z.string(),
  status: z.enum(['pending', 'in_progress', 'completed']),
})
export type PlanItem = z.infer<typeof PlanItem>
/** The daemon sends a plan's first 100 entries, each clipped to 500 characters. */
export const PLAN_MAX_ENTRIES = 100

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
    /** A web search or page fetch: its query or URL and the pages a search found (redacted like `detail`). */
    web: z
      .object({
        query: z.string().optional(),
        url: z.string().optional(),
        hits: z.array(z.object({ title: z.string(), url: z.string() })).optional(),
      })
      .optional(),
  }),
  /** `usage` carries what the run spent (cost so far); `context` is occupancy, never folded into `usage`. */
  /** `breakdown` comes at the end of a run with its last `context`, and as `live` snapshots while it runs. */
  z.object({
    kind: z.literal('usage'),
    usage: Usage,
    context: ContextUsage.optional(),
    breakdown: ContextBreakdown.optional(),
  }),
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
  /** The main agent's plan (ACP `plan`, e.g. Claude's todos), whole on every change; no entries = cleared. */
  z.object({ kind: z.literal('plan'), entries: z.array(PlanItem).max(PLAN_MAX_ENTRIES) }),
])
export type RunEvent = z.infer<typeof RunEvent>
