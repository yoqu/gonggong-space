import { z } from 'zod'

// ── CLI connectors on the machine (plan 连接器-体验升级方案 §5) ─────
// Daemons with the `connectors` feature detect, install, log in and out the CLI behind a connector themselves, so
// connecting never goes through a chat turn. Commands are built in per driver: a manifest never names a command.

/** The CLIs the daemon knows how to drive. */
export const ConnectorDriver = z.enum(['lark-cli', 'meegle'])
export type ConnectorDriver = z.infer<typeof ConnectorDriver>

/**
 * A CLI profile: `default` is the machine owner's own login (used as is when it is the person's), `gg-<userId>` a
 * member's own profile on the machine, so members never act as one another.
 */
export const ConnectorProfile = z.string().regex(/^(default|gg-[0-9a-f-]{36})$/)
export type ConnectorProfile = z.infer<typeof ConnectorProfile>
export const memberProfile = (userId: string) => `gg-${userId}`

/**
 * A profile's state: `ready` logged in and working; `needs_login` set up but not logged in, or the login expired;
 * `needs_init` installed, no app bound yet (lark-cli `config init`); `not_installed`; `error` the CLI could not tell
 * (`detail` says why).
 */
export const ConnectorCliState = z.enum(['ready', 'needs_login', 'needs_init', 'not_installed', 'error'])
export type ConnectorCliState = z.infer<typeof ConnectorCliState>

/** What the daemon found for one connector and profile. */
export const ConnectorProbe = z.object({
  /** The connector plugin's name (e.g. `feishu`). */
  connector: z.string(),
  driver: ConnectorDriver,
  profile: ConnectorProfile,
  state: ConnectorCliState,
  /** Display name of the logged-in account. */
  account: z.string().nullable(),
  /** Feishu tenant-wide user_id of the account, when the CLI could read it (checked against the person's login). */
  feishuUserId: z.string().nullable(),
  /** When the access / refresh token runs out (ISO), when the CLI tells. */
  expiresAt: z.string().nullable(),
  refreshExpiresAt: z.string().nullable(),
  version: z.string().nullable(),
  detail: z.string().nullable(),
})
export type ConnectorProbe = z.infer<typeof ConnectorProbe>

/** The CLI connectors enabled anywhere the machine's bots run, sent on connect and when they change. */
export const ConnectorSpec = z.object({ connector: z.string(), driver: ConnectorDriver, npm: z.string() })
export type ConnectorSpec = z.infer<typeof ConnectorSpec>

/** s2d: the connectors to watch; the daemon probes `default` and the member profiles it has made, then reports. */
export const ConnectorsSync = z.object({
  t: z.literal('connectors.sync'),
  connectors: z.array(ConnectorSpec),
})

/**
 * s2d: one action on a connector's profile, answered by connectors.progress / connectors.auth then connectors.result.
 * `connect` installs when missing, binds an app when needed (lark-cli), logs in and waits for the person to approve
 * (up to 10 minutes; `cancel` with the same `requestId` stops it). `domains`: log in for these only (incremental
 * scopes); empty = the recommended set. `renew` refreshes the token so the login does not lapse.
 */
export const ConnectorsCmd = z.object({
  t: z.literal('connectors.cmd'),
  requestId: z.string(),
  action: z.enum(['detect', 'connect', 'cancel', 'logout', 'renew']),
  spec: ConnectorSpec,
  profile: ConnectorProfile,
  domains: z
    .array(z.string().regex(/^[a-z_]{1,30}$/))
    .max(30)
    .default([]),
})
export type ConnectorsCmd = z.infer<typeof ConnectorsCmd>

/** d2s: a line of what `connect` is doing (install output is capped by the daemon). */
export const ConnectorsProgress = z.object({
  t: z.literal('connectors.progress'),
  requestId: z.string(),
  stage: z.enum(['node', 'install', 'init', 'login']),
  line: z.string(),
})

/**
 * d2s: a link the person opens (or scans) to go on: `init` creates their Feishu app, `login` approves the login.
 * Only ever shown to that person, never posted to a group.
 */
export const ConnectorsAuth = z.object({
  t: z.literal('connectors.auth'),
  requestId: z.string(),
  step: z.enum(['init', 'login']),
  url: z.string().url(),
  userCode: z.string().nullable(),
  expiresAt: z.string().nullable(),
})
export type ConnectorsAuth = z.infer<typeof ConnectorsAuth>

/** d2s: the action is over; `probe` is the profile's state after it. */
export const ConnectorsResult = z.object({
  t: z.literal('connectors.result'),
  requestId: z.string(),
  ok: z.boolean(),
  error: z.string().nullable(),
  probe: ConnectorProbe.nullable(),
})
export type ConnectorsResult = z.infer<typeof ConnectorsResult>

/** d2s: every probe of the machine (replaces the last), after hello, every 30 minutes and after any change. */
export const ConnectorsUpdate = z.object({
  t: z.literal('connectors.update'),
  probes: z.array(ConnectorProbe),
})
export type ConnectorsUpdate = z.infer<typeof ConnectorsUpdate>

/**
 * RunStart.cliProfiles: the profile each CLI runs as for this turn's originator. The daemon puts shims first on the
 * agent's PATH that add `--profile <profile>`; `default` needs none.
 */
export const RunCliProfile = z.object({ driver: ConnectorDriver, profile: ConnectorProfile })
export type RunCliProfile = z.infer<typeof RunCliProfile>
