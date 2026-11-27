import { USAGE_DEFAULT_SENTINEL, type UsageCostSource, type UsageModelSource } from '@gonggong/protocol'
import { eq, type SQL, sql } from 'drizzle-orm'
import type { Ctx } from '../../context.js'
import { bots, groups, machines, runs, users } from '../../db/schema.js'
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

/** Cache read tokens: the run end copies the last usage event's breakdown onto `runs.usage` when the agent omits it. */
export const effectiveCacheReadExpr = sql<number>`coalesce((${runs.usage}->>'cachedReadTokens')::bigint, 0)`

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
  const cost = (r: { input: number; output: number; cacheRead: number; cacheWrite: number }) =>
    sql`(${input} * ${r.input} + ${output} * ${r.output} + ${cr} * ${r.cacheRead} + ${cw} * ${r.cacheWrite}) / 1000000.0`
  const p = matched.price
  if (!p.tiers?.length) return cost(p) as SQL<number>
  // Highest matching tier wins (tiers sorted ascending by `above`, so check descending).
  const branches = [...p.tiers]
    .reverse()
    .map((tier) => sql`when ${input} + ${cr} + ${cw} > ${tier.above} then ${cost(tier)}`)
  return sql<number>`case ${sql.join(branches, sql` `)} else ${cost(p)} end`
}

/**
 * Builds SQL cost expressions backed by live/bundled models.dev pricing for every distinct
 * `(resolvedModel, provider)` pair in `where`, enforcing the exact Magpie override policy.
 * Dispatches with a simple `CASE <resolved model> WHEN …` so the model expression (with its machine-catalog
 * subquery) is evaluated once per row instead of once per pair.
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

  const hasSplitTokens = sql`(${runs.usage}->>'inputTokens' is not null or ${runs.usage}->>'outputTokens' is not null)`
  const hasReportedCost = sql`(${runs.usage}->>'costUsd' is not null)`
  const reportedCost = sql`(${runs.usage}->>'costUsd')::double precision`

  const matches = new Map<string, MatchedModelPrice>()
  const byModel = new Map<string, { cost: SQL[]; source: SQL[] }>()

  for (const row of pairs) {
    if (!row.model) continue
    const hit = matchModelPrice(row.model, row.provider)
    if (!hit) continue
    matches.set(pairKey(row.model, row.provider), hit)

    const providerCond =
      row.provider === null ? sql`${providerCol} is null` : sql`${providerCol} = ${row.provider}`
    const catalogCost = buildCatalogFormula(hit)
    // Official Anthropic keeps its reported cost; otherwise the catalog price overrides bogus adapter costUsd.
    const order: ['reported' | 'catalog', SQL, SQL][] = [
      ['reported', hasReportedCost, reportedCost],
      ['catalog', hasSplitTokens, catalogCost],
    ]
    if (!isOfficialAnthropic(row.model, row.provider)) order.reverse()

    const entry = byModel.get(row.model) ?? { cost: [], source: [] }
    byModel.set(row.model, entry)
    for (const [source, cond, value] of order) {
      entry.cost.push(sql`when ${providerCond} and ${cond} then ${value}`)
      entry.source.push(sql`when ${providerCond} and ${cond} then ${source}`)
    }
  }

  const dispatch = (pick: 'cost' | 'source', fallback: SQL) => {
    const fallbackCase = sql`case when ${hasReportedCost} then ${fallback} else null end`
    if (byModel.size === 0) return fallbackCase
    const arms = [...byModel].map(
      ([model, e]) => sql`when ${model} then case ${sql.join(e[pick], sql` `)} else ${fallbackCase} end`,
    )
    return sql`case ${resolvedModelExpr} ${sql.join(arms, sql` `)} else ${fallbackCase} end`
  }

  const costNullableExpr = dispatch('cost', reportedCost) as SQL<number | null>
  const costSourceExpr = sql<UsageCostSource>`coalesce(${dispatch('source', sql`'reported'`)}, 'unpriced')`

  const costZeroExpr = sql<number>`coalesce(${costNullableExpr}, 0)`
  const hasEffectiveCostExpr = sql<boolean>`(${costNullableExpr}) is not null`

  return { costNullableExpr, costZeroExpr, hasEffectiveCostExpr, costSourceExpr, matches }
}
