import { z } from 'zod'
import { AgentKind, Attachment } from '../common.js'
import { MachineInfo } from './machine.js'

// ── REST: POST /api/daemon/login (bind code → long-lived machine token) ──────
/**
 * POST /api/daemon/login. `createBot` (gg login --create-bot, Agent 自助接入): once bound, the server makes the owner a
 * bot of that agent on this machine (one per machine and agent) and a DM with it.
 */
export const DaemonLoginReq = z.object({
  code: z.string(),
  machine: MachineInfo,
  createBot: z.object({ agent: AgentKind }).optional(),
})
export type DaemonLoginReq = z.infer<typeof DaemonLoginReq>
/** `restored`: this host was bound before, so its machine (and the bots on it) is reused. `bot`: from `createBot`. */
export const DaemonLoginRes = z.object({
  token: z.string(),
  machineId: z.string(),
  ownerName: z.string(),
  restored: z.boolean(),
  bot: z.object({ id: z.string(), name: z.string(), groupId: z.string() }).optional(),
})
export type DaemonLoginRes = z.infer<typeof DaemonLoginRes>

// ── REST: 接入申请 (bind code expired → the user allows the machine on the Web) ──
/**
 * POST /api/daemon/link-requests. `code`: the expired bind code, only used to find who issued it and ask them first;
 * anyone signed in who opens `url` may allow it, and the machine is theirs.
 */
export const LinkRequestReq = z.object({
  machine: MachineInfo,
  createBot: z.object({ agent: AgentKind }).optional(),
  code: z.string().optional(),
})
export type LinkRequestReq = z.infer<typeof LinkRequestReq>
/** `secret` is only for polling; `userCode` is shown on both sides to check it is the same machine. */
export const LinkRequestRes = z.object({
  id: z.string(),
  secret: z.string(),
  userCode: z.string(),
  url: z.string(),
  expiresAt: z.string(),
  intervalMs: z.number().int(),
})
export type LinkRequestRes = z.infer<typeof LinkRequestRes>
/** POST /api/daemon/link-requests/:id/poll. */
export const LinkPollReq = z.object({ secret: z.string() })
export type LinkPollReq = z.infer<typeof LinkPollReq>
/** Allowed: the machine is bound at this poll, once, with the same result as POST /api/daemon/login. */
export const LinkPollRes = z.discriminatedUnion('status', [
  z.object({ status: z.enum(['pending', 'denied', 'expired']) }),
  DaemonLoginRes.extend({ status: z.literal('approved') }),
])
export type LinkPollRes = z.infer<typeof LinkPollRes>

// ── REST for the daemon / desktop app (machine token, `Authorization: Bearer`) ─
/** POST /api/daemon/net: a measured round trip + throughput to the server. */
export const NetReportReq = z.object({ latencyMs: z.number().min(0), bandwidthMbps: z.number().min(0) })
/** GET /api/daemon/net/probe?bytes=N streams N random bytes for the bandwidth measurement (max 16 MiB). */
export const NET_PROBE_MAX_BYTES = 16 * 1024 * 1024
/**
 * POST /api/daemon/runs/:runId/tools/:name: an gonggong MCP tool call made during that run (see tools.ts). Tool-level
 * failures come back as `isError` text for the agent; `attachments` are written into the workspace by the daemon.
 */
export const ToolCallReq = z.object({ arguments: z.unknown() })
export const ToolCallRes = z.object({
  text: z.string(),
  isError: z.boolean(),
  attachments: z.array(Attachment),
})
export type ToolCallRes = z.infer<typeof ToolCallRes>
/**
 * GET /api/daemon/workspaces: every (group, bot) pair of this machine's bots, removed ones included, so the desktop
 * app can name and classify the dirs under `<home>/workspaces`. `removed` = bot left the group, bot deleted or group
 * archived; `repoId` = the group's current repo (the managed dir name). POST …/:groupId/:botId/reset-cd = `/cd --reset`.
 */
export const DaemonWorkspaceDto = z.object({
  groupId: z.string(),
  groupName: z.string(),
  groupKind: z.enum(['group', 'dm']),
  botId: z.string(),
  botName: z.string(),
  kind: z.enum(['managed', 'cd']),
  cdPath: z.string().nullable(),
  repoId: z.string().nullable(),
  /** The group's extra repos, cloned beside the repo: in use too. */
  extraRepoIds: z.array(z.string()).optional(),
  removed: z.boolean(),
  running: z.boolean(),
})
export type DaemonWorkspaceDto = z.infer<typeof DaemonWorkspaceDto>
