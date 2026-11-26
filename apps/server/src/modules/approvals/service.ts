import {
  Allowlist,
  type ApprovalAiApproved,
  type ApprovalRequest,
  type PermissionOption,
  type RunAudience,
} from '@gonggong/protocol'
import { and, asc, eq, gte, inArray, lte, sql } from 'drizzle-orm'
import type { Ctx } from '../../context.js'
import { approvals, auditLogs, bots, groupBots, groups, runs } from '../../db/schema.js'
import { audit, teamOfGroupSql } from '../../lib/audit.js'
import { fail } from '../../lib/errors.js'
import { startSweep } from '../../lib/sweep.js'
import { autoRejects, RED_LINE } from '../bots/access.js'
import { normalizeAllowlist } from '../bots/allowlist.js'
import { publishBots } from '../bots/dto.js'
import { groupParams } from '../groups/params.js'
import { notify, resolveNotifications } from '../notifications/notify.js'
import { approvalDto, LIVE, publishRun } from '../runs/dto.js'
import { runStep } from '../runs/step.js'
import { runRedactors } from '../secrets/resolve.js'

type Approval = typeof approvals.$inferSelect
type Settled = 'approved' | 'rejected' | 'expired'
export type VoidReason = 'stopped' | 'chain_stopped' | 'ended'

const TICK_MS = 15_000
/** Allowlist's max length: the owner must still be able to save the list. */
const ALWAYS_MAX = 100

const scope = {
  a: approvals,
  groupId: runs.groupId,
  botId: bots.id,
  machineId: bots.machineId,
  ownerId: bots.ownerId,
}

const scoped = (ctx: Ctx) =>
  ctx.db
    .select(scope)
    .from(approvals)
    .innerJoin(runs, eq(runs.id, approvals.runId))
    .innerJoin(bots, eq(bots.id, runs.botId))

/** Group → team → platform default, in every sync mode (F22). */
export async function timeoutMin(ctx: Ctx, group: typeof groups.$inferSelect) {
  return (await groupParams(ctx, group)).approvalTimeoutMin
}

/** A live run's permission request from the machine running it: store it, await the owner, notify them. */
export async function onApprovalRequest(ctx: Ctx, machineId: string, raw: ApprovalRequest) {
  const [row] = await ctx.db
    .select({ run: runs, bot: bots, group: groups, groupTier: groupBots.tier })
    .from(runs)
    .innerJoin(bots, eq(bots.id, runs.botId))
    .innerJoin(groups, eq(groups.id, runs.groupId))
    .leftJoin(groupBots, and(eq(groupBots.groupId, runs.groupId), eq(groupBots.botId, runs.botId)))
    .where(and(eq(runs.id, raw.runId), eq(bots.machineId, machineId), inArray(runs.status, LIVE)))
  if (!row) return
  const r = (await runRedactors(ctx, raw.runId)).redact
  const req = { ...raw, title: r(raw.title), detail: r(raw.detail) }
  const expiresAt = new Date(ctx.now().getTime() + (await timeoutMin(ctx, row.group)) * 60_000)
  const [a] = (await ctx.db
    .insert(approvals)
    .values({
      runId: req.runId,
      requestId: req.requestId,
      title: req.title,
      toolKind: req.toolKind,
      detail: req.detail,
      reason: req.reason,
      options: req.options,
      remember: rememberable(raw.remember, r),
      rememberSession: raw.rememberSession.filter((entry) => r(entry) === entry),
      review: req.review && { ...req.review, rationale: r(req.review.rationale) },
      mcp: req.mcp && {
        ...req.mcp,
        ...(req.mcp.input && { input: r(req.mcp.input) }),
        ...(req.mcp.description && { description: r(req.mcp.description) }),
      },
      expiresAt,
      createdAt: ctx.now(),
    })
    .returning()) as [Approval]
  // 自动审批 for someone other than the owner: a red line is refused without disturbing the owner; the grey zone asks.
  if (
    RED_LINE.has(req.reason) &&
    autoRejects(row.bot, row.groupTier, row.run.audience as RunAudience | null)
  ) {
    const reject = req.options.find((o) => o.kind === 'reject_once')
    await settle(ctx, { a, groupId: row.group.id, machineId }, 'rejected', reject?.optionId ?? null, null)
    return
  }
  await syncRun(ctx, req.runId, runStep('等待审批：{title}', { title: req.title }))
  await notify(ctx, row.bot.ownerId, 'approval', {
    groupId: row.group.id,
    groupName: row.group.name,
    runId: req.runId,
    approvalId: a.id,
    botId: row.bot.id,
    botName: row.bot.name,
    title: req.title,
    detail: req.detail,
    // Decided right from the notification when the run is in a DM the owner is not in (a shared bot's).
    options: req.options,
  })
}

/** The AI pre-review or the bot's rules allowed a request of a live run on this machine: kept in the audit log like a decision. */
export async function onAiApproved(ctx: Ctx, machineId: string, msg: ApprovalAiApproved) {
  const [row] = await ctx.db
    .select({ groupId: runs.groupId })
    .from(runs)
    .innerJoin(bots, eq(bots.id, runs.botId))
    .where(and(eq(runs.id, msg.runId), eq(bots.machineId, machineId), inArray(runs.status, LIVE)))
  if (!row) return
  const r = (await runRedactors(ctx, msg.runId)).redact
  await ctx.db.insert(auditLogs).values({
    category: 'approval',
    action: msg.source === 'rule' ? 'rule_approved' : 'ai_approved',
    groupId: row.groupId,
    teamId: teamOfGroupSql(row.groupId),
    detail: {
      runId: msg.runId,
      title: r(msg.title),
      toolKind: msg.toolKind,
      detail: r(msg.detail),
      source: msg.source,
      ...(msg.review && { risk: msg.review.risk, rationale: r(msg.review.rationale) }),
    },
    createdAt: ctx.now(),
  })
}

/** Owner decision (POST /api/runs/:runId/approvals/:id). */
export async function decideApproval(
  ctx: Ctx,
  user: { id: string; name: string },
  runId: string,
  id: string,
  optionId: string,
  session = false,
) {
  const [row] = await scoped(ctx).where(and(eq(approvals.id, id), eq(approvals.runId, runId)))
  if (!row) return fail('not_found', '审批请求不存在')
  if (row.ownerId !== user.id) return fail('forbidden', '仅 Bot 主人可以审批')
  if (row.a.status !== 'pending') return fail('conflict', '该请求已处理')
  const option = (row.a.options as PermissionOption[]).find((o) => o.optionId === optionId)
  if (!option) return fail('invalid', '无效的审批选项')
  const status = option.kind.startsWith('allow') ? 'approved' : 'rejected'
  if (session && (status !== 'approved' || !row.a.rememberSession.length))
    return fail('invalid', '无效的审批选项')
  const settled = await settle(ctx, row, status, optionId, user.id, session)
  if (!settled) return fail('conflict', '该请求已处理')
  if (option.kind === 'allow_always' && settled.remember.length)
    await alwaysAllow(ctx, user.id, row.botId, settled)
  return approvalDto(settled, user.name)
}

/** Rules the bot settings can hold and show: valid allowlist entries without secrets. */
const rememberable = (rules: string[], r: (s: string) => string) =>
  normalizeAllowlist(rules).filter(
    (entry) => Allowlist.element.safeParse(entry).success && r(entry) === entry,
  )

/** 始终允许 persists the request's rules on the bot (A4); the row lock keeps concurrent decisions from dropping each other's. */
async function alwaysAllow(ctx: Ctx, actorUserId: string, botId: string, a: Approval) {
  const changed = await ctx.db.transaction(async (tx) => {
    const [bot] = await tx
      .select({ name: bots.name, teamId: bots.teamId, rules: bots.alwaysAllow })
      .from(bots)
      .where(eq(bots.id, botId))
      .for('update')
    const added = bot ? a.remember.filter((r) => !bot.rules.includes(r)) : []
    if (!bot || !added.length) return null
    await tx
      .update(bots)
      .set({ alwaysAllow: [...bot.rules, ...added].slice(-ALWAYS_MAX) })
      .where(eq(bots.id, botId))
    return { ...bot, added }
  })
  if (!changed) return
  await audit(ctx, {
    category: 'admin',
    actorUserId,
    teamId: changed.teamId,
    action: 'bot.always_allow',
    detail: { botId, name: changed.name, added: changed.added, approvalId: a.id },
  })
  await publishBots(ctx, eq(bots.id, botId))
}

/** The run's tier was raised to full: its pending requests are approved on the actor's behalf. */
export async function approvePending(ctx: Ctx, runId: string, actorUserId: string) {
  const pending = await scoped(ctx).where(and(eq(approvals.runId, runId), eq(approvals.status, 'pending')))
  for (const row of pending) {
    const options = row.a.options as PermissionOption[]
    const allow =
      options.find((o) => o.kind === 'allow_once') ?? options.find((o) => o.kind === 'allow_always')
    if (allow) await settle(ctx, row, 'approved', allow.optionId, actorUserId)
  }
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
      teamId: run ? teamOfGroupSql(run.groupId) : null,
      detail: { ...auditDetail(a), reason },
      createdAt: ctx.now(),
    })),
  )
  await resolveNotifications(
    ctx,
    'approval',
    'approvalId',
    voided.map((a) => a.id),
  )
  await syncRun(ctx, runId)
}

export function startApprovalTimer(ctx: Ctx) {
  return startSweep('approval timeout', () => expireApprovals(ctx), TICK_MS)
}

/** Re-sends settled decisions of this machine's live runs on reconnect; the daemon ignores already-handled ids. */
export async function replayApprovalDecisions(ctx: Ctx, machineId: string) {
  const rows = await ctx.db
    .select({ a: approvals })
    .from(approvals)
    .innerJoin(runs, eq(runs.id, approvals.runId))
    .innerJoin(bots, eq(bots.id, runs.botId))
    .where(
      and(
        eq(bots.machineId, machineId),
        inArray(runs.status, LIVE),
        inArray(approvals.status, ['approved', 'rejected', 'expired']),
      ),
    )
    .orderBy(asc(approvals.decidedAt), asc(approvals.createdAt))
  const first = rows[0]
  if (!first) return
  const settled = rows.map((r) => r.a)
  const earliest = settled.reduce((min, a) => {
    const t = a.decidedAt ?? a.createdAt
    return t < min ? t : min
  }, first.a.decidedAt ?? first.a.createdAt)
  const logs = await ctx.db
    .select({ detail: auditLogs.detail })
    .from(auditLogs)
    .where(
      and(
        gte(auditLogs.createdAt, new Date(earliest.getTime() - 1000)),
        eq(auditLogs.category, 'approval'),
        inArray(
          sql`${auditLogs.detail}->>'approvalId'`,
          settled.map((a) => a.id),
        ),
      ),
    )
  const logged = new Map<string, { optionId: string | null; session: boolean }>()
  for (const { detail } of logs) {
    const d = detail as { approvalId?: unknown; optionId?: unknown; session?: unknown }
    if (typeof d.approvalId === 'string') {
      logged.set(d.approvalId, {
        optionId: typeof d.optionId === 'string' ? d.optionId : null,
        session: d.session === true,
      })
    }
  }
  for (const a of settled) {
    const record = logged.get(a.id)
    const optionId = record ? record.optionId : fallbackOptionId(a)
    const session = record?.session ?? false
    ctx.hub.send(machineId, {
      t: 'approval.decision',
      runId: a.runId,
      requestId: a.requestId,
      optionId,
      ...(session && { session: true }),
    })
  }
}

function fallbackOptionId(a: Approval): string | null {
  const options = a.options as PermissionOption[]
  if (a.status === 'approved') {
    return (
      (options.find((o) => o.kind === 'allow_once') ?? options.find((o) => o.kind === 'allow_always'))
        ?.optionId ?? null
    )
  }
  return options.find((o) => o.kind === 'reject_once')?.optionId ?? null
}

function settledStep(a: Approval, status: Settled, sent: boolean) {
  if (!sent) {
    if (status === 'approved') return runStep('已批准，等待 Bot 电脑重连后继续…')
    if (status === 'rejected') return runStep('已拒绝，等待 Bot 电脑重连后继续…')
    return runStep('审批超时，等待 Bot 电脑重连后继续…')
  }
  return status === 'approved'
    ? runStep('已批准：{title}', { title: a.title })
    : runStep('请求被拒绝，agent 自行绕路')
}

/** Records the outcome once (a racing decision/timeout loses), answers the daemon and audits it. */
async function settle(
  ctx: Ctx,
  row: { a: Approval; groupId: string; machineId: string | null },
  status: Settled,
  optionId: string | null,
  actorUserId: string | null,
  session = false,
) {
  const [a] = await ctx.db
    .update(approvals)
    .set({ status, decidedBy: actorUserId, decidedAt: ctx.now() })
    .where(and(eq(approvals.id, row.a.id), eq(approvals.status, 'pending')))
    .returning()
  if (!a) return null
  const sent = row.machineId
    ? ctx.hub.send(row.machineId, {
        t: 'approval.decision',
        runId: a.runId,
        requestId: a.requestId,
        optionId,
        ...(session && { session: true }),
      })
    : false
  await ctx.db.insert(auditLogs).values({
    category: 'approval',
    actorUserId,
    action: status,
    groupId: row.groupId,
    teamId: teamOfGroupSql(row.groupId),
    detail: { ...auditDetail(a), optionId, ...(session && { session: true }) },
    createdAt: ctx.now(),
  })
  await resolveNotifications(ctx, 'approval', 'approvalId', [a.id])
  await syncRun(ctx, a.runId, settledStep(a, status, sent), { whenClear: true })
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
async function syncRun(
  ctx: Ctx,
  runId: string,
  step?: ReturnType<typeof runStep>,
  opts?: { whenClear?: boolean },
) {
  const pending = sql`exists (select 1 from ${approvals} where ${approvals.runId} = ${runs.id} and ${approvals.status} = 'pending')`
  const stepUpdate =
    step && opts?.whenClear
      ? {
          step: sql`case when ${pending} then ${runs.step} else ${step.step} end`,
          stepI18n: sql`case when ${pending} then ${runs.stepI18n} else ${JSON.stringify(step.stepI18n)}::jsonb end`,
        }
      : step
  const [updated] = await ctx.db
    .update(runs)
    .set({
      status: sql`case when ${pending} then 'awaiting_approval' else 'running' end`,
      ...stepUpdate,
    })
    .where(and(eq(runs.id, runId), inArray(runs.status, ['running', 'awaiting_approval'])))
    .returning()
  const run = updated ?? (await ctx.db.select().from(runs).where(eq(runs.id, runId)))[0]
  if (run) await publishRun(ctx, run)
}
