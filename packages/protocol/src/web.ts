import { z } from 'zod'
import {
  AgentKind,
  Allowlist,
  Answer,
  Approval,
  Attachment,
  DevtoolsBlocker,
  GitStatus,
  MAX_ATTACHMENT_BYTES,
  MAX_ATTACHMENTS,
  MAX_QUESTIONS,
  Permission,
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
  FileTreeEntry,
  GitProtocol,
  MachineInfo,
  McpServer,
  PermissionOption,
  RepoAccessReason,
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
  gitProtocol: GitProtocol,
})
export type UserDto = z.infer<typeof UserDto>
/** PATCH /api/me: the caller's own preferences and display name (same rule as sign-up). */
export const UpdateMeReq = z.object({
  gitProtocol: GitProtocol.optional(),
  name: z.string().trim().min(1).max(40).optional(),
})

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
/**
 * `link` is the 接入链接 `gonggong://bind?server=…&code=…[&fp=sha256:…]` the desktop app opens or parses;
 * `fingerprint` is the server's TLS certificate (null without TLS).
 */
export const BindCodeDto = z.object({
  code: z.string(),
  expiresAt: z.string(),
  fingerprint: z.string().nullable(),
  link: z.string(),
})
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
/** Built-in bot characters: 共字君 (the default) and twelve blended work personalities; art lives in the web app. */
export const BOT_AVATARS = [
  'role-gong',
  'role-hammock',
  'role-braces',
  'role-focus',
  'role-steps',
  'role-blank',
  'role-no',
  'role-abacus',
  'role-invert',
  'role-sentry',
  'role-spring',
  'role-compass',
  'role-loop',
] as const
export const BotAvatar = z.enum(BOT_AVATARS)
export type BotAvatar = z.infer<typeof BotAvatar>

export const BotDto = z.object({
  id: z.string(),
  name: z.string(),
  ownerId: z.string(),
  ownerName: z.string(),
  agentKind: AgentKind,
  avatar: BotAvatar,
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
  approval: Approval,
  allowlist: z.array(z.string()),
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
export const BindWorkspaceReq = z.object({
  path: z.string().min(1).nullable(),
  /** Bind even if `path` is not a work tree of the group repo (the owner confirmed the warning). */
  force: z.boolean().optional(),
})
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
/**
 * Files browser (group members, read-only; `path` relative to the workspace root, '' = the root):
 * GET /api/groups/:id/bots/:botId/files/tree?path=&ignored=1 — one directory level.
 */
export const FilesTreeDto = z.object({
  path: z.string(),
  entries: z.array(FileTreeEntry),
  truncated: z.boolean(),
})
export type FilesTreeDto = z.infer<typeof FilesTreeDto>
/** GET …/files/text?path= — `text` null when binary or over FILE_TEXT_MAX_BYTES. */
export const FileTextDto = z.object({
  path: z.string(),
  size: z.number().int(),
  binary: z.boolean(),
  mime: z.string(),
  text: z.string().nullable(),
})
export type FileTextDto = z.infer<typeof FileTextDto>
/** MIME types `GET …/files/raw?path=` serves inline (Range supported); anything else is a download. */
export const INLINE_FILE_MIMES = [
  'image/png',
  'image/jpeg',
  'image/gif',
  'image/webp',
  'image/avif',
  'image/bmp',
  'image/x-icon',
  'image/svg+xml',
  'video/mp4',
  'video/webm',
  'video/quicktime',
  'audio/mpeg',
  'audio/wav',
  'audio/ogg',
  'audio/mp4',
  'audio/flac',
  'application/pdf',
] as const
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
  avatar: BotAvatar.default('role-gong'),
  model: z.string().nullable().default(null),
  effort: z.string().nullable().default(null),
})
export const UpdateBotReq = z.object({
  name: z.string().min(1).max(40).optional(),
  avatar: BotAvatar.optional(),
  systemPrompt: z.string().max(4000).optional(),
  tier: Tier.optional(),
  triggerScope: TriggerScope.optional(),
  triggerList: z.array(z.string()).optional(),
  concurrency: z.number().int().min(1).max(8).optional(),
  model: z.string().nullable().optional(),
  effort: z.string().nullable().optional(),
  /** Bot owner only. */
  approval: Approval.optional(),
  allowlist: Allowlist.optional(),
})

// ── Notifications ───────────────────────────────────────────────────────────
export const NotificationType = z.enum([
  'approval',
  'question',
  'lock',
  'offline_expired',
  'chain_done',
  'bot_confirm',
  'repo_access',
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
  /** The caller closed the current notice for themselves; a newer notice shows again. */
  noticeHidden: z.boolean(),
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
  /** Bot turns live here (running, or waiting on an approval or answer); non-empty tags the conversation. */
  liveRunIds: z.array(z.string()),
})
export type GroupDto = z.infer<typeof GroupDto>
/** GET /api/groups/:id/notices — every published notice, newest first. */
export const GroupNoticeDto = z.object({
  id: z.string(),
  body: z.string(),
  authorName: z.string(),
  createdAt: z.string(),
  /** Set when an admin removed or replaced it. */
  removedAt: z.string().nullable(),
})
export type GroupNoticeDto = z.infer<typeof GroupNoticeDto>

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
export const RepoReq = z.object({ url: z.string(), branch: z.string() })

// ── Repos (team-wide history, access probes) ────────────────────────────────
export const RepoDto = z.object({
  id: z.string(),
  /** repoKey: `host/path`, lowercase. */
  key: z.string(),
  /** Latest URL used, credentials removed. */
  url: z.string(),
  name: z.string(),
  lastBranch: z.string().nullable(),
  lastUsedAt: z.string(),
  /** Groups currently bound to it. */
  groups: z.number().int(),
  /** The caller has used it (sorted first). */
  mine: z.boolean(),
  /** Directories holding it on the caller's machines. */
  localPaths: z.array(z.object({ machineId: z.string(), path: z.string() })),
})
export type RepoDto = z.infer<typeof RepoDto>

/** POST /api/repos/probe: each bot's machine tries the repo with its own credentials. */
export const RepoProbeReq = z.object({
  url: z.string(),
  branch: z.string(),
  /** Empty → the caller's own online bots (only to learn the branches). */
  botIds: z.array(z.string()).default([]),
})
export const BotProbeDto = z.object({
  botId: z.string(),
  ok: z.boolean(),
  /** offline = not checked; the bot is verified when its machine comes back. */
  reason: z.union([RepoAccessReason, z.literal('offline')]).nullable(),
  usedUrl: z.string().nullable(),
  detail: z.string().nullable(),
})
export type BotProbeDto = z.infer<typeof BotProbeDto>
export const RepoProbeRes = z.object({
  results: z.array(BotProbeDto),
  /** From the first machine that could read the repo; null when none could. */
  defaultBranch: z.string().nullable(),
  branches: z.array(z.string()),
})
export type RepoProbeRes = z.infer<typeof RepoProbeRes>

// ── Git accounts (personal access tokens, repo discovery only) ─────────────
export const GitProvider = z.enum(['github', 'gitlab'])
export type GitProvider = z.infer<typeof GitProvider>
export const GitAccountDto = z.object({
  id: z.string(),
  provider: GitProvider,
  baseUrl: z.string(),
  login: z.string(),
  /** invalid = the provider rejected the token (401); reconnect to fix. */
  status: z.enum(['ok', 'invalid']),
})
export type GitAccountDto = z.infer<typeof GitAccountDto>
/** POST /api/me/git-accounts; baseUrl defaults to https://github.com for GitHub. */
export const AddGitAccountReq = z.object({
  provider: GitProvider,
  baseUrl: z.string().optional(),
  token: z.string().min(1, '请填写 Token'),
})
export const ProviderRepoDto = z.object({
  /** `owner/name`. */
  fullName: z.string(),
  /** Clone URL in the caller's preferred protocol. */
  url: z.string(),
  defaultBranch: z.string().nullable(),
  private: z.boolean(),
})
export type ProviderRepoDto = z.infer<typeof ProviderRepoDto>

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
  /** A bot's preview card; its live state is in the group's preview list (group.previews). */
  previewId: z.string().nullable().optional(),
})
export type MessageDto = z.infer<typeof MessageDto>

// ── Previews (plan 结果预览) ─────────────────────────────────────────────────
export const PreviewKind = z.enum(['http', 'static', 'gui', 'miniprogram'])
export const PreviewDto = z.object({
  id: z.string(),
  groupId: z.string(),
  groupName: z.string(),
  botId: z.string(),
  botName: z.string(),
  kind: PreviewKind,
  title: z.string(),
  path: z.string(),
  serviceId: z.string().nullable(),
  serviceName: z.string().nullable(),
  /** The loopback port it tunnels to; null for a static site. */
  port: z.number().int().nullable(),
  /** Its first-screen PNG (GET /api/previews/:id/snapshot) was taken then; null until the machine managed one. */
  snapshotAt: z.string().nullable(),
  /** online = its machine's tunnel is up; stopped = the service behind it is not running (启动 brings it back). */
  status: z.enum(['online', 'offline', 'stopped']),
  /**
   * login = a mini program whose machine's WeChat devtools nobody is logged in to: its snapshot is their login QR
   * code, served to managers only; the card turns into the simulator once scanned.
   */
  awaiting: z.enum(['login']).nullable(),
  /** Why the machine could not take the last snapshot, until one works. */
  snapshotError: z.string().nullable(),
  /** Its machine's gg-cast while someone watches a live preview (`gui`, `miniprogram`); null otherwise. */
  live: z
    .object({
      state: z.enum(['starting', 'live', 'failed']),
      error: z.string().nullable(),
      missing: z.array(Permission),
      devtools: DevtoolsBlocker.optional(),
    })
    .nullable(),
  /**
   * Remote control of a live preview (plan P14): at most one member controls; members ask, the bot owner or a group
   * admin approves (or takes over). Null for previews without a live view.
   */
  control: z
    .object({
      controller: z.object({ id: z.string(), name: z.string() }).nullable(),
      requests: z.array(z.object({ id: z.string(), name: z.string() })),
    })
    .nullable(),
  /** The bot owner and group admins may close it and share it publicly. */
  canManage: z.boolean(),
  createdAt: z.string(),
})
export type PreviewDto = z.infer<typeof PreviewDto>
export const ServiceDto = z.object({
  id: z.string(),
  groupId: z.string(),
  groupName: z.string(),
  botId: z.string(),
  botName: z.string(),
  name: z.string(),
  command: z.string(),
  cwd: z.string(),
  port: z.number().int().nullable(),
  status: z.enum(['starting', 'running', 'exited', 'failed']),
  canManage: z.boolean(),
  createdAt: z.string(),
})
export type ServiceDto = z.infer<typeof ServiceDto>
/**
 * GET /api/groups/:id/previews: open previews and live services. 打开 = GET /api/previews/:id/open?path= (also the
 * iframe src); POST /api/previews/:id/close and /api/services/:id/stop → 204 (bot owner or group admin);
 * POST /api/previews/:id/snapshot → 204 retakes the first screen (same people; 409 with the machine's reason).
 * POST /api/previews/:id/start → 204 reopens a closed preview and restarts its stopped service as it was started
 * (same people; 409 with the machine's reason).
 * Machine token (desktop app): GET /api/daemon/previews → the machine's own; POST /api/daemon/previews/:id/close
 * (ClosePreviewReq) and /api/daemon/services/:id/stop → 204.
 */
export const GroupPreviewsDto = z.object({
  previews: z.array(PreviewDto),
  services: z.array(ServiceDto),
  /** Bots whose previews this user may manage, closed ones included (their cards offer 启动). */
  manageableBotIds: z.array(z.string()),
})
export type GroupPreviewsDto = z.infer<typeof GroupPreviewsDto>
/** Close body: `stopService` also stops the service behind the preview (409 when its machine is offline). */
export const ClosePreviewReq = z.object({ stopService: z.boolean().optional() })

/**
 * Live view of a `gui` or `miniprogram` preview through LiveKit (plan P12–P14), room = preview id.
 * POST /api/previews/:id/live (members) → a viewer token for this connection. `url` null: the server's own
 * `/livekit` (ws(s)://<its host>/livekit), else an external LiveKit.
 */
export const LiveTokenDto = z.object({ url: z.string().nullable(), token: z.string(), identity: z.string() })
export type LiveTokenDto = z.infer<typeof LiveTokenDto>
/**
 * POST /api/previews/:id/watch (members) → 204: someone is watching; the machine publishes while a viewer renewed
 * within `LIVE_WATCH_SECONDS`, at the highest frame rate its viewers ask for (`LIVE_DEFAULT_FPS` when none does).
 */
export const LIVE_WATCH_SECONDS = 60
export const LIVE_FPS = [30, 60, 90] as const
export type LiveFps = (typeof LIVE_FPS)[number]
export const LIVE_DEFAULT_FPS: LiveFps = 30
export const WatchReq = z.object({ fps: z.union([z.literal(30), z.literal(60), z.literal(90)]).optional() })
export type WatchReq = z.infer<typeof WatchReq>
/**
 * POST /api/previews/:id/control → 204. Members `request` (managers take control at once) and `release` (give it
 * back, or withdraw their request); managers `grant` / `deny` a request and `revoke` control. Control lapses with the
 * controller's watch lease.
 */
export const ControlReq = z.discriminatedUnion('action', [
  z.object({ action: z.literal('request') }),
  z.object({ action: z.literal('release') }),
  z.object({ action: z.literal('grant'), userId: z.string() }),
  z.object({ action: z.literal('deny'), userId: z.string() }),
  z.object({ action: z.literal('revoke') }),
])
export type ControlReq = z.infer<typeof ControlReq>

/** Keys the controller can press besides typing text (`CastInput` `key`, with a letter or digit for shortcuts). */
export const CAST_KEYS = [
  'Enter',
  'Backspace',
  'Delete',
  'Tab',
  'Escape',
  'ArrowUp',
  'ArrowDown',
  'ArrowLeft',
  'ArrowRight',
  'Home',
  'End',
  'PageUp',
  'PageDown',
] as const
const point = { x: z.number().min(0).max(1), y: z.number().min(0).max(1) }
/**
 * The controller's input, as JSON on the LiveKit data channel (topic `input`, to the `cast` participant only); gg-cast
 * replays it on the machine. Points are fractions of the video frame; `wheel` deltas are CSS pixels; `text` is typed
 * as is (IME output included).
 */
export const CastInput = z.discriminatedUnion('t', [
  z.object({ t: z.literal('down'), ...point }),
  z.object({ t: z.literal('move'), ...point }),
  z.object({ t: z.literal('up'), ...point }),
  z.object({ t: z.literal('wheel'), ...point, dx: z.number(), dy: z.number() }),
  z.object({ t: z.literal('text'), text: z.string().min(1).max(1000) }),
  z.object({
    t: z.literal('key'),
    key: z.union([z.enum(CAST_KEYS), z.string().regex(/^[a-z0-9]$/)]),
    mods: z.array(z.enum(['meta', 'ctrl', 'alt', 'shift'])),
  }),
])
export type CastInput = z.infer<typeof CastInput>
export const CAST_INPUT_TOPIC = 'input'

/** POST /api/daemon/previews/:id/cast (machine token, its own preview) → the publisher token for gg-cast. */
export const CastTokenDto = z.object({ url: z.string().nullable(), token: z.string() })
export type CastTokenDto = z.infer<typeof CastTokenDto>

/**
 * Public preview links (plan P8), created by the bot owner or a group admin, always expiring:
 * POST /api/previews/:id/shares → CreatedPreviewShare (the url, with its secret, is shown once);
 * GET /api/previews/:id/shares → PreviewShareDto[]; POST /api/preview-shares/:id/revoke → 204 (managers, sysadmins).
 * Admin console: GET /api/admin/preview-shares → all; PATCH /api/admin/preview-shares/:id → new expiry.
 */
export const PreviewShareDto = z.object({
  id: z.string(),
  previewId: z.string(),
  previewTitle: z.string(),
  groupId: z.string(),
  groupName: z.string(),
  botName: z.string(),
  createdByName: z.string(),
  expiresAt: z.string(),
  revokedAt: z.string().nullable(),
  visitCount: z.number().int(),
  lastVisitAt: z.string().nullable(),
  createdAt: z.string(),
  /** Not revoked, not expired, preview still open. */
  active: z.boolean(),
})
export type PreviewShareDto = z.infer<typeof PreviewShareDto>
export const PREVIEW_SHARE_DEFAULT_DAYS = 7
export const CreatePreviewShareReq = z.object({
  days: z.number().int().min(1).max(365).default(PREVIEW_SHARE_DEFAULT_DAYS),
})
export const CreatedPreviewShare = z.object({ share: PreviewShareDto, url: z.string() })
export type CreatedPreviewShare = z.infer<typeof CreatedPreviewShare>
export const UpdatePreviewShareReq = z.object({ expiresAt: z.iso.datetime() })
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
  .object({ muted: z.boolean(), pinned: z.boolean(), foldRuns: z.boolean(), noticeHidden: z.boolean() })
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
  /** gg-cast (desktop preview publisher) per platform, downloaded by the daemon on its first live preview. */
  cast: z.record(z.string(), DaemonBuild).optional(),
})
export type DaemonRelease = z.infer<typeof DaemonRelease>
/** `<os>-<arch>` built by scripts/release.sh. */
export const RELEASE_PLATFORMS = [
  'macos-aarch64',
  'macos-x86_64',
  'linux-x86_64',
  'linux-aarch64',
  'windows-x86_64',
] as const
export const ReleaseKind = z.enum(['builds', 'cast'])
export type ReleaseKind = z.infer<typeof ReleaseKind>
export interface ReleaseFile {
  kind: ReleaseKind
  version: string
  platform: string
}
const RELEASE_FILE =
  /^(gonggong|gg-cast)-(\d+\.\d+\.\d+)-((?:macos|linux)-(?:x86_64|aarch64)|windows-x86_64)(\.exe)?$/
/**
 * POST /api/admin/daemon-release/files takes scripts/release.sh artifacts as named (`gonggong-0.2.0-macos-aarch64`,
 * `gg-cast-0.2.0-windows-x86_64.exe`): the name alone says what the file is, so admins just drop dist/<version>/.
 */
export function parseReleaseFile(name: string): ReleaseFile | null {
  const [, prefix, version, platform, exe] = RELEASE_FILE.exec(name) ?? []
  if (!version || !platform || platform.startsWith('windows') !== Boolean(exe)) return null
  return { kind: prefix === 'gonggong' ? 'builds' : 'cast', version, platform }
}
/** GET /api/daemon/cast-build (machine token) → gg-cast for its platform; 404 when none is published. */
export const CastBuildDto = z.object({ version: z.string(), url: z.string(), sha256: z.string() })
export type CastBuildDto = z.infer<typeof CastBuildDto>

// ── Audit (spec §9, §13) ────────────────────────────────────────────────────
export const AuditCategory = z.enum(['approval', 'question', 'lock', 'admin', 'run', 'command', 'preview'])
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
  /** Previews nobody opened for this long are closed and their services stopped (plan P11). */
  previewIdleHours: z.number().int().min(1).max(720),
  /** Longest a public preview link may stay valid (plan P8). */
  previewShareMaxDays: z.number().int().min(1).max(365),
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
  { key: 'writerDisconnectReleaseSec', label: '持锁 Bot 断线后自动释放锁', unit: '秒', measure: true },
  { key: 'forceSyncMaxLatencyMs', label: '开启强制同步 · 延迟阈值', unit: 'ms', measure: true },
  { key: 'forceSyncMinBandwidthMbps', label: '开启强制同步 · 带宽阈值', unit: 'Mbps', measure: true },
  { key: 'sessionReplayCount', label: '会话恢复失败时补送群消息数', unit: '条' },
  { key: 'contextInlineMax', label: '每轮随消息附带的群聊上下文', unit: '条' },
  { key: 'runRetentionDays', label: '完整运行过程保留', unit: '天' },
  { key: 'previewIdleHours', label: '预览无人访问后自动关闭', unit: '小时' },
  { key: 'previewShareMaxDays', label: '预览公开链接最长有效期', unit: '天' },
  { key: 'attachmentMaxMb', label: '单个附件大小上限', unit: 'MB' },
  { key: 'attachmentsPerMessage', label: '每条消息附件数', unit: '个' },
  { key: 'questionsPerCard', label: '提问卡片每张题数上限', unit: '题' },
  { key: 'heartbeatSec', label: '机器心跳间隔', unit: '秒' },
  { key: 'offlineMisses', label: '机器离线判定（连续未收到心跳）', unit: '次' },
  { key: 'backupRetentionDays', label: '服务器备份（每日）保留', unit: '天' },
  { key: 'archiveRetentionDays', label: '删群后存档保留', unit: '天' },
  { key: 'approvalTimeoutMin', label: '权限审批等待（分区模式）· 群默认', unit: '分钟' },
  { key: 'chainMaxHops', label: '接力链长上限 · 群默认', unit: '跳' },
  { key: 'offlineWaitMin', label: 'Bot 离线时请求等待上线 · 群默认', unit: '分钟' },
  { key: 'botConcurrencyDefault', label: 'Bot 并发上限 · 新建默认', unit: '个' },
]

// ── Usage (spec §3.7) ───────────────────────────────────────────────────────
/** GET /api/bots/:id/activity — each group the bot is in, where it works there and its turn in flight (owner or sysadmin). */
export const BotPlaceDto = z.object({
  groupId: z.string(),
  groupName: z.string(),
  groupKind: GroupKind,
  workspacePath: z.string().nullable(),
  /** Not yet finished: queued, running or waiting on approval / an answer; the newest if several. */
  run: z
    .object({ id: z.string(), status: RunStatus, step: z.string(), startedAt: z.string().nullable() })
    .nullable(),
  lastRunAt: z.string().nullable(),
})
export type BotPlaceDto = z.infer<typeof BotPlaceDto>

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
  /** With `failed`: denied / network / timeout pause the bot until a recheck succeeds. */
  reason: RepoAccessReason.nullable(),
  /** This group's tier override; null follows the bot's own tier. */
  tier: Tier.nullable(),
  /** This group's model / thought level; null follows the bot's defaults. */
  model: z.string().nullable(),
  effort: z.string().nullable(),
})
export type GroupBotStateDto = z.infer<typeof GroupBotStateDto>

export const WebEvent = z.discriminatedUnion('t', [
  z.object({ t: z.literal('group.botState'), groupId: z.string(), state: GroupBotStateDto }),
  /** The group's previews or services changed; replaces both lists (`canManage` is per receiving user). */
  GroupPreviewsDto.extend({ t: z.literal('group.previews'), groupId: z.string() }),
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
