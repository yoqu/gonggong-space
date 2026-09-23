import type { ApprovalDto, RunDto, RunStatus, Usage } from '@aiws/protocol'
import { and, asc, eq, inArray } from 'drizzle-orm'
import type { Ctx } from '../../context.js'
import { approvals, groups, runs, users } from '../../db/schema.js'
import { memberIds } from '../messages/service.js'

export type RunRow = typeof runs.$inferSelect
type ApprovalRow = typeof approvals.$inferSelect

export const DEFAULT_CHAIN_MAX_HOPS = 3

/** Pure mapping; `runDtos` loads `approvals` and `hopMax` (defaults: none / 3). */
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

export const approvalDto = (a: ApprovalRow, decidedByName: string | null): ApprovalDto => ({
  id: a.id,
  runId: a.runId,
  title: a.title,
  toolKind: a.toolKind,
  detail: a.detail,
  options: a.options as ApprovalDto['options'],
  status: a.status as ApprovalDto['status'],
  decidedBy: a.decidedBy,
  decidedByName,
  decidedAt: a.decidedAt?.toISOString() ?? null,
  expiresAt: a.expiresAt.toISOString(),
  createdAt: a.createdAt.toISOString(),
})

/** Group param `chainMaxHops` (spec §4.6). */
export const hopMaxOf = (params: unknown) => {
  const n = (params as { chainMaxHops?: unknown }).chainMaxHops
  return typeof n === 'number' ? n : DEFAULT_CHAIN_MAX_HOPS
}

/** Card DTOs with their approval records and their group's hop limit. */
export async function runDtos(ctx: Ctx, rows: RunRow[]): Promise<RunDto[]> {
  if (!rows.length) return []
  const aps = await ctx.db
    .select({ a: approvals, name: users.name })
    .from(approvals)
    .leftJoin(users, eq(users.id, approvals.decidedBy))
    .where(
      inArray(
        approvals.runId,
        rows.map((r) => r.id),
      ),
    )
    .orderBy(asc(approvals.createdAt))
  const params = new Map(
    (
      await ctx.db
        .select({ id: groups.id, params: groups.params })
        .from(groups)
        .where(inArray(groups.id, [...new Set(rows.map((r) => r.groupId))]))
    ).map((g) => [g.id, g.params]),
  )
  return rows.map((r) =>
    runDto(r, {
      approvals: aps.filter((x) => x.a.runId === r.id).map((x) => approvalDto(x.a, x.name)),
      hopMax: hopMaxOf(params.get(r.groupId) ?? {}),
    }),
  )
}

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
  return runDtos(ctx, rows)
}

export async function publishRun(ctx: Ctx, run: RunRow) {
  const [dto] = await runDtos(ctx, [run])
  ctx.bus.publish(await memberIds(ctx, run.groupId), { t: 'run.updated', run: dto! })
}
