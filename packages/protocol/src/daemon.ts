import { z } from 'zod'

/** Bumped on any breaking change of the daemon <-> server wire format. */
export const PROTOCOL_VERSION = 1

export const AgentKind = z.enum(['claude', 'codex'])
export type AgentKind = z.infer<typeof AgentKind>

export const AgentInfo = z.object({
  kind: AgentKind,
  available: z.boolean(),
  version: z.string().nullable(),
  path: z.string().nullable(),
})
export type AgentInfo = z.infer<typeof AgentInfo>

export const Hello = z.object({
  t: z.literal('hello'),
  protocol: z.number().int(),
  daemonVersion: z.string(),
  machine: z.object({ name: z.string(), os: z.enum(['macos', 'linux', 'windows']), arch: z.string() }),
  agents: z.array(AgentInfo),
})

export const Heartbeat = z.object({ t: z.literal('heartbeat') })

export const DaemonToServer = z.discriminatedUnion('t', [Hello, Heartbeat])
export type DaemonToServer = z.infer<typeof DaemonToServer>

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

export const ServerToDaemon = z.discriminatedUnion('t', [Welcome, Reject])
export type ServerToDaemon = z.infer<typeof ServerToDaemon>
