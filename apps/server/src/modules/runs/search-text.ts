import { TERMINAL_RUN_STATUS } from '@gonggong/protocol'
import { and, ilike, inArray, isNull, or, sql } from 'drizzle-orm'
import type { Ctx } from '../../context.js'
import type { Db } from '../../db/client.js'
import { bots, messages, runEvents, runs, statusIn } from '../../db/schema.js'

const BATCH = 500
const MINUTE_MS = 60_000

/** A run's card: step, summary, final reply and the titles of its html_render pages. */
export const runCardText = sql<string>`concat_ws(E'\\n', ${runs.step}, ${runs.summary},
  (select string_agg(${messages.body}, E'\\n') from ${messages}
    where ${messages.runId} = ${runs.id} and ${messages.kind} = 'bot'),
  (select string_agg(p->>'title', E'\\n') from jsonb_array_elements(${runs.htmlRenders}) p))`

/**
 * The card and, while the process is retained (plan D9), its tool titles and steps: the plain part of its events.
 * Only tool and status events carry them; the rest (streamed output above all) is never detoasted.
 */
const runText = sql<string>`concat_ws(E'\\n', ${runCardText}, case when ${runs.purgedAt} is null then
  (select string_agg(distinct concat_ws(E'\\n', ${runEvents.payload}->>'title', ${runEvents.payload}->>'step'), E'\\n')
    from ${runEvents} where ${runEvents.runId} = ${runs.id} and ${runEvents.kind} in ('tool', 'status')) end)`

/**
 * Runs matching LIKE pattern `p` by their bot's current name (bots get renamed) or their text. The bots are looked
 * up first: ids the planner sees let it OR the indexes, where a subquery's unknown ids look like a third of all runs.
 */
export async function runMatches(db: Db, p: string) {
  const named = await db.select({ id: bots.id }).from(bots).where(ilike(bots.name, p))
  return or(
    ilike(runs.searchText, p),
    inArray(
      runs.botId,
      named.map((b) => b.id),
    ),
    // Live runs, and ended ones not filled yet.
    and(isNull(runs.searchText), sql`${runText} ilike ${p}`),
  )
}

/**
 * Fills the search text of ended runs, whose card and process no longer change (purging rewrites it), in batches
 * until none is left or `more` says stop; returns how many.
 */
export async function fillRunSearchText(ctx: Ctx, batch = BATCH, more = () => true): Promise<number> {
  let filled = 0
  for (;;) {
    const due = ctx.db
      .select({ id: runs.id })
      .from(runs)
      .where(and(isNull(runs.searchText), statusIn(runs.status, TERMINAL_RUN_STATUS)))
      .limit(batch)
    const n = (
      await ctx.db
        .update(runs)
        .set({ searchText: runText })
        // Rechecked: a purge may have written its card text meanwhile.
        .where(and(inArray(runs.id, due), isNull(runs.searchText)))
        .returning({ id: runs.id })
    ).length
    filled += n
    if (n < batch || !more()) return filled
  }
}

/**
 * Fills now (also the backfill of runs from before the column, off the deploy's path) and then every `everyMs`;
 * the returned stop waits for at most one batch.
 */
export function startRunSearchText(ctx: Ctx, everyMs = MINUTE_MS) {
  let stopped = false
  let pending = Promise.resolve()
  const tick = () => {
    pending = pending
      .then(async () => {
        if (!stopped) await fillRunSearchText(ctx, BATCH, () => !stopped)
      })
      .catch((err) => console.error('run search text:', err))
  }
  tick()
  const timer = setInterval(tick, everyMs)
  timer.unref()
  return async () => {
    stopped = true
    clearInterval(timer)
    await pending
  }
}
