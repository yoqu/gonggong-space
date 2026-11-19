import { and, count, eq, inArray } from 'drizzle-orm'
import type { Ctx } from '../../context.js'
import { bots, groupBots, runs } from '../../db/schema.js'

/** Run statuses that still occupy a bot or keep a task/webhook busy. */
export const UNFINISHED = ['queued', 'offline_wait', 'running', 'awaiting_approval', 'awaiting_answer']

/** The first candidate that is online and idle, else the first online one (its run queues); null when none is. */
export async function pickAvailableBot<T extends { id: string; name: string; machineId: string | null }>(
  ctx: Ctx,
  groupId: string,
  candidates: T[],
): Promise<T | null> {
  if (!candidates.length) return null
  const ids = candidates.map((b) => b.id)
  const state = await ctx.db
    .select({ id: bots.id, binding: bots.binding, workspace: groupBots.workspaceState })
    .from(bots)
    .innerJoin(groupBots, and(eq(groupBots.botId, bots.id), eq(groupBots.groupId, groupId)))
    .where(inArray(bots.id, ids))
  const busy = await ctx.db
    .select({ botId: runs.botId, n: count() })
    .from(runs)
    .where(and(inArray(runs.botId, ids), inArray(runs.status, UNFINISHED)))
    .groupBy(runs.botId)
  const usable = candidates.filter((b) => {
    const st = state.find((x) => x.id === b.id)
    return (
      st?.binding === 'bound' &&
      !['unbound', 'confirm'].includes(st.workspace) &&
      !!b.machineId &&
      ctx.hub.isOnline(b.machineId)
    )
  })
  return usable.find((b) => !busy.some((x) => x.botId === b.id)) ?? usable[0] ?? null
}
