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
  passwordHash: text('password_hash').notNull(),
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
  name: text('name').notNull(),
  /** 'group' | 'dm' */
  kind: text('kind').notNull(),
  notice: text('notice').notNull().default(''),
  /** The `group_notices` row behind `notice`; null when there is none. */
  noticeId: uuid('notice_id'),
  /** 'partition' | 'force' (P2) */
  mode: text('mode').notNull().default('partition'),
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

/** Team-wide history of remote repos bound to groups or found in /cd directories, one row per `repoKey`. */
export const repos = pgTable('repos', {
  id: id(),
  key: text('key').notNull().unique(),
  /** The latest URL it was used with, credentials removed. */
  url: text('url').notNull(),
  name: text('name').notNull(),
  lastBranch: text('last_branch'),
  lastUsedAt: ts('last_used_at').notNull().defaultNow(),
  /** Hidden from the picker until it is used again. */
  hiddenAt: ts('hidden_at'),
  createdAt: createdAt(),
})

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
  (t) => [primaryKey({ columns: [t.groupId, t.userId] })],
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
    /** Recalled by its author: body and meta attachments/quote are erased at that moment. */
    recalledAt: ts('recalled_at'),
  },
  (t) => [index('messages_group_seq').on(t.groupId, t.seq)],
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
    purgedAt: ts('purged_at'),
    /** Requested at dispatch, then as the daemon reported them in effect (session.config). */
    model: text('model'),
    effort: text('effort'),
  },
  (t) => [index('runs_bot_status').on(t.botId, t.status), index('runs_group').on(t.groupId)],
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

/** Global MCP layer maintained by sysadmins (spec §7.1), injected into new sessions over ACP. */
export const mcpServers = pgTable('mcp_servers', {
  id: id(),
  name: text('name').notNull().unique(),
  enabled: boolean('enabled').notNull().default(true),
  config: jsonb('config').notNull(),
  updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
})

/** Web Push subscriptions (plan D13). */
export const pushSubscriptions = pgTable('push_subscriptions', {
  id: id(),
  userId: uuid('user_id')
    .notNull()
    .references(() => users.id),
  endpoint: text('endpoint').notNull().unique(),
  keys: jsonb('keys').notNull(),
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
    /** 'approval' | 'question' | 'lock' | 'offline_expired' | 'chain_done' | 'bot_confirm' */
    type: text('type').notNull(),
    payload: jsonb('payload').notNull(),
    readAt: ts('read_at'),
    /** approval / question: the request was settled, so there is nothing left to act on. */
    resolvedAt: ts('resolved_at'),
    createdAt: createdAt(),
  },
  (t) => [index('notifications_user').on(t.userId, t.createdAt)],
)

export const auditLogs = pgTable(
  'audit_logs',
  {
    id: bigserial('id', { mode: 'number' }).primaryKey(),
    /** 'approval' | 'question' | 'lock' | 'admin' | 'run' */
    category: text('category').notNull(),
    actorUserId: uuid('actor_user_id').references(() => users.id),
    action: text('action').notNull(),
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
