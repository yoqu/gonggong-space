import { z } from 'zod'
import {
  AgentKind,
  Answer,
  Attachment,
  GitStatus,
  MAX_ATTACHMENT_BYTES,
  MAX_ATTACHMENTS,
  MAX_QUESTIONS,
  Question,
  RunStatus,
  Tier,
  TriggerScope,
  Usage,
} from './common.js'
import {
  AgentCatalog,
  AgentInfo,
  DiffScope,
  MachineInfo,
  McpServer,
  PermissionOption,
  RunEvent,
} from './daemon.js'

/** REST base: /api. Auth: httpOnly cookie `gonggong_session`. Errors: { error: ErrorCode, message }. */
export const ErrorCode = z.enum([
  'unauthorized',
  'forbidden',
  'not_found',
  'invalid',
  'conflict',
  'must_change_password',
  'code_expired',
  'code_locked',
  /** POST /api/messages/:id/recall past RECALL_WINDOW_MS. */
  'recall_expired',
])
export const ApiError = z.object({ error: ErrorCode, message: z.string() })

// ── Users & auth ────────────────────────────────────────────────────────────
export const Role = z.enum(['sysadmin', 'member'])
export const UserDto = z.object({
  id: z.string(),
  account: z.string(),
  name: z.string(),
  role: Role,
  mustChangePassword: z.boolean(),
  disabled: z.boolean(),
})
export type UserDto = z.infer<typeof UserDto>

export const LoginReq = z.object({ account: z.string(), password: z.string() })
export const ChangePasswordReq = z.object({ oldPassword: z.string(), newPassword: z.string().min(8) })
/** Minimal user reference for pickers (GET /api/users). */
export const UserBriefDto = z.object({ id: z.string(), name: z.string(), account: z.string() })
export type UserBriefDto = z.infer<typeof UserBriefDto>
/** GET /api/users/:id/card?groupId= — hover card; `groupAdmin` is for `groupId`, `online` = has a live web session. */
export const UserCardDto = UserBriefDto.extend({ role: Role, groupAdmin: z.boolean(), online: z.boolean() })
export type UserCardDto = z.infer<typeof UserCardDto>

const Account = z.string().regex(/^[a-z0-9_.-]{2,32}$/)
export const CreateUserReq = z.object({
  account: Account,
  name: z.string().min(1),
  role: Role,
  password: z.string().min(8),
})
/** POST /api/auth/register — self sign-up, only while the sysadmin has opened it (系统参数 · 开放注册). */
export const RegisterReq = z.object({
  account: Account,
  name: z.string().trim().min(1).max(40),
  password: z.string().min(8),
})
/** GET /api/auth/options — public: what the login page may offer. */
export const AuthOptionsDto = z.object({ registrationOpen: z.boolean() })
export type AuthOptionsDto = z.infer<typeof AuthOptionsDto>
export const UpdateUserReq = z.object({ name: z.string().min(1).optional(), role: Role.optional() })
/** POST /api/admin/users/:id/password — temporary password; the member must change it at next login. */
export const ResetPasswordReq = z.object({ password: z.string().min(8) })
/** Row of the admin 账号与角色 table. */
export const AdminUserDto = UserDto.extend({ machineCount: z.number().int(), online: z.boolean() })
export type AdminUserDto = z.infer<typeof AdminUserDto>

// ── Machines ────────────────────────────────────────────────────────────────
export const BindCodeDto = z.object({ code: z.string(), expiresAt: z.string() })
export type BindCodeDto = z.infer<typeof BindCodeDto>
/** `name` is the owner's label when set, else `hostname`. */
export const MachineDto = MachineInfo.omit({ hardwareId: true }).extend({
  id: z.string(),
  ownerId: z.string(),
  hostname: z.string(),
  boundAt: z.string(),
  createdAt: z.string(),
  online: z.boolean(),
  agents: z.array(AgentInfo),
  daemonVersion: z.string().nullable(),
  lastSeenAt: z.string().nullable(),
})
export type MachineDto = z.infer<typeof MachineDto>
/** PATCH /api/machines/:id; an empty name falls back to the hostname. */
export const UpdateMachineReq = z.object({ name: z.string().trim().max(64) })

// ── Bots ────────────────────────────────────────────────────────────────────
export const BotBinding = z.enum(['pending_bind', 'pending_confirm', 'bound'])
/** Derived presence shown in UI. */
export const BotPresence = z.enum([
  'pending_bind',
  'pending_confirm',
  'online',
  'running',
  'offline',
  'agent_missing',
])
/** Built-in avatar presets; the artwork lives in the web app. */
export const BOT_AVATARS = [
  'bot-dot',
  'bot-visor',
  'bot-cyclops',
  'bot-bunny',
  'bot-cat',
  'bot-screen',
  'bot-dome',
  'bot-pixel',
  'agent-spark',
  'agent-orbit',
  'agent-prism',
  'agent-nodes',
  'agent-prompt',
  'agent-compass',
  'agent-wave',
  'agent-hex',
] as const
export const BotAvatar = z.enum(BOT_AVATARS)
export type BotAvatar = z.infer<typeof BotAvatar>

export const BotDto = z.object({
  id: z.string(),
  name: z.string(),
  ownerId: z.string(),
  ownerName: z.string(),
  agentKind: AgentKind,
  /** null = a preset picked from the bot id. */
  avatar: BotAvatar.nullable(),
  machineId: z.string().nullable(),
  machineName: z.string().nullable(),
  binding: BotBinding,
  presence: BotPresence,
  systemPrompt: z.string(),
  tier: Tier,
  triggerScope: TriggerScope,
  triggerList: z.array(z.string()),
  concurrency: z.number().int(),
  createdBy: z.string(),
  /** Version of this agent kind last reported by the bound machine. */
  agentVersion: z.string().nullable(),
  /** The adapter's minimum for that CLI; `agentVersion` below it gets a warning. */
  agentMinVersion: z.string().nullable(),
  groupCount: z.number().int(),
  /** Owner's directory the bot works in when a group has no binding of its own (plan W1). */
  defaultWorkspace: z.string().nullable(),
  /** Default model and thought level; null = the adapter's default. */
  model: z.string().nullable(),
  effort: z.string().nullable(),
  /** What the bound machine's adapter offers; null until probed (or without a machine). */
  catalog: AgentCatalog.nullable(),
})
export type BotDto = z.infer<typeof BotDto>

/** GET /api/machines/:id/dirs?path= — a machine's directories for the workspace picker (its owner only). */
export const DirListingDto = z.object({
  path: z.string(),
  entries: z.array(z.object({ name: z.string(), git: z.boolean() })),
  git: z.object({ root: z.string(), remotes: z.array(z.string()), branch: z.string().nullable() }).nullable(),
  /** Why `path` cannot be a workspace; null = selectable. */
  unusable: z.string().nullable(),
})
export type DirListingDto = z.infer<typeof DirListingDto>
/** PUT /api/bots/:id/default-workspace; null clears it. */
export const DefaultWorkspaceReq = z.object({ path: z.string().min(1).nullable() })
/** PUT /api/groups/:id/bots/:botId/workspace (bot owner): a local directory, or null = managed workspace. */
export const BindWorkspaceReq = z.object({ path: z.string().min(1).nullable() })
/** GET /api/groups/:id/bots/:botId/diff?scope=&runId= — a bot workspace's changes (group members). */
export const WorkspaceDiffDto = z.object({
  scope: DiffScope,
  /** Unified patch, null when nothing changed. */
  patch: z.string().nullable(),
  /** Main branch compared against (scope base); null when HEAD is on it. */
  base: z.string().nullable(),
  branch: z.string().nullable(),
})
export type WorkspaceDiffDto = z.infer<typeof WorkspaceDiffDto>
/** PUT /api/groups/:id/bots/:botId/tier (bot owner or sysadmin); null follows the bot's own tier. */
export const GroupBotTierReq = z.object({ tier: Tier.nullable() })
/** PUT /api/groups/:id/bots/:botId/config (bot owner or group admin; anyone in a DM): nulls follow the bot. */
export const GroupBotConfigReq = z.object({ model: z.string().nullable(), effort: z.string().nullable() })
/** A one-shot pick for one message; an absent field follows the defaults, null = the adapter's default. */
export const RunConfigPick = z.object({
  model: z.string().nullable().optional(),
  effort: z.string().nullable().optional(),
})
export type RunConfigPick = z.infer<typeof RunConfigPick>

/** GET /api/bots/owners: who the caller may create bots for, with their machines (self only for members). */
export const BotOwnerDto = z.object({ id: z.string(), name: z.string(), machines: z.array(MachineDto) })
export type BotOwnerDto = z.infer<typeof BotOwnerDto>

export const CreateBotReq = z.object({
  name: z.string().min(1).max(40),
  ownerId: z.string(),
  agentKind: AgentKind,
  /** Omit when the owner has no machine yet (bot becomes pending_bind). */
  machineId: z.string().nullable(),
  systemPrompt: z.string().max(4000).default(''),
  avatar: BotAvatar.nullable().default(null),
  model: z.string().nullable().default(null),
  effort: z.string().nullable().default(null),
})
export const UpdateBotReq = z.object({
  name: z.string().min(1).max(40).optional(),
  avatar: BotAvatar.nullable().optional(),
  systemPrompt: z.string().max(4000).optional(),
  tier: Tier.optional(),
  triggerScope: TriggerScope.optional(),
  triggerList: z.array(z.string()).optional(),
  concurrency: z.number().int().min(1).max(8).optional(),
  model: z.string().nullable().optional(),
  effort: z.string().nullable().optional(),
})

// ── Notifications ───────────────────────────────────────────────────────────
export const NotificationType = z.enum([
  'approval',
  'question',
  'lock',
  'offline_expired',
  'chain_done',
  'bot_confirm',
])
export const NotificationDto = z.object({
  id: z.string(),
  type: NotificationType,
  payload: z.record(z.string(), z.unknown()),
  readAt: z.string().nullable(),
  /** The approval / question it asks for was settled (by anyone, a timeout, or the run ending). */
  resolvedAt: z.string().nullable(),
  createdAt: z.string(),
})
export type NotificationDto = z.infer<typeof NotificationDto>

/** Also sent as browser push, only to the people who can act (spec §8.11); others stay in the in-app center. */
export const PUSHED_NOTIFICATION_TYPES: readonly NotificationDto['type'][] = [
  'approval',
  'question',
  'lock',
  'offline_expired',
  'chain_done',
]
export const PushKeyDto = z.object({ publicKey: z.string() })
export const PushSubscriptionReq = z.object({
  endpoint: z.url(),
  keys: z.object({ p256dh: z.string().min(1), auth: z.string().min(1) }),
})
export type PushSubscriptionReq = z.infer<typeof PushSubscriptionReq>

// ── Groups ──────────────────────────────────────────────────────────────────
export const GroupKind = z.enum(['group', 'dm'])
export const GroupDto = z.object({
  id: z.string(),
  name: z.string(),
  kind: GroupKind,
  mode: z.enum(['partition', 'force']),
  notice: z.string(),
  repo: z.object({ url: z.string(), branch: z.string() }).nullable(),
  members: z.array(z.object({ userId: z.string(), name: z.string(), isAdmin: z.boolean() })),
  botIds: z.array(z.string()),
  unread: z.number().int(),
  lastSeq: z.number().int(),
  /** One-line preview of the latest message, '' when empty. */
  last: z.string(),
  /** The requesting user's own prefs. */
  pinned: z.boolean(),
  muted: z.boolean(),
  foldRuns: z.boolean(),
})
export type GroupDto = z.infer<typeof GroupDto>

export const CreateGroupReq = z.object({
  name: z.string().min(1).max(60),
  kind: GroupKind,
  memberIds: z.array(z.string()).default([]),
  botIds: z.array(z.string()).default([]),
  repo: z.object({ url: z.string(), branch: z.string() }).nullable().default(null),
})
export const GroupMemberReq = z.object({ userId: z.string() })
export const GroupBotReq = z.object({ botId: z.string() })
/** Moves the read cursor forward; omit `seq` to mark everything read. */
export const MarkReadReq = z.object({ seq: z.number().int().min(0).optional() })
export const ValidateRepoReq = z.object({ url: z.string(), branch: z.string() })
export const ValidateRepoRes = z.object({ ok: z.boolean(), message: z.string() })
export type ValidateRepoRes = z.infer<typeof ValidateRepoRes>

// ── Timeline ────────────────────────────────────────────────────────────────
/** Fixed set of emoji reactions, in display order. */
export const REACTION_EMOJIS = ['👍', '✅', '👀', '🎉', '❤️', '😂'] as const
export const ReactionEmoji = z.enum(REACTION_EMOJIS)
export type ReactionEmoji = z.infer<typeof ReactionEmoji>
/** One emoji's aggregate on a message, from the viewer's perspective; `users`: reactors, oldest first. */
export const ReactionDto = z.object({
  emoji: ReactionEmoji,
  count: z.number().int().positive(),
  mine: z.boolean(),
  users: z.array(z.object({ id: z.string(), name: z.string() })),
})
export type ReactionDto = z.infer<typeof ReactionDto>
/** PUT | DELETE /api/messages/:id/reactions/:emoji — the message's reactions after the change. */
export const ReactionsDto = z.object({
  groupId: z.string(),
  messageId: z.string(),
  reactions: z.array(ReactionDto),
})
export type ReactionsDto = z.infer<typeof ReactionsDto>

export const MessageDto = z.object({
  id: z.string(),
  seq: z.number().int(),
  groupId: z.string(),
  kind: z.enum(['user', 'bot', 'event']),
  authorId: z.string().nullable(),
  authorName: z.string(),
  body: z.string(),
  /** Bot ids this message triggers (explicit @ or quote). */
  mentions: z.array(z.string()),
  runId: z.string().nullable(),
  createdAt: z.string(),
  attachments: z.array(Attachment),
  quote: z
    .object({ kind: z.enum(['message', 'run']), id: z.string(), who: z.string(), text: z.string() })
    .nullable(),
  /** Ordered by first reaction; always sent by the server (optional only for older clients' literals). */
  reactions: z.array(ReactionDto).optional(),
  /** Recalled by its author: body, attachments, quote, mentions and reactions are blanked. Always sent by the server. */
  recalled: z.boolean().optional(),
})
export type MessageDto = z.infer<typeof MessageDto>
/**
 * POST /api/messages/:id/recall (author, own user message, within the window) → the blanked MessageDto.
 * POST /api/messages/:id/hide (author, any time) → 204; hides it from the author only.
 */
export const RECALL_WINDOW_MS = 24 * 3600_000
/** Quote snapshot text of a message that was recalled after being quoted. */
export const RECALLED_QUOTE = '该消息已撤回'

export const ApprovalDto = z.object({
  id: z.string(),
  runId: z.string(),
  title: z.string(),
  toolKind: z.string(),
  detail: z.string(),
  options: z.array(PermissionOption),
  /** expired = auto-rejected on timeout; void = the run ended/stopped first. */
  status: z.enum(['pending', 'approved', 'rejected', 'expired', 'void']),
  /** Why a request became void: the run was stopped, its relay chain was stopped, or the run ended first. */
  voidReason: z.enum(['stopped', 'chain_stopped', 'ended']).nullable(),
  decidedBy: z.string().nullable(),
  decidedByName: z.string().nullable(),
  decidedAt: z.string().nullable(),
  expiresAt: z.string(),
  createdAt: z.string(),
})
export type ApprovalDto = z.infer<typeof ApprovalDto>

export const DecideApprovalReq = z.object({ optionId: z.string() })
/** POST /api/runs/:id/interrupt — partition /stop leftovers (plan D7). */
export const InterruptChoiceReq = z.object({ choice: z.enum(['keep', 'discard']) })
/** POST /api/runs/:id/stop | stop-chain — how many unfinished runs were stopped. */
export const StopRes = z.object({ stopped: z.number().int() })
export type StopRes = z.infer<typeof StopRes>
/** Whether the stop reached the bot's machine; the task's end then shows in the run process. */
export const TaskStopRes = z.object({ sent: z.boolean() })
export type TaskStopRes = z.infer<typeof TaskStopRes>

export const QuestionSetDto = z.object({
  id: z.string(),
  runId: z.string(),
  questions: z.array(Question),
  status: z.enum(['pending', 'answered', 'expired', 'void']),
  answers: z.array(Answer).nullable(),
  attachments: z.array(Attachment),
  answeredBy: z.string().nullable(),
  answeredByName: z.string().nullable(),
  answeredAt: z.string().nullable(),
  expiresAt: z.string(),
  createdAt: z.string(),
})
export type QuestionSetDto = z.infer<typeof QuestionSetDto>

export const AnswerQuestionsReq = z.object({
  answers: z.array(Answer),
  attachmentIds: z.array(z.string()).max(MAX_ATTACHMENTS).default([]),
})

export const RunDto = z.object({
  id: z.string(),
  groupId: z.string(),
  botId: z.string(),
  triggerMessageId: z.string(),
  triggerUserId: z.string().nullable(),
  hop: z.number().int(),
  status: RunStatus,
  step: z.string(),
  filesChanged: z.number().int(),
  usage: Usage.nullable(),
  newSessionReason: z.string().nullable(),
  queuedAt: z.string(),
  startedAt: z.string().nullable(),
  endedAt: z.string().nullable(),
  /** Relay chain (spec §4.6): hop 1 = triggered by a human; hopMax = the group's chain limit. */
  parentRunId: z.string().nullable(),
  hopMax: z.number().int(),
  /** The group's offline wait (spec §4.8): an offline_wait card expires at queuedAt + this. */
  offlineWaitMin: z.number().int(),
  /** Human whose @ started the chain; every hop is authorized and answerable by them. */
  originUserId: z.string(),
  approvals: z.array(ApprovalDto),
  questions: z.array(QuestionSetDto),
  /** Partition-mode /stop leftovers (plan D7): pending = edits kept, discard still possible. */
  interrupt: z.enum(['pending', 'kept', 'discarded']).nullable(),
  /** Who issued /stop. */
  stoppedBy: z.string().nullable(),
  /** Delegated work of the run for the card: subagents and background tasks still running (may outlive it). */
  delegation: z.object({
    subagents: z.number().int(),
    subagentsRunning: z.number().int(),
    tasksRunning: z.number().int(),
  }),
  /** Model and thought level of the turn: as requested, then as the daemon reported them in effect. */
  model: z.string().nullable(),
  effort: z.string().nullable(),
})
export type RunDto = z.infer<typeof RunDto>

export const TimelineQuery = z.object({
  /** Only messages with a smaller seq (older page). */
  before: z.coerce.number().int().positive().optional(),
  limit: z.coerce.number().int().min(1).max(100).default(50),
})
/** GET /api/runs/:id — card fields plus the full (redacted) process for the side panel. */
export const RunDetailDto = z.object({
  run: RunDto,
  /** null once the full process has been purged by retention (card keeps the summary). */
  patch: z.string().nullable(),
  purged: z.boolean(),
  /** The (group, bot) conversation's current agent session. */
  sessionId: z.string().nullable(),
  /** System param runRetentionDays: how long the full process is kept. */
  retentionDays: z.number().int(),
  events: z.array(z.object({ id: z.number().int(), at: z.string(), event: RunEvent })),
})
export type RunDetailDto = z.infer<typeof RunDetailDto>

/** GET /api/runs/:id/session — earlier rounds of the run's agent session (oldest first), with their trigger text. */
export const RunSessionDto = z.object({ rounds: z.array(z.object({ run: RunDto, prompt: z.string() })) })
export type RunSessionDto = z.infer<typeof RunSessionDto>

export const TimelineDto = z.object({ messages: z.array(MessageDto), runs: z.array(RunDto) })
export type TimelineDto = z.infer<typeof TimelineDto>

export const SendMessageReq = z.object({
  /** May be empty when the message carries attachments. */
  body: z.string().max(20000),
  /** Client-generated idempotency key; resending the same id returns the original message. */
  clientId: z.string().min(8),
  /** Ids from POST /api/uploads. */
  attachmentIds: z.array(z.string()).max(MAX_ATTACHMENTS).default([]),
  /** Quoting a bot's reply or run card triggers that bot (spec §8.6); quoting a human message only adds context. */
  quote: z
    .object({ kind: z.enum(['message', 'run']), id: z.string() })
    .nullable()
    .default(null),
  /** 打断并追加 into this running run (trigger user or bot owner only). */
  appendTo: z.string().nullable().default(null),
  /** One-shot model / thought level per mentioned bot id (bot owner or group admin; anyone in a DM). */
  runOptions: z.record(z.string(), RunConfigPick).default({}),
})

// ── Composer candidates (spec §8.7) ────────────────────────────────────────
export const FileCandidatesDto = z.object({
  /** workspace = the @-ed bot's workspace (incl. uncommitted); mirror = base-branch mirror on the server; authority = P2. */
  source: z.enum(['workspace', 'mirror', 'none']),
  /** e.g. 「小王的 Claude 工作区 · 含未提交」 / 「main 镜像 · 3 分钟前更新」 */
  label: z.string(),
  entries: z.array(
    z.object({
      path: z.string(),
      dir: z.boolean(),
      uncommitted: z.boolean(),
      /** Only in the mirror, not in the @-ed bot's workspace → 「该文件不在你的工作区，可能需要拉取」. */
      notInWorkspace: z.boolean(),
    }),
  ),
})
export type FileCandidatesDto = z.infer<typeof FileCandidatesDto>

export const CommandCandidatesDto = z.object({
  system: z.array(z.object({ name: z.string(), hint: z.string() })),
  /** P1: agent commands reported over ACP (Claude reports skills as commands); server skill layers are P3. */
  agent: z.array(z.object({ name: z.string(), hint: z.string(), botId: z.string(), botName: z.string() })),
})
export type CommandCandidatesDto = z.infer<typeof CommandCandidatesDto>

// ── Global MCP (spec §7, P1 global layer) ──────────────────────────────────
export const McpServerDto = z.object({
  id: z.string(),
  enabled: z.boolean(),
  config: McpServer,
  updatedAt: z.string(),
})
export type McpServerDto = z.infer<typeof McpServerDto>
export const SaveMcpReq = z.object({
  enabled: z.boolean(),
  config: McpServer,
  /** 「强制相关 bot 下一轮开新会话」 (spec §7.4), default off. */
  forceNewSession: z.boolean().default(false),
})

// ── Search (⌘K, plan D9) ────────────────────────────────────────────────────
export const SearchQuery = z.object({ q: z.string().min(1).max(200), tab: z.enum(['msg', 'file', 'run']) })
export const SearchResultDto = z.object({
  kind: z.enum(['msg', 'file', 'run']),
  title: z.string(),
  sub: z.string(),
  groupId: z.string(),
  messageId: z.string().nullable(),
  runId: z.string().nullable(),
  /** When the message was sent / the run was queued; null for base-branch files. */
  at: z.string().nullable(),
})
export type SearchResultDto = z.infer<typeof SearchResultDto>

// ── Group settings (spec §10; group admins) ────────────────────────────────
export const GroupParams = z.object({
  approvalTimeoutMin: z
    .number()
    .int()
    .min(1)
    .max(24 * 60),
  chainMaxHops: z.number().int().min(1).max(10),
  offlineWaitMin: z
    .number()
    .int()
    .min(1)
    .max(24 * 60),
})
export type GroupParams = z.infer<typeof GroupParams>
/** PATCH /api/groups/:id (admins). */
export const UpdateGroupReq = z.object({
  name: z.string().trim().min(1, '填写群名称').max(60).optional(),
  notice: z.string().trim().max(500).optional(),
})
/** PUT /api/groups/:id/prefs — only for the caller. */
export const GroupPrefsReq = z
  .object({ muted: z.boolean(), pinned: z.boolean(), foldRuns: z.boolean() })
  .partial()
export type GroupPrefsReq = z.infer<typeof GroupPrefsReq>

// ── Daemon release (plan D17): PUT /api/admin/daemon-release ─────────────────
export const DaemonBuild = z.object({
  /** Absolute, or server-relative like `/downloads/<file>` (served from GONGGONG_DATA_DIR/downloads). */
  url: z.string().min(1),
  sha256: z.string().regex(/^[0-9a-f]{64}$/, 'sha256 需为 64 位十六进制'),
})
export const DaemonRelease = z.object({
  version: z.string().regex(/^\d+\.\d+\.\d+$/, '版本号需为 x.y.z'),
  /** Keyed by `<os>-<arch>` as the daemon reports them, e.g. `macos-aarch64`, `linux-x86_64`. */
  builds: z.record(z.string(), DaemonBuild),
})
export type DaemonRelease = z.infer<typeof DaemonRelease>

// ── Audit (spec §9, §13) ────────────────────────────────────────────────────
export const AuditCategory = z.enum(['approval', 'question', 'lock', 'admin', 'run', 'command'])
export const AuditQuery = z.object({
  category: AuditCategory.optional(),
  before: z.coerce.number().int().positive().optional(),
  limit: z.coerce.number().int().min(1).max(200).default(50),
})
export const AuditDto = z.object({
  id: z.number().int(),
  at: z.string(),
  category: z.string(),
  actorName: z.string().nullable(),
  action: z.string(),
  groupName: z.string().nullable(),
  /** Human-readable one-liner (prototype 审计记录 rows). */
  summary: z.string(),
  detail: z.record(z.string(), z.unknown()),
})
export type AuditDto = z.infer<typeof AuditDto>

// ── Admin console (spec §8.5, §10) ──────────────────────────────────────────
/** Row of 管理后台 · 群 (archived groups included). */
export const AdminGroupDto = z.object({
  id: z.string(),
  name: z.string(),
  ownerName: z.string().nullable(),
  kind: z.enum(['group', 'dm']),
  mode: z.enum(['partition', 'force']),
  repo: z.string().nullable(),
  members: z.number().int(),
  bots: z.number().int(),
  archivedAt: z.string().nullable(),
})
export type AdminGroupDto = z.infer<typeof AdminGroupDto>

/** Row of 管理后台 · 机器与网络. */
export const AdminMachineDto = MachineDto.extend({
  ownerName: z.string(),
  protocol: z.number().int().nullable(),
  /** Last `gg net` / desktop 测量延迟与带宽 report (spec §8.5: network quality records, admin-only). */
  latencyMs: z.number().nullable(),
  bandwidthMbps: z.number().nullable(),
  netMeasuredAt: z.string().nullable(),
})
export type AdminMachineDto = z.infer<typeof AdminMachineDto>

/** System-wide defaults editable by the sysadmin (spec §10); group params override the group-level ones. */
export const SystemParams = GroupParams.extend({
  /** Lock release after the writer disconnects (P2, 待定 until measured). */
  writerDisconnectReleaseSec: z.number().int().min(1).max(3600).nullable(),
  /** Network thresholds for enabling force sync (P2, 需实测). */
  forceSyncMaxLatencyMs: z.number().int().min(1).max(10_000),
  forceSyncMinBandwidthMbps: z.number().min(0.1).max(10_000),
  sessionReplayCount: z.number().int().min(1).max(500),
  contextInlineMax: z.number().int().min(1).max(200),
  runRetentionDays: z.number().int().min(1).max(3650),
  attachmentMaxMb: z
    .number()
    .int()
    .min(1)
    .max(MAX_ATTACHMENT_BYTES / 1024 / 1024),
  attachmentsPerMessage: z.number().int().min(1).max(MAX_ATTACHMENTS),
  questionsPerCard: z.number().int().min(1).max(MAX_QUESTIONS),
  heartbeatSec: z.number().int().min(5).max(120),
  offlineMisses: z.number().int().min(2).max(10),
  botConcurrencyDefault: z.number().int().min(1).max(10),
  backupRetentionDays: z.number().int().min(1).max(365),
  archiveRetentionDays: z.number().int().min(1).max(365),
  /** Anyone may create a member account from the login page. */
  registrationOpen: z.boolean(),
})
export type SystemParams = z.infer<typeof SystemParams>
export const UpdateSystemParamsReq = SystemParams.partial()
/** Display order, labels and units of 系统参数 (also used by audit summaries); `measure` = 需实测 (spec §10 待定). */
export const SYSTEM_PARAM_VIEW: {
  key: Exclude<keyof SystemParams, 'registrationOpen'>
  label: string
  unit: string
  measure?: true
}[] = [
  { key: 'writerDisconnectReleaseSec', label: '写入方断线后释放锁', unit: '秒', measure: true },
  { key: 'forceSyncMaxLatencyMs', label: '开启强制同步 · 延迟阈值', unit: 'ms', measure: true },
  { key: 'forceSyncMinBandwidthMbps', label: '开启强制同步 · 带宽阈值', unit: 'Mbps', measure: true },
  { key: 'sessionReplayCount', label: '会话恢复失败时补送群消息数', unit: '条' },
  { key: 'contextInlineMax', label: '每轮随消息附带的群聊上下文', unit: '条' },
  { key: 'runRetentionDays', label: '完整运行过程保留', unit: '天' },
  { key: 'attachmentMaxMb', label: '单个附件大小上限', unit: 'MB' },
  { key: 'attachmentsPerMessage', label: '每条消息附件数', unit: '个' },
  { key: 'questionsPerCard', label: '提问卡片每张题数上限', unit: '题' },
  { key: 'heartbeatSec', label: 'daemon 心跳间隔', unit: '秒' },
  { key: 'offlineMisses', label: 'daemon 离线判定（连续未收到心跳）', unit: '次' },
  { key: 'backupRetentionDays', label: '服务器备份（每日）保留', unit: '天' },
  { key: 'archiveRetentionDays', label: '删群后存档保留', unit: '天' },
  { key: 'approvalTimeoutMin', label: '权限审批等待（分区模式）· 群默认', unit: '分钟' },
  { key: 'chainMaxHops', label: '接力链长上限 · 群默认', unit: '跳' },
  { key: 'offlineWaitMin', label: 'Bot 离线时请求等待上线 · 群默认', unit: '分钟' },
  { key: 'botConcurrencyDefault', label: 'Bot 并发上限 · 新建默认', unit: '个' },
]

// ── Usage (spec §3.7) ───────────────────────────────────────────────────────
export const UsageQuery = z.object({
  by: z.enum(['bot', 'user', 'group']),
  days: z.coerce.number().int().min(1).max(365).default(30),
  /** Restrict to one bot (its owner sees who used it). */
  botId: z.string().optional(),
})
export const UsageRowDto = z.object({
  key: z.string(),
  name: z.string(),
  runs: z.number().int(),
  /** Sum over runs that reported usage. */
  totalTokens: z.number().int(),
  /** Runs whose adapter did not report usage (shown as 未上报). */
  unreported: z.number().int(),
})
export type UsageRowDto = z.infer<typeof UsageRowDto>
const isTimeZone = (tz: string) => {
  try {
    new Intl.DateTimeFormat('en', { timeZone: tz })
    return true
  } catch {
    return false
  }
}
/** GET /api/usage/daily: same scope as /api/usage, bucketed by calendar day in `tz` (IANA). */
export const UsageDailyQuery = UsageQuery.omit({ by: true }).extend({
  tz: z.string().refine(isTimeZone).default('UTC'),
})
/** One per day, oldest first, zero-filled; `day` is YYYY-MM-DD in the requested time zone. */
export const UsageDayDto = UsageRowDto.omit({ key: true, name: true }).extend({ day: z.string() })
export type UsageDayDto = z.infer<typeof UsageDayDto>

// ── Realtime: WS /ws/web (server → browser only) ────────────────────────────
/** Per-bot workspace state in a group: drives the partition-mode git status bar (spec §5.3, §8.4). */
export const GroupBotStateDto = z.object({
  botId: z.string(),
  workspace: z.enum(['managed', 'cd']),
  /** unbound = waiting for the owner to pick a workspace; the bot is not run meanwhile (plan W5). */
  state: z.enum(['pending', 'cloning', 'ready', 'failed', 'unbound']),
  path: z.string().nullable(),
  git: GitStatus.nullable(),
  error: z.string().nullable(),
  /** This group's tier override; null follows the bot's own tier. */
  tier: Tier.nullable(),
  /** This group's model / thought level; null follows the bot's defaults. */
  model: z.string().nullable(),
  effort: z.string().nullable(),
})
export type GroupBotStateDto = z.infer<typeof GroupBotStateDto>

export const WebEvent = z.discriminatedUnion('t', [
  z.object({ t: z.literal('group.botState'), groupId: z.string(), state: GroupBotStateDto }),
  z.object({ t: z.literal('message.new'), message: MessageDto }),
  /** A message's reactions changed; replaces its list (`mine` is per receiving user). */
  ReactionsDto.extend({ t: z.literal('message.reactions') }),
  /** Sent to every member; quotes of it now read RECALLED_QUOTE. */
  z.object({ t: z.literal('message.recalled'), groupId: z.string(), messageId: z.string() }),
  /** Sent to the author only (their other sessions). */
  z.object({ t: z.literal('message.hidden'), groupId: z.string(), messageId: z.string() }),
  z.object({ t: z.literal('run.updated'), run: RunDto }),
  z.object({ t: z.literal('run.delta'), runId: z.string(), text: z.string() }),
  z.object({ t: z.literal('bot.updated'), bot: BotDto }),
  z.object({ t: z.literal('bot.removed'), botId: z.string() }),
  z.object({ t: z.literal('notification.new'), notification: NotificationDto }),
  /** Some of the user's notifications were settled server-side; `unread` is their fresh unread count. */
  z.object({
    t: z.literal('notification.resolved'),
    notifications: z.array(NotificationDto),
    unread: z.number().int(),
  }),
  z.object({ t: z.literal('group.updated'), group: GroupDto }),
  /** The receiving user is no longer a member. */
  z.object({ t: z.literal('group.removed'), groupId: z.string() }),
  z.object({ t: z.literal('machine.updated'), machine: MachineDto }),
  z.object({ t: z.literal('machine.removed'), machineId: z.string() }),
])
export type WebEvent = z.infer<typeof WebEvent>
