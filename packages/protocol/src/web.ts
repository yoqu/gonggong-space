import { z } from 'zod'
import { AgentKind, GitStatus, RunStatus, Tier, TriggerScope, Usage } from './common.js'
import { AgentInfo, MachineInfo, PermissionOption, RunEvent } from './daemon.js'

/** REST base: /api. Auth: httpOnly cookie `aiws_session`. Errors: { error: ErrorCode, message }. */
export const ErrorCode = z.enum([
  'unauthorized',
  'forbidden',
  'not_found',
  'invalid',
  'conflict',
  'must_change_password',
  'code_expired',
  'code_locked',
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

export const CreateUserReq = z.object({
  account: z.string().regex(/^[a-z0-9_.-]{2,32}$/),
  name: z.string().min(1),
  role: Role,
  password: z.string().min(8),
})
export const UpdateUserReq = z.object({ name: z.string().min(1).optional(), role: Role.optional() })
/** Row of the admin 账号与角色 table. */
export const AdminUserDto = UserDto.extend({ machineCount: z.number().int(), online: z.boolean() })
export type AdminUserDto = z.infer<typeof AdminUserDto>

// ── Machines ────────────────────────────────────────────────────────────────
export const BindCodeDto = z.object({ code: z.string(), expiresAt: z.string() })
export type BindCodeDto = z.infer<typeof BindCodeDto>
export const MachineDto = MachineInfo.extend({
  id: z.string(),
  ownerId: z.string(),
  online: z.boolean(),
  agents: z.array(AgentInfo),
  daemonVersion: z.string().nullable(),
  lastSeenAt: z.string().nullable(),
})
export type MachineDto = z.infer<typeof MachineDto>

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
export const BotDto = z.object({
  id: z.string(),
  name: z.string(),
  ownerId: z.string(),
  ownerName: z.string(),
  agentKind: AgentKind,
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
  groupCount: z.number().int(),
})
export type BotDto = z.infer<typeof BotDto>

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
})
export const UpdateBotReq = z.object({
  name: z.string().min(1).max(40).optional(),
  systemPrompt: z.string().max(4000).optional(),
  tier: Tier.optional(),
  triggerScope: TriggerScope.optional(),
  triggerList: z.array(z.string()).optional(),
  concurrency: z.number().int().min(1).max(8).optional(),
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
  createdAt: z.string(),
})
export type NotificationDto = z.infer<typeof NotificationDto>

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
})
export type MessageDto = z.infer<typeof MessageDto>

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
  /** Partition-mode /stop leftovers (plan D7): pending = edits kept, discard still possible. */
  interrupt: z.enum(['pending', 'kept', 'discarded']).nullable(),
  /** Who issued /stop. */
  stoppedBy: z.string().nullable(),
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

export const TimelineDto = z.object({ messages: z.array(MessageDto), runs: z.array(RunDto) })
export type TimelineDto = z.infer<typeof TimelineDto>

export const SendMessageReq = z.object({
  body: z.string().min(1).max(20000),
  /** Client-generated idempotency key; resending the same id returns the original message. */
  clientId: z.string().min(8),
})

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

// ── Realtime: WS /ws/web (server → browser only) ────────────────────────────
/** Per-bot workspace state in a group: drives the partition-mode git status bar (spec §5.3, §8.4). */
export const GroupBotStateDto = z.object({
  botId: z.string(),
  workspace: z.enum(['managed', 'cd']),
  state: z.enum(['pending', 'cloning', 'ready', 'failed']),
  git: GitStatus.nullable(),
  error: z.string().nullable(),
})
export type GroupBotStateDto = z.infer<typeof GroupBotStateDto>

export const WebEvent = z.discriminatedUnion('t', [
  z.object({ t: z.literal('group.botState'), groupId: z.string(), state: GroupBotStateDto }),
  z.object({ t: z.literal('message.new'), message: MessageDto }),
  z.object({ t: z.literal('run.updated'), run: RunDto }),
  z.object({ t: z.literal('run.delta'), runId: z.string(), text: z.string() }),
  z.object({ t: z.literal('bot.updated'), bot: BotDto }),
  z.object({ t: z.literal('bot.removed'), botId: z.string() }),
  z.object({ t: z.literal('notification.new'), notification: NotificationDto }),
  z.object({ t: z.literal('group.updated'), group: GroupDto }),
  /** The receiving user is no longer a member. */
  z.object({ t: z.literal('group.removed'), groupId: z.string() }),
  z.object({ t: z.literal('machine.updated'), machine: MachineDto }),
])
export type WebEvent = z.infer<typeof WebEvent>
