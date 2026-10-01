import { type GroupParams, type SystemParams, TEAM_PARAM_KEYS, TeamParams } from '@gonggong/protocol'
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

/** Platform defaults under the team's overrides (plan D9). */
export async function teamParams(db: Pick<Db, 'select'>, teamId: string): Promise<SystemParams> {
  const platform = await sysParams(db)
  const [team] = await db.select({ params: teams.params }).from(teams).where(eq(teams.id, teamId))
  return { ...platform, ...teamOverrides(team?.params ?? {}) }
}

/** A group's own overrides (`groups.params`) over `defaults`. */
export const withDefaults = (own: unknown, defaults: GroupParams): GroupParams =>
  Object.fromEntries(KEYS.map((k) => [k, (own as Partial<GroupParams>)[k] ?? defaults[k]])) as GroupParams

/** Effective group-level params: platform → team → the group's own overrides. */
export async function groupParams(ctx: Ctx, group: Pick<typeof groups.$inferSelect, 'params' | 'teamId'>) {
  return withDefaults(group.params, await teamParams(ctx.db, group.teamId))
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
