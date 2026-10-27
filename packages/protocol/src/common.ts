import { z } from 'zod'

export { compareVersions } from './version.js'

export const AgentKind = z.enum(['claude', 'codex'])
export type AgentKind = z.infer<typeof AgentKind>

export const Tier = z.enum(['full', 'workspace', 'read-only'])
export type Tier = z.infer<typeof Tier>

/** 命令审批: what happens to permission requests beyond the bot's tier; set by the bot owner only. */
export const Approval = z.enum(['ask', 'allowlist', 'all'])
export type Approval = z.infer<typeof Approval>
/** Command prefixes auto-approved in `allowlist` mode, e.g. `go build`. */
export const Allowlist = z.array(z.string().trim().min(1).max(200)).max(100)

export const TriggerScope = z.enum(['all', 'list', 'self'])
export type TriggerScope = z.infer<typeof TriggerScope>

/** Run card states (plan D2). */
export const RunStatus = z.enum([
  'queued',
  'offline_wait',
  'forbidden',
  'running',
  'awaiting_approval',
  'awaiting_answer',
  'completed',
  'interrupted',
  'expired',
])
export type RunStatus = z.infer<typeof RunStatus>
export const TERMINAL_RUN_STATUS: readonly RunStatus[] = ['forbidden', 'completed', 'interrupted', 'expired']
/** Minutes a request for an offline bot waits before it expires (spec §4.8); groups override via params.offlineWaitMin. */
export const DEFAULT_OFFLINE_WAIT_MIN = 30

export const Usage = z.object({
  inputTokens: z.number().int().optional(),
  outputTokens: z.number().int().optional(),
  totalTokens: z.number().int().optional(),
  costUsd: z.number().optional(),
})
export type Usage = z.infer<typeof Usage>

/** Context window occupancy of an ACP session (usage_update): tokens in context now vs the model's window. */
/** `compactAt`: tokens at which the agent compacts by itself, when the daemon knows it. */
/** `blockAt`: auto-compaction is off; the agent stops here until compacted by hand (/compact or /new). */
export const ContextUsage = z.object({
  used: z.number().int(),
  size: z.number().int(),
  compactAt: z.number().int().optional(),
  blockAt: z.number().int().optional(),
})
export type ContextUsage = z.infer<typeof ContextUsage>

/** Where a repo sits in a workspace: the root itself, a git submodule, or an independent repo found below a non-git root. */
/** `extra`: an additional directory of the session (its repo's `path` is the directory's absolute path). */
export const RepoKind = z.enum(['root', 'submodule', 'nested', 'extra'])
export type RepoKind = z.infer<typeof RepoKind>

/** Git state of one repo inside a workspace other than the root; `path` is relative to the workspace root. */
export const RepoStatus = z.object({
  path: z.string(),
  kind: RepoKind,
  branch: z.string().nullable(),
  ahead: z.number().int().nullable(),
  behind: z.number().int().nullable(),
  dirty: z.boolean(),
})
export type RepoStatus = z.infer<typeof RepoStatus>

/** One repo's share of a workspace patch; its files are the patch paths under `path/` ('' = the root repo). */
export const DiffRepo = z.object({
  path: z.string(),
  kind: RepoKind,
  branch: z.string().nullable(),
  /** Main branch this repo is compared against (scope base); null when it is on it or the scope has no base. */
  base: z.string().nullable(),
  /** The workspace patch hit its size cap before (all of) this repo's changes. */
  truncated: z.boolean(),
})
export type DiffRepo = z.infer<typeof DiffRepo>

/** A merge, rebase, cherry-pick or revert that stopped midway (conflicts, or a commit left to make). */
export const GitOngoingKind = z.enum(['merge', 'rebase', 'cherry-pick', 'revert'])
export type GitOngoingKind = z.infer<typeof GitOngoingKind>

/** Partition-mode git state of one (group, bot) workspace, refreshed after every turn (spec §5.3). */
export const GitStatus = z.object({
  /** null when detached (see `head`) or when the root is not a repo. */
  branch: z.string().nullable(),
  /** null when the branch has no upstream. */
  ahead: z.number().int().nullable(),
  behind: z.number().int().nullable(),
  dirty: z.boolean(),
  /** Uncommitted files of the root work tree; absent from older daemons. */
  dirtyCount: z.number().int().optional(),
  /** Uncommitted added/deleted lines, including untracked files; absent from older daemons. */
  additions: z.number().int().optional(),
  deletions: z.number().int().optional(),
  /** When the daemon took the status; absent from older daemons. */
  checkedAt: z.string().optional(),
  workspace: z.enum(['managed', 'cd']),
  /** Submodules and nested repos (not the root), outermost first; the root fields are null/false when the root is not a repo. */
  repos: z.array(RepoStatus).default([]),
  // The root repo's, from daemons with gitOps3 (absent otherwise):
  /** HEAD's short hash; absent on an unborn branch. */
  head: z.string().optional(),
  /** What stopped midway; absent when nothing is in progress. */
  ongoing: GitOngoingKind.optional(),
  /** Unmerged paths. */
  conflicts: z.number().int().optional(),
  stashes: z.number().int().optional(),
})
export type GitStatus = z.infer<typeof GitStatus>

/** A file attached to a message (spec §8.7): ≤ MAX_ATTACHMENT_BYTES each, ≤ MAX_ATTACHMENTS per message. */
export const Attachment = z.object({
  id: z.string(),
  name: z.string(),
  size: z.number().int(),
  mime: z.string(),
  /** Message that carries it; the daemon writes it to `<workspace>/.gonggong/attachments/<messageId>/<name>`. */
  messageId: z.string(),
})
export type Attachment = z.infer<typeof Attachment>
export const MAX_ATTACHMENT_BYTES = 50 * 1024 * 1024
export const MAX_ATTACHMENTS = 10

/** Built-in "向群成员提问" tool (spec §8.8): ≤ 4 questions per card. */
export const Question = z.object({
  id: z.string(),
  type: z.enum(['single', 'multi', 'yesno', 'text']),
  title: z.string(),
  options: z.array(z.string()),
  /** Index into options for choice questions. */
  recommended: z.number().int().nullable(),
  /**
   * Design-enhanced options (plan 插件体系-方案 §5), aligned with `options` by index: a short description, colour
   * swatches, or an image (a workspace-relative path). Absent = plain options, as before.
   */
  optionMeta: z
    .array(
      z.object({
        description: z.string().max(120).nullable().default(null),
        swatch: z
          .array(z.string().regex(/^#[0-9a-fA-F]{6}$/))
          .max(6)
          .default([]),
        image: z.string().max(500).nullable().default(null),
      }),
    )
    .optional(),
})
export type Question = z.infer<typeof Question>
export const MAX_QUESTIONS = 4

export const Answer = z.object({
  questionId: z.string(),
  /** Selected option indexes (single/multi/yesno). */
  choices: z.array(z.number().int()),
  /** 「其他，我来补充」 for choice questions, or the answer of a text question. */
  text: z.string().nullable(),
})
export type Answer = z.infer<typeof Answer>

/** macOS privacy permissions the desktop previews need, held by the app running the daemon (gg-cast inherits them). */
export const Permission = z.enum(['screen_recording', 'accessibility'])
export type Permission = z.infer<typeof Permission>

/**
 * What the machine owner must do in the WeChat devtools before a mini program shows: port = turn on 设置 → 安全设置 →
 * 服务端口; auth = allow Gonggong in the authorization dialog; trust = press 「信任并运行」 for the project.
 */
export const DevtoolsBlocker = z.enum(['port', 'auth', 'trust'])
export type DevtoolsBlocker = z.infer<typeof DevtoolsBlocker>

/** A one-shot pick for one message or a scheduled task; an absent field follows the defaults, null = the adapter's default. */
export const RunConfigPick = z.object({
  model: z.string().nullable().optional(),
  effort: z.string().nullable().optional(),
})
export type RunConfigPick = z.infer<typeof RunConfigPick>
