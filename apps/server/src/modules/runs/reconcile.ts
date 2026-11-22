import { and, eq, inArray, notInArray } from 'drizzle-orm'
import type { Ctx } from '../../context.js'
import { bots, runs } from '../../db/schema.js'
import { publishBots } from '../bots/dto.js'
import { LIVE } from './dto.js'
import { runStep } from './step.js'
import { teardownRun } from './stop.js'

/**
 * On hello: live runs of this machine's bots that the daemon no longer executes were lost with a daemon restart
 * (spec §14). They end as interrupted; the scheduler then refills the freed slots when the machine comes online.
 */
export async function reconcileRuns(ctx: Ctx, machineId: string, activeRuns: string[]) {
  const lost = await ctx.db
    .update(runs)
    .set({ status: 'interrupted', ...runStep('共工客户端重启，本轮已中断'), endedAt: ctx.now() })
    .where(
      and(
        inArray(runs.status, LIVE),
        inArray(runs.botId, ctx.db.select({ id: bots.id }).from(bots).where(eq(bots.machineId, machineId))),
        activeRuns.length ? notInArray(runs.id, activeRuns) : undefined,
      ),
    )
    .returning()
  for (const run of lost) await teardownRun(ctx, run, { voidReason: 'ended', publishBot: false })
  for (const botId of new Set(lost.map((r) => r.botId))) await publishBots(ctx, eq(bots.id, botId))
}
