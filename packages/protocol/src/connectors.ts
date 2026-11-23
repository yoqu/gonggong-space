import { z } from 'zod'
import { GroupPluginDto } from './plugins.js'

export const ConnectorStatus = z.enum(['unconnected', 'unchecked', 'ok', 'expired', 'error'])
export type ConnectorStatus = z.infer<typeof ConnectorStatus>

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
