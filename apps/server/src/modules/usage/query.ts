import {
  type AgentKind,
  LIVE_RUN_STATUSES,
  TERMINAL_RUN_STATUS,
  USAGE_DEFAULT_SENTINEL,
  type UsageAnalyticsQuery,
  type UsageResolvedGranularity,
  type UsageTriggerSource,
} from '@gonggong/protocol'
import { and, eq, gte, ilike, inArray, isNull, lt, or, type SQL, sql } from 'drizzle-orm'
import type { FastifyRequest } from 'fastify'
import type { Ctx } from '../../context.js'
import { bots, feishuMessageLinks, groups, messages, runs, users } from '../../db/schema.js'
import { fail } from '../../lib/errors.js'
import { idParam, isUuid } from '../../lib/ids.js'
import { requireSysadmin, requireUser } from '../auth/session.js'
import { isSharedWith } from '../bots/shares.js'
import { currentTeam, requireTeam } from '../teams/service.js'

export const HOUR_MS = 3_600_000
export const DAY_MS = 86_400_000

const DATE_ONLY = /^\d{4}-\d{2}-\d{2}$/

export interface ResolvedRange {
  from: Date | null
  to: Date
  previousFrom: Date | null
  previousTo: Date | null
  granularity: UsageResolvedGranularity
}

export type ScopedFn = (
  ctx: Ctx,
  req: FastifyRequest,
  q: { botId?: string; teamId?: string },
  opts?: { forFacets?: boolean },
) => Promise<SQL | undefined>

/**
 * Runs of the current team's bots: sysadmins see all of them; members only their own bots' runs, and a botId filter
 * only for bots they own (or their own runs of a bot shared with them). With `teamId`, a team admin sees the whole team.
 */
export async function usageScope(
  ctx: Ctx,
  req: FastifyRequest,
  q: { botId?: string; teamId?: string },
  opts: { forFacets?: boolean } = {},
) {
  const me = await requireUser(ctx, req)
  const byBot = () =>
    !opts.forFacets && q.botId ? eq(runs.botId, idParam(q.botId, 'Bot 不存在')) : undefined
  if (q.teamId)
    return and(eq(bots.teamId, (await requireTeam(ctx, me.id, q.teamId, 'admin')).team.id), byBot())
  const teamId = await currentTeam(ctx, req, me.id)
  const admin = me.role === 'sysadmin'
  if (q.botId && !admin) {
    const [bot] = isUuid(q.botId)
      ? await ctx.db.select({ ownerId: bots.ownerId }).from(bots).where(eq(bots.id, q.botId))
      : []
    if (bot && bot.ownerId !== me.id && (await isSharedWith(ctx, q.botId, me.id)))
      return and(eq(bots.teamId, teamId), eq(runs.botId, q.botId), eq(runs.originUserId, me.id))
    if (bot?.ownerId !== me.id) return fail('forbidden', '仅 Bot 主人或系统管理员可查看该 Bot 的用量')
  }
  return and(eq(bots.teamId, teamId), byBot(), admin ? undefined : eq(bots.ownerId, me.id))
}

/** Platform admin scope: every team, or the one picked. */
export async function platformUsageScope(
  ctx: Ctx,
  req: FastifyRequest,
  q: { botId?: string; teamId?: string },
  opts: { forFacets?: boolean } = {},
) {
  await requireSysadmin(ctx, req)
  return and(
    q.teamId ? eq(bots.teamId, idParam(q.teamId, '团队不存在')) : undefined,
    !opts.forFacets && q.botId ? eq(runs.botId, idParam(q.botId, 'Bot 不存在')) : undefined,
  )
}

/** YYYY-MM-DD of `at` in `timeZone`. */
export const dayIn = (at: Date, timeZone: string) =>
  new Intl.DateTimeFormat('en-CA', { timeZone, year: 'numeric', month: '2-digit', day: '2-digit' }).format(at)

/** YYYY-MM-DDTHH:00 of `at` in `timeZone`. */
export function hourIn(at: Date, timeZone: string) {
  const parts = new Intl.DateTimeFormat('en-CA', {
    timeZone,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    hourCycle: 'h23',
  }).formatToParts(at)
  const pick = (type: string) => parts.find((p) => p.type === type)?.value ?? '00'
  const hour = pick('hour') === '24' ? '00' : pick('hour')
  return `${pick('year')}-${pick('month')}-${pick('day')}T${hour}:00`
}

export const addDays = (day: string, delta: number) =>
  new Date(Date.parse(`${day}T00:00:00Z`) + delta * DAY_MS).toISOString().slice(0, 10)

/** Converts local midnight `YYYY-MM-DD 00:00:00` in IANA `timeZone` to the corresponding UTC Date. */
export function localDateStartUtc(day: string, timeZone: string): Date {
  const [y, m, d] = day.split('-').map(Number) as [number, number, number]
  const targetUtc = Date.UTC(y, m - 1, d, 0, 0, 0)
  const fmt = new Intl.DateTimeFormat('en-CA', {
    timeZone,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
    hourCycle: 'h23',
  })
  let guess = targetUtc
  for (let i = 0; i < 3; i++) {
    const parts = fmt.formatToParts(new Date(guess))
    const p = (type: string) => Number(parts.find((x) => x.type === type)?.value ?? 0)
    const hr = p('hour') === 24 ? 0 : p('hour')
    const localAsUtc = Date.UTC(p('year'), p('month') - 1, p('day'), hr, p('minute'), p('second'))
    const diff = targetUtc - localAsUtc
    if (diff === 0) break
    guess += diff
  }
  return new Date(guess)
}

function parseBound(raw: string, tz: string, endExclusive: boolean): Date {
  if (DATE_ONLY.test(raw)) {
    const day = endExclusive ? addDays(raw, 1) : raw
    const dt = localDateStartUtc(day, tz)
    if (Number.isNaN(dt.getTime())) fail('invalid', '请求无效')
    return dt
  }
  const dt = new Date(raw)
  if (Number.isNaN(dt.getTime())) fail('invalid', '请求无效')
  return dt
}

/** Resolves time preset / custom bounds and its equal-length comparison window. */
export function resolveRange(
  q: Pick<UsageAnalyticsQuery, 'preset' | 'from' | 'to' | 'tz'>,
  now: Date,
): ResolvedRange {
  const to = now
  switch (q.preset) {
    case 'today': {
      const today = dayIn(now, q.tz)
      const from = localDateStartUtc(today, q.tz)
      const prevFrom = localDateStartUtc(addDays(today, -1), q.tz)
      return { from, to, previousFrom: prevFrom, previousTo: from, granularity: 'hour' }
    }
    case '24h': {
      const from = new Date(now.getTime() - 24 * HOUR_MS)
      return {
        from,
        to,
        previousFrom: new Date(from.getTime() - 24 * HOUR_MS),
        previousTo: from,
        granularity: 'hour',
      }
    }
    case '7d':
    case '30d':
    case '90d': {
      const days = q.preset === '7d' ? 7 : q.preset === '30d' ? 30 : 90
      const span = days * DAY_MS
      const from = new Date(now.getTime() - span)
      return {
        from,
        to,
        previousFrom: new Date(from.getTime() - span),
        previousTo: from,
        granularity: 'day',
      }
    }
    case 'all':
      return { from: null, to, previousFrom: null, previousTo: null, granularity: 'day' }
    case 'custom': {
      const rawFrom = q.from ?? fail('invalid', '请求无效')
      const from = parseBound(rawFrom, q.tz, false)
      const customTo = q.to ? parseBound(q.to, q.tz, true) : now
      if (from.getTime() >= customTo.getTime()) fail('invalid', '请求无效')
      const span = customTo.getTime() - from.getTime()
      return {
        from,
        to: customTo,
        previousFrom: new Date(from.getTime() - span),
        previousTo: from,
        granularity: span <= 48 * HOUR_MS ? 'hour' : 'day',
      }
    }
  }
}

// ── Reusable SQL expressions ────────────────────────────────────────────────
export const runAtExpr = sql<Date>`coalesce(${runs.startedAt}, ${runs.queuedAt})`
export const totalTokensExpr = sql<number>`coalesce((${runs.usage}->>'totalTokens')::bigint, 0)`
export const inputTokensExpr = sql<number>`coalesce((${runs.usage}->>'inputTokens')::bigint, 0)`
export const outputTokensExpr = sql<number>`coalesce((${runs.usage}->>'outputTokens')::bigint, 0)`
export const costUsdExpr = sql<number>`coalesce((${runs.usage}->>'costUsd')::double precision, 0)`
export const hasTokensExpr = sql<boolean>`${runs.usage}->>'totalTokens' is not null`
export const hasCostExpr = sql<boolean>`${runs.usage}->>'costUsd' is not null`
export const providerExpr = sql<string | null>`${runs.settings}->>'provider'`

export const durationMsExpr = sql<number | null>`case
  when ${runs.startedAt} is not null and ${runs.endedAt} is not null
  then greatest(0, extract(epoch from ${runs.endedAt} - ${runs.startedAt}) * 1000)
  else null
end`

export const isFailedExpr = sql<boolean>`${runs.status} in ('interrupted', 'expired', 'forbidden') and ${runs.stoppedBy} is null`
export const isCancelledExpr = sql<boolean>`${runs.status} = 'interrupted' and ${runs.stoppedBy} is not null`
export const isEndedExpr = inArray(runs.status, [...TERMINAL_RUN_STATUS])
export const isLiveExpr = inArray(runs.status, [...LIVE_RUN_STATUSES])
export const completedWithDurExpr = sql<boolean>`${runs.status} = 'completed' and ${runs.startedAt} is not null and ${runs.endedAt} is not null`
export const completedWithOutExpr = sql<boolean>`${runs.status} = 'completed' and ${runs.startedAt} is not null and ${runs.endedAt} is not null and coalesce((${runs.usage}->>'outputTokens')::bigint, 0) > 0 and extract(epoch from ${runs.endedAt} - ${runs.startedAt}) > 0`

export const triggerSourceExpr = sql<UsageTriggerSource>`case
  when ${runs.continuationOf} is not null then 'continuation'
  when ${runs.hop} > 1 or ${runs.parentRunId} is not null then 'relay'
  when ${messages.meta}->>'scheduleOf' is not null then 'schedule'
  when ${messages.meta}->>'webhookOf' is not null then 'webhook'
  when exists(
    select 1 from ${feishuMessageLinks} fml
    where fml.message_id = ${runs.triggerMessageId} and fml.direction = 'in'
  ) then 'feishu'
  when ${groups.kind} = 'dm' then 'web_dm'
  else 'web_group'
end`

/** Range predicate using `runs_started` / `runs_queued` indexes cleanly while matching `coalesce(started_at, queued_at)`. */
export function timeWindowWhere(from: Date | null, to: Date | null): SQL | undefined {
  const parts: (SQL | undefined)[] = []
  if (from) parts.push(or(gte(runs.startedAt, from), and(isNull(runs.startedAt), gte(runs.queuedAt, from))))
  if (to) parts.push(or(lt(runs.startedAt, to), and(isNull(runs.startedAt), lt(runs.queuedAt, to))))
  return and(...parts)
}

const escapeLike = (s: string) => s.replace(/[\\%_]/g, (c) => `\\${c}`)

export function buildFilterWhere(
  q: UsageAnalyticsQuery,
  scopeWhere: SQL | undefined,
  window: { from: Date | null; to: Date | null } | null,
  opts: { skipDimFilters?: boolean } = {},
): SQL | undefined {
  const parts: (SQL | undefined)[] = [scopeWhere]
  if (window) parts.push(timeWindowWhere(window.from, window.to))
  if (!opts.skipDimFilters) {
    if (q.userId) parts.push(eq(runs.originUserId, idParam(q.userId, '成员不存在')))
    if (q.groupId) parts.push(eq(runs.groupId, idParam(q.groupId, '群不存在')))
    if (q.agentKind) parts.push(eq(bots.agentKind, q.agentKind))
    if (q.model) {
      parts.push(q.model === USAGE_DEFAULT_SENTINEL ? isNull(runs.model) : eq(runs.model, q.model))
    }
    if (q.provider) {
      parts.push(
        q.provider === USAGE_DEFAULT_SENTINEL
          ? sql`${runs.settings}->>'provider' is null`
          : sql`${runs.settings}->>'provider' = ${q.provider}`,
      )
    }
    if (q.groupKind) parts.push(eq(groups.kind, q.groupKind))
    switch (q.status) {
      case 'completed':
        parts.push(eq(runs.status, 'completed'))
        break
      case 'failed':
        parts.push(isFailedExpr)
        break
      case 'cancelled':
        parts.push(isCancelledExpr)
        break
      case 'live':
        parts.push(isLiveExpr)
        break
    }
    if (q.q) {
      const pattern = `%${escapeLike(q.q)}%`
      parts.push(
        or(
          ilike(bots.name, pattern),
          ilike(users.name, pattern),
          ilike(groups.name, pattern),
          ilike(runs.model, pattern),
          ilike(runs.step, pattern),
          ilike(runs.summary, pattern),
          sql`${runs.settings}->>'provider' ilike ${pattern}`,
          sql`${runs.id}::text ilike ${pattern}`,
        ),
      )
    }
  }
  return and(...parts)
}

export const round = (n: number, digits = 2) => {
  const f = 10 ** digits
  return Math.round(n * f) / f
}

export const safeDiv = (num: number, den: number, digits = 4): number | null =>
  den > 0 ? round(num / den, digits) : null

export const effectiveTps = (outputTokens: number, durationMs: number): number | null =>
  outputTokens > 0 && durationMs > 0 ? round(outputTokens / (durationMs / 1000), 1) : null

export const AGENT_LABELS: Record<AgentKind, string> = {
  claude: 'Claude',
  codex: 'Codex',
  gemini: 'Gemini',
  codebuddy: 'CodeBuddy',
  pi: 'Pi',
  deepseek: 'DeepSeek',
  antigravity: 'Antigravity',
  opencode: 'OpenCode',
  qwen: 'Qwen',
  kimi: 'Kimi',
  goose: 'Goose',
  copilot: 'Copilot',
}
