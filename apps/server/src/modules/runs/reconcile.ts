import { and, eq, inArray, notInArray } from 'drizzle-orm'
import type { Ctx } from '../../context.js'
import { bots, runs } from '../../db/schema.js'
import { voidApprovals } from '../approvals/service.js'
import { publishBot } from '../bots/dto.js'
import { voidQuestions } from '../questions/service.js'
import { publishRun } from './dto.js'
import { notifyChainDone } from './stop.js'

const LIVE = ['running', 'awaiting_approval', 'awaiting_answer']

/**
 * On hello: live runs of this machine's bots that the daemon no longer executes were lost with a daemon restart
 * (spec §14). They end as interrupted; the scheduler then refills the freed slots when the machine comes online.
 */
export async function reconcileRuns(ctx: Ctx, machineId: string, activeRuns: string[]) {
  const lost = await ctx.db
    .update(runs)
    .set({ status: 'interrupted', step: 'daemon 重启，本轮已中断', endedAt: ctx.now() })
    .where(
      and(
        inArray(runs.status, LIVE),
        inArray(runs.botId, ctx.db.select({ id: bots.id }).from(bots).where(eq(bots.machineId, machineId))),
        activeRuns.length ? notInArray(runs.id, activeRuns) : undefined,
      ),
    )
    .returning()
  for (const run of lost) {
    await voidApprovals(ctx, run.id, 'ended')
    await voidQuestions(ctx, run.id)
    await publishRun(ctx, run)
    await notifyChainDone(ctx, run)
  }
  for (const botId of new Set(lost.map((r) => r.botId))) await publishBot(ctx, botId)
}
