import {
  type GroupParams,
  type ReplyStyle,
  type SystemParams,
  TEAM_PARAM_KEYS,
  TeamParams,
} from '@gonggong/protocol'
import { eq } from 'drizzle-orm'
import type { Ctx } from '../../context.js'
import type { Db } from '../../db/client.js'
import { groups, teams } from '../../db/schema.js'
import { fail } from '../../lib/errors.js'
import { sysParams } from '../admin/params.js'

const KEYS: (keyof GroupParams)[] = ['approvalTimeoutMin', 'chainMaxHops', 'offlineWaitMin']

/** A team's stored overrides that still validate (like system params, an invalid one falls back). */
export function teamOverrides(raw: unknown): TeamParams {
  const own = raw as Record<string, unknown>
  return Object.fromEntries(
    TEAM_PARAM_KEYS.filter((k) => own[k] !== undefined && TeamParams.shape[k].safeParse(own[k]).success).map(
      (k) => [k, own[k]],
    ),
  ) as TeamParams
}

/** Overrides per team, read on hot paths like system params; `PATCH /api/teams/:id` is their only writer. */
const overrides = new WeakMap<object, Map<string, Promise<TeamParams>>>()

export function forgetTeamParams(db: object, teamId: string) {
  overrides.get(db)?.delete(teamId)
}

/** Platform defaults under the team's overrides (plan D9). */
export async function teamParams(db: Pick<Db, 'select'>, teamId: string): Promise<SystemParams> {
  const platform = await sysParams(db)
  let byTeam = overrides.get(db)
  if (!byTeam) {
    byTeam = new Map()
    overrides.set(db, byTeam)
  }
  let hit = byTeam.get(teamId)
  if (!hit) {
    const map = byTeam
    hit = db
      .select({ params: teams.params })
      .from(teams)
      .where(eq(teams.id, teamId))
      .then(([team]) => teamOverrides(team?.params ?? {}))
    map.set(teamId, hit)
    hit.catch(() => map.get(teamId) === hit && map.delete(teamId))
  }
  return { ...platform, ...(await hit) }
}

/** Groups from before the setting have none and keep the technical tone. */
export const replyStyleOf = (own: unknown): ReplyStyle =>
  (own as { replyStyle?: ReplyStyle }).replyStyle ?? 'tech'

/** A group's own overrides (`groups.params`) over `defaults`. */
export const withDefaults = (own: unknown, defaults: GroupParams): GroupParams =>
  Object.fromEntries(KEYS.map((k) => [k, (own as Partial<GroupParams>)[k] ?? defaults[k]])) as GroupParams

/** Effective group-level params: platform → team → the group's own overrides. */
export async function groupParams(ctx: Ctx, group: Pick<typeof groups.$inferSelect, 'params' | 'teamId'>) {
  return withDefaults(group.params, await teamParams(ctx.db, group.teamId))
}

type OwnParams = Pick<typeof groups.$inferSelect, 'params' | 'teamId'>

/** Each group's own overrides and team, read on every run card push; `PUT /api/groups/:id/params` is their only writer. */
const ownParams = new WeakMap<object, Map<string, Promise<OwnParams>>>()

export function forgetGroupParams(db: object, groupId: string) {
  ownParams.get(db)?.delete(groupId)
}

/** `groupParams` of a group by id, its row cached like team overrides. */
export async function cachedGroupParams(ctx: Ctx, groupId: string) {
  let byGroup = ownParams.get(ctx.db)
  if (!byGroup) {
    byGroup = new Map()
    ownParams.set(ctx.db, byGroup)
  }
  let hit = byGroup.get(groupId)
  if (!hit) {
    const map = byGroup
    hit = ctx.db
      .select({ params: groups.params, teamId: groups.teamId })
      .from(groups)
      .where(eq(groups.id, groupId))
      .then(([group]) => group ?? Promise.reject(new Error(`group ${groupId} not found`)))
    map.set(groupId, hit)
    hit.catch(() => map.get(groupId) === hit && map.delete(groupId))
  }
  return groupParams(ctx, await hit)
}

/** Every param as it applies in the group: platform → team → group (plan D9). */
export async function effectiveParams(db: Pick<Db, 'select'>, groupId: string): Promise<SystemParams> {
  const [group] = await db
    .select({ teamId: groups.teamId, params: groups.params })
    .from(groups)
    .where(eq(groups.id, groupId))
  if (!group) return fail('not_found', '群不存在')
  const base = await teamParams(db, group.teamId)
  return { ...base, ...withDefaults(group.params, base) }
}
