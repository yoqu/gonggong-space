import { DEFAULT_OFFLINE_WAIT_MIN, type GroupParams } from '@aiws/protocol'
import { inArray } from 'drizzle-orm'
import type { Ctx } from '../../context.js'
import { type groups, systemParams } from '../../db/schema.js'
import { DEFAULT_CHAIN_MAX_HOPS } from '../runs/dto.js'

/** Spec §10 (partition mode). */
const SPEC_DEFAULTS: GroupParams = {
  approvalTimeoutMin: 30,
  chainMaxHops: DEFAULT_CHAIN_MAX_HOPS,
  offlineWaitMin: DEFAULT_OFFLINE_WAIT_MIN,
}
const KEYS = Object.keys(SPEC_DEFAULTS) as (keyof GroupParams)[]

/** System-wide defaults: sysadmin-set `system_params` rows (same keys) over the spec values. */
export async function groupParamDefaults(ctx: Ctx): Promise<GroupParams> {
  const rows = await ctx.db.select().from(systemParams).where(inArray(systemParams.key, KEYS))
  const out = { ...SPEC_DEFAULTS }
  for (const r of rows) if (typeof r.value === 'number') out[r.key as keyof GroupParams] = r.value
  return out
}

/** Effective params of a group: its own overrides over the system defaults. */
export async function groupParams(ctx: Ctx, group: typeof groups.$inferSelect): Promise<GroupParams> {
  const own = group.params as Partial<GroupParams>
  const defaults = await groupParamDefaults(ctx)
  return Object.fromEntries(KEYS.map((k) => [k, own[k] ?? defaults[k]])) as GroupParams
}
