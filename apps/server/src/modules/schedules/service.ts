import {
  type CreateScheduleReq,
  type I18nText,
  SCHEDULE_MAX_PER_GROUP,
  type ScheduleDto,
  type UpdateScheduleReq,
} from '@gonggong/protocol'
import { and, asc, count, eq, isNull, type SQL } from 'drizzle-orm'
import type { Ctx } from '../../context.js'
import { groupMembers, runs, schedules, users } from '../../db/schema.js'
import { type MessageKey, zh } from '../../i18n/index.js'
import { audit } from '../../lib/audit.js'
import { fail } from '../../lib/errors.js'
import { activeBots } from '../groups/service.js'
import { postMessage } from '../messages/service.js'
import { nextFire, timingError } from './timing.js'

export type ScheduleRow = typeof schedules.$inferSelect
/** Who changes a schedule: a member in the app, a bot during a run, or a sysadmin from the admin console. */
export type Actor =
  | { userId: string }
  | { botId: string; runId: string; botName: string }
  | { sysadmin: string }

const live = isNull(schedules.deletedAt)

/** Schedules matching `where` with their owner's name and their last run's status, oldest first. */
export function loadSchedules(ctx: Ctx, where?: SQL) {
  return ctx.db
    .select({ s: schedules, ownerName: users.name, lastStatus: runs.status })
    .from(schedules)
    .innerJoin(users, eq(users.id, schedules.ownerId))
    .leftJoin(runs, eq(runs.id, schedules.lastRunId))
    .where(and(live, where))
    .orderBy(asc(schedules.createdAt))
}
type Loaded = Awaited<ReturnType<typeof loadSchedules>>[number]

export const scheduleDto = ({ s, ownerName, lastStatus }: Loaded, canManage: boolean): ScheduleDto => ({
  id: s.id,
  groupId: s.groupId,
  name: s.name,
  prompt: s.prompt,
  cron: s.cron,
  runAt: s.runAt?.toISOString() ?? null,
  timezone: s.timezone,
  botIds: s.botIds,
  enabled: s.enabled,
  pausedReason: s.pausedReason ?? null,
  nextRunAt: s.nextRunAt?.toISOString() ?? null,
  lastFiredAt: s.lastFiredAt?.toISOString() ?? null,
  lastRunId: s.lastRunId,
  lastBotId: s.lastBotId,
  lastStatus: (lastStatus as ScheduleDto['lastStatus']) ?? null,
  failStreak: s.failStreak,
  ownerId: s.ownerId,
  ownerName,
  createdByBotId: s.createdByBotId,
  canManage,
  createdAt: s.createdAt.toISOString(),
})

async function groupAdmins(ctx: Ctx, groupId: string) {
  const rows = await ctx.db
    .select({ userId: groupMembers.userId, isAdmin: groupMembers.isAdmin })
    .from(groupMembers)
    .where(eq(groupMembers.groupId, groupId))
  return {
    members: rows.map((r) => r.userId),
    admins: new Set(rows.filter((r) => r.isAdmin).map((r) => r.userId)),
  }
}

const manages = (s: ScheduleRow, userId: string, admins: Set<string>) =>
  s.ownerId === userId || admins.has(userId)

/** The group's schedules as `userId` sees them. */
export async function groupSchedules(ctx: Ctx, groupId: string, userId: string) {
  const { admins } = await groupAdmins(ctx, groupId)
  const rows = await loadSchedules(ctx, eq(schedules.groupId, groupId))
  return { schedules: rows.map((r) => scheduleDto(r, manages(r.s, userId, admins))) }
}

export async function publishSchedules(ctx: Ctx, groupId: string) {
  const { members, admins } = await groupAdmins(ctx, groupId)
  const rows = await loadSchedules(ctx, eq(schedules.groupId, groupId))
  for (const userId of members)
    ctx.bus.publish([userId], {
      t: 'group.schedules',
      groupId,
      schedules: rows.map((r) => scheduleDto(r, manages(r.s, userId, admins))),
    })
}

export async function scheduleById(ctx: Ctx, id: string) {
  const [row] = await loadSchedules(ctx, eq(schedules.id, id))
  return row
}

/** Owner or group admin (403), as a member of its group (404 otherwise). */
export async function requireManage(ctx: Ctx, s: ScheduleRow, userId: string) {
  const [m] = await ctx.db
    .select({ isAdmin: groupMembers.isAdmin })
    .from(groupMembers)
    .where(and(eq(groupMembers.groupId, s.groupId), eq(groupMembers.userId, userId)))
  if (!m) return fail('not_found', '定时任务不存在')
  if (s.ownerId !== userId && !m.isAdmin) fail('forbidden', '仅任务主人或群管理员可操作')
}

const invalid = (e: I18nText): never => fail('invalid', e.key as MessageKey, e.params)

async function checkBots(ctx: Ctx, groupId: string, botIds: string[]) {
  const inGroup = new Set((await activeBots(ctx, groupId)).map((b) => b.id))
  if (botIds.some((id) => !inGroup.has(id))) fail('invalid', '候选 Bot 须是本群的 Bot')
  return [...new Set(botIds)]
}

const actorAudit = (actor: Actor) =>
  'userId' in actor
    ? { actorUserId: actor.userId, by: 'user' }
    : 'sysadmin' in actor
      ? { actorUserId: actor.sysadmin, by: 'sysadmin' }
      : { actorUserId: null, by: 'bot', botId: actor.botId, runId: actor.runId }

async function record(ctx: Ctx, s: ScheduleRow, action: string, actor: Actor) {
  const { actorUserId, ...detail } = actorAudit(actor)
  await audit(ctx, {
    category: 'schedule',
    action: `schedule.${action}`,
    actorUserId,
    groupId: s.groupId,
    detail: { scheduleId: s.id, name: s.name, ...detail },
  })
}

/** Creates a live schedule and posts its card; `ownerId` is the member it fires as. */
export async function createSchedule(
  ctx: Ctx,
  groupId: string,
  req: CreateScheduleReq,
  ownerId: string,
  actor: Exclude<Actor, { sysadmin: string }>,
) {
  const [n] = await ctx.db
    .select({ n: count() })
    .from(schedules)
    .where(and(live, eq(schedules.groupId, groupId)))
  if ((n?.n ?? 0) >= SCHEDULE_MAX_PER_GROUP)
    fail('invalid', '每个群最多 {n} 个定时任务', { n: SCHEDULE_MAX_PER_GROUP })
  const botIds = await checkBots(ctx, groupId, req.botIds)
  const timing = {
    cron: req.cron ?? null,
    runAt: req.runAt ? new Date(req.runAt) : null,
    timezone: req.timezone,
  }
  const now = ctx.now()
  const error = timingError(timing, now)
  if (error) invalid(error)
  const [s] = (await ctx.db
    .insert(schedules)
    .values({
      groupId,
      ownerId,
      createdByBotId: 'botId' in actor ? actor.botId : null,
      createdByRunId: 'runId' in actor ? actor.runId : null,
      name: req.name,
      prompt: req.prompt,
      ...timing,
      botIds,
      nextRunAt: nextFire(timing, now),
      createdAt: now,
    })
    .returning()) as [ScheduleRow]
  const who =
    'botName' in actor
      ? actor.botName
      : ((await ctx.db.select({ name: users.name }).from(users).where(eq(users.id, ownerId)))[0]?.name ?? '')
  const params = { who, name: s.name }
  const card = await postMessage(ctx, {
    groupId,
    kind: 'event',
    body: zh('{who} 创建了定时任务「{name}」', params),
    meta: { schedule: s.id, i18n: { key: '{who} 创建了定时任务「{name}」', params } },
  })
  await ctx.db.update(schedules).set({ messageId: card.id }).where(eq(schedules.id, s.id))
  await record(ctx, s, 'create', actor)
  await publishSchedules(ctx, groupId)
  return s
}

/** Applies the changes; turning it on (again) or retiming recomputes its next firing. */
export async function updateSchedule(ctx: Ctx, s: ScheduleRow, req: UpdateScheduleReq, actor: Actor) {
  const now = ctx.now()
  const timing =
    req.cron !== undefined
      ? { cron: req.cron, runAt: null }
      : req.runAt !== undefined
        ? { cron: null, runAt: new Date(req.runAt) }
        : { cron: s.cron, runAt: s.runAt }
  const next = { ...timing, timezone: req.timezone ?? s.timezone }
  const retimed = req.cron !== undefined || req.runAt !== undefined || req.timezone !== undefined
  const enabled = req.enabled ?? s.enabled
  if (enabled && (retimed || !s.enabled)) {
    const error = timingError(next, now)
    if (error) invalid(error)
  }
  const [row] = (await ctx.db
    .update(schedules)
    .set({
      ...(req.name !== undefined && { name: req.name }),
      ...(req.prompt !== undefined && { prompt: req.prompt }),
      ...(req.botIds && { botIds: await checkBots(ctx, s.groupId, req.botIds) }),
      ...next,
      enabled,
      nextRunAt: enabled ? nextFire(next, now) : null,
      ...((!enabled || !s.enabled) && { pausedReason: null }),
      ...(enabled && !s.enabled && { failStreak: 0 }),
    })
    .where(eq(schedules.id, s.id))
    .returning()) as [ScheduleRow]
  await record(
    ctx,
    row,
    req.enabled === false ? 'pause' : req.enabled && !s.enabled ? 'resume' : 'update',
    actor,
  )
  await publishSchedules(ctx, s.groupId)
  return row
}

export async function deleteSchedule(ctx: Ctx, s: ScheduleRow, actor: Actor) {
  await ctx.db
    .update(schedules)
    .set({ deletedAt: ctx.now(), enabled: false, nextRunAt: null })
    .where(eq(schedules.id, s.id))
  await record(ctx, s, 'delete', actor)
  await publishSchedules(ctx, s.groupId)
}
