import {
  type AdminSchedulesDto,
  AdminUpdateScheduleReq,
  CreateScheduleReq,
  type GroupSchedulesDto,
  type ScheduleDto,
  type SchedulePreviewDto,
  SchedulePreviewReq,
  UpdateScheduleReq,
} from '@gonggong/protocol'
import { and, count, eq, gt, inArray, isNull, sql } from 'drizzle-orm'
import type { FastifyInstance } from 'fastify'
import type { Ctx } from '../../context.js'
import { bots, groups, messages, runs, schedules, teams } from '../../db/schema.js'
import { fail } from '../../lib/errors.js'
import { idParam } from '../../lib/ids.js'
import { requireSysadmin, requireUser } from '../auth/session.js'
import { requireMember } from '../groups/service.js'
import {
  createSchedule,
  deleteSchedule,
  groupSchedules,
  loadSchedules,
  requireManage,
  scheduleById,
  scheduleDto,
  updateSchedule,
} from './service.js'
import { nextFires, timingError } from './timing.js'

const DAY_MS = 24 * 3600_000

async function found(ctx: Ctx, id: string) {
  return (await scheduleById(ctx, idParam(id, '定时任务不存在'))) ?? fail('not_found', '定时任务不存在')
}

async function adminView(ctx: Ctx, teamId: string | undefined): Promise<AdminSchedulesDto> {
  const inTeam = teamId ? eq(groups.teamId, idParam(teamId, '团队不存在')) : undefined
  const scoped = await ctx.db
    .select({
      id: schedules.id,
      groupName: groups.name,
      kind: groups.kind,
      teamId: teams.id,
      teamName: teams.name,
    })
    .from(schedules)
    .innerJoin(groups, eq(groups.id, schedules.groupId))
    .innerJoin(teams, eq(teams.id, groups.teamId))
    .where(and(isNull(schedules.deletedAt), isNull(groups.archivedAt), inTeam))
  const ids = scoped.map((r) => r.id)
  if (!ids.length) return { schedules: [], stats: { enabled: 0, fired24h: 0, failed24h: 0, autoPaused: 0 } }
  const rows = await loadSchedules(ctx, inArray(schedules.id, ids))
  const names = new Map(
    (
      await ctx.db
        .select({ id: bots.id, name: bots.name })
        .from(bots)
        .where(inArray(bots.id, [...new Set(rows.flatMap((r) => r.s.botIds))]))
    ).map((b) => [b.id, b.name]),
  )
  const since = new Date(ctx.now().getTime() - DAY_MS)
  const fired = and(sql`${messages.meta}->>'scheduleOf' in ${ids}`, gt(messages.createdAt, since))
  const [f] = await ctx.db.select({ n: count() }).from(messages).where(fired)
  const [failed] = await ctx.db
    .select({ n: count() })
    .from(runs)
    .innerJoin(messages, eq(messages.id, runs.triggerMessageId))
    .where(and(fired, inArray(runs.status, ['forbidden', 'interrupted', 'expired'])))
  return {
    schedules: rows.flatMap((r) =>
      scoped
        .filter((g) => g.id === r.s.id)
        .map((g) => ({
          ...scheduleDto(r, true),
          groupName: g.groupName,
          groupKind: g.kind as 'group' | 'dm',
          teamId: g.teamId,
          teamName: g.teamName,
          botNames: r.s.botIds.map((id) => names.get(id) ?? ''),
        })),
    ),
    stats: {
      enabled: rows.filter((r) => r.s.enabled).length,
      fired24h: f?.n ?? 0,
      failed24h: failed?.n ?? 0,
      autoPaused: rows.filter(
        (r) => !r.s.enabled && r.s.pausedReason && r.s.pausedReason.key !== '仅一次的任务已执行',
      ).length,
    },
  }
}

/** 定时任务 (plan 定时任务): members list them; owners and group admins change them; sysadmins oversee all. */
export function scheduleRoutes(ctx: Ctx) {
  return async (app: FastifyInstance) => {
    app.get<{ Params: { id: string } }>(
      '/api/groups/:id/schedules',
      async (req): Promise<GroupSchedulesDto> => {
        const me = await requireUser(ctx, req)
        const { group } = await requireMember(ctx, req.params.id, me.id)
        return groupSchedules(ctx, group.id, me.id)
      },
    )

    app.post<{ Params: { id: string } }>('/api/groups/:id/schedules', async (req): Promise<ScheduleDto> => {
      const me = await requireUser(ctx, req)
      const { group } = await requireMember(ctx, req.params.id, me.id)
      const s = await createSchedule(ctx, group.id, CreateScheduleReq.parse(req.body), me.id, {
        userId: me.id,
      })
      return scheduleDto(await found(ctx, s.id), true)
    })

    app.post('/api/schedules/preview', async (req): Promise<SchedulePreviewDto> => {
      await requireUser(ctx, req)
      const p = SchedulePreviewReq.parse(req.body)
      const timing = { cron: p.cron ?? null, runAt: p.runAt ? new Date(p.runAt) : null, timezone: p.timezone }
      const error = timingError(timing, ctx.now())
      return { error, next: error ? [] : nextFires(timing, ctx.now(), 3).map((d) => d.toISOString()) }
    })

    app.patch<{ Params: { id: string } }>('/api/schedules/:id', async (req): Promise<ScheduleDto> => {
      const me = await requireUser(ctx, req)
      const { s } = await found(ctx, req.params.id)
      await requireManage(ctx, s, me.id)
      await updateSchedule(ctx, s, UpdateScheduleReq.parse(req.body), { userId: me.id })
      return scheduleDto(await found(ctx, s.id), true)
    })

    app.delete<{ Params: { id: string } }>('/api/schedules/:id', async (req, reply) => {
      const me = await requireUser(ctx, req)
      const { s } = await found(ctx, req.params.id)
      await requireManage(ctx, s, me.id)
      await deleteSchedule(ctx, s, { userId: me.id })
      return reply.status(204).send()
    })

    app.get<{ Querystring: { teamId?: string } }>('/api/admin/schedules', async (req) => {
      await requireSysadmin(ctx, req)
      return adminView(ctx, req.query.teamId)
    })

    app.patch<{ Params: { id: string } }>('/api/admin/schedules/:id', async (req): Promise<ScheduleDto> => {
      const root = await requireSysadmin(ctx, req)
      const { s } = await found(ctx, req.params.id)
      await updateSchedule(ctx, s, AdminUpdateScheduleReq.parse(req.body), { sysadmin: root.id })
      return scheduleDto(await found(ctx, s.id), true)
    })

    app.delete<{ Params: { id: string } }>('/api/admin/schedules/:id', async (req, reply) => {
      const root = await requireSysadmin(ctx, req)
      const { s } = await found(ctx, req.params.id)
      await deleteSchedule(ctx, s, { sysadmin: root.id })
      return reply.status(204).send()
    })
  }
}
