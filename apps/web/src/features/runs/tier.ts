import type { BotDto, GroupBotStateDto, Tier } from '@gonggong/protocol'
import { t } from '../../i18n'

export const TIERS: Tier[] = ['read-only', 'workspace', 'full']

export const TIER_LABEL: Record<Tier, string> = {
  'read-only': t('只读'),
  workspace: t('工作区写入'),
  full: t('完全访问'),
}

/** What a bot runs with in one group: that group's override, else its own tier. */
export const effectiveTier = (bot: Pick<BotDto, 'tier'>, state?: Pick<GroupBotStateDto, 'tier'>) =>
  state?.tier ?? bot.tier
