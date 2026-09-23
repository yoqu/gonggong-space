import type { ApprovalRequest, PermissionOption } from '@aiws/protocol'
import { and, eq, inArray, lte, sql } from 'drizzle-orm'
import type { Ctx } from '../../context.js'
import { approvals, auditLogs, bots, groups, runs } from '../../db/schema.js'
import { fail } from '../../lib/errors.js'
import { sysParams } from '../admin/params.js'
import { notify } from '../notifications/notify.js'
import { approvalDto, publishRun } from '../runs/dto.js'

type Approval = typeof approvals.$inferSelect
type Settled = 'approved' | 'rejected' | 'expired'
export type VoidReason = 'stopped' | 'chain_stopped' | 'ended'

/** Force-sync default (P2); partition groups default to the system param. Group admins override both. */
const FORCE_TIMEOUT_MIN = 5
const TICK_MS = 15_000
const LIVE = ['running', 'awaiting_approval', 'awaiting_answer']

const scope = {
  a: approvals,
  groupId: runs.groupId,
  machineId: bots.machineId,
  ownerId: bots.ownerId,
}

const scoped = (ctx: Ctx) =>
  ctx.db
    .select(scope)
    .from(approvals)
    .innerJoin(runs, eq(runs.id, approvals.runId))
    .innerJoin(bots, eq(bots.id, runs.botId))

export function timeoutMin(group: typeof groups.$inferSelect) {
  const custom = (group.params as { approvalTimeoutMin?: unknown }).approvalTimeoutMin
  if (typeof custom === 'number' && custom > 0) return custom
  return group.mode === 'force' ? FORCE_TIMEOUT_MIN : sysParams().approvalTimeoutMin
}

/** A live run's permission request from the machine running it: store it, await the owner, notify them. */
export async function onApprovalRequest(ctx: Ctx, machineId: string, req: ApprovalRequest) {
  const [row] = await ctx.db
    .select({ run: runs, bot: bots, group: groups })
    .from(runs)
    .innerJoin(bots, eq(bots.id, runs.botId))
    .innerJoin(groups, eq(groups.id, runs.groupId))
    .where(and(eq(runs.id, req.runId), eq(bots.machineId, machineId), inArray(runs.status, LIVE)))
  if (!row) return
  const expiresAt = new Date(ctx.now().getTime() + timeoutMin(row.group) * 60_000)
  const [a] = (await ctx.db
    .insert(approvals)
    .values({
      runId: req.runId,
      requestId: req.requestId,
      title: req.title,
      toolKind: req.toolKind,
      detail: req.detail,
      options: req.options,
      expiresAt,
      createdAt: ctx.now(),
    })
    .returning()) as [Approval]
  await syncRun(ctx, req.runId, `等待审批：${req.title}`)
  await notify(ctx, row.bot.ownerId, 'approval', {
    groupId: row.group.id,
    groupName: row.group.name,
    runId: req.runId,
    approvalId: a.id,
    botId: row.bot.id,
    botName: row.bot.name,
    title: req.title,
    detail: req.detail,
  })
}

/** Owner decision (POST /api/runs/:runId/approvals/:id). */
export async function decideApproval(
  ctx: Ctx,
  user: { id: string; name: string },
  runId: string,
  id: string,
  optionId: string,
) {
  const [row] = await scoped(ctx).where(and(eq(approvals.id, id), eq(approvals.runId, runId)))
  if (!row) return fail('not_found', '审批请求不存在')
  if (row.ownerId !== user.id) return fail('forbidden', '仅 bot 主人可以审批')
  if (row.a.status !== 'pending') return fail('conflict', '该请求已处理')
  const option = (row.a.options as PermissionOption[]).find((o) => o.optionId === optionId)
  if (!option) return fail('invalid', '无效的审批选项')
  const status = option.kind.startsWith('allow') ? 'approved' : 'rejected'
  const settled = await settle(ctx, row, status, optionId, user.id)
  return settled ? approvalDto(settled, user.name) : fail('conflict', '该请求已处理')
}

/** Auto-rejects overdue requests; the agent is told no and carries on (spec §6.7). */
export async function expireApprovals(ctx: Ctx) {
  const due = await scoped(ctx).where(
    and(eq(approvals.status, 'pending'), lte(approvals.expiresAt, ctx.now())),
  )
  for (const row of due) {
    const reject = (row.a.options as PermissionOption[]).find((o) => o.kind === 'reject_once')
    await settle(ctx, row, 'expired', reject?.optionId ?? null, null)
  }
}

/** Pending requests of a run that ended or was stopped are void: nothing is left to decide. */
export async function voidApprovals(ctx: Ctx, runId: string, reason: VoidReason) {
  const voided = await ctx.db
    .update(approvals)
    .set({ status: 'void', voidReason: reason })
    .where(and(eq(approvals.runId, runId), eq(approvals.status, 'pending')))
    .returning()
  if (!voided.length) return
  const [run] = await ctx.db.select({ groupId: runs.groupId }).from(runs).where(eq(runs.id, runId))
  await ctx.db.insert(auditLogs).values(
    voided.map((a) => ({
      category: 'approval',
      action: 'void',
      groupId: run?.groupId,
      detail: { ...auditDetail(a), reason },
      createdAt: ctx.now(),
    })),
  )
  await syncRun(ctx, runId)
}

export function startApprovalTimer(ctx: Ctx) {
  const timer = setInterval(() => {
    expireApprovals(ctx).catch((err) => console.error('approval timeout:', err))
  }, TICK_MS)
  return () => clearInterval(timer)
}

/** Records the outcome once (a racing decision/timeout loses), answers the daemon and audits it. */
async function settle(
  ctx: Ctx,
  row: { a: Approval; groupId: string; machineId: string | null },
  status: Settled,
  optionId: string | null,
  actorUserId: string | null,
) {
  const [a] = await ctx.db
    .update(approvals)
    .set({ status, decidedBy: actorUserId, decidedAt: ctx.now() })
    .where(and(eq(approvals.id, row.a.id), eq(approvals.status, 'pending')))
    .returning()
  if (!a) return null
  if (row.machineId)
    ctx.hub.send(row.machineId, { t: 'approval.decision', runId: a.runId, requestId: a.requestId, optionId })
  await ctx.db.insert(auditLogs).values({
    category: 'approval',
    actorUserId,
    action: status,
    groupId: row.groupId,
    detail: { ...auditDetail(a), optionId },
    createdAt: ctx.now(),
  })
  await syncRun(ctx, a.runId)
  return a
}

const auditDetail = (a: Approval) => ({
  runId: a.runId,
  approvalId: a.id,
  title: a.title,
  toolKind: a.toolKind,
  detail: a.detail,
})

/** A live run awaits approval exactly while it has a pending request; publishes the run with its approvals. */
async function syncRun(ctx: Ctx, runId: string, step?: string) {
  const pending = sql`exists (select 1 from ${approvals} where ${approvals.runId} = ${runs.id} and ${approvals.status} = 'pending')`
  const [updated] = await ctx.db
    .update(runs)
    .set({
      status: sql`case when ${pending} then 'awaiting_approval' else 'running' end`,
      ...(step !== undefined && { step }),
    })
    .where(and(eq(runs.id, runId), inArray(runs.status, ['running', 'awaiting_approval'])))
    .returning()
  const run = updated ?? (await ctx.db.select().from(runs).where(eq(runs.id, runId)))[0]
  if (run) await publishRun(ctx, run)
}
