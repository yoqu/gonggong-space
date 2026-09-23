import { z } from 'zod'
import { AgentKind, RunStatus, Tier, Usage } from './common.js'

/** Bumped on any breaking change of the daemon <-> server wire format. */
export const PROTOCOL_VERSION = 1

export const AgentInfo = z.object({
  kind: AgentKind,
  available: z.boolean(),
  version: z.string().nullable(),
  path: z.string().nullable(),
})
export type AgentInfo = z.infer<typeof AgentInfo>

export const MachineInfo = z.object({
  name: z.string().min(1),
  os: z.enum(['macos', 'linux', 'windows']),
  arch: z.string(),
})
export type MachineInfo = z.infer<typeof MachineInfo>

// ── REST: POST /api/daemon/login (bind code → long-lived machine token) ──────
export const DaemonLoginReq = z.object({ code: z.string(), machine: MachineInfo })
export const DaemonLoginRes = z.object({ token: z.string(), machineId: z.string(), ownerName: z.string() })
export type DaemonLoginRes = z.infer<typeof DaemonLoginRes>

// ── Shared run payloads ─────────────────────────────────────────────────────
/** A group message replayed to a bot as context ("since you were last @-ed"). */
export const ContextMessage = z.object({
  seq: z.number().int(),
  author: z.string(),
  /** 'user' for humans, 'bot' for other bots' final replies. */
  kind: z.enum(['user', 'bot']),
  body: z.string(),
  at: z.string(),
})
export type ContextMessage = z.infer<typeof ContextMessage>

export const RunStart = z.object({
  t: z.literal('run.start'),
  runId: z.string(),
  groupId: z.string(),
  bot: z.object({
    id: z.string(),
    name: z.string(),
    agentKind: AgentKind,
    systemPrompt: z.string(),
    tier: Tier,
  }),
  workspace: z.object({
    /** null → managed empty workspace (group without repo). */
    repo: z.object({ url: z.string(), branch: z.string() }).nullable(),
    /** Absolute local path when the owner used /cd; null → managed path. */
    cdPath: z.string().nullable(),
  }),
  /** Resume this ACP session if possible; null → start a new one. */
  resumeSessionId: z.string().nullable(),
  /** When starting a new session because resume failed, replay this many recent messages. */
  prompt: z.object({
    text: z.string(),
    triggeredBy: z.string(),
    context: z.array(ContextMessage),
  }),
})
export type RunStart = z.infer<typeof RunStart>

/** Incremental process events streamed while a run is in progress. */
export const RunEvent = z.discriminatedUnion('kind', [
  z.object({ kind: z.literal('status'), status: RunStatus, step: z.string() }),
  z.object({ kind: z.literal('text'), delta: z.string() }),
  z.object({ kind: z.literal('thought'), delta: z.string() }),
  z.object({
    kind: z.literal('tool'),
    toolCallId: z.string(),
    title: z.string(),
    /** ACP ToolKind: read | edit | delete | move | search | execute | think | fetch | other */
    toolKind: z.string(),
    status: z.enum(['pending', 'in_progress', 'completed', 'failed']),
    /** Redaction happens server-side before persistence. */
    detail: z.string().optional(),
  }),
  z.object({ kind: z.literal('usage'), usage: Usage }),
])
export type RunEvent = z.infer<typeof RunEvent>

// ── daemon → server ─────────────────────────────────────────────────────────
export const Hello = z.object({
  t: z.literal('hello'),
  protocol: z.number().int(),
  token: z.string(),
  daemonVersion: z.string(),
  machine: MachineInfo,
  agents: z.array(AgentInfo),
})
export const Heartbeat = z.object({ t: z.literal('heartbeat') })
export const RunEventMsg = z.object({ t: z.literal('run.event'), runId: z.string(), event: RunEvent })
export const RunDone = z.object({
  t: z.literal('run.done'),
  runId: z.string(),
  outcome: z.enum(['completed', 'interrupted', 'failed']),
  /** Final agent reply (markdown); posted to the group as the bot's message. */
  reply: z.string(),
  filesChanged: z.number().int(),
  usage: Usage.nullable(),
  sessionId: z.string().nullable(),
  /** Set when a new session was opened, e.g. 'resume_failed' | 'first' | 'requested'. */
  newSessionReason: z.string().nullable(),
  error: z.string().nullable(),
})
export type RunDone = z.infer<typeof RunDone>

export const DaemonToServer = z.discriminatedUnion('t', [Hello, Heartbeat, RunEventMsg, RunDone])
export type DaemonToServer = z.infer<typeof DaemonToServer>

// ── server → daemon ─────────────────────────────────────────────────────────
export const Welcome = z.object({
  t: z.literal('welcome'),
  machineId: z.string(),
  heartbeatSec: z.number().int(),
})
export const RejectReason = z.enum(['protocol', 'revoked', 'unauthorized'])
export const Reject = z.object({
  t: z.literal('reject'),
  reason: RejectReason,
  message: z.string(),
  minProtocol: z.number().int().optional(),
})
export const RunCancel = z.object({ t: z.literal('run.cancel'), runId: z.string() })

export const ServerToDaemon = z.discriminatedUnion('t', [Welcome, Reject, RunStart, RunCancel])
export type ServerToDaemon = z.infer<typeof ServerToDaemon>
