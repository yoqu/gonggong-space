import type { UsageExportQuery, UsageRunItemDto } from '@gonggong/protocol'
import type { SQL } from 'drizzle-orm'
import type { Ctx } from '../../context.js'
import { getActiveUsdToCny } from './pricing-sync.js'
import { dayIn, round } from './query.js'
import { buildRunsWhere, selectRunItems } from './runs.js'

const FORMULA_PREFIX = /^[=+\-@\t\r]/
const SIGNED_NUMBER = /^[+-]?\d+(?:\.\d+)?$/

/** Protects spreadsheet tools from CSV formula injection and RFC-4180 quotes special characters. */
export function escapeCsvCell(value: string | number | boolean | null | undefined): string {
  if (value === null || value === undefined) return ''
  let s = String(value)
  if (typeof value === 'string' && FORMULA_PREFIX.test(s) && !SIGNED_NUMBER.test(s)) s = `'${s}`
  if (/[",\n\r]/.test(s)) return `"${s.replace(/"/g, '""')}"`
  return s
}

const buildCsvColumns = (
  usdToCny: number,
): { header: string; get: (r: UsageRunItemDto) => string | number | boolean | null }[] => [
  { header: 'id', get: (r) => r.id },
  { header: 'queuedAt', get: (r) => r.queuedAt },
  { header: 'startedAt', get: (r) => r.startedAt },
  { header: 'endedAt', get: (r) => r.endedAt },
  { header: 'durationMs', get: (r) => r.durationMs },
  { header: 'status', get: (r) => r.status },
  { header: 'isError', get: (r) => r.isError },
  { header: 'isCancelled', get: (r) => r.isCancelled },
  { header: 'isSlow', get: (r) => r.isSlow },
  { header: 'groupName', get: (r) => r.groupName },
  { header: 'groupKind', get: (r) => r.groupKind },
  { header: 'botName', get: (r) => r.botName },
  { header: 'agentKind', get: (r) => r.agentKind },
  { header: 'userName', get: (r) => r.userName },
  { header: 'model', get: (r) => r.model },
  { header: 'modelSource', get: (r) => r.modelSource ?? null },
  { header: 'effort', get: (r) => r.effort },
  { header: 'provider', get: (r) => r.provider },
  { header: 'triggerSource', get: (r) => r.triggerSource },
  { header: 'inputTokens', get: (r) => r.inputTokens },
  { header: 'outputTokens', get: (r) => r.outputTokens },
  { header: 'totalTokens', get: (r) => r.totalTokens },
  { header: 'costUsd', get: (r) => r.costUsd },
  { header: 'costCny', get: (r) => (r.costUsd === null ? null : round(r.costUsd * usdToCny, 6)) },
  { header: 'costSource', get: (r) => r.costSource ?? null },
  { header: 'outputTps', get: (r) => r.outputTps },
  { header: 'filesChanged', get: (r) => r.filesChanged },
  { header: 'hop', get: (r) => r.hop },
  { header: 'sessionId', get: (r) => r.sessionId },
  { header: 'plugins', get: (r) => r.plugins.join(';') },
  { header: 'personalSkills', get: (r) => r.personalSkills },
  { header: 'step', get: (r) => r.step },
]

export function toUsageCsv(items: UsageRunItemDto[], usdToCny = getActiveUsdToCny()): string {
  const columns = buildCsvColumns(usdToCny)
  const header = columns.map((c) => c.header).join(',')
  const lines = items.map((item) => columns.map((c) => escapeCsvCell(c.get(item))).join(','))
  return `\uFEFF${[header, ...lines].join('\r\n')}\r\n`
}

export async function exportUsage(
  ctx: Ctx,
  q: UsageExportQuery,
  scopeWhere: SQL | undefined,
): Promise<{ contentType: string; filename: string; body: string }> {
  const now = ctx.now()
  const where = buildRunsWhere(
    { ...q, page: 1, pageSize: q.limit, sortBy: 'startedAt', sortDir: 'desc' },
    scopeWhere,
    now,
  )
  const items = await selectRunItems(ctx, where, {
    sortBy: 'startedAt',
    sortDir: 'desc',
    slowMs: q.slowMs,
    limit: q.limit,
    offset: 0,
  })
  const dateTag = dayIn(now, q.tz)
  if (q.format === 'json') {
    return {
      contentType: 'application/json; charset=utf-8',
      filename: `gonggong-usage-${q.preset}-${dateTag}.json`,
      body: JSON.stringify(items, null, 2),
    }
  }
  return {
    contentType: 'text/csv; charset=utf-8',
    filename: `gonggong-usage-${q.preset}-${dateTag}.csv`,
    body: toUsageCsv(items, getActiveUsdToCny()),
  }
}
