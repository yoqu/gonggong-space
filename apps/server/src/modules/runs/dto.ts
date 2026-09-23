import type { ApprovalDto, RunDto, RunStatus, Usage } from '@aiws/protocol'
import { and, asc, eq, inArray } from 'drizzle-orm'
import type { Ctx } from '../../context.js'
import { runs } from '../../db/schema.js'
import { approvalsByRun } from '../approvals/dto.js'
import { memberIds } from '../messages/service.js'

export type RunRow = typeof runs.$inferSelect

export const DEFAULT_CHAIN_MAX_HOPS = 3

/** `approvals` and `hopMax` are loaded by callers that have them (listRuns / run detail); cards default to none / 3. */
export const runDto = (r: RunRow, extra: { approvals?: ApprovalDto[]; hopMax?: number } = {}): RunDto => ({
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
  parentRunId: r.parentRunId,
  hopMax: extra.hopMax ?? DEFAULT_CHAIN_MAX_HOPS,
  originUserId: r.originUserId,
  approvals: extra.approvals ?? [],
  interrupt: (r.interrupt as RunDto['interrupt']) ?? null,
  stoppedBy: r.stoppedBy,
})

/** Run cards of a group in trigger order, for the timeline; `triggerMessageIds` limits them to one page. */
export async function listRuns(ctx: Ctx, groupId: string, triggerMessageIds?: string[]): Promise<RunDto[]> {
  if (triggerMessageIds?.length === 0) return []
  const rows = await ctx.db
    .select()
    .from(runs)
    .where(
      and(
        eq(runs.groupId, groupId),
        triggerMessageIds ? inArray(runs.triggerMessageId, triggerMessageIds) : undefined,
      ),
    )
    .orderBy(asc(runs.queuedAt))
  const approvals = await approvalsByRun(
    ctx,
    rows.map((r) => r.id),
  )
  return rows.map((r) => runDto(r, { approvals: approvals.get(r.id) }))
}

export async function publishRun(ctx: Ctx, run: RunRow) {
  const approvals = (await approvalsByRun(ctx, [run.id])).get(run.id)
  ctx.bus.publish(await memberIds(ctx, run.groupId), { t: 'run.updated', run: runDto(run, { approvals }) })
}
