import { type I18nText, SCHEDULE_MIN_INTERVAL_MIN } from '@gonggong/protocol'
import { Cron } from 'croner'

export interface Timing {
  cron: string | null
  runAt: Date | null
  timezone: string
}

const cronOf = (expr: string, timezone: string) => new Cron(expr, { timezone, mode: '5-part', paused: true })

/** The next `n` firings after `after`; a past one-off has none. */
export function nextFires(s: Timing, after: Date, n = 1): Date[] {
  if (!s.cron) return s.runAt && s.runAt > after ? [s.runAt] : []
  return cronOf(s.cron, s.timezone).nextRuns(n, after)
}

export const nextFire = (s: Timing, after: Date) => nextFires(s, after)[0] ?? null

/** Why the timing cannot be used, or null. */
export function timingError(s: Timing, now: Date): I18nText | null {
  if (!s.cron) return s.runAt && s.runAt > now ? null : { key: '执行时间已过' }
  let runs: Date[]
  try {
    runs = nextFires(s, now, 13)
  } catch {
    return { key: 'cron 表达式无效' }
  }
  if (!runs.length) return { key: 'cron 表达式无效' }
  const tooClose = runs
    .slice(1)
    .some((d, i) => d.getTime() - (runs[i] as Date).getTime() < SCHEDULE_MIN_INTERVAL_MIN * 60_000)
  return tooClose ? { key: '执行间隔不能小于 {n} 分钟', params: { n: SCHEDULE_MIN_INTERVAL_MIN } } : null
}
