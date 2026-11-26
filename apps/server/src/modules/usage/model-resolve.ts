import { USAGE_DEFAULT_SENTINEL, type UsageCostSource, type UsageModelSource } from '@gonggong/protocol'
import { eq, type SQL, sql } from 'drizzle-orm'
import type { Ctx } from '../../context.js'
import { bots, groups, machines, runEvents, runs, users } from '../../db/schema.js'
import { isOfficialAnthropic, type MatchedModelPrice, matchModelPrice } from './pricing.js'

const DEFAULT_PREFIX_SQL = sql.raw(`'${USAGE_DEFAULT_SENTINEL}:'`)

/** Normalizes a raw model name; returns null for empty, 'default', or '<synthetic>'. */
export function normalizeConcreteModel(raw: string | null | undefined): string | null {
  if (!raw) return null
  const trimmed = raw.trim()
  if (!trimmed || trimmed === 'default' || trimmed === '<synthetic>') return null
  return trimmed
}

/** Machine catalog current default model for the bot's agentKind. */
export const machineCatalogModelExpr = sql<string | null>`(
  select nullif(nullif(nullif(elem->'catalog'->>'current', ''), 'default'), '<synthetic>')
  from jsonb_array_elements(coalesce(${machines.agents}, '[]'::jsonb)) as elem
  where elem->>'kind' = ${bots.agentKind}
  limit 1
)`

/** Concrete model resolved via runs.model -> bots.model -> machines.agents catalog.current. */
export const resolvedModelExpr = sql<string | null>`coalesce(
  nullif(nullif(nullif(${runs.model}, ''), 'default'), '<synthetic>'),
  nullif(nullif(nullif(${bots.model}, ''), 'default'), '<synthetic>'),
  ${machineCatalogModelExpr}
)`

export const modelSourceExpr = sql<UsageModelSource>`case
  when nullif(nullif(nullif(${runs.model}, ''), 'default'), '<synthetic>') is not null then 'recorded'
  when nullif(nullif(nullif(${bots.model}, ''), 'default'), '<synthetic>') is not null then 'bot_default'
  when ${machineCatalogModelExpr} is not null then 'machine_default'
  else 'unknown'
end`

/** Model grouping key: concrete model id, or `__default__:<agentKind>` when genuinely unknown. */
export const modelKeyExpr = sql<string>`coalesce(
  ${resolvedModelExpr},
  ${DEFAULT_PREFIX_SQL} || ${bots.agentKind}
)`

/** Cache read tokens: runs.usage.cachedReadTokens, else latest unpurged run_events breakdown.cache.read, else 0. */
export const effectiveCacheReadExpr = sql<number>`coalesce(
  (${runs.usage}->>'cachedReadTokens')::bigint,
  case when ${runs.purgedAt} is null then (
    select (re.payload->'breakdown'->'cache'->>'read')::bigint
    from ${runEvents} re
    where re.run_id = ${runs.id}
      and re.kind = 'usage'
      and re.payload->'breakdown'->'cache' is not null
    order by re.id desc
    limit 1
  ) else null end,
  0
)`

export const effectiveCacheWriteExpr = sql<number>`coalesce((${runs.usage}->>'cachedWriteTokens')::bigint, 0)`

export interface SqlPricingPlan {
  /** Effective per-run USD cost (nullable when unpriced). */
  costNullableExpr: SQL<number | null>
  /** Effective per-run USD cost coalesced to 0 for SUM(). */
  costZeroExpr: SQL<number>
  /** True when run has either reported or catalog cost. */
  hasEffectiveCostExpr: SQL<boolean>
  /** 'reported' | 'catalog' | 'unpriced' */
  costSourceExpr: SQL<UsageCostSource>
  /** Matched catalog entry keyed by `${resolvedModel ?? ''}\0${provider ?? ''}`. */
  matches: Map<string, MatchedModelPrice>
}

export const pairKey = (model: string | null, provider: string | null) => `${model ?? ''}\0${provider ?? ''}`

function buildCatalogFormula(matched: MatchedModelPrice): SQL<number> {
  const input = sql`coalesce((${runs.usage}->>'inputTokens')::bigint, 0)::double precision`
  const output = sql`coalesce((${runs.usage}->>'outputTokens')::bigint, 0)::double precision`
  const cr = sql`(${effectiveCacheReadExpr})::double precision`
  const cw = sql`(${effectiveCacheWriteExpr})::double precision`
  const p = matched.price

  const baseFormula = sql<number>`(${input} * ${p.input} + ${output} * ${p.output} + ${cr} * ${p.cacheRead} + ${cw} * ${p.cacheWrite}) / 1000000.0`
  if (!p.tiers || p.tiers.length === 0) return baseFormula

  const prompt = sql`(${input} + ${cr} + ${cw})`
  // Highest matching tier wins (sorted ascending by `above`, check descending in CASE).
  const branches: SQL[] = []
  for (let i = p.tiers.length - 1; i >= 0; i--) {
    const tier = p.tiers[i]
    if (!tier) continue
    branches.push(
      sql`when ${prompt} > ${tier.above} then (${input} * ${tier.input} + ${output} * ${tier.output} + ${cr} * ${tier.cacheRead} + ${cw} * ${tier.cacheWrite}) / 1000000.0`,
    )
  }
  return sql<number>`case ${sql.join(branches, sql` `)} else ${baseFormula} end`
}

/**
 * Builds SQL cost expressions backed by live/bundled models.dev pricing for every distinct
 * `(resolvedModel, provider)` pair in `where`, enforcing the exact Magpie override policy.
 */
export async function buildPricingPlan(ctx: Ctx, where: SQL | undefined): Promise<SqlPricingPlan> {
  const providerCol = sql<string | null>`${runs.settings}->>'provider'`
  const pairs = await ctx.db
    .selectDistinct({ model: resolvedModelExpr, provider: providerCol })
    .from(runs)
    .innerJoin(bots, eq(bots.id, runs.botId))
    .leftJoin(machines, eq(machines.id, bots.machineId))
    .innerJoin(users, eq(users.id, runs.originUserId))
    .innerJoin(groups, eq(groups.id, runs.groupId))
    .where(where)

  const matches = new Map<string, MatchedModelPrice>()
  const costBranches: SQL[] = []
  const sourceBranches: SQL[] = []

  const hasSplitTokens = sql`(${runs.usage}->>'inputTokens' is not null or ${runs.usage}->>'outputTokens' is not null)`
  const hasReportedCost = sql`(${runs.usage}->>'costUsd' is not null)`
  const reportedCost = sql`(${runs.usage}->>'costUsd')::double precision`

  for (const row of pairs) {
    if (!row.model) continue
    const hit = matchModelPrice(row.model, row.provider)
    if (!hit) continue
    matches.set(pairKey(row.model, row.provider), hit)

    const matchCond =
      row.provider === null
        ? sql`${resolvedModelExpr} = ${row.model} and ${providerCol} is null`
        : sql`${resolvedModelExpr} = ${row.model} and ${providerCol} = ${row.provider}`

    const catalogCost = buildCatalogFormula(hit)
    const officialAnthropic = isOfficialAnthropic(row.model, row.provider)

    if (officialAnthropic) {
      costBranches.push(
        sql`when ${matchCond} and ${hasReportedCost} then ${reportedCost}`,
        sql`when ${matchCond} and ${hasSplitTokens} then ${catalogCost}`,
      )
      sourceBranches.push(
        sql`when ${matchCond} and ${hasReportedCost} then 'reported'`,
        sql`when ${matchCond} and ${hasSplitTokens} then 'catalog'`,
      )
    } else {
      // Non-Anthropic model or third-party provider: catalog price always overrides bogus adapter costUsd.
      costBranches.push(
        sql`when ${matchCond} and ${hasSplitTokens} then ${catalogCost}`,
        sql`when ${matchCond} and ${hasReportedCost} then ${reportedCost}`,
      )
      sourceBranches.push(
        sql`when ${matchCond} and ${hasSplitTokens} then 'catalog'`,
        sql`when ${matchCond} and ${hasReportedCost} then 'reported'`,
      )
    }
  }

  const costNullableExpr =
    costBranches.length > 0
      ? sql<
          number | null
        >`case ${sql.join(costBranches, sql` `)} when ${hasReportedCost} then ${reportedCost} else null end`
      : sql<number | null>`case when ${hasReportedCost} then ${reportedCost} else null end`

  const costSourceExpr =
    sourceBranches.length > 0
      ? sql<UsageCostSource>`case ${sql.join(sourceBranches, sql` `)} when ${hasReportedCost} then 'reported' else 'unpriced' end`
      : sql<UsageCostSource>`case when ${hasReportedCost} then 'reported' else 'unpriced' end`

  const costZeroExpr = sql<number>`coalesce(${costNullableExpr}, 0)`
  const hasEffectiveCostExpr = sql<boolean>`(${costNullableExpr}) is not null`

  return { costNullableExpr, costZeroExpr, hasEffectiveCostExpr, costSourceExpr, matches }
}
