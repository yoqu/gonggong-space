import type { BotDto, GroupBotStateDto, Tier } from '@gonggong/protocol'
import { t } from '../../i18n'

export const TIERS: Tier[] = ['read-only', 'workspace', 'full']

export const TIER_LABEL: Record<Tier, string> = {
  'read-only': t('只读'),
  workspace: t('需要审批'),
  full: t('完全允许'),
}

/** What a bot runs with in one group: that group's override, else its own tier. */
export const effectiveTier = (bot: Pick<BotDto, 'tier'>, state?: Pick<GroupBotStateDto, 'tier'>) =>
  state?.tier ?? bot.tier
