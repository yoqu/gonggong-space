import type { ProtocolKey, Tier } from '@gonggong/protocol'
import { and, eq, inArray, isNull } from 'drizzle-orm'
import type { Ctx } from '../../context.js'
import type { Db } from '../../db/client.js'
import { bots, groupBots, runs } from '../../db/schema.js'
import { fail } from '../../lib/errors.js'
import { sysParams } from '../admin/params.js'
import { approvePending } from '../approvals/service.js'

export const TIER_LABEL: Record<Tier, ProtocolKey> = {
  'read-only': '只读',
  workspace: '工作区写入',
  full: '完全访问',
}

/** Demo visitors must not drive a bot to run anything outside its workspace on the host's machine. */
export async function runTier(db: Pick<Db, 'select'>, tier: Tier): Promise<Tier> {
  return tier === 'full' && (await sysParams(db)).demoMode ? 'workspace' : tier
}

export async function assertTierAllowed(ctx: Ctx, tier: Tier | null | undefined) {
  if (tier === 'full' && (await sysParams(ctx.db)).demoMode)
    fail('forbidden', '演示模式下不能使用完全访问档位')
}

const LIVE = ['running', 'awaiting_approval', 'awaiting_answer']

/**
 * Live runs follow a tier change at once instead of from the next turn; raised to full, their pending
 * requests are approved by `actorId`. `groupId` = that group's override changed, otherwise the bot's own tier
 * (groups with an override keep theirs).
 */
export async function applyTier(ctx: Ctx, actorId: string, botId: string, groupId?: string) {
  const live = await ctx.db
    .select({ runId: runs.id, botTier: bots.tier, groupTier: groupBots.tier, machineId: bots.machineId })
    .from(runs)
    .innerJoin(bots, eq(bots.id, runs.botId))
    .innerJoin(groupBots, and(eq(groupBots.groupId, runs.groupId), eq(groupBots.botId, runs.botId)))
    .where(
      and(
        eq(runs.botId, botId),
        inArray(runs.status, LIVE),
        groupId ? eq(runs.groupId, groupId) : isNull(groupBots.tier),
      ),
    )
  for (const r of live) {
    const tier = await runTier(ctx.db, (r.groupTier ?? r.botTier) as Tier)
    if (r.machineId) ctx.hub.send(r.machineId, { t: 'run.tier', runId: r.runId, tier })
    if (tier === 'full') await approvePending(ctx, r.runId, actorId)
  }
}
