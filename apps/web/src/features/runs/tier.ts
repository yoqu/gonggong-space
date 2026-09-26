import type { BotDto, GroupBotStateDto, Tier } from '@gonggong/protocol'

export const TIER_LABEL: Record<Tier, string> = {
  'read-only': '只读',
  workspace: '工作区写入',
  full: '完全访问',
}

/** What a bot runs with in one group: that group's override, else its own tier. */
export const effectiveTier = (bot: Pick<BotDto, 'tier'>, state?: Pick<GroupBotStateDto, 'tier'>) =>
  state?.tier ?? bot.tier
