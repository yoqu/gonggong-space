import {
  type ContextMessage,
  type RunDiscarded,
  type RunDone,
  type RunSyncDone,
  TERMINAL_RUN_STATUS,
} from '@gonggong/protocol'
import { and, desc, eq, inArray, isNotNull, isNull, ne, sql } from 'drizzle-orm'
import type { Ctx } from '../../context.js'
import type { Db } from '../../db/client.js'
import {
  bots,
  groupMembers,
  groups,
  messages,
  notifications,
  runs,
  syncReplicas,
  teams,
  users,
} from '../../db/schema.js'
import { audit } from '../../lib/audit.js'
import { fail } from '../../lib/errors.js'
import { startSweep } from '../../lib/sweep.js'
import { sysParams } from '../admin/params.js'
import { type VoidReason, voidApprovals } from '../approvals/service.js'
import { publishBots } from '../bots/dto.js'
import { postEvent } from '../messages/service.js'
import { notify } from '../notifications/notify.js'
import { voidQuestions } from '../questions/service.js'
import { settleSchedule } from '../schedules/engine.js'
import { forgetRedactors } from '../secrets/resolve.js'
import { touchThread } from '../threads/service.js'
import { settleWebhook } from '../webhooks/service.js'
import { controlsRun, publishRun, type RunRow, UNFINISHED, WAITING } from './dto.js'
import { schedule } from './scheduler.js'
import { runStep } from './step.js'
import { forgetStream } from './streams.js'
import { settleReports } from './trigger.js'

type Tx = Parameters<Parameters<Db['transaction']>[0]>[0]
type User = { id: string; name: string }

const DISCARD_TIMEOUT_MS = 60_000
/** How long a stopped live run waits for the daemon's run.done before the server ends it (a hung agent, or a daemon
 * that lost the run). A mutable box so tests can shorten it. */
export const stopGrace = { ms: 10_000 }

/** Ids of the relay chain `runId` belongs to: its root and every descendant. */
async function chainIds(db: Db | Tx, runId: string): Promise<string[]> {
  const rows = await db.execute<{ id: string }>(sql`
    with recursive up as (
      select id, parent_run_id from runs where id = ${runId}
      union all select r.id, r.parent_run_id from runs r join up on r.id = up.parent_run_id
    ), down as (
      select id from up where parent_run_id is null
      union all select r.id from runs r join down on r.parent_run_id = down.id
    )
    select id from down`)
  return rows.map((r) => r.id)
}

/** A chain ends for good once any of its runs was stopped (spec §4.6); the relay hook must not add hops to it. */
export async function isChainStopped(ctx: Ctx, run: Pick<RunRow, 'id'>) {
  const [hit] = await ctx.db
    .select({ id: runs.id })
    .from(runs)
    .where(and(inArray(runs.id, await chainIds(ctx.db, run.id)), isNotNull(runs.stoppedBy)))
    .limit(1)
  return !!hit
}

/** Chain hops show that the whole chain ended; other runs name who stopped them. */
const stopStep = (name: string, run: Pick<RunRow, 'hop'>) =>
  runStep(run.hop > 1 ? '整条链已被 {user} /stop 终止' : '{user} 执行了 /stop', { user: name })

export type StopTarget =
  /** `threadRootId`: that thread's runs only. */
  | { groupId: string; botIds?: string[]; threadRootId?: string }
  | { groupId: string; runId: string; chain?: boolean; edited?: boolean }

/** A run stopped because its author edited the triggering message (plan F8); a fresh run follows. */
const EDITED_STEP = '消息已编辑，已重新运行'

/**
 * Cleans up a run that ended without the daemon's run.done (force-stopped, reconciled on reconnect, stopped while
 * waiting/offline, or expired): closes live stream/redactors, voids open prompts, publishes card + bot presence,
 * settles schedules/webhooks, and closes relay chains.
 */
export async function teardownRun(
  ctx: Ctx,
  run: RunRow,
  o: {
    voidReason?: VoidReason
    reschedule?: boolean
    publishBot?: boolean
    notifyChain?: boolean
  } = {},
) {
  await forgetStream(run.id)
  forgetRedactors(run.id)
  if (o.voidReason) {
    await voidApprovals(ctx, run.id, o.voidReason)
    await voidQuestions(ctx, run.id)
  }
  await touchThread(ctx, run.threadRootId)
  await publishRun(ctx, run)
  if (o.reschedule) await schedule(ctx, run.botId)
  if (o.publishBot !== false) await publishBots(ctx, eq(bots.id, run.botId))
  await settleSchedule(ctx, run)
  await settleWebhook(ctx, run)
  if (o.notifyChain !== false) await notifyChainDone(ctx, run)
}

/**
 * Plan D7. Waiting runs end at once; live ones get `run.cancel` and end on the daemon's run.done (see
 * `stoppedDone`). Every stopped run records who stopped it, which also ends its relay chain.
 */
export async function stopRuns(ctx: Ctx, target: StopTarget, by: User): Promise<RunRow[]> {
  const chain = 'runId' in target && !!target.chain
  const scope =
    'runId' in target
      ? inArray(runs.id, chain ? await chainIds(ctx.db, target.runId) : [target.runId])
      : and(
          target.botIds?.length ? inArray(runs.botId, target.botIds) : undefined,
          target.threadRootId ? eq(runs.threadRootId, target.threadRootId) : undefined,
        )
  const targets = await ctx.db
    .select({ run: runs, machineId: bots.machineId })
    .from(runs)
    .innerJoin(bots, eq(bots.id, runs.botId))
    .where(and(chain ? undefined : eq(runs.groupId, target.groupId), inArray(runs.status, UNFINISHED), scope))
  const edited = 'edited' in target && target.edited
  const stopped: RunRow[] = []
  for (const { run, machineId } of targets) {
    const step = edited ? runStep(EDITED_STEP) : stopStep(by.name, run)
    const voidReason: VoidReason = chain || run.hop > 1 ? 'chain_stopped' : 'stopped'
    // Marked before run.cancel goes out, so the daemon's run.done always finds who stopped it.
    const live = !WAITING.includes(run.status) && !!machineId && ctx.hub.isOnline(machineId)
    // Already winding down: a repeat click must not resend run.cancel or arm another grace timer.
    if (live && run.stoppedBy) continue
    const [row] = await ctx.db
      .update(runs)
      .set(
        live
          ? { stoppedBy: by.id, ...(edited && step) }
          : { stoppedBy: by.id, status: 'interrupted', ...step, endedAt: ctx.now() },
      )
      .where(and(eq(runs.id, run.id), inArray(runs.status, UNFINISHED)))
      .returning()
    if (!row) continue
    if (live && machineId) {
      ctx.hub.send(machineId, { t: 'run.cancel', runId: run.id })
      setTimeout(
        () => void forceStopped(ctx, row.id, step).catch((e) => console.error('stop:', e)),
        stopGrace.ms,
      ).unref()
      await publishRun(ctx, row)
      // Also republishes the run, as running again while the daemon winds the turn down.
      await voidApprovals(ctx, row.id, voidReason)
      await voidQuestions(ctx, row.id)
    } else {
      await teardownRun(ctx, row, { voidReason, publishBot: false, notifyChain: false })
    }
    stopped.push(row)
  }
  const ended = stopped.filter((r) => r.status === 'interrupted')
  for (const botId of new Set(ended.map((r) => r.botId))) {
    await schedule(ctx, botId)
    await publishBots(ctx, eq(bots.id, botId))
  }
  for (const run of ended) await notifyChainDone(ctx, run)
  return stopped
}

/** A stopped run the daemon never wound down: ended here so its bot's queue goes on; a late run.done is ignored. */
async function forceStopped(ctx: Ctx, runId: string, step: Partial<RunRow>) {
  const [row] = await ctx.db
    .update(runs)
    .set({ status: 'interrupted', ...step, endedAt: ctx.now() })
    .where(and(eq(runs.id, runId), isNotNull(runs.stoppedBy), inArray(runs.status, UNFINISHED)))
    .returning()
  if (!row) return
  await teardownRun(ctx, row, { voidReason: 'ended', reschedule: true })
}

/**
 * Fields for run.done of a stopped run: step and the pending keep/discard choice, for partition edits in a repo or
 * force-group changes the daemon left unsubmitted (F21).
 */
export async function stoppedDone(ctx: Ctx, run: RunRow, done: RunDone): Promise<Partial<RunRow>> {
  if (!run.stoppedBy || done.outcome === 'completed') return {}
  const [by] = await ctx.db.select({ name: users.name }).from(users).where(eq(users.id, run.stoppedBy))
  const step = (await stoppedByEdit(ctx, run)) ? runStep(EDITED_STEP) : stopStep(by?.name ?? '', run)
  if (done.sync?.outcome === 'stopped')
    return {
      ...runStep('{step} · 强制同步：已改的 {n} 个文件待处理，未提交', {
        step: step.stepI18n,
        n: done.sync.files,
      }),
      interrupt: 'pending',
    }
  const kept = done.filesChanged > 0 && done.git !== null && !done.sync
  return kept
    ? {
        ...runStep('{step} · 分区模式：已改的 {n} 个文件留在工作区，未提交', {
          step: step.stepI18n,
          n: done.filesChanged,
        }),
        interrupt: 'pending',
      }
    : step
}

/** Its author edited the triggering message while it ran (the edit stops it, see `editMessage`). */
async function stoppedByEdit(ctx: Ctx, run: RunRow) {
  if (!run.startedAt) return false
  const [m] = await ctx.db
    .select({ editedAt: messages.editedAt, author: messages.authorUserId })
    .from(messages)
    .where(eq(messages.id, run.triggerMessageId))
  return !!m?.editedAt && m.editedAt >= run.startedAt && m.author === run.stoppedBy
}

/** The chain's initiator learns when a relay chain (more than one hop) has no unfinished run left (spec §8.11). */
export async function notifyChainDone(ctx: Ctx, run: RunRow) {
  // Next hops are only created from a run's handoffs (triggerChain), so this run is a chain of one.
  if (!run.parentRunId && !run.handoffs.length) return
  const ids = await chainIds(ctx.db, run.id)
  const chain = await ctx.db
    .select({
      id: runs.id,
      parentRunId: runs.parentRunId,
      hop: runs.hop,
      status: runs.status,
      stoppedBy: runs.stoppedBy,
      originUserId: runs.originUserId,
    })
    .from(runs)
    .where(inArray(runs.id, ids))
  const root = chain.find((r) => r.parentRunId === null)
  const hops = Math.max(...chain.map((r) => r.hop))
  if (!root || hops < 2 || chain.some((r) => !TERMINAL_RUN_STATUS.includes(r.status as never))) return
  const [sent] = await ctx.db
    .select({ id: notifications.id })
    .from(notifications)
    .where(
      and(eq(notifications.type, 'chain_done'), sql`${notifications.payload}->>'rootRunId' = ${root.id}`),
    )
  if (sent) return
  const [group] = await ctx.db.select({ name: groups.name }).from(groups).where(eq(groups.id, run.groupId))
  await notify(ctx, root.originUserId, 'chain_done', {
    groupId: run.groupId,
    groupName: group?.name ?? '',
    rootRunId: root.id,
    hops,
    stopped: chain.some((r) => r.stoppedBy !== null),
  })
}

/**
 * Context note for the turn after a /stop of this (group, bot) session, `thread` or the main one (plan D7). A still-open
 * keep/discard choice settles as kept: the daemon drops that turn's snapshot once the next turn starts. Returns the
 * settled run for publishing.
 */
export async function interruptNote(tx: Tx, run: RunRow, at: string, thread: string | null) {
  const [prev] = await tx
    .select({
      id: runs.id,
      status: runs.status,
      stoppedBy: runs.stoppedBy,
      interrupt: runs.interrupt,
      filesChanged: runs.filesChanged,
      sync: runs.sync,
    })
    .from(runs)
    .innerJoin(messages, eq(messages.id, runs.triggerMessageId))
    .where(
      and(
        eq(runs.groupId, run.groupId),
        eq(runs.botId, run.botId),
        ne(runs.id, run.id),
        isNotNull(runs.startedAt),
        thread ? eq(messages.threadRootId, thread) : isNull(messages.threadRootId),
      ),
    )
    .orderBy(desc(runs.startedAt))
    .limit(1)
  if (!prev?.stoppedBy || prev.status !== 'interrupted') return null
  const settled =
    prev.interrupt === 'pending'
      ? (await tx.update(runs).set({ interrupt: 'kept' }).where(eq(runs.id, prev.id)).returning())[0]
      : undefined
  const n = prev.filesChanged
  const force = (prev.sync as RunSyncDone | null)?.outcome === 'stopped'
  const detail = force
    ? prev.interrupt === 'discarded'
      ? '；本轮改动已备份后丢弃，工作区已回到同步版本'
      : '；本轮改动已保留并提交为一版'
    : prev.interrupt === 'discarded'
      ? `；本轮改动已丢弃，上一轮改动的 ${n} 个文件已还原到该轮开始前的状态`
      : n > 0
        ? `；本轮改动已保留，上一轮改动的 ${n} 个文件仍在工作区，未提交`
        : ''
  const note: ContextMessage = {
    seq: 0,
    author: '共工空间',
    kind: 'user',
    body: `上一轮被 /stop 中断${detail}。`,
    at,
    attachments: [],
  }
  return { note, settled }
}

/** Trigger / origin user or bot owner; only while the choice is open. */
export async function chooseInterrupt(ctx: Ctx, runId: string, choice: 'keep' | 'discard', user: User) {
  const [row] = await ctx.db
    .select({ run: runs, ownerId: bots.ownerId, machineId: bots.machineId })
    .from(runs)
    .innerJoin(bots, eq(bots.id, runs.botId))
    .innerJoin(groupMembers, and(eq(groupMembers.groupId, runs.groupId), eq(groupMembers.userId, user.id)))
    .where(eq(runs.id, runId))
  if (!row) return fail('not_found', '运行不存在')
  const { run, ownerId, machineId } = row
  if (!controlsRun(run, ownerId, user.id)) return fail('forbidden', '仅发起人或 Bot 主人可选择')
  if (run.interrupt !== 'pending') return fail('conflict', '已处理过本轮改动')
  const record = (detail: Record<string, unknown>) =>
    audit(ctx, {
      category: 'run',
      actorUserId: user.id,
      action: `run.${choice}`,
      groupId: run.groupId,
      detail: { runId, ...detail },
    })
  if ((run.sync as RunSyncDone | null)?.outcome === 'stopped') {
    // Force group (F21): the daemon submits the changes as a version (kind interrupted) or backs them up and rolls
    // back to the head, reporting like settled local edits. Once the replica no longer syncs (back to partition, left)
    // neither applies and the files stay as they are; the partition discard has no snapshot of a force turn.
    const [synced] = await ctx.db
      .select({ botId: syncReplicas.botId })
      .from(syncReplicas)
      .innerJoin(groups, eq(groups.id, syncReplicas.groupId))
      .where(
        and(
          eq(syncReplicas.groupId, run.groupId),
          eq(syncReplicas.botId, run.botId),
          eq(groups.mode, 'force'),
          isNotNull(syncReplicas.joinedAt),
        ),
      )
    if (!synced) return fail('conflict', '该 Bot 已不在强制同步中，本轮改动留在工作区')
    const action = { kind: 'drift', choice: choice === 'keep' ? 'submit' : 'discard' } as const
    const msg = { t: 'sync.action', groupId: run.groupId, botId: run.botId, action } as const
    if (!machineId || !ctx.hub.send(machineId, msg))
      return fail('conflict', 'Bot 所在的电脑离线，上线后再处理')
    await record({})
  } else if (choice === 'discard') {
    const res = machineId ? await discard(ctx, machineId, runId) : null
    const error = res ? (res.ok ? null : (res.error ?? '未知错误')) : 'Bot 离线'
    await record({ ok: !error, files: res?.files ?? 0, error })
    if (error) {
      const reason = res ? (res.error ?? { key: '未知错误' }) : { key: 'Bot 离线' }
      await postEvent(ctx, run.groupId, '丢弃本轮改动失败：{error}', { error: reason }, {}, run.threadRootId)
      return fail('conflict', '丢弃本轮改动失败：{error}', { error: reason })
    }
  } else await record({})
  const [updated] = await ctx.db
    .update(runs)
    .set({ interrupt: choice === 'keep' ? 'kept' : 'discarded' })
    .where(and(eq(runs.id, runId), eq(runs.interrupt, 'pending')))
    .returning()
  if (updated) await publishRun(ctx, updated)
}

/**
 * The replica's local edits were settled from the sync panel (F12): a /stop'ped run whose changes they are gets its
 * choice closed the same way, so the next turn does not settle it as kept.
 */
export async function closeStoppedChoice(
  ctx: Ctx,
  groupId: string,
  botId: string,
  choice: 'submit' | 'discard',
) {
  const closed = await ctx.db
    .update(runs)
    .set({ interrupt: choice === 'submit' ? 'kept' : 'discarded' })
    .where(
      and(
        eq(runs.groupId, groupId),
        eq(runs.botId, botId),
        eq(runs.interrupt, 'pending'),
        sql`${runs.sync}->>'outcome' = 'stopped'`,
      ),
    )
    .returning()
  for (const run of closed) await publishRun(ctx, run)
}

/** Sends run.discard and waits for the daemon's answer; null when the machine is offline or silent. */
function discard(ctx: Ctx, machineId: string, runId: string) {
  return new Promise<RunDiscarded | null>((resolve) => {
    const finish = (res: RunDiscarded | null) => {
      clearTimeout(timer)
      ctx.hub.off('message', on)
      resolve(res)
    }
    const on = (from: string, msg: { t: string }) => {
      if (from === machineId && msg.t === 'run.discarded' && (msg as RunDiscarded).runId === runId)
        finish(msg as RunDiscarded)
    }
    const timer = setTimeout(() => finish(null), DISCARD_TIMEOUT_MS)
    ctx.hub.on('message', on)
    if (!ctx.hub.send(machineId, { t: 'run.discard', runId })) finish(null)
  })
}

/** Spec §4.8: requests for an offline bot expire after the group's wait and the trigger user is told. */
export async function expireOfflineRuns(ctx: Ctx) {
  const { offlineWaitMin } = await sysParams(ctx.db)
  // Group → team → platform (plan D9).
  const waitMin = sql<number>`coalesce((${groups.params}->>'offlineWaitMin')::int, (${teams.params}->>'offlineWaitMin')::int, ${offlineWaitMin})`
  const due = await ctx.db
    .select({ run: runs, waitMin, groupName: groups.name, botName: bots.name, trigger: users.name })
    .from(runs)
    .innerJoin(groups, eq(groups.id, runs.groupId))
    .innerJoin(teams, eq(teams.id, groups.teamId))
    .innerJoin(bots, eq(bots.id, runs.botId))
    // Relay hops have no human trigger: their chain's initiator is told instead.
    .leftJoin(users, eq(users.id, sql`coalesce(${runs.triggerUserId}, ${runs.originUserId})`))
    .where(
      and(
        eq(runs.status, 'offline_wait'),
        sql`${runs.queuedAt} + make_interval(mins => ${waitMin}) <= ${ctx.now().toISOString()}::timestamptz`,
      ),
    )
  for (const { run, waitMin: min, groupName, botName, trigger } of due) {
    const [row] = await ctx.db
      .update(runs)
      .set({
        status: 'expired',
        ...runStep('Bot 离线超过 {n} 分钟，已失效并通知 {user}', { n: min, user: trigger ?? '' }),
        endedAt: ctx.now(),
      })
      .where(and(eq(runs.id, run.id), eq(runs.status, 'offline_wait')))
      .returning()
    if (!row) continue
    await teardownRun(ctx, row, { notifyChain: false })
    await notify(ctx, row.triggerUserId ?? row.originUserId, 'offline_expired', {
      groupId: row.groupId,
      groupName,
      runId: row.id,
      botId: row.botId,
      botName,
      waitMin: min,
    })
    await settleReports(ctx, row)
    await notifyChainDone(ctx, row)
  }
}

/** Periodic offline-expiry sweep; returns a function that stops it and waits for a sweep in flight. */
export function startOfflineExpiry(ctx: Ctx, everyMs = 30_000) {
  return startSweep('offline expiry', () => expireOfflineRuns(ctx), everyMs)
}
