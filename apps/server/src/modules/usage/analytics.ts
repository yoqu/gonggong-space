import {
  type AgentKind,
  USAGE_DEFAULT_SENTINEL,
  type UsageAnalyticsQuery,
  type UsageBreakdownBy,
  type UsageBreakdownDto,
  type UsageBreakdownQuery,
  type UsageBreakdownRowDto,
  type UsageCalendarCellDto,
  type UsageCapabilitiesDto,
  type UsageFacetsDto,
  type UsageHeatmapDto,
  type UsageHeatmapQuery,
  type UsageKpiDto,
  type UsageMetric,
  type UsageOverviewDto,
  type UsageResolvedGranularity,
  type UsageTimeseriesBucketDto,
  type UsageTimeseriesDto,
  type UsageTimeseriesLegendDto,
  type UsageTimeseriesQuery,
  type UsageWeekHourCellDto,
} from '@gonggong/protocol'
import { and, desc, eq, isNull, type SQL, sql } from 'drizzle-orm'
import type { Ctx } from '../../context.js'
import { bots, groups, runEvents, runs, users } from '../../db/schema.js'
import { t } from '../../i18n/index.js'
import { sysParams } from '../admin/params.js'
import {
  AGENT_LABELS,
  addDays,
  buildFilterWhere,
  completedWithDurExpr,
  completedWithOutExpr,
  costUsdExpr,
  DAY_MS,
  dayIn,
  durationMsExpr,
  effectiveTps,
  HOUR_MS,
  hasCostExpr,
  hasTokensExpr,
  hourIn,
  inputTokensExpr,
  isCancelledExpr,
  isEndedExpr,
  isFailedExpr,
  isLiveExpr,
  outputTokensExpr,
  providerExpr,
  resolveRange,
  round,
  runAtExpr,
  safeDiv,
  totalTokensExpr,
} from './query.js'

const countExpr = sql<number>`count(*)`.mapWith(Number)
const DEFAULT_SQL = sql.raw(`'${USAGE_DEFAULT_SENTINEL}'`)
const NULL_TEXT = sql<string | null>`cast(null as text)`

const dimLabel = (by: UsageBreakdownBy, key: string, rawName: string | null) => {
  if (key === USAGE_DEFAULT_SENTINEL) return by === 'provider' ? t('官方 / 默认') : t('默认模型')
  if (by === 'agentKind') return AGENT_LABELS[key as AgentKind] ?? key
  if (by === 'groupKind') return key === 'dm' ? t('私聊') : t('群聊')
  return rawName || key
}

const dimensionSql = (by: UsageBreakdownBy) => {
  switch (by) {
    case 'model':
      return {
        key: sql<string>`coalesce(${runs.model}, ${DEFAULT_SQL})`,
        name: sql<string | null>`${runs.model}`,
        sublabel: NULL_TEXT,
      }
    case 'agentKind':
      return {
        key: sql<string>`${bots.agentKind}`,
        name: sql<string | null>`${bots.agentKind}`,
        sublabel: NULL_TEXT,
      }
    case 'provider':
      return {
        key: sql<string>`coalesce(${providerExpr}, ${DEFAULT_SQL})`,
        name: providerExpr,
        sublabel: NULL_TEXT,
      }
    case 'bot':
      return {
        key: sql<string>`${bots.id}::text`,
        name: sql<string | null>`${bots.name}`,
        sublabel: sql<string | null>`${bots.agentKind}`,
      }
    case 'user':
      return {
        key: sql<string>`${users.id}::text`,
        name: sql<string | null>`${users.name}`,
        sublabel: sql<string | null>`${users.account}`,
      }
    case 'group':
      return {
        key: sql<string>`${groups.id}::text`,
        name: sql<string | null>`${groups.name}`,
        sublabel: sql<string | null>`${groups.kind}`,
      }
    case 'groupKind':
      return {
        key: sql<string>`${groups.kind}`,
        name: sql<string | null>`${groups.kind}`,
        sublabel: NULL_TEXT,
      }
  }
}

async function queryCacheStats(ctx: Ctx, where: SQL | undefined) {
  const unpurgedRuns = ctx.db
    .select({ id: runs.id })
    .from(runs)
    .innerJoin(bots, eq(bots.id, runs.botId))
    .innerJoin(users, eq(users.id, runs.originUserId))
    .innerJoin(groups, eq(groups.id, runs.groupId))
    .where(and(where, isNull(runs.purgedAt)))
    .as('u_runs')

  const latest = ctx.db
    .selectDistinctOn([runEvents.runId], {
      runId: runEvents.runId,
      read: sql<number>`(${runEvents.payload}->'breakdown'->'cache'->>'read')::bigint`.as('cache_read'),
      total: sql<number>`(${runEvents.payload}->'breakdown'->'cache'->>'total')::bigint`.as('cache_total'),
    })
    .from(runEvents)
    .innerJoin(unpurgedRuns, eq(unpurgedRuns.id, runEvents.runId))
    .where(and(eq(runEvents.kind, 'usage'), sql`${runEvents.payload}->'breakdown'->'cache' is not null`))
    .orderBy(runEvents.runId, desc(runEvents.id))
    .as('latest_cache')

  const [row] = await ctx.db
    .select({
      runs: sql<number>`count(*)`.mapWith(Number),
      read: sql<number>`coalesce(sum(${latest.read}), 0)`.mapWith(Number),
      total: sql<number>`coalesce(sum(${latest.total}), 0)`.mapWith(Number),
    })
    .from(latest)

  return {
    cacheReportedRuns: row?.runs ?? 0,
    cacheReadTokens: row?.read ?? 0,
    cacheInputTokens: row?.total ?? 0,
    cacheHitRate: safeDiv(row?.read ?? 0, row?.total ?? 0, 4),
  }
}

async function queryCapabilities(
  ctx: Ctx,
  where: SQL | undefined,
  retentionDays: number,
  cacheReportedRuns?: number,
): Promise<UsageCapabilitiesDto> {
  const [[flags], [toolRow], cacheRuns] = await Promise.all([
    ctx.db
      .select({
        hasInputOutput:
          sql<boolean>`coalesce(bool_or(${runs.usage}->>'inputTokens' is not null or ${runs.usage}->>'outputTokens' is not null), false)`.mapWith(
            Boolean,
          ),
        hasCost: sql<boolean>`coalesce(bool_or(${hasCostExpr}), false)`.mapWith(Boolean),
        hasProvider: sql<boolean>`coalesce(bool_or(${providerExpr} is not null), false)`.mapWith(Boolean),
        hasModels: sql<boolean>`coalesce(bool_or(${runs.model} is not null), false)`.mapWith(Boolean),
        hasPlugins: sql<boolean>`coalesce(bool_or(jsonb_array_length(${runs.plugins}) > 0), false)`.mapWith(
          Boolean,
        ),
      })
      .from(runs)
      .innerJoin(bots, eq(bots.id, runs.botId))
      .innerJoin(users, eq(users.id, runs.originUserId))
      .innerJoin(groups, eq(groups.id, runs.groupId))
      .where(where),
    ctx.db
      .select({ exists: sql<boolean>`count(*) > 0`.mapWith(Boolean) })
      .from(runEvents)
      .innerJoin(runs, eq(runs.id, runEvents.runId))
      .innerJoin(bots, eq(bots.id, runs.botId))
      .innerJoin(users, eq(users.id, runs.originUserId))
      .innerJoin(groups, eq(groups.id, runs.groupId))
      .where(and(where, isNull(runs.purgedAt), eq(runEvents.kind, 'tool')))
      .limit(1),
    cacheReportedRuns !== undefined
      ? Promise.resolve(cacheReportedRuns)
      : queryCacheStats(ctx, where).then((c) => c.cacheReportedRuns),
  ])

  return {
    hasInputOutput: flags?.hasInputOutput ?? false,
    hasCost: flags?.hasCost ?? false,
    hasCache: cacheRuns > 0,
    hasProvider: flags?.hasProvider ?? false,
    hasModels: flags?.hasModels ?? false,
    hasTools: toolRow?.exists ?? false,
    hasPlugins: flags?.hasPlugins ?? false,
    retentionDays,
  }
}

async function queryKpi(ctx: Ctx, where: SQL | undefined): Promise<UsageKpiDto> {
  const [[agg], cache] = await Promise.all([
    ctx.db
      .select({
        totalTokens: sql<number>`coalesce(sum(${totalTokensExpr}), 0)`.mapWith(Number),
        inputTokens: sql<number>`coalesce(sum(${inputTokensExpr}), 0)`.mapWith(Number),
        outputTokens: sql<number>`coalesce(sum(${outputTokensExpr}), 0)`.mapWith(Number),
        tokenReportedRuns: sql<number>`count(*) filter (where ${hasTokensExpr})`.mapWith(Number),
        unreportedRuns: sql<number>`count(*) filter (where not (${hasTokensExpr}))`.mapWith(Number),
        totalRuns: countExpr,
        endedRuns: sql<number>`count(*) filter (where ${isEndedExpr})`.mapWith(Number),
        completedRuns: sql<number>`count(*) filter (where ${runs.status} = 'completed')`.mapWith(Number),
        failedRuns: sql<number>`count(*) filter (where ${isFailedExpr})`.mapWith(Number),
        cancelledRuns: sql<number>`count(*) filter (where ${isCancelledExpr})`.mapWith(Number),
        liveRuns: sql<number>`count(*) filter (where ${isLiveExpr})`.mapWith(Number),
        totalCostUsd: sql<number>`coalesce(sum(${costUsdExpr}), 0)`.mapWith(Number),
        costReportedRuns: sql<number>`count(*) filter (where ${hasCostExpr})`.mapWith(Number),
        avgDurationMs: sql<
          number | null
        >`round(avg(${durationMsExpr}) filter (where ${completedWithDurExpr}))`.mapWith((v) =>
          v === null ? null : Number(v),
        ),
        p50DurationMs: sql<
          number | null
        >`round(percentile_cont(0.5) within group (order by ${durationMsExpr}) filter (where ${completedWithDurExpr}))`.mapWith(
          (v) => (v === null ? null : Number(v)),
        ),
        p95DurationMs: sql<
          number | null
        >`round(percentile_cont(0.95) within group (order by ${durationMsExpr}) filter (where ${completedWithDurExpr}))`.mapWith(
          (v) => (v === null ? null : Number(v)),
        ),
        tpsOutTokens:
          sql<number>`coalesce(sum(${outputTokensExpr}) filter (where ${completedWithOutExpr}), 0)`.mapWith(
            Number,
          ),
        tpsDurMs:
          sql<number>`coalesce(sum(${durationMsExpr}) filter (where ${completedWithOutExpr}), 0)`.mapWith(
            Number,
          ),
        activeUsers: sql<number>`count(distinct ${runs.originUserId})`.mapWith(Number),
        activeBots: sql<number>`count(distinct ${runs.botId})`.mapWith(Number),
        activeGroups: sql<number>`count(distinct ${runs.groupId})`.mapWith(Number),
      })
      .from(runs)
      .innerJoin(bots, eq(bots.id, runs.botId))
      .innerJoin(users, eq(users.id, runs.originUserId))
      .innerJoin(groups, eq(groups.id, runs.groupId))
      .where(where),
    queryCacheStats(ctx, where),
  ])

  const a = agg ?? {
    totalTokens: 0,
    inputTokens: 0,
    outputTokens: 0,
    tokenReportedRuns: 0,
    unreportedRuns: 0,
    totalRuns: 0,
    endedRuns: 0,
    completedRuns: 0,
    failedRuns: 0,
    cancelledRuns: 0,
    liveRuns: 0,
    totalCostUsd: 0,
    costReportedRuns: 0,
    avgDurationMs: null,
    p50DurationMs: null,
    p95DurationMs: null,
    tpsOutTokens: 0,
    tpsDurMs: 0,
    activeUsers: 0,
    activeBots: 0,
    activeGroups: 0,
  }
  return {
    totalTokens: a.totalTokens,
    inputTokens: a.inputTokens,
    outputTokens: a.outputTokens,
    tokenReportedRuns: a.tokenReportedRuns,
    unreportedRuns: a.unreportedRuns,
    totalRuns: a.totalRuns,
    endedRuns: a.endedRuns,
    completedRuns: a.completedRuns,
    failedRuns: a.failedRuns,
    cancelledRuns: a.cancelledRuns,
    liveRuns: a.liveRuns,
    successRate: safeDiv(a.completedRuns, a.endedRuns, 4),
    totalCostUsd: round(a.totalCostUsd, 6),
    costReportedRuns: a.costReportedRuns,
    cacheReadTokens: cache.cacheReadTokens,
    cacheInputTokens: cache.cacheInputTokens,
    cacheHitRate: cache.cacheHitRate,
    cacheReportedRuns: cache.cacheReportedRuns,
    avgDurationMs: a.avgDurationMs,
    p50DurationMs: a.p50DurationMs,
    p95DurationMs: a.p95DurationMs,
    avgOutputTps: effectiveTps(a.tpsOutTokens, a.tpsDurMs),
    activeUsers: a.activeUsers,
    activeBots: a.activeBots,
    activeGroups: a.activeGroups,
  }
}

export async function getFacets(
  ctx: Ctx,
  q: UsageAnalyticsQuery,
  scopeWhere: SQL | undefined,
): Promise<UsageFacetsDto> {
  const range = resolveRange(q, ctx.now())
  const where = buildFilterWhere(q, scopeWhere, range, { skipDimFilters: true })
  const retentionDays = (await sysParams(ctx.db)).runRetentionDays

  const facetQuery = (by: UsageBreakdownBy) => {
    const dim = dimensionSql(by)
    return ctx.db
      .select({ value: dim.key, name: dim.name, sublabel: dim.sublabel, count: countExpr })
      .from(runs)
      .innerJoin(bots, eq(bots.id, runs.botId))
      .innerJoin(users, eq(users.id, runs.originUserId))
      .innerJoin(groups, eq(groups.id, runs.groupId))
      .where(where)
      .groupBy(sql`1`, sql`2`, sql`3`)
      .orderBy(desc(countExpr), sql`1 asc`)
      .limit(100)
  }

  const [models, providers, agentKinds, botRows, userRows, groupRows, capabilities] = await Promise.all([
    facetQuery('model'),
    facetQuery('provider'),
    facetQuery('agentKind'),
    facetQuery('bot'),
    facetQuery('user'),
    facetQuery('group'),
    queryCapabilities(ctx, where, retentionDays),
  ])

  const mapRows = (
    by: UsageBreakdownBy,
    rows: { value: string; name: string | null; sublabel: string | null; count: number }[],
  ) =>
    rows.map((r) => ({
      value: r.value,
      label: dimLabel(by, r.value, r.name),
      sublabel: r.sublabel,
      count: r.count,
    }))

  return {
    models: mapRows('model', models),
    providers: mapRows('provider', providers),
    agentKinds: mapRows('agentKind', agentKinds),
    bots: mapRows('bot', botRows),
    users: mapRows('user', userRows),
    groups: mapRows('group', groupRows),
    capabilities,
  }
}

export async function getOverview(
  ctx: Ctx,
  q: UsageAnalyticsQuery,
  scopeWhere: SQL | undefined,
): Promise<UsageOverviewDto> {
  const range = resolveRange(q, ctx.now())
  const currentWhere = buildFilterWhere(q, scopeWhere, range)
  const prevWhere =
    range.previousFrom && range.previousTo
      ? buildFilterWhere(q, scopeWhere, { from: range.previousFrom, to: range.previousTo })
      : null
  const retentionDays = (await sysParams(ctx.db)).runRetentionDays

  const [kpi, previous] = await Promise.all([
    queryKpi(ctx, currentWhere),
    prevWhere ? queryKpi(ctx, prevWhere) : Promise.resolve(null),
  ])
  const capabilities = await queryCapabilities(ctx, currentWhere, retentionDays, kpi.cacheReportedRuns)

  return {
    range: {
      from: range.from?.toISOString() ?? null,
      to: range.to.toISOString(),
      previousFrom: range.previousFrom?.toISOString() ?? null,
      previousTo: range.previousTo?.toISOString() ?? null,
      granularity: range.granularity,
    },
    kpi,
    previous,
    capabilities,
  }
}

const metricValue = (
  metric: UsageMetric,
  r: {
    totalTokens: number
    costUsd: number
    runs: number
    avgDurationMs: number | null
    avgOutputTps: number | null
  },
) => {
  switch (metric) {
    case 'tokens':
      return r.totalTokens
    case 'cost':
      return round(r.costUsd, 6)
    case 'runs':
      return r.runs
    case 'duration':
      return r.avgDurationMs ?? 0
    case 'throughput':
      return r.avgOutputTps ?? 0
  }
}

function buildBucketKeys(
  from: Date,
  to: Date,
  tz: string,
  granularity: UsageResolvedGranularity,
): { ts: string; label: string }[] {
  if (granularity === 'hour') {
    const out: { ts: string; label: string }[] = []
    const seen = new Set<string>()
    const startMs = Math.floor(from.getTime() / HOUR_MS) * HOUR_MS
    const lastMs = Math.max(startMs, to.getTime() - 1)
    for (let ms = startMs; ms <= lastMs && out.length < 168; ms += HOUR_MS) {
      const ts = hourIn(new Date(ms), tz)
      if (seen.has(ts)) continue
      seen.add(ts)
      out.push({ ts, label: ts.slice(11, 16) })
    }
    return out
  }
  const startDay = dayIn(from, tz)
  const endDay = dayIn(new Date(Math.max(from.getTime(), to.getTime() - 1)), tz)
  const out: { ts: string; label: string }[] = []
  let cur = startDay
  while (cur <= endDay && out.length < 366) {
    out.push({ ts: cur, label: cur.slice(5) })
    cur = addDays(cur, 1)
  }
  return out
}

export async function getTimeseries(
  ctx: Ctx,
  q: UsageTimeseriesQuery,
  scopeWhere: SQL | undefined,
): Promise<UsageTimeseriesDto> {
  const now = ctx.now()
  const range = resolveRange(q, now)
  const where = buildFilterWhere(q, scopeWhere, range)

  // Determine effective bucket span & granularity (clamp hourly to <= 7 days).
  let effectiveFrom = range.from
  if (!effectiveFrom) {
    const [bounds] = await ctx.db
      .select({ minAt: sql<Date | null>`min(${runAtExpr})`.mapWith((v) => (v ? new Date(v) : null)) })
      .from(runs)
      .innerJoin(bots, eq(bots.id, runs.botId))
      .innerJoin(users, eq(users.id, runs.originUserId))
      .innerJoin(groups, eq(groups.id, runs.groupId))
      .where(where)
    const fallback = new Date(range.to.getTime() - 29 * DAY_MS)
    effectiveFrom = bounds?.minAt
      ? new Date(Math.max(bounds.minAt.getTime(), range.to.getTime() - 365 * DAY_MS))
      : fallback
  }
  const spanMs = Math.max(HOUR_MS, range.to.getTime() - effectiveFrom.getTime())
  const requestedGranularity: UsageResolvedGranularity =
    q.granularity === 'auto' ? range.granularity : q.granularity
  const granularity: UsageResolvedGranularity =
    requestedGranularity === 'hour' && spanMs > 7 * DAY_MS ? 'day' : requestedGranularity

  const bucketExpr =
    granularity === 'hour'
      ? sql<string>`to_char(${runAtExpr} at time zone ${q.tz}, 'YYYY-MM-DD"T"HH24:00')`
      : sql<string>`to_char(${runAtExpr} at time zone ${q.tz}, 'YYYY-MM-DD')`

  const bucketRows = await ctx.db
    .select({
      ts: bucketExpr,
      totalTokens: sql<number>`coalesce(sum(${totalTokensExpr}), 0)`.mapWith(Number),
      inputTokens: sql<number>`coalesce(sum(${inputTokensExpr}), 0)`.mapWith(Number),
      outputTokens: sql<number>`coalesce(sum(${outputTokensExpr}), 0)`.mapWith(Number),
      costUsd: sql<number>`coalesce(sum(${costUsdExpr}), 0)`.mapWith(Number),
      runs: countExpr,
      completedRuns: sql<number>`count(*) filter (where ${runs.status} = 'completed')`.mapWith(Number),
      failedRuns: sql<number>`count(*) filter (where ${isFailedExpr})`.mapWith(Number),
      unreportedRuns: sql<number>`count(*) filter (where not (${hasTokensExpr}))`.mapWith(Number),
      avgDurationMs: sql<
        number | null
      >`round(avg(${durationMsExpr}) filter (where ${completedWithDurExpr}))`.mapWith((v) =>
        v === null ? null : Number(v),
      ),
      tpsOut:
        sql<number>`coalesce(sum(${outputTokensExpr}) filter (where ${completedWithOutExpr}), 0)`.mapWith(
          Number,
        ),
      tpsDur: sql<number>`coalesce(sum(${durationMsExpr}) filter (where ${completedWithOutExpr}), 0)`.mapWith(
        Number,
      ),
    })
    .from(runs)
    .innerJoin(bots, eq(bots.id, runs.botId))
    .innerJoin(users, eq(users.id, runs.originUserId))
    .innerJoin(groups, eq(groups.id, runs.groupId))
    .where(where)
    .groupBy(sql`1`)

  const byTs = new Map(bucketRows.map((r) => [r.ts, r]))
  const keys = buildBucketKeys(effectiveFrom, range.to, q.tz, granularity)

  const buckets: UsageTimeseriesBucketDto[] = keys.map(({ ts, label }) => {
    const r = byTs.get(ts)
    const avgOutputTps = r ? effectiveTps(r.tpsOut, r.tpsDur) : null
    const row = {
      ts,
      label,
      totalTokens: r?.totalTokens ?? 0,
      inputTokens: r?.inputTokens ?? 0,
      outputTokens: r?.outputTokens ?? 0,
      costUsd: round(r?.costUsd ?? 0, 6),
      runs: r?.runs ?? 0,
      completedRuns: r?.completedRuns ?? 0,
      failedRuns: r?.failedRuns ?? 0,
      unreportedRuns: r?.unreportedRuns ?? 0,
      avgDurationMs: r?.avgDurationMs ?? null,
      avgOutputTps,
    }
    return { ...row, total: metricValue(q.metric, row), bySeries: {} }
  })

  if (q.breakdown === 'none') {
    return { granularity, metric: q.metric, breakdown: q.breakdown, buckets, series: [] }
  }

  const dim = dimensionSql(q.breakdown)
  const rawSeries = await ctx.db
    .select({
      key: dim.key,
      name: dim.name,
      runs: countExpr,
      failedRuns: sql<number>`count(*) filter (where ${isFailedExpr})`.mapWith(Number),
      totalTokens: sql<number>`coalesce(sum(${totalTokensExpr}), 0)`.mapWith(Number),
      costUsd: sql<number>`coalesce(sum(${costUsdExpr}), 0)`.mapWith(Number),
      avgDurationMs: sql<
        number | null
      >`round(avg(${durationMsExpr}) filter (where ${completedWithDurExpr}))`.mapWith((v) =>
        v === null ? null : Number(v),
      ),
      durSum: sql<number>`coalesce(sum(${durationMsExpr}) filter (where ${completedWithDurExpr}), 0)`.mapWith(
        Number,
      ),
      durCnt: sql<number>`count(*) filter (where ${completedWithDurExpr})`.mapWith(Number),
      tpsOut:
        sql<number>`coalesce(sum(${outputTokensExpr}) filter (where ${completedWithOutExpr}), 0)`.mapWith(
          Number,
        ),
      tpsDur: sql<number>`coalesce(sum(${durationMsExpr}) filter (where ${completedWithOutExpr}), 0)`.mapWith(
        Number,
      ),
    })
    .from(runs)
    .innerJoin(bots, eq(bots.id, runs.botId))
    .innerJoin(users, eq(users.id, runs.originUserId))
    .innerJoin(groups, eq(groups.id, runs.groupId))
    .where(where)
    .groupBy(sql`1`, sql`2`)

  const scored = rawSeries
    .map((r) => {
      const avgOutputTps = effectiveTps(r.tpsOut, r.tpsDur)
      const total = metricValue(q.metric, {
        totalTokens: r.totalTokens,
        costUsd: r.costUsd,
        runs: r.runs,
        avgDurationMs: r.avgDurationMs,
        avgOutputTps,
      })
      return {
        ...r,
        name: dimLabel(q.breakdown as UsageBreakdownBy, r.key, r.name),
        avgOutputTps,
        total,
      }
    })
    .sort((a, b) => b.total - a.total || b.runs - a.runs || a.name.localeCompare(b.name))

  const top = scored.slice(0, q.topN)
  const rest = scored.slice(q.topN)
  const topKeys = new Set(top.map((s) => s.key))
  const additive = q.metric === 'tokens' || q.metric === 'cost' || q.metric === 'runs'
  const sumMetric = scored.reduce((acc, s) => acc + s.total, 0)
  const sumRuns = scored.reduce((acc, s) => acc + s.runs, 0)
  const shareOf = (val: number, runsCount: number) =>
    additive ? (safeDiv(val, sumMetric, 4) ?? 0) : (safeDiv(runsCount, sumRuns, 4) ?? 0)

  const series: UsageTimeseriesLegendDto[] = top.map((s) => ({
    key: s.key,
    name: s.name,
    total: s.total,
    share: shareOf(s.total, s.runs),
    runs: s.runs,
    failedRuns: s.failedRuns,
    totalTokens: s.totalTokens,
    costUsd: round(s.costUsd, 6),
    avgDurationMs: s.avgDurationMs,
    avgOutputTps: s.avgOutputTps,
  }))

  if (rest.length > 0) {
    const restRuns = rest.reduce((n, r) => n + r.runs, 0)
    const restFailed = rest.reduce((n, r) => n + r.failedRuns, 0)
    const restTokens = rest.reduce((n, r) => n + r.totalTokens, 0)
    const restCost = rest.reduce((n, r) => n + r.costUsd, 0)
    const restDurSum = rest.reduce((n, r) => n + r.durSum, 0)
    const restDurCnt = rest.reduce((n, r) => n + r.durCnt, 0)
    const restTpsOut = rest.reduce((n, r) => n + r.tpsOut, 0)
    const restTpsDur = rest.reduce((n, r) => n + r.tpsDur, 0)
    const restAvgDur = restDurCnt > 0 ? Math.round(restDurSum / restDurCnt) : null
    const restAvgTps = effectiveTps(restTpsOut, restTpsDur)
    const restTotal = metricValue(q.metric, {
      totalTokens: restTokens,
      costUsd: restCost,
      runs: restRuns,
      avgDurationMs: restAvgDur,
      avgOutputTps: restAvgTps,
    })
    series.push({
      key: '__other__',
      name: t('其他'),
      total: restTotal,
      share: shareOf(restTotal, restRuns),
      runs: restRuns,
      failedRuns: restFailed,
      totalTokens: restTokens,
      costUsd: round(restCost, 6),
      avgDurationMs: restAvgDur,
      avgOutputTps: restAvgTps,
    })
  }

  const cellRows = await ctx.db
    .select({
      ts: bucketExpr,
      key: dim.key,
      runs: countExpr,
      totalTokens: sql<number>`coalesce(sum(${totalTokensExpr}), 0)`.mapWith(Number),
      costUsd: sql<number>`coalesce(sum(${costUsdExpr}), 0)`.mapWith(Number),
      durSum: sql<number>`coalesce(sum(${durationMsExpr}) filter (where ${completedWithDurExpr}), 0)`.mapWith(
        Number,
      ),
      durCnt: sql<number>`count(*) filter (where ${completedWithDurExpr})`.mapWith(Number),
      tpsOut:
        sql<number>`coalesce(sum(${outputTokensExpr}) filter (where ${completedWithOutExpr}), 0)`.mapWith(
          Number,
        ),
      tpsDur: sql<number>`coalesce(sum(${durationMsExpr}) filter (where ${completedWithOutExpr}), 0)`.mapWith(
        Number,
      ),
    })
    .from(runs)
    .innerJoin(bots, eq(bots.id, runs.botId))
    .innerJoin(users, eq(users.id, runs.originUserId))
    .innerJoin(groups, eq(groups.id, runs.groupId))
    .where(where)
    .groupBy(sql`1`, sql`2`)

  const bucketMap = new Map(buckets.map((b) => [b.ts, b]))
  const otherAcc = new Map<
    string,
    {
      runs: number
      totalTokens: number
      costUsd: number
      durSum: number
      durCnt: number
      tpsOut: number
      tpsDur: number
    }
  >()
  for (const c of cellRows) {
    const bucket = bucketMap.get(c.ts)
    if (!bucket) continue
    if (topKeys.has(c.key)) {
      bucket.bySeries[c.key] = metricValue(q.metric, {
        totalTokens: c.totalTokens,
        costUsd: c.costUsd,
        runs: c.runs,
        avgDurationMs: c.durCnt > 0 ? Math.round(c.durSum / c.durCnt) : null,
        avgOutputTps: effectiveTps(c.tpsOut, c.tpsDur),
      })
    } else if (rest.length > 0) {
      const prev = otherAcc.get(c.ts) ?? {
        runs: 0,
        totalTokens: 0,
        costUsd: 0,
        durSum: 0,
        durCnt: 0,
        tpsOut: 0,
        tpsDur: 0,
      }
      prev.runs += c.runs
      prev.totalTokens += c.totalTokens
      prev.costUsd += c.costUsd
      prev.durSum += c.durSum
      prev.durCnt += c.durCnt
      prev.tpsOut += c.tpsOut
      prev.tpsDur += c.tpsDur
      otherAcc.set(c.ts, prev)
    }
  }
  for (const [ts, o] of otherAcc) {
    const bucket = bucketMap.get(ts)
    if (!bucket) continue
    bucket.bySeries.__other__ = metricValue(q.metric, {
      totalTokens: o.totalTokens,
      costUsd: o.costUsd,
      runs: o.runs,
      avgDurationMs: o.durCnt > 0 ? Math.round(o.durSum / o.durCnt) : null,
      avgOutputTps: effectiveTps(o.tpsOut, o.tpsDur),
    })
  }

  return { granularity, metric: q.metric, breakdown: q.breakdown, buckets, series }
}

export async function getBreakdown(
  ctx: Ctx,
  q: UsageBreakdownQuery,
  scopeWhere: SQL | undefined,
): Promise<UsageBreakdownDto> {
  const range = resolveRange(q, ctx.now())
  const where = buildFilterWhere(q, scopeWhere, range)
  const dim = dimensionSql(q.by)

  const rows = await ctx.db
    .select({
      key: dim.key,
      name: dim.name,
      sublabel: dim.sublabel,
      runs: countExpr,
      endedRuns: sql<number>`count(*) filter (where ${isEndedExpr})`.mapWith(Number),
      completedRuns: sql<number>`count(*) filter (where ${runs.status} = 'completed')`.mapWith(Number),
      failedRuns: sql<number>`count(*) filter (where ${isFailedExpr})`.mapWith(Number),
      cancelledRuns: sql<number>`count(*) filter (where ${isCancelledExpr})`.mapWith(Number),
      unreportedRuns: sql<number>`count(*) filter (where not (${hasTokensExpr}))`.mapWith(Number),
      totalTokens: sql<number>`coalesce(sum(${totalTokensExpr}), 0)`.mapWith(Number),
      inputTokens: sql<number>`coalesce(sum(${inputTokensExpr}), 0)`.mapWith(Number),
      outputTokens: sql<number>`coalesce(sum(${outputTokensExpr}), 0)`.mapWith(Number),
      costUsd: sql<number>`coalesce(sum(${costUsdExpr}), 0)`.mapWith(Number),
      costReportedRuns: sql<number>`count(*) filter (where ${hasCostExpr})`.mapWith(Number),
      avgDurationMs: sql<
        number | null
      >`round(avg(${durationMsExpr}) filter (where ${completedWithDurExpr}))`.mapWith((v) =>
        v === null ? null : Number(v),
      ),
      p95DurationMs: sql<
        number | null
      >`round(percentile_cont(0.95) within group (order by ${durationMsExpr}) filter (where ${completedWithDurExpr}))`.mapWith(
        (v) => (v === null ? null : Number(v)),
      ),
      tpsOut:
        sql<number>`coalesce(sum(${outputTokensExpr}) filter (where ${completedWithOutExpr}), 0)`.mapWith(
          Number,
        ),
      tpsDur: sql<number>`coalesce(sum(${durationMsExpr}) filter (where ${completedWithOutExpr}), 0)`.mapWith(
        Number,
      ),
    })
    .from(runs)
    .innerJoin(bots, eq(bots.id, runs.botId))
    .innerJoin(users, eq(users.id, runs.originUserId))
    .innerJoin(groups, eq(groups.id, runs.groupId))
    .where(where)
    .groupBy(sql`1`, sql`2`, sql`3`)

  const sumTokens = rows.reduce((n, r) => n + r.totalTokens, 0)
  const sumRuns = rows.reduce((n, r) => n + r.runs, 0)
  const sumCost = rows.reduce((n, r) => n + r.costUsd, 0)

  const mapped: UsageBreakdownRowDto[] = rows
    .map((r) => ({
      key: r.key,
      name: dimLabel(q.by, r.key, r.name),
      sublabel: r.sublabel,
      runs: r.runs,
      completedRuns: r.completedRuns,
      failedRuns: r.failedRuns,
      cancelledRuns: r.cancelledRuns,
      unreportedRuns: r.unreportedRuns,
      successRate: safeDiv(r.completedRuns, r.endedRuns, 4),
      totalTokens: r.totalTokens,
      inputTokens: r.inputTokens,
      outputTokens: r.outputTokens,
      costUsd: round(r.costUsd, 6),
      costReportedRuns: r.costReportedRuns,
      avgDurationMs: r.avgDurationMs,
      p95DurationMs: r.p95DurationMs,
      avgOutputTps: effectiveTps(r.tpsOut, r.tpsDur),
      tokenShare: safeDiv(r.totalTokens, sumTokens, 4) ?? 0,
      runShare: safeDiv(r.runs, sumRuns, 4) ?? 0,
      costShare: safeDiv(r.costUsd, sumCost, 4) ?? 0,
    }))
    .sort((a, b) => b.totalTokens - a.totalTokens || b.runs - a.runs || a.name.localeCompare(b.name))

  return {
    by: q.by,
    totalItems: mapped.length,
    items: mapped.slice(0, q.limit),
  }
}

const heatValue = (
  metric: UsageHeatmapQuery['metric'],
  r: { totalTokens: number; runs: number; costUsd: number },
) => (metric === 'tokens' ? r.totalTokens : metric === 'runs' ? r.runs : round(r.costUsd, 6))

export async function getHeatmap(
  ctx: Ctx,
  q: UsageHeatmapQuery,
  scopeWhere: SQL | undefined,
): Promise<UsageHeatmapDto> {
  const now = ctx.now()
  if (q.mode === 'calendar') {
    const endDay = dayIn(now, q.tz)
    const startDay = addDays(endDay, -370)
    const where = buildFilterWhere(q, scopeWhere, {
      from: new Date(now.getTime() - 372 * DAY_MS),
      to: now,
    })
    const dayExpr = sql<string>`to_char(${runAtExpr} at time zone ${q.tz}, 'YYYY-MM-DD')`
    const rows = await ctx.db
      .select({
        day: dayExpr,
        runs: countExpr,
        totalTokens: sql<number>`coalesce(sum(${totalTokensExpr}), 0)`.mapWith(Number),
        costUsd: sql<number>`coalesce(sum(${costUsdExpr}), 0)`.mapWith(Number),
      })
      .from(runs)
      .innerJoin(bots, eq(bots.id, runs.botId))
      .innerJoin(users, eq(users.id, runs.originUserId))
      .innerJoin(groups, eq(groups.id, runs.groupId))
      .where(where)
      .groupBy(sql`1`)
    const byDay = new Map(rows.map((r) => [r.day, r]))
    const calendar: UsageCalendarCellDto[] = []
    let maxValue = 0
    for (let i = 0; i < 371; i++) {
      const day = addDays(startDay, i)
      const r = byDay.get(day)
      const cell = {
        day,
        runs: r?.runs ?? 0,
        totalTokens: r?.totalTokens ?? 0,
        costUsd: round(r?.costUsd ?? 0, 6),
        value: r ? heatValue(q.metric, r) : 0,
      }
      if (cell.value > maxValue) maxValue = cell.value
      calendar.push(cell)
    }
    return { mode: 'calendar', metric: q.metric, maxValue, calendar }
  }

  const range = resolveRange(q, now)
  const where = buildFilterWhere(q, scopeWhere, range)
  const dowExpr = sql<number>`extract(dow from ${runAtExpr} at time zone ${q.tz})::int`.mapWith(Number)
  const hourExpr = sql<number>`extract(hour from ${runAtExpr} at time zone ${q.tz})::int`.mapWith(Number)
  const rows = await ctx.db
    .select({
      dow: dowExpr,
      hour: hourExpr,
      runs: countExpr,
      totalTokens: sql<number>`coalesce(sum(${totalTokensExpr}), 0)`.mapWith(Number),
      costUsd: sql<number>`coalesce(sum(${costUsdExpr}), 0)`.mapWith(Number),
    })
    .from(runs)
    .innerJoin(bots, eq(bots.id, runs.botId))
    .innerJoin(users, eq(users.id, runs.originUserId))
    .innerJoin(groups, eq(groups.id, runs.groupId))
    .where(where)
    .groupBy(sql`1`, sql`2`)

  const byCell = new Map(rows.map((r) => [`${r.dow}:${r.hour}`, r]))
  const weekHour: UsageWeekHourCellDto[] = []
  let maxValue = 0
  for (let dow = 0; dow < 7; dow++) {
    for (let hour = 0; hour < 24; hour++) {
      const r = byCell.get(`${dow}:${hour}`)
      const cell = {
        dow,
        hour,
        runs: r?.runs ?? 0,
        totalTokens: r?.totalTokens ?? 0,
        costUsd: round(r?.costUsd ?? 0, 6),
        value: r ? heatValue(q.metric, r) : 0,
      }
      if (cell.value > maxValue) maxValue = cell.value
      weekHour.push(cell)
    }
  }
  return { mode: 'week_hour', metric: q.metric, maxValue, weekHour }
}
