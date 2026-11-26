import type {
  AgentKind,
  UsageInsightsDto,
  UsageInsightsQuery,
  UsageSessionRowDto,
  UsageTriggerSource,
} from '@gonggong/protocol'
import { and, desc, eq, isNull, type SQL, sql } from 'drizzle-orm'
import type { Ctx } from '../../context.js'
import { bots, groups, messages, runEvents, runs, users } from '../../db/schema.js'
import { sysParams } from '../admin/params.js'
import {
  buildFilterWhere,
  costUsdExpr,
  durationMsExpr,
  hasCostExpr,
  inputTokensExpr,
  isFailedExpr,
  outputTokensExpr,
  resolveRange,
  round,
  runAtExpr,
  totalTokensExpr,
  triggerSourceExpr,
} from './query.js'

const TURN_BUCKETS = ['1', '2-3', '4-10', '11+'] as const
const DUR_BUCKETS = ['<10s', '10-30s', '30-120s', '2-5m', '5m+'] as const

const turnBucketOf = (turns: number): (typeof TURN_BUCKETS)[number] =>
  turns <= 1 ? '1' : turns <= 3 ? '2-3' : turns <= 10 ? '4-10' : '11+'

function percentile(sorted: number[], p: number): number | null {
  if (!sorted.length) return null
  const idx = (sorted.length - 1) * p
  const lo = Math.floor(idx)
  const hi = Math.ceil(idx)
  const loVal = sorted[lo] ?? 0
  const hiVal = sorted[hi] ?? loVal
  if (lo === hi) return loVal
  return Math.round(loVal + (hiVal - loVal) * (idx - lo))
}

export async function getInsights(
  ctx: Ctx,
  q: UsageInsightsQuery,
  scopeWhere: SQL | undefined,
): Promise<UsageInsightsDto> {
  const range = resolveRange(q, ctx.now())
  const where = buildFilterWhere(q, scopeWhere, range)
  const retentionDays = (await sysParams(ctx.db)).runRetentionDays

  const sessionKeyExpr = sql<string>`coalesce(${runs.sessionAfter}, ${runs.id}::text)`

  const [sessionRows, durRows, sourceRows, coverageRow, pluginRows, personalSkillRow] = await Promise.all([
    ctx.db
      .select({
        sessionKey: sessionKeyExpr,
        groupId: groups.id,
        groupName: groups.name,
        groupKind: sql<'group' | 'dm'>`${groups.kind}`,
        botId: bots.id,
        botName: bots.name,
        agentKind: sql<AgentKind>`${bots.agentKind}`,
        userId: sql<string>`(array_agg(${users.id}::text order by ${runAtExpr} desc))[1]`,
        userName: sql<string>`(array_agg(${users.name} order by ${runAtExpr} desc))[1]`,
        model: sql<
          string | null
        >`(array_agg(${runs.model} order by ${runAtExpr} desc) filter (where ${runs.model} is not null))[1]`,
        turns: sql<number>`count(*)`.mapWith(Number),
        failedTurns: sql<number>`count(*) filter (where ${isFailedExpr})`.mapWith(Number),
        totalTokens: sql<number>`coalesce(sum(${totalTokensExpr}), 0)`.mapWith(Number),
        inputTokens: sql<number>`coalesce(sum(${inputTokensExpr}), 0)`.mapWith(Number),
        outputTokens: sql<number>`coalesce(sum(${outputTokensExpr}), 0)`.mapWith(Number),
        costUsd: sql<number>`coalesce(sum(${costUsdExpr}), 0)`.mapWith(Number),
        costReportedRuns: sql<number>`count(*) filter (where ${hasCostExpr})`.mapWith(Number),
        totalDurationMs: sql<number>`coalesce(round(sum(${durationMsExpr})), 0)`.mapWith(Number),
        firstAt: sql<Date>`min(${runAtExpr})`.mapWith((v) => new Date(v)),
        lastAt: sql<Date>`max(${runAtExpr})`.mapWith((v) => new Date(v)),
      })
      .from(runs)
      .innerJoin(bots, eq(bots.id, runs.botId))
      .innerJoin(users, eq(users.id, runs.originUserId))
      .innerJoin(groups, eq(groups.id, runs.groupId))
      .where(where)
      .groupBy(sessionKeyExpr, groups.id, groups.name, groups.kind, bots.id, bots.name, bots.agentKind),

    ctx.db
      .select({
        bucket: sql<(typeof DUR_BUCKETS)[number]>`case
          when ${durationMsExpr} < 10000 then '<10s'
          when ${durationMsExpr} < 30000 then '10-30s'
          when ${durationMsExpr} < 120000 then '30-120s'
          when ${durationMsExpr} < 300000 then '2-5m'
          else '5m+'
        end`,
        runs: sql<number>`count(*)`.mapWith(Number),
        totalTokens: sql<number>`coalesce(sum(${totalTokensExpr}), 0)`.mapWith(Number),
      })
      .from(runs)
      .innerJoin(bots, eq(bots.id, runs.botId))
      .innerJoin(users, eq(users.id, runs.originUserId))
      .innerJoin(groups, eq(groups.id, runs.groupId))
      .where(and(where, sql`${durationMsExpr} is not null`))
      .groupBy(sql`1`),

    ctx.db
      .select({
        source: triggerSourceExpr,
        runs: sql<number>`count(*)`.mapWith(Number),
        totalTokens: sql<number>`coalesce(sum(${totalTokensExpr}), 0)`.mapWith(Number),
        costUsd: sql<number>`coalesce(sum(${costUsdExpr}), 0)`.mapWith(Number),
      })
      .from(runs)
      .innerJoin(bots, eq(bots.id, runs.botId))
      .innerJoin(users, eq(users.id, runs.originUserId))
      .innerJoin(groups, eq(groups.id, runs.groupId))
      .innerJoin(messages, eq(messages.id, runs.triggerMessageId))
      .where(where)
      .groupBy(sql`1`),

    ctx.db
      .select({
        coveredRuns: sql<number>`count(*) filter (where ${runs.purgedAt} is null)`.mapWith(Number),
        purgedRuns: sql<number>`count(*) filter (where ${runs.purgedAt} is not null)`.mapWith(Number),
      })
      .from(runs)
      .innerJoin(bots, eq(bots.id, runs.botId))
      .innerJoin(users, eq(users.id, runs.originUserId))
      .innerJoin(groups, eq(groups.id, runs.groupId))
      .where(where),

    ctx.db
      .select({
        name: sql<string>`p.elem->>'name'`,
        runs: sql<number>`count(distinct ${runs.id})`.mapWith(Number),
        totalTokens: sql<number>`coalesce(sum(${totalTokensExpr}), 0)`.mapWith(Number),
      })
      .from(runs)
      .innerJoin(bots, eq(bots.id, runs.botId))
      .innerJoin(users, eq(users.id, runs.originUserId))
      .innerJoin(groups, eq(groups.id, runs.groupId))
      .innerJoin(sql`lateral jsonb_array_elements(${runs.plugins}) as p(elem)`, sql`true`)
      .where(and(where, sql`jsonb_array_length(${runs.plugins}) > 0`))
      .groupBy(sql`1`)
      .orderBy(desc(sql`count(distinct ${runs.id})`), desc(sql`coalesce(sum(${totalTokensExpr}), 0)`))
      .limit(20),

    ctx.db
      .select({
        runsWithPersonalSkills: sql<number>`count(*) filter (where ${runs.personalSkills} > 0)`.mapWith(
          Number,
        ),
      })
      .from(runs)
      .innerJoin(bots, eq(bots.id, runs.botId))
      .innerJoin(users, eq(users.id, runs.originUserId))
      .innerJoin(groups, eq(groups.id, runs.groupId))
      .where(where),
  ])

  const sessions: UsageSessionRowDto[] = sessionRows.map((s) => ({
    sessionKey: s.sessionKey,
    groupId: s.groupId,
    groupName: s.groupName,
    groupKind: s.groupKind,
    botId: s.botId,
    botName: s.botName,
    agentKind: s.agentKind,
    model: s.model,
    userId: s.userId,
    userName: s.userName,
    turns: s.turns,
    failedTurns: s.failedTurns,
    totalTokens: s.totalTokens,
    inputTokens: s.inputTokens,
    outputTokens: s.outputTokens,
    costUsd: round(s.costUsd, 6),
    costReportedRuns: s.costReportedRuns,
    totalDurationMs: s.totalDurationMs,
    firstAt: s.firstAt.toISOString(),
    lastAt: s.lastAt.toISOString(),
  }))

  const totalSessions = sessions.length
  const totalTurns = sessions.reduce((n, s) => n + s.turns, 0)
  const totalTokens = sessions.reduce((n, s) => n + s.totalTokens, 0)
  const totalActiveDurationMs = sessions.reduce((n, s) => n + s.totalDurationMs, 0)
  const sortedTokens = sessions.map((s) => s.totalTokens).sort((a, b) => a - b)

  const turnMap = new Map<string, { sessions: number; totalTokens: number; costUsd: number }>()
  for (const s of sessions) {
    const b = turnBucketOf(s.turns)
    const acc = turnMap.get(b) ?? { sessions: 0, totalTokens: 0, costUsd: 0 }
    acc.sessions += 1
    acc.totalTokens += s.totalTokens
    acc.costUsd += s.costUsd
    turnMap.set(b, acc)
  }

  const durMap = new Map(durRows.map((r) => [r.bucket, r]))

  const topSessions = [...sessions]
    .sort((a, b) => {
      if (q.sessionSort === 'runs') return b.turns - a.turns || b.totalTokens - a.totalTokens
      if (q.sessionSort === 'duration')
        return b.totalDurationMs - a.totalDurationMs || b.totalTokens - a.totalTokens
      return b.totalTokens - a.totalTokens || b.costUsd - a.costUsd || b.turns - a.turns
    })
    .slice(0, 15)

  const recentSessions = [...sessions].sort((a, b) => b.lastAt.localeCompare(a.lastAt)).slice(0, 20)

  // Tool usage from unpurged run_events (deduped by (runId, toolCallId)).
  const coveredRuns = coverageRow[0]?.coveredRuns ?? 0
  const purgedRuns = coverageRow[0]?.purgedRuns ?? 0
  const toolUsage =
    coveredRuns > 0
      ? await queryToolUsage(ctx, where, q.tz, coveredRuns, purgedRuns, retentionDays)
      : {
          coveredRuns: 0,
          purgedRuns,
          retentionDays,
          byToolKind: [],
          byMcpTool: [],
          byToolName: [],
          weeklyByKind: [],
        }

  return {
    sessionShape: {
      totalSessions,
      totalActiveDurationMs,
      totalTokens,
      avgTurnsPerSession: totalSessions > 0 ? round(totalTurns / totalSessions, 2) : 0,
      avgTokensPerSession: totalSessions > 0 ? Math.round(totalTokens / totalSessions) : 0,
      medianTokensPerSession: percentile(sortedTokens, 0.5),
      p90TokensPerSession: percentile(sortedTokens, 0.9),
      groupCount: sessions.filter((s) => s.groupKind === 'group').length,
      dmCount: sessions.filter((s) => s.groupKind === 'dm').length,
      turnBuckets: TURN_BUCKETS.map((bucket) => {
        const v = turnMap.get(bucket)
        return {
          bucket,
          sessions: v?.sessions ?? 0,
          totalTokens: v?.totalTokens ?? 0,
          costUsd: round(v?.costUsd ?? 0, 6),
        }
      }),
      durationBuckets: DUR_BUCKETS.map((bucket) => {
        const v = durMap.get(bucket)
        return { bucket, runs: v?.runs ?? 0, totalTokens: v?.totalTokens ?? 0 }
      }),
      triggerSources: sourceRows
        .map((r) => ({
          source: r.source as UsageTriggerSource,
          runs: r.runs,
          totalTokens: r.totalTokens,
          costUsd: round(r.costUsd, 6),
        }))
        .sort((a, b) => b.runs - a.runs || b.totalTokens - a.totalTokens),
    },
    topSessions,
    recentSessions,
    toolUsage,
    pluginUsage: {
      items: pluginRows.map((p) => ({ name: p.name, runs: p.runs, totalTokens: p.totalTokens })),
      runsWithPersonalSkills: personalSkillRow[0]?.runsWithPersonalSkills ?? 0,
    },
  }
}

async function queryToolUsage(
  ctx: Ctx,
  where: SQL | undefined,
  tz: string,
  coveredRuns: number,
  purgedRuns: number,
  retentionDays: number,
): Promise<UsageInsightsDto['toolUsage']> {
  const unpurgedRuns = ctx.db
    .select({ id: runs.id })
    .from(runs)
    .innerJoin(bots, eq(bots.id, runs.botId))
    .innerJoin(users, eq(users.id, runs.originUserId))
    .innerJoin(groups, eq(groups.id, runs.groupId))
    .where(and(where, isNull(runs.purgedAt)))
    .as('ins_runs')

  const dedupedTools = ctx.db
    .select({
      runId: runEvents.runId,
      callId: sql<string>`coalesce(${runEvents.payload}->>'toolCallId', ${runEvents.id}::text)`.as('call_id'),
      toolKind: sql<string>`coalesce(max(${runEvents.payload}->>'toolKind'), 'other')`.as('tool_kind'),
      failed: sql<boolean>`bool_or(${runEvents.payload}->>'status' = 'failed')`.as('failed'),
      mcpServer: sql<string | null>`max(${runEvents.payload}->'mcp'->>'server')`.as('mcp_server'),
      mcpTool: sql<string | null>`max(${runEvents.payload}->'mcp'->>'tool')`.as('mcp_tool'),
      firstAt: sql<Date>`min(${runEvents.createdAt})`.as('first_at'),
    })
    .from(runEvents)
    .innerJoin(unpurgedRuns, eq(unpurgedRuns.id, runEvents.runId))
    .where(eq(runEvents.kind, 'tool'))
    .groupBy(runEvents.runId, sql`coalesce(${runEvents.payload}->>'toolCallId', ${runEvents.id}::text)`)
    .as('deduped_tools')

  const latestBreakdown = ctx.db
    .selectDistinctOn([runEvents.runId], {
      runId: runEvents.runId,
      tools: sql<unknown>`${runEvents.payload}->'breakdown'->'tools'`.as('tools_json'),
    })
    .from(runEvents)
    .innerJoin(unpurgedRuns, eq(unpurgedRuns.id, runEvents.runId))
    .where(and(eq(runEvents.kind, 'usage'), sql`${runEvents.payload}->'breakdown'->'tools' is not null`))
    .orderBy(runEvents.runId, desc(runEvents.id))
    .as('latest_bd')

  const [byKindRows, byMcpRows, weeklyRows, byNameRows] = await Promise.all([
    ctx.db
      .select({
        toolKind: dedupedTools.toolKind,
        calls: sql<number>`count(*)`.mapWith(Number),
        failedCalls: sql<number>`count(*) filter (where ${dedupedTools.failed})`.mapWith(Number),
        runs: sql<number>`count(distinct ${dedupedTools.runId})`.mapWith(Number),
      })
      .from(dedupedTools)
      .groupBy(dedupedTools.toolKind)
      .orderBy(desc(sql`count(*)`)),

    ctx.db
      .select({
        server: sql<string>`${dedupedTools.mcpServer}`,
        tool: sql<string>`${dedupedTools.mcpTool}`,
        calls: sql<number>`count(*)`.mapWith(Number),
        failedCalls: sql<number>`count(*) filter (where ${dedupedTools.failed})`.mapWith(Number),
        runs: sql<number>`count(distinct ${dedupedTools.runId})`.mapWith(Number),
      })
      .from(dedupedTools)
      .where(sql`${dedupedTools.mcpServer} is not null and ${dedupedTools.mcpTool} is not null`)
      .groupBy(dedupedTools.mcpServer, dedupedTools.mcpTool)
      .orderBy(desc(sql`count(*)`))
      .limit(20),

    ctx.db
      .select({
        week: sql<string>`to_char(date_trunc('week', ${dedupedTools.firstAt} at time zone ${tz}), 'YYYY-MM-DD')`,
        toolKind: dedupedTools.toolKind,
        calls: sql<number>`count(*)`.mapWith(Number),
      })
      .from(dedupedTools)
      .groupBy(sql`1`, dedupedTools.toolKind)
      .orderBy(sql`1 asc`),

    ctx.db
      .select({
        name: sql<string>`coalesce(t.elem->>'name', t.elem->>'kind', 'other')`,
        kind: sql<string>`coalesce(t.elem->>'kind', 'other')`,
        calls: sql<number>`coalesce(sum((t.elem->>'count')::bigint), 0)`.mapWith(Number),
        estTokens: sql<number>`coalesce(sum((t.elem->>'tokens')::bigint), 0)`.mapWith(Number),
        runs: sql<number>`count(distinct ${latestBreakdown.runId})`.mapWith(Number),
      })
      .from(latestBreakdown)
      .innerJoin(sql`lateral jsonb_array_elements(${latestBreakdown.tools}) as t(elem)`, sql`true`)
      .groupBy(sql`1`, sql`2`)
      .orderBy(desc(sql`coalesce(sum((t.elem->>'count')::bigint), 0)`))
      .limit(20),
  ])

  const weekMap = new Map<string, { week: string; total: number; byKind: Record<string, number> }>()
  for (const r of weeklyRows) {
    const entry = weekMap.get(r.week) ?? { week: r.week, total: 0, byKind: {} }
    entry.total += r.calls
    entry.byKind[r.toolKind] = (entry.byKind[r.toolKind] ?? 0) + r.calls
    weekMap.set(r.week, entry)
  }

  return {
    coveredRuns,
    purgedRuns,
    retentionDays,
    byToolKind: byKindRows,
    byMcpTool: byMcpRows,
    byToolName: byNameRows,
    weeklyByKind: [...weekMap.values()].sort((a, b) => a.week.localeCompare(b.week)),
  }
}
