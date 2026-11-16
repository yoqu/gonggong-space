import { z } from 'zod'
import { API_PROTOCOLS } from '../agents.js'
import { AgentKind } from '../common.js'
import { AgentCatalog } from './machine.js'

export const ApiProtocol = z.enum(API_PROTOCOLS)
export type ApiProtocol = z.infer<typeof ApiProtocol>

/** One agent on a machine: detection and install in one (replaces AgentInfo and the agents' ToolStatus). */
export const AgentState = z.object({
  kind: AgentKind,
  available: z.boolean(),
  version: z.string().nullable(),
  path: z.string().nullable(),
  /** Oldest CLI version the bundled ACP adapter supports; older ones still run but the bot shows a warning. */
  minVersion: z.string().nullable().default(null),
  /** What the adapter offers, probed by the daemon; null until probed or when unavailable. */
  catalog: AgentCatalog.nullable().default(null),
  /** Latest version on the machine's mirror (last check, cached by the daemon). */
  latest: z.string().nullable().default(null),
  /** Installed by Gonggong under its home, so it can upgrade it. */
  managed: z.boolean().default(false),
  /** How the user's own install is upgraded (Gonggong runs it on 升级); null when managed or unknown. */
  upgradeCommand: z.string().nullable().default(null),
  /** Not on npm, so Gonggong neither installs nor upgrades it: the maker's install command, run on the machine. */
  installCommand: z.string().nullable().default(null),
})
export type AgentState = z.infer<typeof AgentState>

/** Node.js, the runtime the managed agents run on; listed apart from them. */
export const RuntimeState = z.object({
  installed: z.boolean(),
  version: z.string().nullable(),
  latest: z.string().nullable(),
  managed: z.boolean(),
  path: z.string().nullable(),
})
export type RuntimeState = z.infer<typeof RuntimeState>
