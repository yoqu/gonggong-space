import { z } from 'zod'
import { ConnectorCliState, ConnectorProfile } from './daemon/connectors.js'
import { GroupPluginDto } from './plugins.js'

export const ConnectorStatus = z.enum(['unconnected', 'unchecked', 'ok', 'expired', 'error'])
export type ConnectorStatus = z.infer<typeof ConnectorStatus>

/**
 * How a CLI connector reads for the caller: the CLI states plus `no_machine` (no online machine to connect on: none
 * of theirs, none of the group's bots' whose owner allows members to connect).
 */
export const ConnectorRunState = z.enum([...ConnectorCliState.options, 'no_machine'])
export type ConnectorRunState = z.infer<typeof ConnectorRunState>

/** The caller's profile on one online machine that runs the group's bots or is theirs. */
export const ConnectorMachineView = z.object({
  machineId: z.string(),
  machineName: z.string(),
  /** The caller owns the machine. */
  own: z.boolean(),
  profile: ConnectorProfile,
  state: ConnectorCliState,
  account: z.string().nullable(),
  /** The account is the caller's (Feishu user_id matches); null when it could not be told. */
  verified: z.boolean().nullable(),
  /** The group's bots on this machine. */
  botIds: z.array(z.string()),
})
export type ConnectorMachineView = z.infer<typeof ConnectorMachineView>

export const ConnectorCliView = z.object({
  /** The best state over `machines` (ready on any wins); `no_machine` when none. */
  state: ConnectorRunState,
  machines: z.array(ConnectorMachineView),
  /** Where 连接 runs (§4.5 order); null = no_machine. */
  target: z.string().nullable(),
  /** The group's bots that can use it for the caller now (tryDraft @s one of them first). */
  readyBotIds: z.array(z.string()),
})
export type ConnectorCliView = z.infer<typeof ConnectorCliView>

/**
 * GET /api/groups/:groupId/connectors — the group's connector plugins (category `connector`), with whether the
 * caller has connected each: every required secret resolves for a run they start (their own value, usable on others'
 * machines, or a shared value). Connecting is per person per team, not per group.
 */
export const ConnectorDto = GroupPluginDto.extend({
  /** Some required secret is personal or overridable: each person connects their own account. */
  personal: z.boolean(),
  connected: z.boolean(),
  /** Required secrets the caller still has to fill (personal ones only; shared ones are for a team admin). */
  missing: z.array(z.string()),
  /** Other plugins and skills of the group that read the same personal secrets: disconnecting also cuts them off. */
  sharedWith: z.array(z.string()),
  /** The caller's own switch in this group (on by default): off keeps it from the turns they start here. */
  on: z.boolean(),
  /**
   * Whether the connection works, as last checked: `unconnected` keys missing; `unchecked` not checked since it was
   * (re)connected, or a CLI login nobody reported yet; `ok`; `expired` the system refused the key / login; `error`
   * the check could not tell (unreachable, unexpected answer).
   */
  status: ConnectorStatus,
  /** Who it is connected as, when known (a CLI login's account). */
  account: z.string().nullable(),
  checkedAt: z.string().nullable(),
  /** CLI connectors (`manifest.connector.cli`) on daemons with `connectors`; null otherwise. */
  cli: ConnectorCliView.nullable().default(null),
})
export type ConnectorDto = z.infer<typeof ConnectorDto>
export const ConnectorList = z.object({ connectors: z.array(ConnectorDto) })
export type ConnectorList = z.infer<typeof ConnectorList>

/**
 * POST /api/groups/:groupId/connectors/:pluginId/connect — saves the caller's personal values for the connector's
 * secrets, usable on others' machines (a group bot rarely runs on the caller's own). Returns the updated ConnectorDto.
 */
export const ConnectReq = z.object({
  values: z.record(z.string().regex(/^[A-Z][A-Z0-9_]{1,63}$/), z.string().min(1).max(4096)),
})
export type ConnectReq = z.infer<typeof ConnectReq>
// DELETE /api/groups/:groupId/connectors/:pluginId/connection — deletes the caller's personal values of its secrets.

/** PUT /api/groups/:groupId/connectors/:pluginId/switch — the caller's own switch in this group. Returns the ConnectorDto. */
export const ConnectorSwitchReq = z.object({ on: z.boolean() })
export type ConnectorSwitchReq = z.infer<typeof ConnectorSwitchReq>
// POST /api/groups/:groupId/connectors/:pluginId/check — checks the caller's connection now (key-based connectors
// with a `check`); returns the ConnectorDto.

/**
 * POST /api/groups/:groupId/connectors/:pluginId/cli — runs a CLI action on `machineId` (default: the view's target)
 * for the caller's profile there. `connect` returns 202 at once: progress, links and the end come over the socket as
 * connector.cli.progress / connector.cli.auth / connector.cli.result to the caller only. Others answer the ConnectorDto.
 */
export const ConnectorCliReq = z.object({
  action: z.enum(['detect', 'connect', 'cancel', 'logout']),
  machineId: z.string().optional(),
  /** `connect`: only these Feishu domains (incremental scopes, from a 就地连接 card). */
  domains: z
    .array(z.string().regex(/^[a-z_]{1,30}$/))
    .max(30)
    .default([]),
})
export type ConnectorCliReq = z.infer<typeof ConnectorCliReq>
export const ConnectorCliStarted = z.object({ requestId: z.string(), machineId: z.string() })
export type ConnectorCliStarted = z.infer<typeof ConnectorCliStarted>

/**
 * A 就地连接 card posted by `connector_request` (phase 2): only `userId` (the turn's originator) can connect from it;
 * once their connector is ready the card is resolved and the run that asked goes on by itself.
 */
export const ConnectorCard = z.object({
  id: z.string(),
  pluginId: z.string(),
  connector: z.string(),
  title: z.string(),
  userId: z.string(),
  reason: z.enum(['unconnected', 'expired', 'missing_scope']),
  domains: z.array(z.string()),
  resolved: z.boolean(),
})
export type ConnectorCard = z.infer<typeof ConnectorCard>

/** PUT /api/machines/:id/member-connect — the owner allows group members to log their own CLI accounts in there. */
export const MachineMemberConnectReq = z.object({ allow: z.boolean() })
export type MachineMemberConnectReq = z.infer<typeof MachineMemberConnectReq>
