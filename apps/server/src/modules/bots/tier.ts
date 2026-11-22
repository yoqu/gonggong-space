import type { BotAccess, ProtocolKey, RunAudience, Tier } from '@gonggong/protocol'
import { and, eq, inArray } from 'drizzle-orm'
import type { Ctx } from '../../context.js'
import type { Db } from '../../db/client.js'
import { bots, groupBots, runs } from '../../db/schema.js'
import { audit } from '../../lib/audit.js'
import { fail } from '../../lib/errors.js'
import { sysParams } from '../admin/params.js'
import { approvePending } from '../approvals/service.js'
import { LIVE } from '../runs/dto.js'
import { hasFull, runAccess } from './access.js'

export const TIER_LABEL: Record<Tier, ProtocolKey> = {
  'read-only': '只读',
  workspace: '需要审批',
  full: '完全允许',
}

const effectiveTier = (tier: Tier, demoMode: boolean): Tier =>
  tier === 'full' && demoMode ? 'workspace' : tier

/** Demo visitors must not drive a bot to run anything outside its workspace on the host's machine. */
export async function runTier(db: Pick<Db, 'select'>, tier: Tier): Promise<Tier> {
  return effectiveTier(tier, (await sysParams(db)).demoMode)
}

export async function assertTierAllowed(ctx: Ctx, tier: Tier | null | undefined, access?: BotAccess) {
  if ((tier === 'full' || hasFull(access)) && (await sysParams(ctx.db)).demoMode)
    fail('forbidden', '演示模式下不能使用「完全允许」审批方式')
}

export type PrevTier = {
  bot?: Pick<typeof bots.$inferSelect, 'tier' | 'aiReview' | 'access'>
  groupTier?: string | null
}

/**
 * Live runs follow a tier or access change at once instead of from the next turn; raised to full, their pending
 * requests are approved by `actorId`. `groupId` = only that group's runs (its override changed).
 */
export async function applyTier(ctx: Ctx, actorId: string, botId: string, groupId?: string, prev?: PrevTier) {
  const live = await ctx.db
    .select({ runId: runs.id, audience: runs.audience, bot: bots, groupTier: groupBots.tier })
    .from(runs)
    .innerJoin(bots, eq(bots.id, runs.botId))
    .innerJoin(groupBots, and(eq(groupBots.groupId, runs.groupId), eq(groupBots.botId, runs.botId)))
    .where(
      and(eq(runs.botId, botId), inArray(runs.status, LIVE), groupId ? eq(runs.groupId, groupId) : undefined),
    )
  if (!live.length) return
  const { demoMode } = await sysParams(ctx.db)
  for (const r of live) {
    const audience = r.audience as RunAudience | null
    const after = effectiveTier(runAccess(r.bot, r.groupTier, audience).tier, demoMode)
    if (prev) {
      const before = effectiveTier(
        runAccess(prev.bot ?? r.bot, prev.groupTier !== undefined ? prev.groupTier : r.groupTier, audience)
          .tier,
        demoMode,
      )
      if (after === before) continue
    }
    if (r.bot.machineId) ctx.hub.send(r.bot.machineId, { t: 'run.tier', runId: r.runId, tier: after })
    if (after === 'full') await approvePending(ctx, r.runId, actorId)
  }
}

/**
 * The owner waives approvals for the rest of this run only: its tier goes to full and pending requests are approved.
 * Nothing is stored on the bot, so the next run starts at the configured tier again.
 */
export async function fullAccessForRun(ctx: Ctx, userId: string, runId: string) {
  const [r] = await ctx.db
    .select({ status: runs.status, groupId: runs.groupId, bot: bots })
    .from(runs)
    .innerJoin(bots, eq(bots.id, runs.botId))
    .where(eq(runs.id, runId))
  if (!r) return fail('not_found', '运行不存在')
  if (r.bot.ownerId !== userId) return fail('forbidden', '仅 Bot 主人可以审批')
  await assertTierAllowed(ctx, 'full')
  if (!LIVE.includes(r.status)) return fail('conflict', '运行已结束')
  if (r.bot.machineId) ctx.hub.send(r.bot.machineId, { t: 'run.tier', runId, tier: 'full' })
  await approvePending(ctx, runId, userId)
  await audit(ctx, {
    category: 'admin',
    actorUserId: userId,
    groupId: r.groupId,
    action: 'run.full_access',
    detail: { runId, botId: r.bot.id, name: r.bot.name },
  })
}
