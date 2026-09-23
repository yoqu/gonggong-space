import { and, eq, inArray, isNull, lt } from 'drizzle-orm'
import type { Ctx } from '../../context.js'
import { runEvents, runs, systemParams } from '../../db/schema.js'

export const DEFAULT_RUN_RETENTION_DAYS = 30
const DAY_MS = 86_400_000
const HOUR_MS = 3_600_000

/** System param `runRetentionDays` (spec §9): how long a run's full process is kept. */
export async function runRetentionDays(ctx: Ctx): Promise<number> {
  const [row] = await ctx.db.select().from(systemParams).where(eq(systemParams.key, 'runRetentionDays'))
  return typeof row?.value === 'number' ? row.value : DEFAULT_RUN_RETENTION_DAYS
}

/** Drops the events and patch of runs that ended before the retention window; cards keep their summary. */
export async function purgeExpiredRuns(ctx: Ctx): Promise<number> {
  const cutoff = new Date(ctx.now().getTime() - (await runRetentionDays(ctx)) * DAY_MS)
  return ctx.db.transaction(async (tx) => {
    const expired = await tx
      .update(runs)
      .set({ patch: null, purgedAt: ctx.now() })
      .where(and(isNull(runs.purgedAt), lt(runs.endedAt, cutoff)))
      .returning({ id: runs.id })
    if (expired.length)
      await tx.delete(runEvents).where(
        inArray(
          runEvents.runId,
          expired.map((r) => r.id),
        ),
      )
    return expired.length
  })
}

/** Purges now and then every `everyMs`; the returned function stops and waits for a purge in flight. */
export function startRetention(ctx: Ctx, everyMs = HOUR_MS) {
  let pending = Promise.resolve()
  const tick = () => {
    pending = pending
      .then(() => purgeExpiredRuns(ctx))
      .then(
        () => {},
        (err) => console.error('run retention:', err),
      )
  }
  tick()
  const timer = setInterval(tick, everyMs)
  timer.unref()
  return async () => {
    clearInterval(timer)
    await pending
  }
}
