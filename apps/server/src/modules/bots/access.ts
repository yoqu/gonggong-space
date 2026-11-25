import type { AccessLevel, BotAccess, RunAudience, Tier } from '@gonggong/protocol'

const RANK: Record<Tier, number> = { 'read-only': 0, workspace: 1, full: 2 }

const LEVEL: Record<AccessLevel, { tier: Tier; aiReview: boolean }> = {
  full: { tier: 'full', aiReview: false },
  auto: { tier: 'workspace', aiReview: true },
  ask: { tier: 'workspace', aiReview: false },
  'read-only': { tier: 'read-only', aiReview: false },
}

/** The trigger list counts as trusted; a shared bot's DM was opened by someone it was shared with, so trusted too. */
export function audienceOf(
  bot: { ownerId: string; triggerList: string[] },
  origin: string,
  sharedDm = false,
): RunAudience {
  if (origin === bot.ownerId) return 'owner'
  return sharedDm || bot.triggerList.includes(origin) ? 'trusted' : 'others'
}

/** null audience: a run from before audiences, at the bot's own tier. */
export const levelOf = (bot: { access: BotAccess }, audience: RunAudience | null): AccessLevel | null =>
  audience === 'trusted' || audience === 'others' ? bot.access[audience] : null

/**
 * What a run is started with. The owner's group override replaces the bot tier (it may raise it); for anyone else
 * it is a ceiling over their level. Demo mode is applied on top by `runTier`.
 */
export function runAccess(
  bot: { tier: string; aiReview: boolean; access: BotAccess },
  groupTier: string | null,
  audience: RunAudience | null,
): { tier: Tier; aiReview: boolean } {
  const level = levelOf(bot, audience)
  if (!level) {
    const tier = (groupTier ?? bot.tier) as Tier
    return { tier, aiReview: tier === 'workspace' && bot.aiReview }
  }
  const own = LEVEL[level]
  const cap = groupTier as Tier | null
  return cap && RANK[cap] < RANK[own.tier]
    ? { tier: cap, aiReview: cap === 'workspace' && own.aiReview }
    : own
}

/** Approval reasons 自动审批 rejects outright for someone else; the rest go to the owner. */
export const RED_LINE = new Set<string>(['high_risk', 'protected_base'])

export const autoRejects = (
  bot: { tier: string; aiReview: boolean; access: BotAccess },
  groupTier: string | null,
  audience: RunAudience | null,
) => (audience === 'trusted' || audience === 'others' ? runAccess(bot, groupTier, audience).aiReview : false)

export const hasFull = (access: BotAccess | undefined) =>
  !!access && (access.trusted === 'full' || access.others === 'full')
