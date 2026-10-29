import {
  type AgentSettingValues,
  type ArtifactFile,
  type DiffRepo,
  type GitActionArgs,
  type GitActionDetail,
  type GroupTabTarget,
  type HtmlRenderRef,
  type I18nText,
  LIVE_RUN_STATUSES,
  type LintIssue,
  type PluginManifest,
  type PluginRef,
  type RunConfigPick,
  type RunSecret,
  type RunSettingsSnapshot,
  type RunSyncDone,
} from '@gonggong/protocol'
import { type AnyColumn, sql } from 'drizzle-orm'
import {
  bigint,
  bigserial,
  boolean,
  doublePrecision,
  index,
  integer,
  jsonb,
  pgTable,
  primaryKey,
  text,
  timestamp,
  unique,
  uniqueIndex,
  uuid,
} from 'drizzle-orm/pg-core'

const id = () => uuid('id').primaryKey().default(sql`gen_random_uuid()`)
const createdAt = () => timestamp('created_at', { withTimezone: true }).notNull().defaultNow()
const ts = (name: string) => timestamp(name, { withTimezone: true })

// ── Accounts ────────────────────────────────────────────────────────────────
export const users = pgTable('users', {
  id: id(),
  account: text('account').notNull().unique(),
  name: text('name').notNull(),
  email: text('email'),
  /** `avatars/<uuid>` under the data dir, or an https URL (the Feishu avatar); null = generated from the name. */
  avatar: text('avatar'),
  /** null for accounts created by 飞书登录 that never set a password: password login always fails. */
  passwordHash: text('password_hash'),
  /** 'sysadmin' | 'member'; group admin is per group (groupMembers.isAdmin). */
  role: text('role').notNull().default('member'),
  mustChangePassword: boolean('must_change_password').notNull().default(true),
  /** 'auto' | 'ssh' | 'https': tried first when this user's bots clone or probe a repo (RepoSpec.protocol). */
  gitProtocol: text('git_protocol').notNull().default('auto'),
  disabledAt: ts('disabled_at'),
  createdAt: createdAt(),
})

export const webSessions = pgTable('web_sessions', {
  id: id(),
  tokenHash: text('token_hash').notNull().unique(),
  userId: uuid('user_id')
    .notNull()
    .references(() => users.id),
  expiresAt: ts('expires_at').notNull(),
  revokedAt: ts('revoked_at'),
  createdAt: createdAt(),
})

/** Personal GitHub / GitLab accounts, used only to list the caller's repos and branches. */
export const gitAccounts = pgTable(
  'git_accounts',
  {
    id: id(),
    userId: uuid('user_id')
      .notNull()
      .references(() => users.id),
    /** 'github' | 'gitlab' */
    provider: text('provider').notNull(),
    /** Instance web address without a trailing slash, e.g. https://github.com. */
    baseUrl: text('base_url').notNull(),
    login: text('login').notNull(),
    /** seal()ed personal access token; never sent to the browser. */
    token: text('token').notNull(),
    /** 'ok' | 'invalid' */
    status: text('status').notNull().default('ok'),
    createdAt: createdAt(),
  },
  (t) => [unique().on(t.userId, t.baseUrl, t.login)],
)

// ── Teams (plan 团队层级) ───────────────────────────────────────────────────
export const teams = pgTable('teams', {
  id: id(),
  name: text('name').notNull(),
  /** `avatars/<uuid>` under the data dir, or one character or emoji; null = the name's initial. */
  avatar: text('avatar'),
  /** Overrides of TEAM_PARAM_KEYS for the team's groups. */
  params: jsonb('params').notNull().default({}),
  createdBy: uuid('created_by')
    .notNull()
    .references(() => users.id),
  archivedAt: ts('archived_at'),
  createdAt: createdAt(),
})

export const teamMembers = pgTable(
  'team_members',
  {
    teamId: uuid('team_id')
      .notNull()
      .references(() => teams.id),
    userId: uuid('user_id')
      .notNull()
      .references(() => users.id),
    /** 'owner' | 'admin' | 'member' */
    role: text('role').notNull().default('member'),
    joinedAt: timestamp('joined_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [primaryKey({ columns: [t.teamId, t.userId] }), index('team_members_user').on(t.userId)],
)

export const teamInvites = pgTable('team_invites', {
  id: id(),
  teamId: uuid('team_id')
    .notNull()
    .references(() => teams.id),
  tokenHash: text('token_hash').notNull().unique(),
  role: text('role').notNull().default('member'),
  /** null = unlimited. */
  maxUses: integer('max_uses'),
  uses: integer('uses').notNull().default(0),
  expiresAt: ts('expires_at').notNull(),
  createdBy: uuid('created_by')
    .notNull()
    .references(() => users.id),
  revokedAt: ts('revoked_at'),
  createdAt: createdAt(),
})

const teamId = () =>
  uuid('team_id')
    .notNull()
    .references(() => teams.id)

// ── Machines & daemon binding ───────────────────────────────────────────────
export const bindCodes = pgTable('bind_codes', {
  code: text('code').primaryKey(),
  userId: uuid('user_id')
    .notNull()
    .references(() => users.id),
  expiresAt: ts('expires_at').notNull(),
  usedAt: ts('used_at'),
  failedAttempts: integer('failed_attempts').notNull().default(0),
  createdAt: createdAt(),
})

export const machines = pgTable('machines', {
  id: id(),
  ownerId: uuid('owner_id')
    .notNull()
    .references(() => users.id),
  /** Hostname as last reported by the daemon. */
  name: text('name').notNull(),
  /** Owner-chosen display name; null shows the hostname. */
  label: text('label'),
  os: text('os').notNull(),
  arch: text('arch').notNull(),
  hardwareId: text('hardware_id').unique(),
  /** SystemInfo as last reported by the daemon. */
  system: jsonb('system'),
  tokenHash: text('token_hash').notNull().unique(),
  daemonVersion: text('daemon_version'),
  protocol: integer('protocol'),
  /** AgentInfo[] as last reported by the daemon. */
  agents: jsonb('agents').notNull().default([]),
  lastSeenAt: ts('last_seen_at'),
  revokedAt: ts('revoked_at'),
  latencyMs: integer('latency_ms'),
  bandwidthMbps: doublePrecision('bandwidth_mbps'),
  netMeasuredAt: ts('net_measured_at'),
  /** Latest successful `gg login`; differs from createdAt once the host was restored or transferred. */
  boundAt: timestamp('bound_at', { withTimezone: true }).notNull().defaultNow(),
  createdAt: createdAt(),
})

// ── Bots ────────────────────────────────────────────────────────────────────
export const bots = pgTable('bots', {
  id: id(),
  teamId: teamId(),
  name: text('name').notNull(),
  ownerId: uuid('owner_id')
    .notNull()
    .references(() => users.id),
  agentKind: text('agent_kind').notNull(),
  /** The role key (BOT_AVATARS). */
  avatar: text('avatar'),
  /** `avatars/<uuid>` under the data dir, shown instead of the role; picking a role clears it. */
  avatarImage: text('avatar_image'),
  /** null while 'pending_bind' (owner has no machine yet). */
  machineId: uuid('machine_id').references(() => machines.id),
  /** 'pending_bind' | 'pending_confirm' | 'bound' */
  binding: text('binding').notNull(),
  systemPrompt: text('system_prompt').notNull().default(''),
  /** 'full' | 'workspace' | 'read-only' */
  tier: text('tier').notNull().default('workspace'),
  /** 'all' | 'list' | 'self' */
  triggerScope: text('trigger_scope').notNull().default('all'),
  triggerList: jsonb('trigger_list').$type<string[]>().notNull().default([]),
  concurrency: integer('concurrency').notNull().default(2),
  /** 'ask' | 'allowlist' | 'all'; set by the owner only (plan J9). */
  approval: text('approval').notNull().default('ask'),
  allowlist: jsonb('allowlist').$type<string[]>().notNull().default([]),
  /** Rules the owner chose 始终允许 for (command prefixes or `tool:<title>`), across groups. */
  alwaysAllow: jsonb('always_allow').$type<string[]>().notNull().default([]),
  /** Owner's local directory used when a group has no binding of its own. */
  defaultWorkspace: text('default_workspace'),
  /** Default model / thought level as the adapter names them; null = the adapter's default. */
  model: text('model'),
  effort: text('effort'),
  /** Author/committer of the agent's git commits; null = bot name / `defaultGitEmail`. */
  gitName: text('git_name'),
  gitEmail: text('git_email'),
  /** Owner's overrides of `botOverride` agent settings (field id → value). */
  agentSettings: jsonb('agent_settings').$type<AgentSettingValues>().notNull().default({}),
  createdBy: uuid('created_by')
    .notNull()
    .references(() => users.id),
  deletedAt: ts('deleted_at'),
  createdAt: createdAt(),
})

/** Members a bot is shared with: they may DM it, each DM in a managed workspace of its own. */
export const botShares = pgTable(
  'bot_shares',
  {
    botId: uuid('bot_id')
      .notNull()
      .references(() => bots.id),
    userId: uuid('user_id')
      .notNull()
      .references(() => users.id),
    createdBy: uuid('created_by')
      .notNull()
      .references(() => users.id),
    createdAt: createdAt(),
  },
  (t) => [primaryKey({ columns: [t.botId, t.userId] }), index('bot_shares_user').on(t.userId)],
)

/** 消息置顶: a group's pinned messages (MAX_PINS each); a recalled message's pin goes with it. */
export const groupPinnedMessages = pgTable(
  'group_pinned_messages',
  {
    groupId: uuid('group_id')
      .notNull()
      .references(() => groups.id, { onDelete: 'cascade' }),
    messageId: uuid('message_id')
      .notNull()
      .references(() => messages.id, { onDelete: 'cascade' }),
    pinnedBy: uuid('pinned_by')
      .notNull()
      .references(() => users.id),
    pinnedAt: createdAt(),
  },
  (t) => [primaryKey({ columns: [t.groupId, t.messageId] })],
)

/**
 * A manual git write in a group (plan Git增强): the bot owner's run at once; anyone else's wait here for the owner's
 * approval, then the server sends it to the daemon. Kept as the record of who asked, who decided and what git said.
 */
export const gitOperations = pgTable(
  'git_operations',
  {
    id: id(),
    groupId: uuid('group_id')
      .notNull()
      .references(() => groups.id, { onDelete: 'cascade' }),
    botId: uuid('bot_id')
      .notNull()
      .references(() => bots.id, { onDelete: 'cascade' }),
    /** The workspace's sub-repo acted on (see GitActionReq); null = the root repo. */
    repo: text('repo'),
    /** GitActionKind */
    action: text('action').notNull(),
    branch: text('branch'),
    remote: text('remote'),
    message: text('message'),
    /** A commit (discard, stash) of these work-tree paths only; null = every change. */
    paths: jsonb('paths').$type<string[]>(),
    /** The action's other parameters (GitActionArgs); null when it has none. */
    args: jsonb('args').$type<GitActionArgs>(),
    /** A push of the group's protected base branch. */
    pushesBase: boolean('pushes_base').notNull().default(false),
    /** GitOperationStatus */
    status: text('status').notNull(),
    requestedBy: uuid('requested_by')
      .notNull()
      .references(() => users.id),
    decidedBy: uuid('decided_by').references(() => users.id),
    output: text('output'),
    error: text('error'),
    /** What the outcome needs beyond its text (GitActionDetail, gitOps4); null from older daemons. */
    detail: jsonb('detail').$type<GitActionDetail>(),
    createdAt: createdAt(),
    expiresAt: ts('expires_at').notNull(),
    finishedAt: ts('finished_at'),
  },
  (t) => [index('git_operations_group').on(t.groupId, t.createdAt)],
)

/** 申请共享: a member asks the owner to share a bot with them; one pending request per bot and member. */
export const botShareRequests = pgTable(
  'bot_share_requests',
  {
    id: id(),
    botId: uuid('bot_id')
      .notNull()
      .references(() => bots.id),
    userId: uuid('user_id')
      .notNull()
      .references(() => users.id),
    reason: text('reason').notNull().default(''),
    /** 'pending' | 'approved' | 'rejected' */
    status: text('status').notNull().default('pending'),
    decidedBy: uuid('decided_by').references(() => users.id),
    decidedAt: ts('decided_at'),
    createdAt: createdAt(),
  },
  (t) => [
    uniqueIndex('bot_share_requests_pending').on(t.botId, t.userId).where(sql`${t.status} = 'pending'`),
  ],
)

// ── Groups ──────────────────────────────────────────────────────────────────
export const groups = pgTable('groups', {
  id: id(),
  teamId: teamId(),
  name: text('name').notNull(),
  /** 'group' | 'dm' */
  kind: text('kind').notNull(),
  /** `avatars/<uuid>` under the data dir; null = tiled from the members. */
  avatar: text('avatar'),
  /** A DM renamed by its owner shows `name`; otherwise it follows its Bot's name. */
  renamed: boolean('renamed').notNull().default(false),
  notice: text('notice').notNull().default(''),
  /** The `group_notices` row behind `notice`; null when there is none. */
  noticeId: uuid('notice_id'),
  /** 'partition' | 'force' (P2) */
  mode: text('mode').notNull().default('partition'),
  /** Off: any member invites people; on: only group admins do. */
  adminOnlyInvite: boolean('admin_only_invite').notNull().default(false),
  /** 禁止直推基准分支: agents work on feature branches; pushing to the base branch asks the bot owner. */
  protectBase: boolean('protect_base').notNull().default(false),
  /** Switching to force (§3.5): who started it when with which base bot, until the base's tree is in; new turns wait. */
  /** Partition → force in progress: started `at`, the base sync.init first sent at `sentAt`. */
  syncSwitch: jsonb('sync_switch').$type<{ userId: string; botId: string; at?: string; sentAt?: string }>(),
  /** Switched back to partition: the group's sync data is purged 30 days later unless force is enabled again. */
  syncArchivedAt: ts('sync_archived_at'),
  /** Per-group overrides of system params, e.g. { approvalTimeoutMin: 30, chainMaxHops: 3 }. */
  params: jsonb('params').notNull().default({}),
  createdBy: uuid('created_by')
    .notNull()
    .references(() => users.id),
  archivedAt: ts('archived_at'),
  createdAt: createdAt(),
})

/** Every published notice; `groups.notice` holds the current one. */
/** 群标签栏: shared tabs under the group header, in `position` order (protocol GroupTabTarget). */
export const groupTabs = pgTable(
  'group_tabs',
  {
    id: id(),
    groupId: uuid('group_id')
      .notNull()
      .references(() => groups.id, { onDelete: 'cascade' }),
    title: text('title').notNull(),
    target: jsonb('target').$type<GroupTabTarget>().notNull(),
    position: integer('position').notNull(),
    createdByUserId: uuid('created_by_user_id').references(() => users.id),
    createdByBotId: uuid('created_by_bot_id').references(() => bots.id),
    createdAt: createdAt(),
  },
  (t) => [index('group_tabs_group').on(t.groupId, t.position)],
)

export const groupNotices = pgTable('group_notices', {
  id: id(),
  groupId: uuid('group_id')
    .notNull()
    .references(() => groups.id),
  body: text('body').notNull(),
  createdBy: uuid('created_by')
    .notNull()
    .references(() => users.id),
  removedAt: ts('removed_at'),
  createdAt: createdAt(),
})

/** One group → many repos (P1 enforces at most one). */
export const groupRepos = pgTable('group_repos', {
  id: id(),
  groupId: uuid('group_id')
    .notNull()
    .references(() => groups.id),
  url: text('url').notNull(),
  baseBranch: text('base_branch').notNull(),
  createdAt: createdAt(),
})

/** Team-wide history of remote repos bound to groups or found in /cd directories, one row per team and `repoKey`. */
export const repos = pgTable(
  'repos',
  {
    id: id(),
    teamId: teamId(),
    key: text('key').notNull(),
    /** The latest URL it was used with, credentials removed. */
    url: text('url').notNull(),
    name: text('name').notNull(),
    lastBranch: text('last_branch'),
    lastUsedAt: ts('last_used_at').notNull().defaultNow(),
    /** Hidden from the picker until it is used again. */
    hiddenAt: ts('hidden_at'),
    createdAt: createdAt(),
  },
  (t) => [unique().on(t.teamId, t.key)],
)

/** Who used which repo last, for "recently used by me" ordering. */
export const repoUsers = pgTable(
  'repo_users',
  {
    repoId: uuid('repo_id')
      .notNull()
      .references(() => repos.id),
    userId: uuid('user_id')
      .notNull()
      .references(() => users.id),
    usedAt: ts('used_at').notNull().defaultNow(),
  },
  (t) => [primaryKey({ columns: [t.repoId, t.userId] })],
)

/** Local directories holding a repo, per machine (from ready /cd bindings); suggested before cloning. */
export const machineRepos = pgTable(
  'machine_repos',
  {
    machineId: uuid('machine_id')
      .notNull()
      .references(() => machines.id),
    path: text('path').notNull(),
    repoId: uuid('repo_id')
      .notNull()
      .references(() => repos.id),
    seenAt: ts('seen_at').notNull().defaultNow(),
  },
  (t) => [primaryKey({ columns: [t.machineId, t.path] }), index('machine_repos_repo').on(t.repoId)],
)

export const groupMembers = pgTable(
  'group_members',
  {
    groupId: uuid('group_id')
      .notNull()
      .references(() => groups.id),
    userId: uuid('user_id')
      .notNull()
      .references(() => users.id),
    isAdmin: boolean('is_admin').notNull().default(false),
    muted: boolean('muted').notNull().default(false),
    pinned: boolean('pinned').notNull().default(false),
    foldRuns: boolean('fold_runs').notNull().default(false),
    /** 完成: the group's last seq when this member marked it done; a later message brings it back. */
    doneSeq: bigint('done_seq', { mode: 'number' }),
    /** 标记 */
    flagged: boolean('flagged').notNull().default(false),
    /** The notice this member closed for themselves; a newer notice shows again. */
    hiddenNoticeId: uuid('hidden_notice_id'),
    lastReadSeq: bigint('last_read_seq', { mode: 'number' }).notNull().default(0),
    joinedAt: createdAt(),
  },
  (t) => [primaryKey({ columns: [t.groupId, t.userId] }), index('group_members_user').on(t.userId)],
)

export const groupBots = pgTable(
  'group_bots',
  {
    groupId: uuid('group_id')
      .notNull()
      .references(() => groups.id),
    botId: uuid('bot_id')
      .notNull()
      .references(() => bots.id),
    /** 'managed' | 'cd' */
    workspaceKind: text('workspace_kind').notNull().default('managed'),
    cdPath: text('cd_path'),
    /** This group's tier override ('full' | 'workspace' | 'read-only'); null follows bots.tier. */
    tier: text('tier'),
    /** This group's model / thought level; null follows the bot's. */
    model: text('model'),
    effort: text('effort'),
    /** Highest message seq already delivered to this bot as context. */
    contextSeq: bigint('context_seq', { mode: 'number' }).notNull().default(0),
    /** Current ACP session id on the owner's machine, if any. */
    sessionId: text('session_id'),
    /** Context occupancy ({used, size}) last reported for that session; null before the first report or after /new. */
    contextUsage: jsonb('context_usage'),
    /** Set by /new ('requested'): the next dispatch opens a fresh session and reports why; cleared once sent. */
    newSessionReason: text('new_session_reason'),
    /** Last git status reported after a turn (partition mode status bar). */
    gitStatus: jsonb('git_status'),
    /**
     * 'pending' | 'cloning' | 'ready' | 'failed' as last reported by the owner's daemon; 'unbound' until the owner
     * picks one; 'confirm' until the owner chooses a managed or local clone for a bot that joined a repo group.
     */
    workspaceState: text('workspace_state').notNull().default('pending'),
    workspacePath: text('workspace_path'),
    workspaceError: text('workspace_error'),
    /** RepoAccessReason of a 'failed' workspace; 'denied' | 'network' | 'timeout' pause the bot (not dispatched). */
    workspaceReason: text('workspace_reason'),
    /** Agent commands last reported over ACP (available_commands_update) for / candidates. */
    agentCommands: jsonb('agent_commands').notNull().default([]),
    /** Absolute paths on the owner's machine the session also works in (ACP additionalDirectories); set by the owner. */
    extraDirs: jsonb('extra_dirs').$type<string[]>().notNull().default([]),
    /** When this bot last got the group knowledge base in a run.start; later changes go to its resumed session. */
    knowledgeAt: ts('knowledge_at'),
    removedAt: ts('removed_at'),
    addedAt: createdAt(),
  },
  (t) => [primaryKey({ columns: [t.groupId, t.botId] }), index('group_bots_bot').on(t.botId)],
)

// ── Timeline ────────────────────────────────────────────────────────────────
export const messages = pgTable(
  'messages',
  {
    id: id(),
    /** Global monotonic order; also used as the "since last @" cursor. */
    seq: bigserial('seq', { mode: 'number' }).notNull().unique(),
    groupId: uuid('group_id')
      .notNull()
      .references(() => groups.id),
    /** 'user' | 'bot' | 'event' */
    kind: text('kind').notNull(),
    authorUserId: uuid('author_user_id').references(() => users.id),
    authorBotId: uuid('author_bot_id').references(() => bots.id),
    body: text('body').notNull().default(''),
    /** { mentions: string[] (bot ids), quote?: {...}, attachments?: [...], event?: {...} } */
    meta: jsonb('meta').notNull().default({}),
    runId: uuid('run_id'),
    createdAt: createdAt(),
    editedAt: ts('edited_at'),
    /** Recalled by its author: body and meta attachments/quote are erased at that moment. */
    recalledAt: ts('recalled_at'),
  },
  (t) => [
    index('messages_group_seq').on(t.groupId, t.seq),
    // Unread @ of the viewer in the conversation list (groups/service.ts `mentioned`).
    index('messages_user_mentions').on(t.groupId, t.seq).where(sql`(${t.meta}->'userMentions') is not null`),
    index('messages_run').on(t.runId).where(sql`${t.runId} is not null`),
    // 会话统计 windows.
    index('messages_created').on(t.createdAt),
    // Send idempotency lookup (messages/routes.ts); not unique, the advisory lock serializes retries.
    index('messages_client_id')
      .on(t.groupId, t.authorUserId, sql`(${t.meta}->>'clientId')`)
      .where(sql`(${t.meta}->>'clientId') is not null`),
    index('messages_append_to')
      .on(sql`(${t.meta}->>'appendTo')`)
      .where(sql`(${t.meta}->>'appendTo') is not null`),
    index('messages_schedule_of')
      .on(sql`(${t.meta}->>'scheduleOf')`, t.seq)
      .where(sql`(${t.meta}->>'scheduleOf') is not null`),
    // Search (⌘K and the agent tool): `body ilike '%q%'` for terms of 3+ characters.
    index('messages_body_trgm').using('gin', t.body.op('gin_trgm_ops')),
  ],
)

/** 删除: messages a user hid from their own timeline only. */
export const messageHides = pgTable(
  'message_hides',
  {
    messageId: uuid('message_id')
      .notNull()
      .references(() => messages.id, { onDelete: 'cascade' }),
    userId: uuid('user_id')
      .notNull()
      .references(() => users.id),
    createdAt: createdAt(),
  },
  (t) => [primaryKey({ columns: [t.userId, t.messageId] })],
)

/** Emoji reactions: one row per (message, user, emoji). */
export const messageReactions = pgTable(
  'message_reactions',
  {
    messageId: uuid('message_id')
      .notNull()
      .references(() => messages.id, { onDelete: 'cascade' }),
    userId: uuid('user_id')
      .notNull()
      .references(() => users.id),
    emoji: text('emoji').notNull(),
    createdAt: createdAt(),
  },
  (t) => [primaryKey({ columns: [t.messageId, t.userId, t.emoji] })],
)

/**
 * `status IN (…)` with the statuses written out, not bound: a bound list hides from a generic plan that it implies a
 * partial index's predicate (`runs_group_live`).
 */
export const statusIn = (status: AnyColumn, statuses: readonly string[]) =>
  sql`${status} in (${sql.raw(statuses.map((s) => `'${s}'`).join(', '))})`

export const runs = pgTable(
  'runs',
  {
    id: id(),
    groupId: uuid('group_id')
      .notNull()
      .references(() => groups.id),
    botId: uuid('bot_id')
      .notNull()
      .references(() => bots.id),
    triggerMessageId: uuid('trigger_message_id')
      .notNull()
      .references(() => messages.id),
    triggerUserId: uuid('trigger_user_id').references(() => users.id),
    /** Human who started the chain; every hop is authorized against this user. */
    originUserId: uuid('origin_user_id')
      .notNull()
      .references(() => users.id),
    parentRunId: uuid('parent_run_id'),
    hop: integer('hop').notNull().default(1),
    /**
     * The run whose agent went on by itself here once a background task finished (run.continue). Holds no slot of
     * its bot: the group's next turn ends it.
     */
    continuationOf: uuid('continuation_of'),
    /** See protocol RunStatus. */
    status: text('status').notNull(),
    step: text('step').notNull().default(''),
    /** `step`'s translatable source when the server wrote it; stale once `step` is rewritten from elsewhere. */
    stepI18n: jsonb('step_i18n').$type<I18nText>(),
    filesChanged: integer('files_changed').notNull().default(0),
    /** { input?, output?, total?, costUsd? } or null when the adapter did not report. */
    usage: jsonb('usage'),
    newSessionReason: text('new_session_reason'),
    /** The ACP session the run ended with (run.done); a reply branches from its run's session. */
    sessionAfter: text('session_after'),
    summary: text('summary').notNull().default(''),
    queuedAt: createdAt(),
    startedAt: ts('started_at'),
    endedAt: ts('ended_at'),
    /** Partition /stop leftovers (plan D7): 'pending' | 'kept' | 'discarded'. */
    interrupt: text('interrupt'),
    stoppedBy: uuid('stopped_by').references(() => users.id),
    /** Unified diff of the turn (redacted); purged with run_events after retention. */
    patch: text('patch'),
    /** Repos `patch` spans (RunDone.repos); purged with it. */
    patchRepos: jsonb('patch_repos').$type<DiffRepo[]>().notNull().default([]),
    /** Secrets injected into the run: names and sources, never values. */
    secrets: jsonb('secrets').$type<RunSecret[]>().notNull().default([]),
    /** Plugins sent in its run.start: the only versions its machine may download. */
    plugins: jsonb('plugins').$type<PluginRef[]>().notNull().default([]),
    /** Latest state of each subagent / background task by id: { subagents: {id: state}, tasks: {id: state} }. */
    delegation: jsonb('delegation').notNull().default({}),
    /**
     * Bots that take over once this run completes (the hand_off tool); an @ in the reply alone relays nothing.
     * `groupId`: the hop runs in that other group instead of the run's own.
     */
    handoffs: jsonb('handoffs')
      .$type<{ botId: string; task: string; groupId?: string }[]>()
      .notNull()
      .default([]),
    /**
     * Set with the terminal state of a run that reported run.done, cleared once its follow-up work (relay, requeued
     * appends, notifications) is done: a run left flagged is finished again by a repeated run.done or on reconnect.
     */
    finalizing: boolean('finalizing').notNull().default(false),
    /** How many 打断并追加 messages the agent applied (run.done); the rest are requeued while finalizing. */
    appendsApplied: integer('appends_applied').notNull().default(0),
    purgedAt: ts('purged_at'),
    /** Requested at dispatch, then as the daemon reported them in effect (session.config). */
    model: text('model'),
    effort: text('effort'),
    /** Force group: RunSyncDone as reported with run.done. */
    sync: jsonb('sync').$type<RunSyncDone>(),
    /** What the run's agent settings came from (session.config); null = codex / not reported. */
    settings: jsonb('settings').$type<RunSettingsSnapshot>(),
    /** What search matches besides the bot's name, filled once the run ended (runs/search-text.ts); null till then. */
    searchText: text('search_text'),
    /** Pages published with html_render (their attachments), posted with the final reply. */
    htmlRenders: jsonb('html_renders').$type<HtmlRenderRef[]>().notNull().default([]),
    /** Artifact ids sent in its run.start (RunStart.artifacts): the only ones its machine may read or submit. */
    artifacts: jsonb('artifacts').$type<string[]>().notNull().default([]),
  },
  (t) => [
    index('runs_bot_status').on(t.botId, t.status),
    index('runs_group').on(t.groupId),
    index('runs_group_bot_ended').on(t.groupId, t.botId, t.endedAt),
    index('runs_group_bot_started').on(t.groupId, t.botId, t.startedAt),
    index('runs_parent').on(t.parentRunId),
    index('runs_trigger').on(t.triggerMessageId),
    index('runs_started').on(t.startedAt),
    index('runs_queued').on(t.queuedAt),
    index('runs_waiting').on(t.queuedAt).where(sql`${t.status} = 'offline_wait'`),
    index('runs_finalizing').on(t.botId).where(sql`${t.finalizing}`),
    index('runs_unpurged_ended').on(t.endedAt).where(sql`${t.purgedAt} is null`),
    index('runs_group_live').on(t.groupId).where(statusIn(t.status, LIVE_RUN_STATUSES)),
    index('runs_search_text').using('gin', t.searchText.op('gin_trgm_ops')),
    index('runs_search_pending').on(t.queuedAt).where(sql`${t.searchText} is null`),
  ],
)

/** Full run process (thoughts, tool calls, output, diffs). Redacted; purged after retention. */
export const runEvents = pgTable(
  'run_events',
  {
    id: bigserial('id', { mode: 'number' }).primaryKey(),
    runId: uuid('run_id')
      .notNull()
      .references(() => runs.id),
    kind: text('kind').notNull(),
    payload: jsonb('payload').notNull(),
    createdAt: createdAt(),
  },
  (t) => [index('run_events_run').on(t.runId, t.id)],
)

/** Agent permission requests awaiting / decided by the bot owner (spec §3.4). Kept forever for accountability. */
export const approvals = pgTable(
  'approvals',
  {
    id: id(),
    runId: uuid('run_id')
      .notNull()
      .references(() => runs.id),
    /** Daemon's id for the pending ACP request. */
    requestId: text('request_id').notNull(),
    title: text('title').notNull(),
    toolKind: text('tool_kind').notNull(),
    detail: text('detail').notNull(),
    /** Why the daemon forwarded the request; old records use the generic reason. */
    reason: text('reason').notNull().default('not_allowed'),
    options: jsonb('options').notNull(),
    /** What an allow_always answer adds to the bot's alwaysAllow. */
    remember: jsonb('remember').$type<string[]>().notNull().default([]),
    /** 'pending' | 'approved' | 'rejected' | 'expired' | 'void' */
    status: text('status').notNull().default('pending'),
    /** 'stopped' | 'chain_stopped' | 'ended' when status = 'void'. */
    voidReason: text('void_reason'),
    decidedBy: uuid('decided_by').references(() => users.id),
    decidedAt: ts('decided_at'),
    expiresAt: ts('expires_at').notNull(),
    createdAt: createdAt(),
  },
  (t) => [index('approvals_run').on(t.runId), index('approvals_pending').on(t.status, t.expiresAt)],
)

/** Uploaded files (spec §8.7). Stored on the server's disk (encrypted at rest in M5); bound to a message once sent. */
export const attachments = pgTable(
  'attachments',
  {
    id: id(),
    uploaderId: uuid('uploader_id')
      .notNull()
      .references(() => users.id),
    groupId: uuid('group_id')
      .notNull()
      .references(() => groups.id),
    /** null until the message (or question answer) that carries it is stored. */
    messageId: uuid('message_id'),
    name: text('name').notNull(),
    size: integer('size').notNull(),
    mime: text('mime').notNull(),
    /** Path under the server's data dir. */
    storageKey: text('storage_key').notNull(),
    createdAt: createdAt(),
  },
  (t) => [index('attachments_message').on(t.messageId)],
)

/** One question card from the built-in ask tool (spec §8.8); answers are kept forever (audit). */
export const questionSets = pgTable(
  'question_sets',
  {
    id: id(),
    runId: uuid('run_id')
      .notNull()
      .references(() => runs.id),
    requestId: text('request_id').notNull(),
    questions: jsonb('questions').notNull(),
    /** 'pending' | 'answered' | 'expired' | 'void' */
    status: text('status').notNull().default('pending'),
    answers: jsonb('answers'),
    /** Attachment ids sent with the answer. */
    attachmentIds: jsonb('attachment_ids').$type<string[]>().notNull().default([]),
    answeredBy: uuid('answered_by').references(() => users.id),
    answeredAt: ts('answered_at'),
    expiresAt: ts('expires_at').notNull(),
    createdAt: createdAt(),
  },
  (t) => [index('question_sets_run').on(t.runId), index('question_sets_pending').on(t.status, t.expiresAt)],
)

/** 倾向: a member's leaning toward an option of a pending card, for reference only (not a vote). */
export const questionLeanings = pgTable(
  'question_leanings',
  {
    questionSetId: uuid('question_set_id')
      .notNull()
      .references(() => questionSets.id, { onDelete: 'cascade' }),
    questionId: text('question_id').notNull(),
    choice: integer('choice').notNull(),
    userId: uuid('user_id')
      .notNull()
      .references(() => users.id),
    createdAt: createdAt(),
  },
  (t) => [primaryKey({ columns: [t.questionSetId, t.questionId, t.choice, t.userId] })],
)

// ── Previews (plan 结果预览) ─────────────────────────────────────────────────
/** Processes hosted by a daemon (built-in `service_start`); the daemon owns them, this is the registry it reports. */
export const services = pgTable(
  'services',
  {
    /** Chosen by the daemon (ServiceInfo.id). */
    id: uuid('id').primaryKey(),
    machineId: uuid('machine_id')
      .notNull()
      .references(() => machines.id),
    groupId: uuid('group_id')
      .notNull()
      .references(() => groups.id),
    botId: uuid('bot_id')
      .notNull()
      .references(() => bots.id),
    runId: uuid('run_id').references(() => runs.id),
    name: text('name').notNull(),
    command: text('command').notNull(),
    cwd: text('cwd').notNull(),
    port: integer('port'),
    /** 'starting' | 'running' | 'exited' | 'failed' */
    status: text('status').notNull(),
    exitCode: integer('exit_code'),
    exitedAt: ts('exited_at'),
    createdAt: createdAt(),
  },
  (t) => [
    index('services_group').on(t.groupId, t.botId),
    index('services_machine').on(t.machineId, t.status),
  ],
)

export const previews = pgTable(
  'previews',
  {
    id: id(),
    /** Subdomain label in domain mode; random, unguessable. */
    slug: text('slug').notNull().unique(),
    /** 'http' | 'static' | 'gui' | 'miniprogram' | 'artifact' */
    kind: text('kind').notNull(),
    machineId: uuid('machine_id')
      .notNull()
      .references(() => machines.id),
    groupId: uuid('group_id')
      .notNull()
      .references(() => groups.id),
    botId: uuid('bot_id')
      .notNull()
      .references(() => bots.id),
    serviceId: uuid('service_id').references(() => services.id),
    attachmentId: uuid('attachment_id').references(() => attachments.id),
    /** Daemon loopback port (http / gui). */
    port: integer('port'),
    /** Mini program: the project's absolute directory on the machine; `path` is then `/<page>?<query>`. */
    project: text('project'),
    path: text('path').notNull().default('/'),
    title: text('title').notNull(),
    /** Port mode: the server port this preview listens on while open. */
    publicPort: integer('public_port'),
    createdByRunId: uuid('created_by_run_id').references(() => runs.id),
    /** The card message posted for it. */
    messageId: uuid('message_id'),
    lastAccessAt: ts('last_access_at'),
    /** Its first-screen PNG (data dir `previews/<id>.png`) was last taken then. */
    snapshotAt: ts('snapshot_at'),
    /** 'login': a mini program whose devtools nobody is logged in to; the snapshot is their login QR code. */
    awaiting: text('awaiting'),
    /** Why the machine could not take the last snapshot (shown on the card until one works). */
    snapshotError: text('snapshot_error'),
    /** kind 'artifact': served from the artifact's blobs, not through the tunnel. */
    artifactId: uuid('artifact_id').references(() => artifacts.id),
    /** A fixed version; null follows the head. */
    artifactVersionId: uuid('artifact_version_id').references(() => artifactVersions.id),
    closedAt: ts('closed_at'),
    createdAt: createdAt(),
  },
  (t) => [
    index('previews_group').on(t.groupId, t.closedAt),
    index('previews_artifact').on(t.artifactId).where(sql`${t.artifactId} is not null`),
    index('previews_machine').on(t.machineId, t.closedAt),
  ],
)

/** Public links (plan P8): created by people only, always expiring, managed in the admin console. */
export const previewShares = pgTable(
  'preview_shares',
  {
    id: id(),
    previewId: uuid('preview_id')
      .notNull()
      .references(() => previews.id),
    tokenHash: text('token_hash').notNull().unique(),
    createdBy: uuid('created_by')
      .notNull()
      .references(() => users.id),
    expiresAt: ts('expires_at').notNull(),
    revokedAt: ts('revoked_at'),
    visitCount: integer('visit_count').notNull().default(0),
    lastVisitAt: ts('last_visit_at'),
    createdAt: createdAt(),
  },
  (t) => [index('preview_shares_preview').on(t.previewId)],
)

/** MCP servers injected into new sessions over ACP (spec §7.1): platform (sysadmins) → team → group layers. */
export const mcpServers = pgTable(
  'mcp_servers',
  {
    id: id(),
    /** 'platform' | 'team' | 'group' */
    scope: text('scope').notNull().default('platform'),
    teamId: uuid('team_id').references(() => teams.id),
    groupId: uuid('group_id').references(() => groups.id),
    name: text('name').notNull(),
    enabled: boolean('enabled').notNull().default(true),
    config: jsonb('config').notNull(),
    updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [unique().on(t.scope, t.teamId, t.groupId, t.name).nullsNotDistinct()],
)

/** Inherited (platform / team) MCP servers a group's admins turned off for that group alone. */
export const groupMcpOverrides = pgTable(
  'group_mcp_overrides',
  {
    groupId: uuid('group_id')
      .notNull()
      .references(() => groups.id, { onDelete: 'cascade' }),
    name: text('name').notNull(),
    updatedBy: uuid('updated_by').references(() => users.id),
    updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [primaryKey({ columns: [t.groupId, t.name] })],
)

/**
 * A 填写密钥 card a bot posted for an MCP server: only `user_id` (the run's originator) fills `keys`, written straight
 * into the server's env / headers; the values never reach the agent, the message or the audit log.
 */
export const mcpSecretRequests = pgTable('mcp_secret_requests', {
  id: id(),
  mcpId: uuid('mcp_id')
    .notNull()
    .references(() => mcpServers.id, { onDelete: 'cascade' }),
  groupId: uuid('group_id')
    .notNull()
    .references(() => groups.id),
  runId: uuid('run_id').references(() => runs.id),
  userId: uuid('user_id')
    .notNull()
    .references(() => users.id),
  keys: jsonb('keys').$type<string[]>().notNull(),
  forceNewSession: boolean('force_new_session').notNull().default(false),
  messageId: uuid('message_id'),
  filledAt: ts('filled_at'),
  createdAt: createdAt(),
})

/**
 * Secret definitions (plan 团队密钥-方案), layered like `mcp_servers`; the shared value is seal()ed and never returned.
 * Injected into runs as env vars named `name`; MCP env / headers reference them as `${secret:NAME}`.
 */
export const secrets = pgTable(
  'secrets',
  {
    id: id(),
    /** 'platform' | 'team' | 'group' */
    scope: text('scope').notNull(),
    teamId: uuid('team_id').references(() => teams.id),
    groupId: uuid('group_id').references(() => groups.id, { onDelete: 'cascade' }),
    name: text('name').notNull(),
    description: text('description').notNull().default(''),
    /** 'shared' | 'shared_overridable' | 'personal' */
    mode: text('mode').notNull().default('shared'),
    /** null = every bot; otherwise only these bots get it injected. */
    botIds: jsonb('bot_ids').$type<string[]>(),
    enabled: boolean('enabled').notNull().default(true),
    expiresAt: ts('expires_at'),
    /** seal()ed shared value; null = not filled (always null for 'personal'). */
    value: text('value'),
    last4: text('last4'),
    valueUpdatedBy: uuid('value_updated_by').references(() => users.id),
    valueUpdatedAt: ts('value_updated_at'),
    updatedBy: uuid('updated_by').references(() => users.id),
    updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [unique().on(t.scope, t.teamId, t.groupId, t.name).nullsNotDistinct()],
)

/** A member's own value of a secret name within a team: used by every same-named definition the team's groups see. */
export const personalSecrets = pgTable(
  'personal_secrets',
  {
    id: id(),
    userId: uuid('user_id')
      .notNull()
      .references(() => users.id),
    teamId: uuid('team_id')
      .notNull()
      .references(() => teams.id),
    name: text('name').notNull(),
    /** seal()ed. */
    value: text('value').notNull(),
    last4: text('last4').notNull(),
    /** false: injected only into runs on the user's own machines (a machine's owner can read its processes' env). */
    allowForeignMachines: boolean('allow_foreign_machines').notNull().default(false),
    updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [unique().on(t.userId, t.teamId, t.name)],
)

/** A 填写密钥 card posted by `secret_request` (supersedes `mcp_secret_requests`, kept for old cards). */
export const secretRequests = pgTable('secret_requests', {
  id: id(),
  groupId: uuid('group_id')
    .notNull()
    .references(() => groups.id),
  runId: uuid('run_id').references(() => runs.id),
  /** 'origin' (userId fills personal values) | 'admins' (an admin of each definition's layer fills shared values) */
  audience: text('audience').notNull(),
  userId: uuid('user_id').references(() => users.id),
  names: jsonb('names').$type<string[]>().notNull(),
  forceNewSession: boolean('force_new_session').notNull().default(false),
  messageId: uuid('message_id'),
  filledAt: ts('filled_at'),
  createdAt: createdAt(),
})

/** Team skills (plan 团队Skill), layered like `mcp_servers`; `name` / `description` mirror the current version. */
export const skills = pgTable(
  'skills',
  {
    id: id(),
    /** 'platform' | 'team' | 'group' */
    scope: text('scope').notNull(),
    teamId: uuid('team_id').references(() => teams.id),
    groupId: uuid('group_id').references(() => groups.id),
    name: text('name').notNull(),
    description: text('description').notNull(),
    enabled: boolean('enabled').notNull().default(true),
    /** Not a foreign key: versions reference the skill, and the first one is inserted after it. */
    versionId: uuid('version_id'),
    updatedBy: uuid('updated_by').references(() => users.id),
    updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [unique().on(t.scope, t.teamId, t.groupId, t.name).nullsNotDistinct()],
)

/** Immutable snapshots of a skill folder; rolling back only moves `skills.version_id`. */
export const skillVersions = pgTable(
  'skill_versions',
  {
    id: id(),
    skillId: uuid('skill_id')
      .notNull()
      .references(() => skills.id, { onDelete: 'cascade' }),
    version: integer('version').notNull(),
    /** SkillFile[] sorted by path. */
    files: jsonb('files').notNull(),
    /** sha256 over the files: the daemon's cache key. */
    digest: text('digest').notNull(),
    size: integer('size').notNull(),
    createdBy: uuid('created_by').references(() => users.id),
    createdAt: createdAt(),
  },
  (t) => [unique().on(t.skillId, t.version)],
)

/** Inherited (platform / team) skills a group's admins turned off for that group alone. */
export const groupSkillOverrides = pgTable(
  'group_skill_overrides',
  {
    groupId: uuid('group_id')
      .notNull()
      .references(() => groups.id, { onDelete: 'cascade' }),
    name: text('name').notNull(),
    updatedBy: uuid('updated_by').references(() => users.id),
    updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [primaryKey({ columns: [t.groupId, t.name] })],
)

/** Plugins (plan 插件体系), layered like skills; `name` mirrors the current version's manifest. */
export const plugins = pgTable(
  'plugins',
  {
    id: id(),
    /** 'platform' | 'team' | 'group' */
    scope: text('scope').notNull(),
    teamId: uuid('team_id').references(() => teams.id),
    groupId: uuid('group_id').references(() => groups.id),
    name: text('name').notNull(),
    /** Not a foreign key: versions reference the plugin, and the first one is inserted after it. */
    versionId: uuid('version_id'),
    updatedBy: uuid('updated_by').references(() => users.id),
    updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [unique().on(t.scope, t.teamId, t.groupId, t.name).nullsNotDistinct()],
)

/** Immutable snapshots of a plugin folder. */
export const pluginVersions = pgTable(
  'plugin_versions',
  {
    id: id(),
    pluginId: uuid('plugin_id')
      .notNull()
      .references(() => plugins.id, { onDelete: 'cascade' }),
    /** Increments with every upload, independent of `manifest.version`. */
    revision: integer('revision').notNull(),
    /** SkillFile[] sorted by path. */
    files: jsonb('files').notNull(),
    manifest: jsonb('manifest').$type<PluginManifest>().notNull(),
    /** sha256 over the files: the daemon's cache key. */
    digest: text('digest').notNull(),
    size: integer('size').notNull(),
    createdBy: uuid('created_by').references(() => users.id),
    createdAt: createdAt(),
  },
  (t) => [unique().on(t.pluginId, t.revision)],
)

/** A group's switch of a plugin; no row = off. */
export const groupPlugins = pgTable(
  'group_plugins',
  {
    groupId: uuid('group_id')
      .notNull()
      .references(() => groups.id, { onDelete: 'cascade' }),
    pluginId: uuid('plugin_id')
      .notNull()
      .references(() => plugins.id, { onDelete: 'cascade' }),
    enabled: boolean('enabled').notNull(),
    updatedBy: uuid('updated_by').references(() => users.id),
    updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [primaryKey({ columns: [t.groupId, t.pluginId] })],
)

/** Scheduled tasks (plan 定时任务): at each firing the first available bot of `botIds` is @-ed in the owner's name. */
export const schedules = pgTable(
  'schedules',
  {
    id: id(),
    groupId: uuid('group_id')
      .notNull()
      .references(() => groups.id),
    /** Fires in this member's name and is authorized against them. */
    ownerId: uuid('owner_id')
      .notNull()
      .references(() => users.id),
    /** Set when a bot created it with the gonggong tools. */
    createdByBotId: uuid('created_by_bot_id').references(() => bots.id),
    createdByRunId: uuid('created_by_run_id'),
    name: text('name').notNull(),
    prompt: text('prompt').notNull(),
    /** Exactly one of `cron` (recurring, in `timezone`) and `runAt` (once). */
    cron: text('cron'),
    runAt: ts('run_at'),
    timezone: text('timezone').notNull(),
    /** Candidates, most suitable first. */
    botIds: jsonb('bot_ids').$type<string[]>().notNull(),
    /** Model / thought level per candidate bot id; absent = the defaults. */
    runOptions: jsonb('run_options').$type<Record<string, RunConfigPick>>().notNull().default({}),
    enabled: boolean('enabled').notNull().default(true),
    /** Why the server turned it off; null when off by hand. */
    pausedReason: jsonb('paused_reason').$type<I18nText>(),
    /** Null while disabled. */
    nextRunAt: ts('next_run_at'),
    lastFiredAt: ts('last_fired_at'),
    lastRunId: uuid('last_run_id'),
    lastBotId: uuid('last_bot_id'),
    /** Firings in a row whose run did not complete. */
    failStreak: integer('fail_streak').notNull().default(0),
    /** Its card in the group. */
    messageId: uuid('message_id'),
    createdAt: createdAt(),
    deletedAt: ts('deleted_at'),
  },
  (t) => [index('schedules_due').on(t.nextRunAt), index('schedules_group').on(t.groupId)],
)

/** Group knowledge base (群知识库): markdown entries every bot of the group reads; members and bots maintain them. */
export const groupKnowledge = pgTable(
  'group_knowledge',
  {
    id: id(),
    groupId: uuid('group_id')
      .notNull()
      .references(() => groups.id),
    title: text('title').notNull(),
    body: text('body').notNull(),
    tags: jsonb('tags').$type<string[]>().notNull().default([]),
    pinned: boolean('pinned').notNull().default(false),
    /** Bumped by content changes only (title / body / tags), not by pinning. */
    version: integer('version').notNull().default(1),
    updatedByUserId: uuid('updated_by_user_id').references(() => users.id),
    updatedByBotId: uuid('updated_by_bot_id').references(() => bots.id),
    createdAt: createdAt(),
    updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
    /** Deleted: kept with its versions, out of every list. */
    archivedAt: ts('archived_at'),
  },
  (t) => [index('group_knowledge_group').on(t.groupId, t.updatedAt)],
)

/** Every content version of an entry; rolling back copies an old one into a new version. */
export const groupKnowledgeVersions = pgTable(
  'group_knowledge_versions',
  {
    id: id(),
    entryId: uuid('entry_id')
      .notNull()
      .references(() => groupKnowledge.id, { onDelete: 'cascade' }),
    version: integer('version').notNull(),
    title: text('title').notNull(),
    body: text('body').notNull(),
    tags: jsonb('tags').$type<string[]>().notNull(),
    /** 'create' | 'update' | 'rollback' */
    action: text('action').notNull(),
    byUserId: uuid('by_user_id').references(() => users.id),
    byBotId: uuid('by_bot_id').references(() => bots.id),
    createdAt: createdAt(),
  },
  (t) => [unique().on(t.entryId, t.version)],
)

// ── Force sync (plan 强制同步) ───────────────────────────────────────────────
/** A force group's versions (F5); metadata is kept forever. */
export const syncVersions = pgTable(
  'sync_versions',
  {
    groupId: uuid('group_id')
      .notNull()
      .references(() => groups.id),
    version: integer('version').notNull(),
    /** The daemon's SyncSubmit.submitId: a resubmission returns this version. */
    submitId: uuid('submit_id').unique(),
    /** 'bot' | 'user' */
    authorKind: text('author_kind').notNull(),
    authorId: uuid('author_id').notNull(),
    runId: uuid('run_id'),
    /** SyncVersionTag[] */
    tags: jsonb('tags').$type<string[]>().notNull().default([]),
    files: integer('files').notNull(),
    /** sha256 of syncRootText over the head after this version (F14). */
    rootHash: text('root_hash').notNull(),
    createdAt: createdAt(),
  },
  (t) => [primaryKey({ columns: [t.groupId, t.version] })],
)

/** What each version changed: `hash` null = deleted. */
export const syncChanges = pgTable(
  'sync_changes',
  {
    groupId: uuid('group_id')
      .notNull()
      .references(() => groups.id),
    version: integer('version').notNull(),
    path: text('path').notNull(),
    hash: text('hash'),
    exec: boolean('exec').notNull(),
  },
  (t) => [primaryKey({ columns: [t.groupId, t.version, t.path] })],
)

/** The live files of the group's latest version. */
export const syncHead = pgTable(
  'sync_head',
  {
    groupId: uuid('group_id')
      .notNull()
      .references(() => groups.id),
    path: text('path').notNull(),
    hash: text('hash').notNull(),
    exec: boolean('exec').notNull(),
  },
  (t) => [primaryKey({ columns: [t.groupId, t.path] })],
)

/** A replica (group × bot, F3) as its daemon last reported it. */
export const syncReplicas = pgTable(
  'sync_replicas',
  {
    groupId: uuid('group_id')
      .notNull()
      .references(() => groups.id),
    botId: uuid('bot_id')
      .notNull()
      .references(() => bots.id),
    /** Takes part in versions since then (base accepted or aligned at the switch, or joined later); null = left out. */
    joinedAt: ts('joined_at'),
    /** sync.init due or in flight: 'base' | 'align' | 'force' (align discarding uncommitted changes). */
    pending: text('pending'),
    /** Last version applied with a matching rootHash; null before it joined. */
    version: integer('version'),
    rootHash: text('root_hash'),
    /** SyncReplicaIssue, null while clean; a matching sync.applied clears it. */
    issue: text('issue'),
    files: jsonb('files').$type<string[]>().notNull().default([]),
    total: integer('total').notNull().default(0),
    reason: text('reason'),
    /** `reason` as a translatable template (daemon-reported or the server's own); null from older daemons. */
    reasonI18n: jsonb('reason_i18n').$type<I18nText>(),
    /** The latest conflict result with the change it refused, turned into a sync_conflicts row once reported held. */
    lastConflict: jsonb('last_conflict'),
    syncedAt: ts('synced_at'),
    updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [primaryKey({ columns: [t.groupId, t.botId] }), index('sync_replicas_bot').on(t.botId)],
)

/** A held change waiting for a decision (F11). */
export const syncConflicts = pgTable(
  'sync_conflicts',
  {
    id: id(),
    groupId: uuid('group_id')
      .notNull()
      .references(() => groups.id),
    botId: uuid('bot_id')
      .notNull()
      .references(() => bots.id),
    submitId: uuid('submit_id').notNull().unique(),
    baseVersion: integer('base_version').notNull(),
    headVersion: integer('head_version').notNull(),
    /** SyncChange[]: the whole refused change. */
    changes: jsonb('changes').notNull(),
    /** SyncEntry[]: the head's state of each conflicting path. */
    conflicts: jsonb('conflicts').notNull(),
    resolvedAt: ts('resolved_at'),
    createdAt: createdAt(),
  },
  (t) => [index('sync_conflicts_group').on(t.groupId, t.resolvedAt)],
)

/** Web Push subscriptions (plan D13). */
export const pushSubscriptions = pgTable('push_subscriptions', {
  id: id(),
  userId: uuid('user_id')
    .notNull()
    .references(() => users.id),
  endpoint: text('endpoint').notNull().unique(),
  keys: jsonb('keys').notNull(),
  /** The subscriber's language (its Accept-Language when subscribing): pushes are rendered outside a request. */
  locale: text('locale').notNull().default('zh'),
  createdAt: createdAt(),
})

// ── Cross-cutting ───────────────────────────────────────────────────────────
export const notifications = pgTable(
  'notifications',
  {
    id: id(),
    userId: uuid('user_id')
      .notNull()
      .references(() => users.id),
    /** Team of the group / bot it is about; null for platform-level notices. */
    teamId: uuid('team_id').references(() => teams.id),
    /** NotificationType; rows of retired types are kept but ignored. */
    type: text('type').notNull(),
    payload: jsonb('payload').notNull(),
    readAt: ts('read_at'),
    /** approval / question: the request was settled, so there is nothing left to act on. */
    resolvedAt: ts('resolved_at'),
    createdAt: createdAt(),
  },
  (t) => [
    index('notifications_user').on(t.userId, t.createdAt),
    index('notifications_unread').on(t.userId, t.teamId).where(sql`${t.readAt} is null`),
    // resolveNotifications binds the payload key as a parameter, so an expression index on it would never match.
    index('notifications_unresolved').on(t.type).where(sql`${t.resolvedAt} is null`),
  ],
)

export const auditLogs = pgTable(
  'audit_logs',
  {
    id: bigserial('id', { mode: 'number' }).primaryKey(),
    /** 'approval' | 'question' | 'lock' | 'admin' | 'run' */
    category: text('category').notNull(),
    actorUserId: uuid('actor_user_id').references(() => users.id),
    action: text('action').notNull(),
    /** null for platform-level events. */
    teamId: uuid('team_id'),
    groupId: uuid('group_id'),
    detail: jsonb('detail').notNull().default({}),
    createdAt: createdAt(),
  },
  (t) => [index('audit_created').on(t.createdAt)],
)

export const systemParams = pgTable('system_params', {
  key: text('key').primaryKey(),
  value: jsonb('value').notNull(),
})

// ── 飞书联动 (plan 飞书联动-开发计划) ─────────────────────────────────────────
/** Feishu self-built apps: one system-wide 'main' app (login, human mirroring) and one per bot (F1). */
export const feishuApps = pgTable(
  'feishu_apps',
  {
    id: id(),
    /** 'main' | 'bot' */
    kind: text('kind').notNull(),
    /** The bot's team for 'bot'; null for the system-wide 'main' app. */
    teamId: uuid('team_id').references(() => teams.id),
    botId: uuid('bot_id')
      .references(() => bots.id)
      .unique(),
    appId: text('app_id').notNull().unique(),
    /** Sealed (lib/seal.ts). */
    appSecret: text('app_secret').notNull(),
    /** Long connection: 'connecting' | 'connected' | 'error' */
    status: text('status').notNull().default('connecting'),
    error: text('error'),
    /**
     * Why the scan-created app's dev config (long connection / redirect URL) is still not applied: Feishu's reason,
     * or 'no_public_url'. Retried in the background; null once applied or for manually entered apps.
     */
    configError: text('config_error'),
    updatedBy: uuid('updated_by')
      .notNull()
      .references(() => users.id),
    updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
    createdAt: createdAt(),
  },
  (t) => [uniqueIndex('feishu_apps_one_main').on(t.kind).where(sql`${t.kind} = 'main'`)],
)

/** A 共工 account's Feishu identity, via the main app's OAuth (F13); one to one both ways. */
export const feishuIdentities = pgTable('feishu_identities', {
  id: id(),
  userId: uuid('user_id')
    .notNull()
    .references(() => users.id)
    .unique(),
  unionId: text('union_id').notNull().unique(),
  /** Tenant-wide user_id when the main app may read it. */
  feishuUserId: text('feishu_user_id'),
  /** open_id under the main app. */
  openId: text('open_id').notNull(),
  name: text('name').notNull(),
  email: text('email'),
  avatar: text('avatar'),
  /** Sealed user tokens of the main app (send as user, read chat context); null once revoked. */
  accessToken: text('access_token'),
  refreshToken: text('refresh_token'),
  expiresAt: ts('expires_at'),
  refreshExpiresAt: ts('refresh_expires_at'),
  /** 飞书通知: pushed notifications also go to the user's DM with the main app. */
  notify: boolean('notify').notNull().default(false),
  updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
  createdAt: createdAt(),
})

/** 共工 group ↔ Feishu chat, one to one while bound. */
export const feishuChats = pgTable(
  'feishu_chats',
  {
    id: id(),
    groupId: uuid('group_id')
      .notNull()
      .references(() => groups.id),
    chatId: text('chat_id').notNull(),
    /** Chat name when bound, for display. */
    name: text('name').notNull().default(''),
    /** Off: web messages are not sent to the chat; Feishu messages still come in and get their run cards. */
    syncOutbound: boolean('sync_outbound').notNull().default(true),
    /** On: every user message of the chat comes in (stored without running bots), not only those @-ing a bot. */
    syncAll: boolean('sync_all').notNull().default(true),
    boundBy: uuid('bound_by')
      .notNull()
      .references(() => users.id),
    unboundAt: ts('unbound_at'),
    createdAt: createdAt(),
  },
  (t) => [
    uniqueIndex('feishu_chats_group').on(t.groupId).where(sql`${t.unboundAt} is null`),
    uniqueIndex('feishu_chats_chat').on(t.chatId).where(sql`${t.unboundAt} is null`),
  ],
)

/** Which Feishu message mirrors which 共工 message / card: dedup, loop guard, recall and edit sync. */
export const feishuMessageLinks = pgTable(
  'feishu_message_links',
  {
    id: id(),
    feishuMessageId: text('feishu_message_id').notNull().unique(),
    chatId: text('chat_id').notNull(),
    /** The app that sent ('out') or first delivered ('in') it. */
    appId: text('app_id').notNull(),
    /** 'in' | 'out' */
    direction: text('direction').notNull(),
    /**
     * 'message' | 'run_card' | 'question' | 'approval' | 'preview' | 'reaction' (a bot's working reaction: its
     * reaction_id is `feishuMessageId`, the message it is on is `feishuRef`) | 'custom_card' (sent by a run's
     * feishu_send_card).
     */
    kind: text('kind').notNull(),
    messageId: uuid('message_id').references(() => messages.id),
    runId: uuid('run_id').references(() => runs.id),
    /** question_sets / approvals / previews row a card stands for. */
    refId: uuid('ref_id'),
    /** Feishu id paired with it: a streaming run card's CardKit card_id, a reaction's message. */
    feishuRef: text('feishu_ref'),
    createdAt: createdAt(),
  },
  (t) => [index('feishu_links_message').on(t.messageId), index('feishu_links_run').on(t.runId)],
)

/** Machine terminals (我的机器管理 → 新建终端): a named directory on the owner's machine, listed among conversations. */
export const terminalSpaces = pgTable(
  'terminal_spaces',
  {
    id: id(),
    ownerId: uuid('owner_id')
      .notNull()
      .references(() => users.id),
    machineId: uuid('machine_id')
      .notNull()
      .references(() => machines.id, { onDelete: 'cascade' }),
    name: text('name').notNull(),
    /** Absolute directory on the machine the shell starts in. */
    cwd: text('cwd').notNull(),
    createdAt: createdAt(),
    lastActiveAt: timestamp('last_active_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [index('terminal_spaces_owner').on(t.ownerId)],
)

// ── Hosted artifacts (docs/plan/产物托管与编辑-开发计划.md §3.1) ──────────────
export const artifacts = pgTable(
  'artifacts',
  {
    id: id(),
    groupId: uuid('group_id')
      .notNull()
      .references(() => groups.id),
    pluginId: uuid('plugin_id').references(() => plugins.id),
    /** Its shell (`kit/`) and lint rules come from this version of the plugin. */
    pluginVersionId: uuid('plugin_version_id').references(() => pluginVersions.id),
    designSystemId: text('design_system_id'),
    title: text('title').notNull(),
    /** `design/<slug>` in the bots' workspaces. */
    dir: text('dir').notNull(),
    /** The bot it was created for: its previews hang off this bot. */
    botId: uuid('bot_id').references(() => bots.id),
    /** Not a foreign key: versions reference the artifact, and the first one is inserted after it. */
    headVersionId: uuid('head_version_id'),
    createdBy: uuid('created_by').references(() => users.id),
    /** The artifact card. */
    messageId: uuid('message_id'),
    /** Starred screen ids (not versioned). */
    favorites: jsonb('favorites').$type<string[]>().notNull().default([]),
    /** Bots that asked for it with artifact_checkout: their next run checks it out first, then they leave the list. */
    checkoutBotIds: jsonb('checkout_bot_ids').$type<string[]>().notNull().default([]),
    /** The secret of its public link (a preview share of the head preview), kept so members can copy it again. */
    shareToken: text('share_token'),
    archivedAt: ts('archived_at'),
    createdAt: createdAt(),
    updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [unique().on(t.groupId, t.dir), index('artifacts_bot').on(t.botId)],
)

/** Immutable. */
export const artifactVersions = pgTable(
  'artifact_versions',
  {
    id: id(),
    artifactId: uuid('artifact_id')
      .notNull()
      .references(() => artifacts.id),
    n: integer('n').notNull(),
    parentVersionId: uuid('parent_version_id'),
    /** 'run' | 'edit' | 'local' */
    source: text('source').notNull(),
    runId: uuid('run_id').references(() => runs.id),
    userId: uuid('user_id').references(() => users.id),
    submitKey: text('submit_key'),
    /** ArtifactFile[] sorted by path. */
    files: jsonb('files').$type<ArtifactFile[]>().notNull(),
    digest: text('digest').notNull(),
    thumbnailHash: text('thumbnail_hash'),
    /** Its parent was not the head when it was submitted. */
    stale: boolean('stale').notNull().default(false),
    issues: jsonb('issues').$type<LintIssue[]>().notNull().default([]),
    createdAt: createdAt(),
  },
  (t) => [unique().on(t.artifactId, t.n), unique().on(t.artifactId, t.submitKey)],
)

export const artifactAnnotations = pgTable(
  'artifact_annotations',
  {
    id: id(),
    artifactId: uuid('artifact_id')
      .notNull()
      .references(() => artifacts.id),
    versionId: uuid('version_id')
      .notNull()
      .references(() => artifactVersions.id),
    file: text('file').notNull(),
    ggId: text('gg_id'),
    selector: text('selector').notNull(),
    rect: jsonb('rect').$type<{ x: number; y: number; w: number; h: number }>().notNull(),
    snippet: text('snippet').notNull(),
    note: text('note').notNull(),
    authorId: uuid('author_id')
      .notNull()
      .references(() => users.id),
    /** 'open' | 'sent' | 'resolved' */
    status: text('status').notNull().default('open'),
    sentMessageId: uuid('sent_message_id'),
    createdAt: createdAt(),
  },
  (t) => [index('artifact_annotations_artifact').on(t.artifactId, t.versionId)],
)
