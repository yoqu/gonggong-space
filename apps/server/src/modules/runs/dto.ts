import type { ApprovalDto, GroupParams, QuestionSetDto, RunDto, RunStatus, Usage } from '@gonggong/protocol'
import { and, asc, eq, inArray, type SQL, sql } from 'drizzle-orm'
import type { Ctx } from '../../context.js'
import { approvals, attachments, questionSets, runEvents, runs, statusIn, users } from '../../db/schema.js'
import { PARAM_DEFAULTS } from '../admin/params.js'
import { mirrorRun } from '../feishu/mirror.js'
import { cachedGroupParams } from '../groups/params.js'
import { memberIds } from '../messages/service.js'
import { attachmentDto, leaningsOf, questionSetDto } from '../questions/dto.js'
import { stepI18nOf } from './step.js'

export type RunRow = typeof runs.$inferSelect
type ApprovalRow = typeof approvals.$inferSelect

/** The columns a run card is built from: never the patch, which may be large. */
export const cardColumns = {
  id: runs.id,
  groupId: runs.groupId,
  botId: runs.botId,
  triggerMessageId: runs.triggerMessageId,
  triggerUserId: runs.triggerUserId,
  hop: runs.hop,
  status: runs.status,
  step: runs.step,
  stepI18n: runs.stepI18n,
  filesChanged: runs.filesChanged,
  usage: runs.usage,
  newSessionReason: runs.newSessionReason,
  queuedAt: runs.queuedAt,
  startedAt: runs.startedAt,
  endedAt: runs.endedAt,
  parentRunId: runs.parentRunId,
  continuationOf: runs.continuationOf,
  originUserId: runs.originUserId,
  interrupt: runs.interrupt,
  stoppedBy: runs.stoppedBy,
  delegation: runs.delegation,
  model: runs.model,
  effort: runs.effort,
  sync: runs.sync,
  secrets: runs.secrets,
  htmlRenders: runs.htmlRenders,
}
type CardRow = Pick<RunRow, keyof typeof cardColumns>

/** Pure mapping; `runDtoLoader` loads `approvals`, `questions` and `hopMax` (defaults: none / none / system param). */
export const runDto = (
  r: CardRow,
  extra: {
    approvals?: ApprovalDto[]
    questions?: QuestionSetDto[]
    hopMax?: number
    offlineWaitMin?: number
    lastActivityAt?: Date
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
  ...stepI18nOf(r),
  filesChanged: r.filesChanged,
  usage: (r.usage as Usage | null) ?? null,
  newSessionReason: r.newSessionReason,
  queuedAt: r.queuedAt.toISOString(),
  startedAt: r.startedAt?.toISOString() ?? null,
  endedAt: r.endedAt?.toISOString() ?? null,
  lastActivityAt: new Date(
    Math.max(
      extra.lastActivityAt?.getTime() ?? 0,
      r.endedAt?.getTime() ?? 0,
      r.startedAt?.getTime() ?? 0,
      r.queuedAt.getTime(),
    ),
  ).toISOString(),
  parentRunId: r.parentRunId,
  continuationOf: r.continuationOf,
  hopMax: extra.hopMax ?? PARAM_DEFAULTS.chainMaxHops,
  offlineWaitMin: extra.offlineWaitMin ?? PARAM_DEFAULTS.offlineWaitMin,
  originUserId: r.originUserId,
  approvals: extra.approvals ?? [],
  questions: extra.questions ?? [],
  interrupt: (r.interrupt as RunDto['interrupt']) ?? null,
  stoppedBy: r.stoppedBy,
  delegation: delegationDto(r.delegation as Delegation),
  model: r.model,
  effort: r.effort,
  sync: r.sync ?? null,
  secrets: r.secrets,
  ...(r.htmlRenders.length > 0 && { htmlRenders: r.htmlRenders }),
})

export type Delegation = { subagents?: Record<string, string>; tasks?: Record<string, string> }

function delegationDto({ subagents = {}, tasks = {} }: Delegation): RunDto['delegation'] {
  const states = Object.values(subagents)
  return {
    subagents: states.length,
    subagentsRunning: states.filter((s) => s === 'running').length,
    tasksRunning: Object.values(tasks).filter((s) => s === 'running' || s === 'paused').length,
  }
}

export const approvalDto = (a: ApprovalRow, decidedByName: string | null): ApprovalDto => ({
  id: a.id,
  runId: a.runId,
  title: a.title,
  toolKind: a.toolKind,
  detail: a.detail,
  reason: a.reason as ApprovalDto['reason'],
  options: a.options as ApprovalDto['options'],
  remember: a.remember,
  status: a.status as ApprovalDto['status'],
  voidReason: a.voidReason as ApprovalDto['voidReason'],
  decidedBy: a.decidedBy,
  decidedByName,
  decidedAt: a.decidedAt?.toISOString() ?? null,
  expiresAt: a.expiresAt.toISOString(),
  createdAt: a.createdAt.toISOString(),
})

/** Loads what cards need beyond the row (approval records, the group's hop limit) for `rows`, then maps them. */
export async function runDtoLoader(ctx: Ctx, rows: CardRow[]): Promise<(r: CardRow) => RunDto> {
  if (!rows.length) return (r) => runDto(r)
  const ids = rows.map((r) => r.id)
  const groupIds = [...new Set(rows.map((r) => r.groupId))]
  const [aps, qs, paramsByGroup, activity] = await Promise.all([
    ctx.db
      .select({ a: approvals, name: users.name })
      .from(approvals)
      .leftJoin(users, eq(users.id, approvals.decidedBy))
      .where(inArray(approvals.runId, ids))
      .orderBy(asc(approvals.createdAt)),
    ctx.db
      .select({ q: questionSets, name: users.name })
      .from(questionSets)
      .leftJoin(users, eq(users.id, questionSets.answeredBy))
      .where(inArray(questionSets.runId, ids))
      .orderBy(asc(questionSets.createdAt)),
    Promise.all(groupIds.map((id) => cachedGroupParams(ctx, id))),
    ctx.db
      .select({
        runId: runEvents.runId,
        lastActivityAt: sql<Date>`max(${runEvents.createdAt})`.mapWith(runEvents.createdAt),
      })
      .from(runEvents)
      .where(inArray(runEvents.runId, ids))
      .groupBy(runEvents.runId),
  ])
  const fileIds = qs.flatMap((x) => x.q.attachmentIds)
  const [files, leanings] = await Promise.all([
    fileIds.length
      ? ctx.db
          .select()
          .from(attachments)
          .where(inArray(attachments.id, fileIds))
          .then((rows) => rows.map(attachmentDto))
      : [],
    leaningsOf(
      ctx.db,
      qs.filter((x) => x.q.status === 'pending').map((x) => x.q.id),
    ),
  ])
  const params = new Map(groupIds.map((id, i) => [id, paramsByGroup[i]]))
  const activityByRun = new Map(activity.map((r) => [r.runId, r.lastActivityAt]))
  return (r) => {
    const p = params.get(r.groupId) as GroupParams
    return runDto(r, {
      approvals: aps.filter((x) => x.a.runId === r.id).map((x) => approvalDto(x.a, x.name)),
      questions: qs
        .filter((x) => x.q.runId === r.id)
        .map((x) => questionSetDto(x.q, x.name, files, leanings)),
      hopMax: p.chainMaxHops,
      offlineWaitMin: p.offlineWaitMin,
      lastActivityAt: activityByRun.get(r.id),
    })
  }
}

/** Run cards of a group in trigger order, for the timeline; `triggerMessageIds` limits them to one page. */
export const LIVE = ['running', 'awaiting_approval', 'awaiting_answer']

/** `withLive` also returns the group's live runs whose trigger is not among `triggerMessageIds`. */
export async function listRuns(
  ctx: Ctx,
  groupId: string,
  triggerMessageIds?: string[],
  withLive = false,
): Promise<RunDto[]> {
  // Two lookups, each served by its own index (runs_trigger, runs_group_live), instead of one OR over the group's
  // whole history.
  const select = (where?: SQL) =>
    ctx.db
      .select(cardColumns)
      .from(runs)
      .where(and(eq(runs.groupId, groupId), where))
  const [paged, live] = await Promise.all([
    !triggerMessageIds
      ? select()
      : triggerMessageIds.length
        ? select(inArray(runs.triggerMessageId, triggerMessageIds))
        : [],
    triggerMessageIds && withLive ? select(statusIn(runs.status, LIVE)) : [],
  ])
  const seen = new Set(paged.map((r) => r.id))
  const rows = [...paged, ...live.filter((r) => !seen.has(r.id))].sort(
    (a, b) => a.queuedAt.getTime() - b.queuedAt.getTime(),
  )
  return rows.map(await runDtoLoader(ctx, rows))
}

/** Pushes a change of the card's step or usage alone, without loading what the rest of the card needs. */
export async function publishStep(ctx: Ctx, r: CardRow, lastActivityAt = ctx.now()) {
  ctx.bus.publish(await memberIds(ctx, r.groupId), {
    t: 'run.step',
    runId: r.id,
    groupId: r.groupId,
    botId: r.botId,
    step: r.step,
    ...stepI18nOf(r),
    usage: (r.usage as Usage | null) ?? null,
    lastActivityAt: lastActivityAt.toISOString(),
  })
}

export const publishRun = (ctx: Ctx, run: CardRow) => publishRuns(ctx, [run])

/** Pushes several run cards with one load. */
export async function publishRuns(ctx: Ctx, rows: CardRow[]) {
  const toDto = await runDtoLoader(ctx, rows)
  for (const run of rows) {
    ctx.bus.publish(await memberIds(ctx, run.groupId), { t: 'run.updated', run: toDto(run) })
    await mirrorRun(ctx, run)
  }
}
