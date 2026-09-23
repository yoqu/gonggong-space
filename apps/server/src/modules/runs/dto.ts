import type { ApprovalDto, QuestionSetDto, RunDto, RunStatus, Usage } from '@aiws/protocol'
import { and, asc, eq, inArray } from 'drizzle-orm'
import type { Ctx } from '../../context.js'
import { approvals, attachments, groups, questionSets, runs, users } from '../../db/schema.js'
import { sysParams } from '../admin/params.js'
import { memberIds } from '../messages/service.js'
import { attachmentDto, questionSetDto } from '../questions/dto.js'

export type RunRow = typeof runs.$inferSelect
type ApprovalRow = typeof approvals.$inferSelect

/** Pure mapping; `runDtoLoader` loads `approvals`, `questions` and `hopMax` (defaults: none / none / system param). */
export const runDto = (
  r: RunRow,
  extra: {
    approvals?: ApprovalDto[]
    questions?: QuestionSetDto[]
    hopMax?: number
    offlineWaitMin?: number
  } = {},
): RunDto => ({
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
  hopMax: extra.hopMax ?? sysParams().chainMaxHops,
  offlineWaitMin: extra.offlineWaitMin ?? sysParams().offlineWaitMin,
  originUserId: r.originUserId,
  approvals: extra.approvals ?? [],
  questions: extra.questions ?? [],
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
  voidReason: a.voidReason as ApprovalDto['voidReason'],
  decidedBy: a.decidedBy,
  decidedByName,
  decidedAt: a.decidedAt?.toISOString() ?? null,
  expiresAt: a.expiresAt.toISOString(),
  createdAt: a.createdAt.toISOString(),
})

/** Group param `offlineWaitMin` (spec §4.8). */
const offlineWaitOf = (params: unknown) => {
  const n = (params as { offlineWaitMin?: unknown }).offlineWaitMin
  return typeof n === 'number' ? n : sysParams().offlineWaitMin
}

/** Group param `chainMaxHops` (spec §4.6). */
export const hopMaxOf = (params: unknown) => {
  const n = (params as { chainMaxHops?: unknown }).chainMaxHops
  return typeof n === 'number' ? n : sysParams().chainMaxHops
}

/** Loads what cards need beyond the row (approval records, the group's hop limit) for `rows`, then maps them. */
export async function runDtoLoader(ctx: Ctx, rows: RunRow[]): Promise<(r: RunRow) => RunDto> {
  if (!rows.length) return (r) => runDto(r)
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
  const qs = await ctx.db
    .select({ q: questionSets, name: users.name })
    .from(questionSets)
    .leftJoin(users, eq(users.id, questionSets.answeredBy))
    .where(
      inArray(
        questionSets.runId,
        rows.map((r) => r.id),
      ),
    )
    .orderBy(asc(questionSets.createdAt))
  const fileIds = qs.flatMap((x) => x.q.attachmentIds)
  const files = fileIds.length
    ? (await ctx.db.select().from(attachments).where(inArray(attachments.id, fileIds))).map(attachmentDto)
    : []
  const params = new Map(
    (
      await ctx.db
        .select({ id: groups.id, params: groups.params })
        .from(groups)
        .where(inArray(groups.id, [...new Set(rows.map((r) => r.groupId))]))
    ).map((g) => [g.id, g.params]),
  )
  return (r) =>
    runDto(r, {
      approvals: aps.filter((x) => x.a.runId === r.id).map((x) => approvalDto(x.a, x.name)),
      questions: qs.filter((x) => x.q.runId === r.id).map((x) => questionSetDto(x.q, x.name, files)),
      hopMax: hopMaxOf(params.get(r.groupId) ?? {}),
      offlineWaitMin: offlineWaitOf(params.get(r.groupId) ?? {}),
    })
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
  return rows.map(await runDtoLoader(ctx, rows))
}

export async function publishRun(ctx: Ctx, run: RunRow) {
  const toDto = await runDtoLoader(ctx, [run])
  ctx.bus.publish(await memberIds(ctx, run.groupId), { t: 'run.updated', run: toDto(run) })
}
