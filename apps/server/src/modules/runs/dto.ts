import type { RunDto, RunStatus, Usage } from '@aiws/protocol'
import { asc, eq } from 'drizzle-orm'
import type { Ctx } from '../../context.js'
import { groupMembers, runs } from '../../db/schema.js'

export type RunRow = typeof runs.$inferSelect

export const runDto = (r: RunRow): RunDto => ({
  id: r.id,
  groupId: r.groupId,
  botId: r.botId,
  triggerMessageId: r.triggerMessageId,
  triggerUserId: r.triggerUserId,
  hop: r.hop,
  status: r.status as RunStatus,
  step: r.step,
  filesChanged: r.filesChanged,
  usage: (r.usage as Usage | null) ?? null,
  newSessionReason: r.newSessionReason,
  queuedAt: r.queuedAt.toISOString(),
  startedAt: r.startedAt?.toISOString() ?? null,
  endedAt: r.endedAt?.toISOString() ?? null,
})

/** All run cards of a group in trigger order, for the timeline. */
export async function listRuns(ctx: Ctx, groupId: string): Promise<RunDto[]> {
  const rows = await ctx.db.select().from(runs).where(eq(runs.groupId, groupId)).orderBy(asc(runs.queuedAt))
  return rows.map(runDto)
}

export async function memberIds(ctx: Ctx, groupId: string) {
  const rows = await ctx.db
    .select({ id: groupMembers.userId })
    .from(groupMembers)
    .where(eq(groupMembers.groupId, groupId))
  return rows.map((r) => r.id)
}

export async function publishRun(ctx: Ctx, run: RunRow) {
  ctx.bus.publish(await memberIds(ctx, run.groupId), { t: 'run.updated', run: runDto(run) })
}
