import type {
  UsageCalendarCellDto,
  UsageHeatmapDto,
  UsageHeatmapQuery,
  UsageWeekHourCellDto,
} from '@gonggong/protocol'
import { eq, type SQL, sql } from 'drizzle-orm'
import type { Ctx } from '../../context.js'
import { bots, groups, machines, runs, users } from '../../db/schema.js'
import { buildPricingPlan } from './model-resolve.js'
import {
  addDays,
  buildFilterWhere,
  DAY_MS,
  dayIn,
  resolveRange,
  round,
  runAtExpr,
  totalTokensExpr,
} from './query.js'

const countExpr = sql<number>`count(*)`.mapWith(Number)

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
    const plan = await buildPricingPlan(ctx, where)
    const dayExpr = sql<string>`to_char(${runAtExpr} at time zone ${q.tz}, 'YYYY-MM-DD')`
    const rows = await ctx.db
      .select({
        day: dayExpr,
        runs: countExpr,
        totalTokens: sql<number>`coalesce(sum(${totalTokensExpr}), 0)`.mapWith(Number),
        costUsd: sql<number>`coalesce(sum(${plan.costZeroExpr}), 0)`.mapWith(Number),
      })
      .from(runs)
      .innerJoin(bots, eq(bots.id, runs.botId))
      .leftJoin(machines, eq(machines.id, bots.machineId))
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
  const plan = await buildPricingPlan(ctx, where)
  const dowExpr = sql<number>`extract(dow from ${runAtExpr} at time zone ${q.tz})::int`.mapWith(Number)
  const hourExpr = sql<number>`extract(hour from ${runAtExpr} at time zone ${q.tz})::int`.mapWith(Number)
  const rows = await ctx.db
    .select({
      dow: dowExpr,
      hour: hourExpr,
      runs: countExpr,
      totalTokens: sql<number>`coalesce(sum(${totalTokensExpr}), 0)`.mapWith(Number),
      costUsd: sql<number>`coalesce(sum(${plan.costZeroExpr}), 0)`.mapWith(Number),
    })
    .from(runs)
    .innerJoin(bots, eq(bots.id, runs.botId))
    .leftJoin(machines, eq(machines.id, bots.machineId))
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
