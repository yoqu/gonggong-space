import type { AccessLevel, BotAccess, TriggerScope } from '@gonggong/protocol'
import { useState } from 'react'
import { t } from '../../i18n'
import { AlertDialog, FormRow, Select, TokenField } from '../../ui'

/** A non-owner audience's choice: a run level, or 不可触发 (kept as `triggerScope`). */
export type AudienceLevel = AccessLevel | 'deny'

export const AUDIENCE_LEVEL_LABEL: Record<AudienceLevel, string> = {
  full: t('完全允许'),
  auto: t('自动审批'),
  ask: t('需要审批'),
  'read-only': t('只读'),
  deny: t('不可触发'),
}

const LEVEL_HINT: Record<AudienceLevel, string> = {
  full: t('不再询问，Bot 可以执行任何操作，包括危险命令。'),
  auto: t('按「帮我审批」的规则自动放行，规则拦下的操作直接拒绝，不打扰你。'),
  ask: t('只读命令自动放行，其余操作发审批卡片给你。'),
  'read-only': t('Bot 只能读取，其余操作发审批卡片给你。'),
  deny: t('@ 它不会启动运行。'),
}

const LEVELS: AudienceLevel[] = ['full', 'auto', 'ask', 'read-only', 'deny']

export interface AudienceValue {
  trusted: AudienceLevel
  others: AudienceLevel
}

export const audienceValue = (bot: { triggerScope: TriggerScope; access: BotAccess }): AudienceValue => ({
  trusted: bot.triggerScope === 'self' ? 'deny' : bot.access.trusted,
  others: bot.triggerScope === 'all' ? bot.access.others : 'deny',
})

/** Back to the bot's fields; a denied audience keeps its stored level for when it is let in again. */
export function audiencePatch(v: AudienceValue, saved: BotAccess) {
  const triggerScope: TriggerScope = v.others !== 'deny' ? 'all' : v.trusted !== 'deny' ? 'list' : 'self'
  const access: BotAccess = {
    trusted: v.trusted === 'deny' ? saved.trusted : v.trusted,
    others: v.others === 'deny' ? saved.others : v.others,
  }
  return { triggerScope, access }
}

/** 信任名单 and 其他成员 rows; 完全允许 for anyone but the owner is confirmed once more. */
export function AudienceFields({
  canEdit,
  demo,
  value,
  onChange,
  listNames,
  suggestions,
  onListChange,
}: {
  canEdit: boolean
  demo?: boolean
  value: AudienceValue
  onChange: (value: AudienceValue) => void
  listNames: string[]
  suggestions: { label: string; detail?: string }[]
  onListChange: (names: string[]) => void
}) {
  const [confirming, setConfirming] = useState<keyof AudienceValue | null>(null)
  const pick = (who: keyof AudienceValue, level: AudienceLevel) => {
    if (level === 'full' && value[who] !== 'full') return setConfirming(who)
    onChange({ ...value, [who]: level })
  }
  const options = (who: keyof AudienceValue) =>
    LEVELS.map((l) => ({
      value: l,
      label: AUDIENCE_LEVEL_LABEL[l],
      description: LEVEL_HINT[l],
      // Letting everyone in but not the list would make the list mean less than nobody.
      disabled: (demo && l === 'full') || (who === 'trusted' && l === 'deny' && value.others !== 'deny'),
    }))
  const row = (who: keyof AudienceValue, label: string, hint: string) => (
    <FormRow label={label} align="top" hint={<div>{canEdit ? hint : LEVEL_HINT[value[who]]}</div>}>
      {canEdit ? (
        <Select<AudienceLevel>
          label={label}
          options={options(who)}
          value={value[who]}
          onChange={(l) => pick(who, l)}
        />
      ) : (
        <span>{AUDIENCE_LEVEL_LABEL[value[who]]}</span>
      )}
    </FormRow>
  )
  return (
    <>
      {row('trusted', t('信任名单'), t('名单里的成员发起的任务按这个方式审批。'))}
      {value.trusted !== 'deny' ? (
        <FormRow label={t('名单成员')}>
          {canEdit ? (
            <TokenField
              aria-label={t('名单成员')}
              placeholder={t('输入成员姓名')}
              value={listNames}
              suggestions={suggestions}
              onChange={(tokens) => onListChange(tokens.map((x) => (typeof x === 'string' ? x : x.label)))}
            />
          ) : (
            <span>{listNames.join(t('、')) || '--'}</span>
          )}
        </FormRow>
      ) : null}
      {row('others', t('其他成员'), t('群里其余成员发起的任务按这个方式审批；接力的任务按最初发起人算。'))}
      <AlertDialog
        open={confirming !== null}
        title={t('允许{who}完全控制这台电脑？', {
          who: confirming === 'others' ? t('其他成员') : t('名单成员'),
        })}
        message={t(
          '他们发起的任务不再询问你，Bot 可以在你的电脑上执行任何操作，包括删除文件、推送代码等危险命令。',
        )}
        onClose={() => setConfirming(null)}
        actions={[
          { label: t('取消'), onClick: () => setConfirming(null) },
          {
            label: t('确定允许'),
            variant: 'destructive',
            onClick: () => {
              if (confirming) onChange({ ...value, [confirming]: 'full' })
              setConfirming(null)
            },
          },
        ]}
      />
    </>
  )
}
