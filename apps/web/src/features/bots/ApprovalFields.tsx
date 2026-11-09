import type { Tier } from '@gonggong/protocol'
import { t } from '../../i18n'
import { FormRow, SegmentedControl, type Token, TokenField } from '../../ui'

/** 审批方式: one choice made of the bot's tier and AI review (read-only is a legacy tier, shown only while set). */
export type ApprovalMode = 'ask' | 'review' | 'full' | 'read-only'

export const APPROVAL_MODE_LABEL: Record<ApprovalMode, string> = {
  ask: t('每次问我'),
  review: t('帮我审批'),
  full: t('完全允许'),
  'read-only': t('只读'),
}

const FLOOR = t('高危命令（如 sudo、git push --force）、推送受保护的基准分支和客户端发版始终需要你确认。')
const MODE_HINT: Record<ApprovalMode, string> = {
  ask: t('只读命令自动放行，其余操作都发审批卡片给你。'),
  review: t(
    '先由 AI 用小模型评估：低风险且明显是用户要求的自动批准，其余仍交给你，审批卡片附上风险和理由。每次评估约消耗几千 token。',
  ),
  full: t('不再询问，Bot 可以执行任何操作；只有触发名单里的人能触发它。'),
  'read-only': t('Bot 只能读取，其余操作都发审批卡片给你。'),
}

export const approvalMode = (bot: { tier: Tier; aiReview: boolean }): ApprovalMode =>
  bot.tier === 'workspace' ? (bot.aiReview ? 'review' : 'ask') : bot.tier

/** Display text, with the always-allowed rules when they matter. */
export const approvalText = (bot: { tier: Tier; aiReview: boolean; alwaysAllow: string[] }) => {
  const mode = approvalMode(bot)
  return mode !== 'full' && bot.alwaysAllow.length
    ? `${APPROVAL_MODE_LABEL[mode]} · ${t('已允许 {rules}', { rules: bot.alwaysAllow.join(t('、')) })}`
    : APPROVAL_MODE_LABEL[mode]
}

/** Trimmed, whitespace-collapsed, de-duplicated command prefixes. */
export const prefixes = (tokens: Token[]) => [
  ...new Set(
    tokens.map((t) => (typeof t === 'string' ? t : t.label).trim().replace(/\s+/g, ' ')).filter(Boolean),
  ),
]

export interface ApprovalValue {
  tier: Tier
  aiReview: boolean
  alwaysAllow: string[]
}

/** 审批方式 and 已允许的命令. AI review and the rules are the owner's (plan J9); a sysadmin may only change the tier. */
export function ApprovalFields({
  owner,
  canEdit,
  demo,
  value,
  onChange,
}: {
  owner: boolean
  canEdit: boolean
  demo?: boolean
  value: ApprovalValue
  onChange: (value: ApprovalValue) => void
}) {
  const mode = approvalMode(value)
  const unattended = value.aiReview ? 'review' : 'ask'
  const modes: ApprovalMode[] = [
    'ask',
    'review',
    'full',
    ...(value.tier === 'read-only' ? ['read-only' as const] : []),
  ]
  const pick = (m: ApprovalMode) =>
    onChange({
      ...value,
      tier: m === 'ask' || m === 'review' ? 'workspace' : m,
      aiReview: m === 'ask' ? false : m === 'review' ? true : value.aiReview,
    })
  return (
    <>
      <FormRow
        label={t('审批方式')}
        align="top"
        hint={mode === 'full' ? MODE_HINT.full : `${MODE_HINT[mode]}${FLOOR}`}
      >
        {canEdit ? (
          <SegmentedControl<ApprovalMode>
            aria-label={t('审批方式')}
            size="small"
            value={mode}
            onChange={pick}
            items={modes.map((m) => ({
              value: m,
              label: APPROVAL_MODE_LABEL[m],
              disabled:
                (demo && m === 'full') || (!owner && (m === 'ask' || m === 'review') && m !== unattended),
            }))}
          />
        ) : (
          <span>{APPROVAL_MODE_LABEL[mode]}</span>
        )}
      </FormRow>
      {mode !== 'full' && (owner || value.alwaysAllow.length) ? (
        <FormRow
          label={t('已允许的命令')}
          align="top"
          hint={
            owner
              ? t(
                  '审批卡片上选「批准，不再询问」会加到这里；以这些前缀开头的命令（或 tool:工具名）自动批准，删除后再次询问。',
                )
              : undefined
          }
        >
          {owner ? (
            <TokenField
              aria-label={t('已允许的命令')}
              value={value.alwaysAllow}
              placeholder={t('命令前缀，如 go build')}
              onChange={(tokens) => onChange({ ...value, alwaysAllow: prefixes(tokens) })}
            />
          ) : (
            <span>{value.alwaysAllow.join(t('、'))}</span>
          )}
        </FormRow>
      ) : null}
    </>
  )
}
