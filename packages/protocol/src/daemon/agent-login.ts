import { z } from 'zod'
import { AgentKind } from '../common.js'

// ── Agent interactive ACP login (daemon <-> server) ─────────────────────────
// Daemons with the `agent_login` feature run an agent's ACP `initialize` + `authenticate` flow
// on behalf of the machine owner, streaming auth methods, OAuth URLs, progress and the final result.

export const AgentAuthMethod = z.object({
  id: z.string(),
  name: z.string(),
  description: z.string().nullable().optional(),
})
export type AgentAuthMethod = z.infer<typeof AgentAuthMethod>

/** s2d: start or cancel an interactive agent login on the machine; answered by agent.login.* events. */
export const AgentLoginCmd = z.object({
  t: z.literal('agent.login'),
  op: z.enum(['start', 'cancel']),
  opId: z.string(),
  kind: AgentKind,
  /** Auth method id chosen by the owner (e.g. `internal`, `external`); omitted to list methods or use default. */
  methodId: z.string().optional(),
  /** Whether the daemon / CLI may open the system browser locally (false for remote web-driven login). */
  openBrowser: z.boolean().optional(),
})
export type AgentLoginCmd = z.infer<typeof AgentLoginCmd>

/** d2s: auth methods advertised by the agent's ACP `initialize` response. */
export const AgentLoginMethods = z.object({
  t: z.literal('agent.login.methods'),
  opId: z.string(),
  kind: AgentKind,
  methods: z.array(AgentAuthMethod),
})
export type AgentLoginMethods = z.infer<typeof AgentLoginMethods>

/** d2s: OAuth / browser URL emitted during `authenticate`; only ever shown to the owner, never posted to a group. */
export const AgentLoginAuth = z.object({
  t: z.literal('agent.login.auth'),
  opId: z.string(),
  kind: AgentKind,
  url: z.string(),
  methodId: z.string().optional(),
})
export type AgentLoginAuth = z.infer<typeof AgentLoginAuth>

/** d2s: stage / log line while agent login is in progress. */
export const AgentLoginProgress = z.object({
  t: z.literal('agent.login.progress'),
  opId: z.string(),
  kind: AgentKind,
  stage: z.string(),
  line: z.string().optional(),
})
export type AgentLoginProgress = z.infer<typeof AgentLoginProgress>

/** d2s: agent login finished (succeeded, failed, timed out, or cancelled). */
export const AgentLoginResult = z.object({
  t: z.literal('agent.login.result'),
  opId: z.string(),
  kind: AgentKind,
  ok: z.boolean(),
  error: z.string().optional(),
  user: z.string().optional(),
})
export type AgentLoginResult = z.infer<typeof AgentLoginResult>
