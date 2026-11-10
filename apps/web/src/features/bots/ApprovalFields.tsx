import type { ModelChoice, Tier } from '@gonggong/protocol'
import { t } from '../../i18n'
import { FormRow, PopUpButton, SegmentedControl, type Token, TokenField } from '../../ui'

/** 审批方式: one choice made of the bot's tier and AI review (read-only is a legacy tier, shown only while set). */
export type ApprovalMode = 'ask' | 'review' | 'full' | 'read-only'

export const APPROVAL_MODE_LABEL: Record<ApprovalMode, string> = {
  ask: t('每次问我'),
  review: t('帮我审批'),
  full: t('完全允许'),
  'read-only': t('只读'),
}

const FLOOR = t('高危命令（如 sudo、git push --force）、推送受保护的基准分支和客户端发版始终需要你确认。')
const BUILTIN_HINT = t(
  'Claude 和 Codex（OpenAI 官方登录）改由 agent 内置的自动审核把关，共工不再预审；被它拦下的操作会让 agent 换个做法，不发卡片。内置审核不可用时（第三方供应商、不支持的模型）按上面的方式审批，运行过程里会注明本次由谁审。',
)
const MODE_HINT: Record<ApprovalMode, string> = {
  ask: t('只读命令自动放行，其余操作都发审批卡片给你。'),
  review: t(
    '构建、测试、lint、格式化、本地 git 和工作区内改文件直接放行（等于信任仓库里的脚本）；其余发审批卡片给你，开启 AI 预审后先由 AI 评估，只把风险操作交给你。',
  ),
  full: t(
    '不再询问，Bot 可以执行任何操作；能触发它的人发起的任务都不会被拦截，包括危险命令，建议只给自己用的群或 Bot 开启。',
  ),
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
  /** AI 预审's model; null = off. */
  reviewModel: string | null
  alwaysAllow: string[]
}

const OFF = '__off'
const REVIEW_HINT = t(
  '默认关闭。开启后，规则没放行、内置审核也没接手的请求先由这里选的模型评估，只把风险操作交给你，审批卡片附上风险和理由。每次评估都消耗 token，请选小模型（如 haiku、mini、flash）。',
)

/** 审批方式 and 已允许的命令. AI review and the rules are the owner's (plan J9); a sysadmin may only change the tier. */
export function ApprovalFields({
  owner,
  canEdit,
  demo,
  value,
  outdated,
  builtin,
  models,
  onChange,
}: {
  owner: boolean
  canEdit: boolean
  demo?: boolean
  /** The bot's machine, when its client predates 帮我审批's rules: they do not apply there yet. */
  outdated?: string
  /** The bot's agent and machine hand 帮我审批 to the agent's own reviewer where it works. */
  builtin?: boolean
  /** What the bot's agent offers, for AI 预审's model; null = not reported yet. */
  models: ModelChoice[] | null
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
        hint={
          <>
            {mode === 'full' ? MODE_HINT.full : `${MODE_HINT[mode]}${FLOOR}`}
            {mode === 'review' && builtin ? ` ${BUILTIN_HINT}` : null}
            {mode === 'review' && outdated !== undefined ? (
              <span className="bot-settings__warn" role="note">
                {t(
                  '{machine} 的客户端版本较旧，「帮我审批」还不能自动放行开发命令，更多请求会问你；升级客户端后生效。',
                  {
                    machine: outdated,
                  },
                )}
              </span>
            ) : null}
          </>
        }
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
      {mode === 'review' && owner ? (
        <FormRow
          label={t('AI 预审')}
          align="top"
          hint={models ? REVIEW_HINT : t('Bot 所在机器尚未上报可选模型，暂不能开启。')}
        >
          <PopUpButton<string>
            aria-label={t('AI 预审')}
            disabled={!canEdit || (!models && value.reviewModel === null)}
            value={value.reviewModel ?? OFF}
            options={[
              { value: OFF, label: t('关闭#off') },
              ...(models ?? []).map((m) => ({ value: m.value, label: m.name })),
              ...(value.reviewModel && !models?.some((m) => m.value === value.reviewModel)
                ? [{ value: value.reviewModel, label: value.reviewModel }]
                : []),
            ]}
            onChange={(v) => onChange({ ...value, reviewModel: v === OFF ? null : v })}
          />
        </FormRow>
      ) : null}
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
