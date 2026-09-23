import { sql } from 'drizzle-orm'
import {
  bigint,
  bigserial,
  boolean,
  index,
  integer,
  jsonb,
  pgTable,
  primaryKey,
  text,
  timestamp,
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
  name: text('name').notNull(),
  os: text('os').notNull(),
  arch: text('arch').notNull(),
  tokenHash: text('token_hash').notNull().unique(),
  daemonVersion: text('daemon_version'),
  protocol: integer('protocol'),
  /** AgentInfo[] as last reported by the daemon. */
  agents: jsonb('agents').notNull().default([]),
  lastSeenAt: ts('last_seen_at'),
  revokedAt: ts('revoked_at'),
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
    /** Highest message seq already delivered to this bot as context. */
    contextSeq: bigint('context_seq', { mode: 'number' }).notNull().default(0),
    /** Current ACP session id on the owner's machine, if any. */
    sessionId: text('session_id'),
    /** Last git status reported after a turn (partition mode status bar). */
    gitStatus: jsonb('git_status'),
    /** 'pending' | 'cloning' | 'ready' | 'failed' — as last reported by the owner's daemon. */
    workspaceState: text('workspace_state').notNull().default('pending'),
    workspacePath: text('workspace_path'),
    workspaceError: text('workspace_error'),
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
  },
  (t) => [index('messages_group_seq').on(t.groupId, t.seq)],
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
