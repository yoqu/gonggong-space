import type { I18nText, RunSyncDone } from '@gonggong/protocol'
import { sql } from 'drizzle-orm'
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
  avatar: text('avatar'),
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
  /** Owner's local directory used when a group has no binding of its own. */
  defaultWorkspace: text('default_workspace'),
  /** Default model / thought level as the adapter names them; null = the adapter's default. */
  model: text('model'),
  effort: text('effort'),
  createdBy: uuid('created_by')
    .notNull()
    .references(() => users.id),
  deletedAt: ts('deleted_at'),
  createdAt: createdAt(),
})

// ── Groups ──────────────────────────────────────────────────────────────────
export const groups = pgTable('groups', {
  id: id(),
  teamId: teamId(),
  name: text('name').notNull(),
  /** 'group' | 'dm' */
  kind: text('kind').notNull(),
  notice: text('notice').notNull().default(''),
  /** The `group_notices` row behind `notice`; null when there is none. */
  noticeId: uuid('notice_id'),
  /** 'partition' | 'force' (P2) */
  mode: text('mode').notNull().default('partition'),
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
    /** 'pending' | 'cloning' | 'ready' | 'failed' as last reported by the owner's daemon; 'unbound' until the owner picks one. */
    workspaceState: text('workspace_state').notNull().default('pending'),
    workspacePath: text('workspace_path'),
    workspaceError: text('workspace_error'),
    /** RepoAccessReason of a 'failed' workspace; 'denied' | 'network' | 'timeout' pause the bot (not dispatched). */
    workspaceReason: text('workspace_reason'),
    /** Agent commands last reported over ACP (available_commands_update) for / candidates. */
    agentCommands: jsonb('agent_commands').notNull().default([]),
    removedAt: ts('removed_at'),
    addedAt: createdAt(),
  },
  (t) => [primaryKey({ columns: [t.groupId, t.botId] })],
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
    index('messages_run').on(t.runId).where(sql`${t.runId} is not null`),
    // Send idempotency lookup (messages/routes.ts); not unique, the advisory lock serializes retries.
    index('messages_client_id')
      .on(t.groupId, t.authorUserId, sql`(${t.meta}->>'clientId')`)
      .where(sql`(${t.meta}->>'clientId') is not null`),
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
    /** See protocol RunStatus. */
    status: text('status').notNull(),
    step: text('step').notNull().default(''),
    /** `step`'s translatable source when the server wrote it; stale once `step` is rewritten from elsewhere. */
    stepI18n: jsonb('step_i18n').$type<I18nText>(),
    filesChanged: integer('files_changed').notNull().default(0),
    /** { input?, output?, total?, costUsd? } or null when the adapter did not report. */
    usage: jsonb('usage'),
    newSessionReason: text('new_session_reason'),
    summary: text('summary').notNull().default(''),
    queuedAt: createdAt(),
    startedAt: ts('started_at'),
    endedAt: ts('ended_at'),
    /** Partition /stop leftovers (plan D7): 'pending' | 'kept' | 'discarded'. */
    interrupt: text('interrupt'),
    stoppedBy: uuid('stopped_by').references(() => users.id),
    /** Unified diff of the turn (redacted); purged with run_events after retention. */
    patch: text('patch'),
    /** Latest state of each subagent / background task by id: { subagents: {id: state}, tasks: {id: state} }. */
    delegation: jsonb('delegation').notNull().default({}),
    /** Bots that take over once this run completes (the hand_off tool); an @ in the reply alone relays nothing. */
    handoffs: jsonb('handoffs').$type<{ botId: string; task: string }[]>().notNull().default([]),
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
  },
  (t) => [
    index('runs_bot_status').on(t.botId, t.status),
    index('runs_group').on(t.groupId),
    index('runs_group_bot_ended').on(t.groupId, t.botId, t.endedAt),
    index('runs_trigger').on(t.triggerMessageId),
    index('runs_started').on(t.startedAt),
    index('runs_waiting').on(t.queuedAt).where(sql`${t.status} = 'offline_wait'`),
    index('runs_finalizing').on(t.botId).where(sql`${t.finalizing}`),
    index('runs_unpurged_ended').on(t.endedAt).where(sql`${t.purgedAt} is null`),
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
    options: jsonb('options').notNull(),
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
    /** 'http' | 'static' | 'gui' | 'miniprogram' */
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
    closedAt: ts('closed_at'),
    createdAt: createdAt(),
  },
  (t) => [
    index('previews_group').on(t.groupId, t.closedAt),
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
  (t) => [primaryKey({ columns: [t.groupId, t.botId] })],
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
     * reaction_id is `feishuMessageId`, the message it is on is `feishuRef`).
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
