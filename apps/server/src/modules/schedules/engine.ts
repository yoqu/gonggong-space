import { type I18nText, TERMINAL_RUN_STATUS } from '@gonggong/protocol'
import { and, asc, count, desc, eq, inArray, isNull, lte, sql } from 'drizzle-orm'
import type { Ctx } from '../../context.js'
import { bots, groupBots, groupMembers, groups, messages, runs, schedules, users } from '../../db/schema.js'
import { audit } from '../../lib/audit.js'
import { mirrorUserMessage } from '../feishu/mirror.js'
import { activeBots } from '../groups/service.js'
import { type MessageRow, messageDto, postEvent, publishMessage } from '../messages/service.js'
import { notify } from '../notifications/notify.js'
import type { RunRow } from '../runs/dto.js'
import { triggerRuns } from '../runs/trigger.js'
import { publishSchedules, type ScheduleRow } from './service.js'
import { nextFire } from './timing.js'

const BATCH = 50
const FAIL_LIMIT = 3
/** A one-off that missed its time by more than this (server down) is dropped instead of fired late. */
const MISS_LIMIT_MS = 24 * 3600_000
const UNFINISHED = ['queued', 'offline_wait', 'running', 'awaiting_approval', 'awaiting_answer']

/** Turns the schedule off for `reason`, says so in its group and tells its owner. */
async function pause(ctx: Ctx, s: ScheduleRow, reason: I18nText) {
  await ctx.db
    .update(schedules)
    .set({ enabled: false, nextRunAt: null, pausedReason: reason })
    .where(eq(schedules.id, s.id))
  await postEvent(ctx, s.groupId, '定时任务「{name}」已停用：{reason}', { name: s.name, reason })
  await notify(ctx, s.ownerId, 'schedule_paused', {
    groupId: s.groupId,
    scheduleId: s.id,
    name: s.name,
    reason,
  })
  await audit(ctx, {
    category: 'schedule',
    action: 'schedule.auto_pause',
    groupId: s.groupId,
    detail: { scheduleId: s.id, name: s.name, reason },
  })
}

/**
 * Recounts the schedule's failures in a row from its latest ended runs (so repeating it is harmless) and turns it
 * off at FAIL_LIMIT. Called when one of its runs ended.
 */
export async function settleSchedule(ctx: Ctx, run: RunRow) {
  const [s] = await ctx.db
    .select()
    .from(schedules)
    .where(and(eq(schedules.lastRunId, run.id), isNull(schedules.deletedAt)))
  if (!s) return
  const ended = await ctx.db
    .select({ status: runs.status })
    .from(runs)
    .innerJoin(messages, eq(messages.id, runs.triggerMessageId))
    .where(
      and(sql`${messages.meta}->>'scheduleOf' = ${s.id}`, inArray(runs.status, [...TERMINAL_RUN_STATUS])),
    )
    .orderBy(desc(messages.seq))
    .limit(FAIL_LIMIT)
  const streak = ended.findIndex((r) => r.status === 'completed')
  const failStreak = streak === -1 ? ended.length : streak
  await ctx.db.update(schedules).set({ failStreak }).where(eq(schedules.id, s.id))
  if (s.enabled && failStreak >= FAIL_LIMIT)
    await pause(ctx, s, { key: '连续 {n} 次失败', params: { n: failStreak } })
  await publishSchedules(ctx, s.groupId)
}

/** The first candidate that is online and idle, else the first online one (its run queues); null when none is. */
async function pick(
  ctx: Ctx,
  groupId: string,
  candidates: { id: string; name: string; machineId: string | null }[],
) {
  const state = await ctx.db
    .select({ id: bots.id, binding: bots.binding, workspace: groupBots.workspaceState })
    .from(bots)
    .innerJoin(groupBots, and(eq(groupBots.botId, bots.id), eq(groupBots.groupId, groupId)))
    .where(
      inArray(
        bots.id,
        candidates.map((b) => b.id),
      ),
    )
  const busy = await ctx.db
    .select({ botId: runs.botId, n: count() })
    .from(runs)
    .where(
      and(
        inArray(
          runs.botId,
          candidates.map((b) => b.id),
        ),
        inArray(runs.status, UNFINISHED),
      ),
    )
    .groupBy(runs.botId)
  const usable = candidates.filter((b) => {
    const st = state.find((x) => x.id === b.id)
    return (
      st?.binding === 'bound' && st.workspace !== 'unbound' && !!b.machineId && ctx.hub.isOnline(b.machineId)
    )
  })
  return usable.find((b) => !busy.some((x) => x.botId === b.id)) ?? usable[0] ?? null
}

/** @-s the chosen bot with the task in its owner's name; the run then goes the way of any other @. */
async function fire(ctx: Ctx, s: ScheduleRow) {
  const [owner] = await ctx.db
    .select({ id: users.id, name: users.name })
    .from(groupMembers)
    .innerJoin(users, eq(users.id, groupMembers.userId))
    .where(and(eq(groupMembers.groupId, s.groupId), eq(groupMembers.userId, s.ownerId)))
  if (!owner) return pause(ctx, s, { key: '主人已不在群内' })
  if (s.lastRunId) {
    const [last] = await ctx.db.select().from(runs).where(eq(runs.id, s.lastRunId))
    if (last && UNFINISHED.includes(last.status))
      return void (await postEvent(ctx, s.groupId, '定时任务「{name}」上次尚未结束，本次跳过', {
        name: s.name,
      }))
  }
  const inGroup = await activeBots(ctx, s.groupId)
  const candidates = s.botIds.flatMap((id) => inGroup.filter((b) => b.id === id))
  if (!candidates.length) return pause(ctx, s, { key: '候选 Bot 都已不在群内' })
  const bot = await pick(ctx, s.groupId, candidates)
  if (!bot)
    return void (await postEvent(
      ctx,
      s.groupId,
      '定时任务「{name}」的候选 Bot 都不可用（{bots}），本次跳过',
      {
        name: s.name,
        bots: candidates.map((b) => b.name).join('、'),
      },
    ))
  const [message] = (await ctx.db
    .insert(messages)
    .values({
      groupId: s.groupId,
      kind: 'user',
      authorUserId: owner.id,
      body: `@${bot.name} ${s.prompt}`,
      meta: { mentions: [bot.id], scheduleOf: s.id },
      createdAt: ctx.now(),
    })
    .returning()) as [MessageRow]
  await publishMessage(ctx, messageDto(message, owner.name))
  await mirrorUserMessage(ctx, message, owner)
  await triggerRuns(ctx, message)
  const [run] = await ctx.db.select().from(runs).where(eq(runs.triggerMessageId, message.id))
  await ctx.db
    .update(schedules)
    .set({ lastRunId: run?.id ?? null, lastBotId: bot.id })
    .where(eq(schedules.id, s.id))
  if (run && (TERMINAL_RUN_STATUS as readonly string[]).includes(run.status)) await settleSchedule(ctx, run)
}

/**
 * Fires every due schedule once. Each is claimed and moved to its next firing in one transaction (skipping rows
 * another instance holds), so concurrent ticks and restarts never fire it twice; a recurring one that was missed
 * while the server was down fires once, then resumes its rhythm.
 */
export async function fireDue(ctx: Ctx) {
  const now = ctx.now()
  const due = await ctx.db.transaction(async (tx) => {
    const rows = await tx
      .select()
      .from(schedules)
      .innerJoin(groups, eq(groups.id, schedules.groupId))
      .where(
        and(
          isNull(schedules.deletedAt),
          eq(schedules.enabled, true),
          lte(schedules.nextRunAt, now),
          isNull(groups.archivedAt),
        ),
      )
      .orderBy(asc(schedules.nextRunAt))
      .limit(BATCH)
      .for('update', { of: schedules, skipLocked: true })
    const out: { s: ScheduleRow; missed: boolean }[] = []
    for (const { schedules: s } of rows) {
      const missed = !s.cron && now.getTime() - (s.nextRunAt?.getTime() ?? 0) > MISS_LIMIT_MS
      const once: I18nText = missed ? { key: '错过执行时间超过 24 小时' } : { key: '仅一次的任务已执行' }
      const [row] = await tx
        .update(schedules)
        .set(
          s.cron
            ? { nextRunAt: nextFire(s, now), lastFiredAt: now }
            : { enabled: false, nextRunAt: null, pausedReason: once, ...(!missed && { lastFiredAt: now }) },
        )
        .where(eq(schedules.id, s.id))
        .returning()
      out.push({ s: row as ScheduleRow, missed })
    }
    return out
  })
  for (const { s, missed } of due) {
    try {
      if (missed) await pause(ctx, s, { key: '错过执行时间超过 24 小时' })
      else await fire(ctx, s)
    } catch (err) {
      console.error(`schedule ${s.id}:`, err)
    }
  }
  for (const groupId of new Set(due.map((d) => d.s.groupId))) await publishSchedules(ctx, groupId)
  return due.length
}

/** Fires due schedules now and then every `everyMs`; the returned function stops and waits for a tick in flight. */
export function startScheduleEngine(ctx: Ctx, everyMs = 30_000) {
  let pending = Promise.resolve()
  const tick = () => {
    pending = pending
      .then(() => fireDue(ctx))
      .then(
        () => {},
        (err) => console.error('schedule engine:', err),
      )
  }
  tick()
  const timer = setInterval(tick, everyMs)
  timer.unref()
  return async () => {
    clearInterval(timer)
    await pending
  }
}
