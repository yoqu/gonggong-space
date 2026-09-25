import type { GroupParams } from '@gonggong/protocol'
import type { Ctx } from '../../context.js'
import type { groups } from '../../db/schema.js'
import { sysParams } from '../admin/params.js'

const KEYS: (keyof GroupParams)[] = ['approvalTimeoutMin', 'chainMaxHops', 'offlineWaitMin']

/** System-wide defaults of the group-level params (管理后台 · 系统参数 over the spec values). */
export async function groupParamDefaults(ctx: Ctx): Promise<GroupParams> {
  const p = await sysParams(ctx.db)
  return Object.fromEntries(KEYS.map((k) => [k, p[k]])) as GroupParams
}

/** A group's own overrides (`groups.params`) over `defaults`. */
export const withDefaults = (own: unknown, defaults: GroupParams): GroupParams =>
  Object.fromEntries(KEYS.map((k) => [k, (own as Partial<GroupParams>)[k] ?? defaults[k]])) as GroupParams

/** Effective params of a group: its own overrides over the system defaults. */
export async function groupParams(ctx: Ctx, group: Pick<typeof groups.$inferSelect, 'params'>) {
  return withDefaults(group.params, await groupParamDefaults(ctx))
}
