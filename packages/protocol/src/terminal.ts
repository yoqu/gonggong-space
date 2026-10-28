import { z } from 'zod'
import { WorkspaceSpec } from './daemon.js'

/** Hello `terminals`, the `terminate` open action, and stale cursors resuming from retained output. */
export const TERMINAL_FEATURE = 'terminal-v2'
/** Machine terminals: a `cwd` on the terminal open names the directory instead of a bot workspace. */
export const TERMINAL_DIR_FEATURE = 'terminal-dir'
export const TERMINAL_IDLE_MS = 24 * 60 * 60 * 1000
export const TERMINAL_REPLAY_BYTES = 1024 * 1024
export const TERMINAL_REPLAY_CHUNKS = 4096
export const TERMINAL_MAX_PER_MACHINE = 8
export const TERMINAL_MAX_PER_USER = 4
export const TERMINAL_MAX_BUFFERED_BYTES = 4 * 1024 * 1024

export const TerminalStatus = z.enum(['running', 'exited', 'closed', 'daemon_restart'])
export const TerminalEndReason = z.enum([
  'user',
  'exited',
  'idle_timeout',
  'revoked',
  'daemon_restart',
  'shutdown',
  'error',
])

export const TerminalCreateReq = z.object({
  cols: z.number().int().min(2).max(500),
  rows: z.number().int().min(2).max(500),
})
export type TerminalCreateReq = z.infer<typeof TerminalCreateReq>

export const TerminalDto = z.object({
  sessionId: z.string().uuid(),
  groupId: z.string().uuid(),
  botId: z.string().uuid(),
  status: TerminalStatus,
  createdAt: z.string(),
  lastActiveAt: z.string(),
  exitCode: z.number().int().nullable(),
  reason: TerminalEndReason.nullable(),
})
export type TerminalDto = z.infer<typeof TerminalDto>

/** `terminate` ends the session and answers with its exit head; it needs no attached stream. */
export const TerminalOpen = z.object({
  action: z.enum(['create', 'attach', 'terminate']),
  sessionId: z.string().uuid(),
  groupId: z.string().uuid(),
  botId: z.string().uuid(),
  workspace: WorkspaceSpec,
  cols: z.number().int().min(2).max(500),
  rows: z.number().int().min(2).max(500),
  after: z.number().int().nonnegative(),
  /** A machine terminal's own absolute directory (its group and bot ids are both its space id); absent = the bot's workspace. */
  cwd: z.string().min(1).max(4096).optional(),
})
export type TerminalOpen = z.infer<typeof TerminalOpen>

/** A machine terminal (我的机器管理 → 新建终端): a named directory on one of my machines, kept as a conversation. */
export const TerminalSpaceDto = z.object({
  id: z.string().uuid(),
  machineId: z.string().uuid(),
  machineName: z.string(),
  name: z.string(),
  cwd: z.string(),
  createdAt: z.string(),
  lastActiveAt: z.string(),
})
export type TerminalSpaceDto = z.infer<typeof TerminalSpaceDto>

export const TERMINAL_SPACE_NAME_MAX = 60
export const TerminalSpaceCreateReq = z.object({
  machineId: z.string().uuid(),
  cwd: z.string().trim().min(1).max(4096),
  name: z.string().trim().min(1).max(TERMINAL_SPACE_NAME_MAX),
})
export type TerminalSpaceCreateReq = z.infer<typeof TerminalSpaceCreateReq>
export const TerminalSpaceUpdateReq = z.object({
  name: z.string().trim().min(1).max(TERMINAL_SPACE_NAME_MAX),
})

export const TerminalHead = z.object({
  sessionId: z.string().uuid(),
  status: TerminalStatus,
  cols: z.number().int().min(2).max(500),
  rows: z.number().int().min(2).max(500),
  next: z.number().int().nonnegative(),
  createdAt: z.string(),
  lastActiveAt: z.string(),
  exitCode: z.number().int().nullable(),
  reason: TerminalEndReason.nullable(),
})
export type TerminalHead = z.infer<typeof TerminalHead>

export const TerminalClientControl = z.discriminatedUnion('op', [
  z.object({
    op: z.literal('resize'),
    sessionId: z.string().uuid(),
    cols: z.number().int().min(2).max(500),
    rows: z.number().int().min(2).max(500),
  }),
  z.object({ op: z.literal('terminate'), sessionId: z.string().uuid() }),
  z.object({ op: z.literal('ping'), sessionId: z.string().uuid() }),
])
export type TerminalClientControl = z.infer<typeof TerminalClientControl>

export const TerminalDaemonControl = z.discriminatedUnion('op', [
  z.object({
    op: z.literal('state'),
    sessionId: z.string().uuid(),
    state: TerminalStatus,
    next: z.number().int().nonnegative(),
    exitCode: z.number().int().nullable(),
    reason: TerminalEndReason.nullable(),
  }),
  z.object({
    op: z.literal('exit'),
    sessionId: z.string().uuid(),
    state: TerminalStatus,
    next: z.number().int().nonnegative(),
    exitCode: z.number().int().nullable(),
    reason: TerminalEndReason.nullable(),
  }),
])
export type TerminalDaemonControl = z.infer<typeof TerminalDaemonControl>

export const TerminalLinkReq = z.object({
  path: z.string().min(1).max(4096),
  line: z.number().int().min(1).max(1_000_000).default(1),
})
export const TerminalLinkDto = z.object({
  path: z.string(),
  line: z.number().int().min(1),
  exists: z.boolean(),
})
export type TerminalLinkDto = z.infer<typeof TerminalLinkDto>
