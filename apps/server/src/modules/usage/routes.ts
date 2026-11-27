import {
  UsageAnalyticsQuery,
  type UsageBreakdownDto,
  UsageBreakdownQuery,
  UsageDailyQuery,
  type UsageDayDto,
  UsageExportQuery,
  type UsageFacetsDto,
  type UsageHeatmapDto,
  UsageHeatmapQuery,
  type UsageInsightsDto,
  UsageInsightsQuery,
  type UsageOverviewDto,
  type UsagePricingStatusDto,
  UsageQuery,
  type UsageRowDto,
  type UsageRunsDto,
  UsageRunsQuery,
  type UsageTimeseriesDto,
  UsageTimeseriesQuery,
} from '@gonggong/protocol'
import { and, asc, desc, eq, gte, sql } from 'drizzle-orm'
import type { FastifyInstance } from 'fastify'
import type { Ctx } from '../../context.js'
import { bots, groups, runs, users } from '../../db/schema.js'
import { requireSysadmin, requireUser } from '../auth/session.js'
import { getBreakdown, getFacets, getOverview, getTimeseries } from './analytics.js'
import { exportUsage } from './export.js'
import { getHeatmap } from './heatmap.js'
import { getInsights } from './insights.js'
import { getPricingStatus, syncPricingOrFail } from './pricing-sync.js'
import { addDays, DAY_MS, dayIn, platformUsageScope, type ScopedFn, usageScope } from './query.js'
import { getRuns } from './runs.js'

const DIMENSIONS = {
  bot: [bots.id, bots.name],
  user: [users.id, users.name],
  group: [groups.id, groups.name],
} as const

const count = sql<number>`count(*)`.mapWith(Number)
const tokens = sql<number>`coalesce(sum((${runs.usage}->>'totalTokens')::bigint), 0)`.mapWith(Number)
const unreported = sql<number>`count(*) filter (where ${runs.usage}->>'totalTokens' is null)`.mapWith(Number)

/**
 * The usage page fires a burst of aggregate queries over every run; unbounded, they took all pooled database
 * connections and stalled every other endpoint. Analytics requests queue behind this many in flight.
 */
const ANALYTICS_CONCURRENCY = 2
let analyticsActive = 0
const analyticsWaiting: (() => void)[] = []

async function gated<T>(fn: () => Promise<T>): Promise<T> {
  if (analyticsActive < ANALYTICS_CONCURRENCY) analyticsActive++
  else await new Promise<void>((resolve) => analyticsWaiting.push(resolve))
  try {
    return await fn()
  } finally {
    const next = analyticsWaiting.shift()
    if (next) next()
    else analyticsActive--
  }
}

/**
 * Usage totals over runs (spec §3.7) plus full multi-dimensional analytics under `/api[/admin]/usage/*`.
 * Legacy `GET ${base}` and `GET ${base}/daily` remain strictly backward-compatible.
 */
export function usageRoutes(ctx: Ctx) {
  return async (app: FastifyInstance) => {
    for (const [base, scoped] of [
      ['/api/usage', usageScope],
      ['/api/admin/usage', platformUsageScope],
    ] as const)
      register(app, base, scoped)

    app.post('/api/admin/usage/pricing/sync', async (req): Promise<UsagePricingStatusDto> => {
      await requireSysadmin(ctx, req)
      return syncPricingOrFail(ctx.now())
    })
  }

  function register(app: FastifyInstance, base: string, scoped: ScopedFn) {
    // ── Legacy endpoints (BotPage, BotSettings, TeamAdminTabs, UsageDialog, e2e) ──
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
      const days = Array.from({ length: q.days }, (_, i) => addDays(dayIn(now, q.tz), -(q.days - 1 - i)))
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

    // ── Rich AI Usage Analytics endpoints ──
    app.get(`${base}/pricing`, async (req): Promise<UsagePricingStatusDto> => {
      if (base === '/api/admin/usage') await requireSysadmin(ctx, req)
      else await requireUser(ctx, req)
      return getPricingStatus(ctx.now())
    })

    app.get(`${base}/facets`, async (req): Promise<UsageFacetsDto> => {
      const q = UsageAnalyticsQuery.parse(req.query)
      const where = await scoped(ctx, req, q, { forFacets: true })
      return gated(() => getFacets(ctx, q, where))
    })

    app.get(`${base}/overview`, async (req): Promise<UsageOverviewDto> => {
      const q = UsageAnalyticsQuery.parse(req.query)
      const where = await scoped(ctx, req, q)
      return gated(() => getOverview(ctx, q, where))
    })

    app.get(`${base}/timeseries`, async (req): Promise<UsageTimeseriesDto> => {
      const q = UsageTimeseriesQuery.parse(req.query)
      const where = await scoped(ctx, req, q)
      return gated(() => getTimeseries(ctx, q, where))
    })

    app.get(`${base}/breakdown`, async (req): Promise<UsageBreakdownDto> => {
      const q = UsageBreakdownQuery.parse(req.query)
      const where = await scoped(ctx, req, q)
      return gated(() => getBreakdown(ctx, q, where))
    })

    app.get(`${base}/heatmap`, async (req): Promise<UsageHeatmapDto> => {
      const q = UsageHeatmapQuery.parse(req.query)
      const where = await scoped(ctx, req, q)
      return gated(() => getHeatmap(ctx, q, where))
    })

    app.get(`${base}/insights`, async (req): Promise<UsageInsightsDto> => {
      const q = UsageInsightsQuery.parse(req.query)
      const where = await scoped(ctx, req, q)
      return gated(() => getInsights(ctx, q, where))
    })

    app.get(`${base}/runs`, async (req): Promise<UsageRunsDto> => {
      const q = UsageRunsQuery.parse(req.query)
      const where = await scoped(ctx, req, q)
      return gated(() => getRuns(ctx, q, where))
    })

    app.get(`${base}/export`, async (req, reply) => {
      const q = UsageExportQuery.parse(req.query)
      const where = await scoped(ctx, req, q)
      const out = await gated(() => exportUsage(ctx, q, where))
      reply
        .header('content-type', out.contentType)
        .header('content-disposition', `attachment; filename="${out.filename}"`)
        .send(out.body)
    })
  }
}
