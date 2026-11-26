import type { AccessLevel, BotDto, GroupDto, RunDto, Tier } from '@gonggong/protocol'
import { t } from '../../i18n'
import { APPROVAL_MODE_LABEL, approvalMode } from './ApprovalFields'
import { AUDIENCE_LEVEL_LABEL } from './AudienceFields'

export type AccessFocus = 'owner' | 'trusted' | 'others'

const TIER_RANK: Record<Tier, number> = { 'read-only': 0, workspace: 1, full: 2 }

const LEVEL_TIER: Record<AccessLevel, { tier: Tier; aiReview: boolean }> = {
  full: { tier: 'full', aiReview: false },
  auto: { tier: 'workspace', aiReview: true },
  ask: { tier: 'workspace', aiReview: false },
  'read-only': { tier: 'read-only', aiReview: false },
}

export interface ApprovalScopeInfo {
  focus: AccessFocus
  pillLabel: string
  modeLabel: string
  groupOverridden: boolean
}

/**
 * Resolves which permission rule governs `run` on the client (matching server `runAccess` / `runTier`),
 * so an approval card displays why it asked and focuses that exact rule row when opened in settings.
 */
export function effectiveApprovalScope({
  bot,
  run,
  group,
  groupTier,
  demo = false,
}: {
  bot: Pick<BotDto, 'ownerId' | 'tier' | 'aiReview' | 'triggerList' | 'access'>
  run: Pick<RunDto, 'originUserId'>
  group?: Pick<GroupDto, 'kind'>
  groupTier?: Tier | null
  demo?: boolean
}): ApprovalScopeInfo {
  const origin = run.originUserId
  const focus: AccessFocus =
    !origin || origin === bot.ownerId
      ? 'owner'
      : group?.kind === 'dm' || bot.triggerList?.includes(origin)
        ? 'trusted'
        : 'others'

  const clampDemo = (tier: Tier): Tier => (demo && tier === 'full' ? 'workspace' : tier)

  if (focus === 'owner') {
    const rawTier = groupTier ?? bot.tier
    const tier = clampDemo(rawTier)
    const mode = approvalMode({ tier, aiReview: tier === 'workspace' && !!bot.aiReview })
    const modeLabel = APPROVAL_MODE_LABEL[mode]
    const pillLabel = groupTier
      ? t('本群：{mode}', { mode: modeLabel })
      : t('当前：{mode}', { mode: modeLabel })
    return { focus, pillLabel, modeLabel, groupOverridden: groupTier != null }
  }

  const baseLevel: AccessLevel = bot.access?.[focus] ?? 'ask'
  const base = LEVEL_TIER[baseLevel]
  const cappedByGroup = groupTier != null && TIER_RANK[groupTier] < TIER_RANK[base.tier]
  const rawEffectiveTier = cappedByGroup ? groupTier : base.tier
  const effectiveTier = clampDemo(rawEffectiveTier)
  const effectiveLevel: AccessLevel =
    effectiveTier === 'full'
      ? 'full'
      : effectiveTier === 'read-only'
        ? 'read-only'
        : base.aiReview
          ? 'auto'
          : 'ask'
  const modeLabel = AUDIENCE_LEVEL_LABEL[effectiveLevel]
  const pillLabel =
    focus === 'trusted'
      ? t('信任名单：{mode}', { mode: modeLabel })
      : t('其他成员：{mode}', { mode: modeLabel })
  return { focus, pillLabel, modeLabel, groupOverridden: cappedByGroup }
}
