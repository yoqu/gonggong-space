import type {
  AgentKind,
  RunStatus,
  UsageRunItemDto,
  UsageRunsDto,
  UsageRunsQuery,
  UsageTriggerSource,
} from '@gonggong/protocol'
import { and, eq, type SQL, sql } from 'drizzle-orm'
import type { Ctx } from '../../context.js'
import { bots, groups, machines, messages, runs, users } from '../../db/schema.js'
import {
  buildPricingPlan,
  modelSourceExpr,
  pairKey,
  resolvedModelExpr,
  type SqlPricingPlan,
} from './model-resolve.js'
import { toUnitPriceDto } from './pricing.js'
import {
  buildFilterWhere,
  durationMsExpr,
  effectiveTps,
  hasTokensExpr,
  inputTokensExpr,
  isCancelledExpr,
  isFailedExpr,
  outputTokensExpr,
  providerExpr,
  resolveRange,
  round,
  runAtExpr,
  totalTokensExpr,
  triggerSourceExpr,
} from './query.js'

const outputTpsSql = sql<number | null>`case
  when ${runs.status} = 'completed'
    and ${durationMsExpr} > 0
    and coalesce((${runs.usage}->>'outputTokens')::bigint, 0) > 0
  then ((${runs.usage}->>'outputTokens')::double precision / (${durationMsExpr} / 1000.0))
  else null
end`

const slowExpr = (slowMs: number) => sql<boolean>`coalesce(${durationMsExpr} >= ${slowMs}, false)`

export function buildRunsWhere(
  q: UsageRunsQuery | (UsageRunsQuery & { limit?: number }),
  scopeWhere: SQL | undefined,
  now: Date,
) {
  const range = resolveRange(q, now)
  const base = buildFilterWhere(q, scopeWhere, range)
  return and(base, q.onlySlow ? slowExpr(q.slowMs) : undefined, q.onlyError ? isFailedExpr : undefined)
}

export async function selectRunItems(
  ctx: Ctx,
  where: SQL | undefined,
  opts: {
    sortBy: UsageRunsQuery['sortBy']
    sortDir: UsageRunsQuery['sortDir']
    slowMs: number
    limit: number
    offset: number
    plan?: SqlPricingPlan
  },
): Promise<UsageRunItemDto[]> {
  const plan = opts.plan ?? (await buildPricingPlan(ctx, where))
  const orderCol = (() => {
    switch (opts.sortBy) {
      case 'totalTokens':
        return sql`(${runs.usage}->>'totalTokens')::bigint`
      case 'costUsd':
        return plan.costNullableExpr
      case 'durationMs':
        return durationMsExpr
      case 'outputTps':
        return outputTpsSql
      default:
        return runAtExpr
    }
  })()
  const orderSql =
    opts.sortDir === 'asc'
      ? sql`${orderCol} asc nulls last, ${runAtExpr} desc`
      : sql`${orderCol} desc nulls last, ${runAtExpr} desc`

  const rows = await ctx.db
    .select({
      id: runs.id,
      groupId: groups.id,
      groupName: groups.name,
      groupKind: sql<'group' | 'dm'>`${groups.kind}`,
      botId: bots.id,
      botName: bots.name,
      agentKind: sql<AgentKind>`${bots.agentKind}`,
      userId: users.id,
      userName: users.name,
      model: resolvedModelExpr,
      modelSource: modelSourceExpr,
      effort: runs.effort,
      provider: providerExpr,
      status: sql<RunStatus>`${runs.status}`,
      isError: sql<boolean>`(${isFailedExpr})`.mapWith(Boolean),
      isCancelled: sql<boolean>`(${isCancelledExpr})`.mapWith(Boolean),
      step: runs.step,
      summary: runs.summary,
      queuedAt: runs.queuedAt,
      startedAt: runs.startedAt,
      endedAt: runs.endedAt,
      durationMs: sql<number | null>`round(${durationMsExpr})`.mapWith((v) =>
        v === null ? null : Number(v),
      ),
      inputTokens: sql<number | null>`(${runs.usage}->>'inputTokens')::bigint`.mapWith((v) =>
        v === null ? null : Number(v),
      ),
      outputTokens: sql<number | null>`(${runs.usage}->>'outputTokens')::bigint`.mapWith((v) =>
        v === null ? null : Number(v),
      ),
      totalTokens: sql<number | null>`(${runs.usage}->>'totalTokens')::bigint`.mapWith((v) =>
        v === null ? null : Number(v),
      ),
      costUsd: plan.costNullableExpr.mapWith((v) => (v === null ? null : Number(v))),
      costSource: plan.costSourceExpr,
      filesChanged: runs.filesChanged,
      hop: runs.hop,
      sessionId: runs.sessionAfter,
      triggerSource: triggerSourceExpr,
      plugins: runs.plugins,
      personalSkills: runs.personalSkills,
    })
    .from(runs)
    .innerJoin(bots, eq(bots.id, runs.botId))
    .leftJoin(machines, eq(machines.id, bots.machineId))
    .innerJoin(users, eq(users.id, runs.originUserId))
    .innerJoin(groups, eq(groups.id, runs.groupId))
    .innerJoin(messages, eq(messages.id, runs.triggerMessageId))
    .where(where)
    .orderBy(orderSql)
    .limit(opts.limit)
    .offset(opts.offset)

  return rows.map((r) => {
    const matched = plan.matches.get(pairKey(r.model, r.provider))
    return {
      id: r.id,
      groupId: r.groupId,
      groupName: r.groupName,
      groupKind: r.groupKind,
      botId: r.botId,
      botName: r.botName,
      agentKind: r.agentKind,
      userId: r.userId,
      userName: r.userName,
      model: r.model,
      effort: r.effort,
      provider: r.provider,
      status: r.status,
      isError: r.isError,
      isCancelled: r.isCancelled,
      isSlow: r.durationMs !== null && r.durationMs >= opts.slowMs,
      step: r.step,
      summary: r.summary,
      queuedAt: r.queuedAt.toISOString(),
      startedAt: r.startedAt?.toISOString() ?? null,
      endedAt: r.endedAt?.toISOString() ?? null,
      durationMs: r.durationMs,
      inputTokens: r.inputTokens,
      outputTokens: r.outputTokens,
      totalTokens: r.totalTokens,
      costUsd: r.costUsd === null ? null : round(r.costUsd, 6),
      outputTps:
        r.status === 'completed' && r.outputTokens !== null && r.durationMs !== null
          ? effectiveTps(r.outputTokens, r.durationMs)
          : null,
      filesChanged: r.filesChanged,
      hop: r.hop,
      sessionId: r.sessionId,
      triggerSource: r.triggerSource,
      plugins: (r.plugins ?? []).map((p) => p.name),
      personalSkills: r.personalSkills,
      costSource: r.costSource,
      unitPrice: matched ? toUnitPriceDto(matched) : null,
      modelDisplayName: matched ? matched.displayName : null,
      modelSource: r.modelSource,
    }
  })
}

export async function getRuns(
  ctx: Ctx,
  q: UsageRunsQuery,
  scopeWhere: SQL | undefined,
): Promise<UsageRunsDto> {
  const where = buildRunsWhere(q, scopeWhere, ctx.now())
  const plan = await buildPricingPlan(ctx, where)
  const isSlowSql = slowExpr(q.slowMs)

  const [[summaryRow], sourceRows, items] = await Promise.all([
    ctx.db
      .select({
        totalRuns: sql<number>`count(*)`.mapWith(Number),
        totalTokens: sql<number>`coalesce(sum(${totalTokensExpr}), 0)`.mapWith(Number),
        inputTokens: sql<number>`coalesce(sum(${inputTokensExpr}), 0)`.mapWith(Number),
        outputTokens: sql<number>`coalesce(sum(${outputTokensExpr}), 0)`.mapWith(Number),
        costUsd: sql<number>`coalesce(sum(${plan.costZeroExpr}), 0)`.mapWith(Number),
        costReportedRuns: sql<number>`count(*) filter (where ${plan.hasEffectiveCostExpr})`.mapWith(Number),
        failedRuns: sql<number>`count(*) filter (where ${isFailedExpr})`.mapWith(Number),
        cancelledRuns: sql<number>`count(*) filter (where ${isCancelledExpr})`.mapWith(Number),
        unreportedRuns: sql<number>`count(*) filter (where not (${hasTokensExpr}))`.mapWith(Number),
        slowRuns: sql<number>`count(*) filter (where ${isSlowSql})`.mapWith(Number),
      })
      .from(runs)
      .innerJoin(bots, eq(bots.id, runs.botId))
      .leftJoin(machines, eq(machines.id, bots.machineId))
      .innerJoin(users, eq(users.id, runs.originUserId))
      .innerJoin(groups, eq(groups.id, runs.groupId))
      .where(where),

    ctx.db
      .select({
        source: triggerSourceExpr,
        runs: sql<number>`count(*)`.mapWith(Number),
        totalTokens: sql<number>`coalesce(sum(${totalTokensExpr}), 0)`.mapWith(Number),
        costUsd: sql<number>`coalesce(sum(${plan.costZeroExpr}), 0)`.mapWith(Number),
      })
      .from(runs)
      .innerJoin(bots, eq(bots.id, runs.botId))
      .leftJoin(machines, eq(machines.id, bots.machineId))
      .innerJoin(users, eq(users.id, runs.originUserId))
      .innerJoin(groups, eq(groups.id, runs.groupId))
      .innerJoin(messages, eq(messages.id, runs.triggerMessageId))
      .where(where)
      .groupBy(sql`1`),

    selectRunItems(ctx, where, {
      sortBy: q.sortBy,
      sortDir: q.sortDir,
      slowMs: q.slowMs,
      limit: q.pageSize,
      offset: (q.page - 1) * q.pageSize,
      plan,
    }),
  ])

  const s = summaryRow ?? {
    totalRuns: 0,
    totalTokens: 0,
    inputTokens: 0,
    outputTokens: 0,
    costUsd: 0,
    costReportedRuns: 0,
    failedRuns: 0,
    cancelledRuns: 0,
    unreportedRuns: 0,
    slowRuns: 0,
  }
  return {
    total: s.totalRuns,
    page: q.page,
    pageSize: q.pageSize,
    slowThresholdMs: q.slowMs,
    summary: {
      totalRuns: s.totalRuns,
      totalTokens: s.totalTokens,
      inputTokens: s.inputTokens,
      outputTokens: s.outputTokens,
      costUsd: round(s.costUsd, 6),
      costReportedRuns: s.costReportedRuns,
      failedRuns: s.failedRuns,
      cancelledRuns: s.cancelledRuns,
      unreportedRuns: s.unreportedRuns,
      slowRuns: s.slowRuns,
      bySource: sourceRows
        .map((r) => ({
          source: r.source as UsageTriggerSource,
          runs: r.runs,
          totalTokens: r.totalTokens,
          costUsd: round(r.costUsd, 6),
        }))
        .sort((a, b) => b.runs - a.runs || b.totalTokens - a.totalTokens),
    },
    items,
  }
}
