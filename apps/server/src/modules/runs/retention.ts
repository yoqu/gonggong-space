import { and, eq, inArray, isNotNull, isNull, lt, lte, or } from 'drizzle-orm'
import type { Ctx } from '../../context.js'
import { bindCodes, runEvents, runs, systemParams, webSessions } from '../../db/schema.js'
import { purgeSyncBlobs } from '../sync/blobs.js'

export const DEFAULT_RUN_RETENTION_DAYS = 30
const DAY_MS = 86_400_000
const HOUR_MS = 3_600_000

/** System param `runRetentionDays` (spec §9): how long a run's full process is kept. */
export async function runRetentionDays(ctx: Ctx): Promise<number> {
  const [row] = await ctx.db.select().from(systemParams).where(eq(systemParams.key, 'runRetentionDays'))
  return typeof row?.value === 'number' ? row.value : DEFAULT_RUN_RETENTION_DAYS
}

/** Runs purged per transaction, so a backlog (first enabled, long downtime) never becomes one huge transaction. */
const PURGE_BATCH = 500

/** Drops the events and patch of runs that ended before the retention window; cards keep their summary. */
export async function purgeExpiredRuns(ctx: Ctx, batch = PURGE_BATCH): Promise<number> {
  const cutoff = new Date(ctx.now().getTime() - (await runRetentionDays(ctx)) * DAY_MS)
  let purged = 0
  for (;;) {
    const n = await ctx.db.transaction(async (tx) => {
      const due = tx
        .select({ id: runs.id })
        .from(runs)
        .where(and(isNull(runs.purgedAt), lt(runs.endedAt, cutoff)))
        .limit(batch)
      const expired = await tx
        .update(runs)
        .set({ patch: null, purgedAt: ctx.now() })
        .where(inArray(runs.id, due))
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
    purged += n
    if (n < batch) return purged
  }
}

/** Drops sessions that can no longer sign in, and bind codes a day past expiry (until then a retry reads 已过期, not 无效). */
export async function purgeExpiredLogins(ctx: Ctx) {
  const now = ctx.now()
  await ctx.db
    .delete(webSessions)
    .where(or(lte(webSessions.expiresAt, now), isNotNull(webSessions.revokedAt)))
  await ctx.db.delete(bindCodes).where(lt(bindCodes.expiresAt, new Date(now.getTime() - DAY_MS)))
}

/** Purges runs, unneeded sync blobs (F16) and dead logins now and then every `everyMs`; the returned function stops and waits for a purge in flight. */
export function startRetention(ctx: Ctx, everyMs = HOUR_MS) {
  let pending = Promise.resolve()
  const tick = () => {
    pending = pending
      .then(() => purgeExpiredRuns(ctx))
      .then(() => purgeSyncBlobs(ctx))
      .then(() => purgeExpiredLogins(ctx))
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
