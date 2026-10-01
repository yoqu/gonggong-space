import { UsageDailyQuery, type UsageDayDto, UsageQuery, type UsageRowDto } from '@gonggong/protocol'
import { and, asc, desc, eq, gte, sql } from 'drizzle-orm'
import type { FastifyInstance, FastifyRequest } from 'fastify'
import type { Ctx } from '../../context.js'
import { bots, groups, runs, users } from '../../db/schema.js'
import { fail } from '../../lib/errors.js'
import { idParam, isUuid } from '../../lib/ids.js'
import { requireSysadmin, requireUser } from '../auth/session.js'
import { currentTeam, requireTeam } from '../teams/service.js'

const DAY_MS = 86_400_000
const DIMENSIONS = {
  bot: [bots.id, bots.name],
  user: [users.id, users.name],
  group: [groups.id, groups.name],
} as const

const count = sql<number>`count(*)`.mapWith(Number)
const tokens = sql<number>`coalesce(sum((${runs.usage}->>'totalTokens')::bigint), 0)`.mapWith(Number)
const unreported = sql<number>`count(*) filter (where ${runs.usage}->>'totalTokens' is null)`.mapWith(Number)

/**
 * Runs of the current team's bots: sysadmins see all of them; members only their own bots' runs, and a botId filter
 * only for bots they own. With `teamId`, a team admin sees the whole team (团队设置 · 用量).
 */
async function scope(ctx: Ctx, req: FastifyRequest, q: { botId?: string; teamId?: string }) {
  const me = await requireUser(ctx, req)
  const byBot = () => (q.botId ? eq(runs.botId, idParam(q.botId, 'Bot 不存在')) : undefined)
  if (q.teamId)
    return and(eq(bots.teamId, (await requireTeam(ctx, me.id, q.teamId, 'admin')).team.id), byBot())
  const teamId = await currentTeam(ctx, req, me.id)
  const admin = me.role === 'sysadmin'
  if (q.botId && !admin) {
    const [bot] = isUuid(q.botId)
      ? await ctx.db.select({ ownerId: bots.ownerId }).from(bots).where(eq(bots.id, q.botId))
      : []
    if (bot?.ownerId !== me.id) return fail('forbidden', '仅 Bot 主人或系统管理员可查看该 Bot 的用量')
  }
  return and(eq(bots.teamId, teamId), byBot(), admin ? undefined : eq(bots.ownerId, me.id))
}

/** 管理后台 · 用量: every team, or the one picked. */
async function platformScope(ctx: Ctx, req: FastifyRequest, q: { botId?: string; teamId?: string }) {
  await requireSysadmin(ctx, req)
  return and(
    q.teamId ? eq(bots.teamId, idParam(q.teamId, '团队不存在')) : undefined,
    q.botId ? eq(runs.botId, idParam(q.botId, 'Bot 不存在')) : undefined,
  )
}

/** YYYY-MM-DD of `at` in `timeZone`, and `n` calendar days before it. */
const dayIn = (at: Date, timeZone: string) =>
  new Intl.DateTimeFormat('en-CA', { timeZone, year: 'numeric', month: '2-digit', day: '2-digit' }).format(at)
const minusDays = (day: string, n: number) =>
  new Date(Date.parse(`${day}T00:00:00Z`) - n * DAY_MS).toISOString().slice(0, 10)

/**
 * Usage totals over runs that actually started (spec §3.7), grouped by bot / chain initiator / group, or by local
 * calendar day for the trend chart. No quotas.
 */
export function usageRoutes(ctx: Ctx) {
  return async (app: FastifyInstance) => {
    for (const [base, scoped] of [
      ['/api/usage', scope],
      ['/api/admin/usage', platformScope],
    ] as const)
      usage(app, base, scoped)
  }

  function usage(app: FastifyInstance, base: string, scoped: typeof scope) {
    app.get(base, async (req): Promise<UsageRowDto[]> => {
      const q = UsageQuery.parse(req.query)
      const where = await scoped(ctx, req, q)
      const [key, name] = DIMENSIONS[q.by]
      return ctx.db
        .select({ key, name, runs: count, totalTokens: tokens, unreported })
        .from(runs)
        .innerJoin(bots, eq(bots.id, runs.botId))
        .innerJoin(users, eq(users.id, runs.originUserId))
        .innerJoin(groups, eq(groups.id, runs.groupId))
        .where(and(gte(runs.startedAt, new Date(ctx.now().getTime() - q.days * DAY_MS)), where))
        .groupBy(key, name)
        .orderBy(desc(tokens), desc(count), asc(name))
    })

    app.get(`${base}/daily`, async (req): Promise<UsageDayDto[]> => {
      const q = UsageDailyQuery.parse(req.query)
      const where = await scoped(ctx, req, q)
      const now = ctx.now()
      const days = Array.from({ length: q.days }, (_, i) => minusDays(dayIn(now, q.tz), q.days - 1 - i))
      const day = sql<string>`to_char(${runs.startedAt} at time zone ${q.tz}, 'YYYY-MM-DD')`
      const rows = await ctx.db
        .select({ day, runs: count, totalTokens: tokens, unreported })
        .from(runs)
        .innerJoin(bots, eq(bots.id, runs.botId))
        // A day spans at most 26h across zones/DST; the exact cut happens on `day` below.
        .where(and(gte(runs.startedAt, new Date(now.getTime() - (q.days + 1) * DAY_MS)), where))
        // Positional: the tz parameter makes the expression differ textually between SELECT and GROUP BY.
        .groupBy(sql`1`)
      const byDay = new Map(rows.map((r) => [r.day, r]))
      return days.map((d) => ({ day: d, runs: 0, totalTokens: 0, unreported: 0, ...byDay.get(d) }))
    })
  }
}
