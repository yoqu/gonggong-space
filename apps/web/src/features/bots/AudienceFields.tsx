import type { AccessLevel, BotAccess, TriggerScope, UserBriefDto } from '@gonggong/protocol'
import { useState } from 'react'
import { t } from '../../i18n'
import { AlertDialog, Button, FormRow, IconButton, Select, Tag } from '../../ui'
import { MemberPicker } from '../groups/pickers'
import type { AccessFocus } from './accessScope'

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
  auto: t('常规开发与工作区内操作自动放行；高危红线自动拒绝；其余不确定的操作发审批卡片给你。'),
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

/** Keeps the invariant `others !== 'deny' => trusted !== 'deny'`: opening 其他成员 also opens 信任名单. */
export function applyAudienceLevel(
  value: AudienceValue,
  who: keyof AudienceValue,
  level: AudienceLevel,
): AudienceValue {
  if (who === 'others' && level !== 'deny' && value.trusted === 'deny') {
    return { trusted: level, others: level }
  }
  return { ...value, [who]: level }
}

/** Back to the bot's fields; a denied audience keeps its stored level unless demoMode forbids sending dormant full. */
export function audiencePatch(v: AudienceValue, saved: BotAccess, demo = false) {
  const triggerScope: TriggerScope = v.others !== 'deny' ? 'all' : v.trusted !== 'deny' ? 'list' : 'self'
  const raw: BotAccess = {
    trusted: v.trusted === 'deny' ? saved.trusted : v.trusted,
    others: v.others === 'deny' ? saved.others : v.others,
  }
  const changed = raw.trusted !== saved.trusted || raw.others !== saved.others
  const access: BotAccess =
    demo && changed
      ? {
          trusted: v.trusted === 'deny' && raw.trusted === 'full' ? 'ask' : raw.trusted,
          others: v.others === 'deny' && raw.others === 'full' ? 'ask' : raw.others,
        }
      : raw
  return { triggerScope, access }
}

/** 信任名单 and 其他成员 rows; 完全允许 for anyone but the owner is confirmed once more. */
export function AudienceFields({
  canEdit,
  demo,
  value,
  onChange,
  list,
  users,
  ownerId,
  focus,
  onListChange,
}: {
  canEdit: boolean
  demo?: boolean
  value: AudienceValue
  onChange: (value: AudienceValue) => void
  list: string[]
  users: UserBriefDto[]
  ownerId: string
  focus?: AccessFocus
  onListChange: (ids: string[]) => void
}) {
  const [confirming, setConfirming] = useState<keyof AudienceValue | null>(null)
  const nameCounts = new Map<string, number>()
  for (const u of users) nameCounts.set(u.name, (nameCounts.get(u.name) ?? 0) + 1)
  const memberLabel = (id: string) => {
    const u = users.find((x) => x.id === id)
    if (!u) return '--'
    return (nameCounts.get(u.name) ?? 0) > 1 ? `${u.name} (${u.account})` : u.name
  }
  const pick = (who: keyof AudienceValue, level: AudienceLevel) => {
    if (level === 'full' && value[who] !== 'full') return setConfirming(who)
    onChange(applyAudienceLevel(value, who, level))
  }
  const options = (who: keyof AudienceValue) =>
    LEVELS.map((l) => ({
      value: l,
      label: AUDIENCE_LEVEL_LABEL[l],
      description: LEVEL_HINT[l],
      // Letting everyone in but not the list would make the list mean less than nobody.
      disabled: (demo && l === 'full') || (who === 'trusted' && l === 'deny' && value.others !== 'deny'),
    }))
  const row = (who: keyof AudienceValue, label: string, hint: string) => {
    const highlighted = focus === who
    return (
      <FormRow
        label={label}
        align="top"
        highlighted={highlighted}
        focusTag={highlighted ? who : undefined}
        badge={highlighted ? <Tag tone="blue">{t('本次请求适用')}</Tag> : undefined}
        hint={<div>{canEdit ? hint : LEVEL_HINT[value[who]]}</div>}
      >
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
  }
  const cascadesTrusted = confirming === 'others' && value.trusted === 'deny'
  return (
    <>
      {row('trusted', t('信任名单'), t('名单里的成员发起的任务按这个方式审批。'))}
      {value.trusted !== 'deny' ? (
        <FormRow label={t('名单成员')} align="top">
          {canEdit ? (
            <>
              {list.length ? (
                <ul className="bot-shares" aria-label={t('名单成员')}>
                  {list.map((id) => {
                    const label = memberLabel(id)
                    return (
                      <li key={id} className="bot-shares__row">
                        <span>{label}</span>
                        <IconButton
                          size="small"
                          title={t('移除 {name}', { name: label })}
                          onClick={() => onListChange(list.filter((x) => x !== id))}
                        >
                          {'minus' as const}
                        </IconButton>
                      </li>
                    )
                  })}
                </ul>
              ) : null}
              <MemberPicker
                trigger={<Button size="small">{t('添加成员…')}</Button>}
                users={users.filter((u) => u.id !== ownerId && !list.includes(u.id))}
                onAdd={(ids) => onListChange([...list, ...ids.filter((id) => !list.includes(id))])}
              />
            </>
          ) : (
            <span>{list.map(memberLabel).join(t('、')) || '--'}</span>
          )}
        </FormRow>
      ) : null}
      {row('others', t('其他成员'), t('群里其余成员发起的任务按这个方式审批；接力的任务按最初发起人算。'))}
      <AlertDialog
        open={confirming !== null}
        title={t('允许{who}完全控制这台电脑？', {
          who: cascadesTrusted
            ? t('信任名单和其他成员')
            : confirming === 'others'
              ? t('其他成员')
              : t('名单成员'),
        })}
        message={
          cascadesTrusted
            ? t(
                '开启「其他成员」会同时将「信任名单」设为完全允许。他们发起的任务不再询问你，Bot 可以在你的电脑上执行任何操作，包括删除文件、推送代码等危险命令。',
              )
            : t(
                '他们发起的任务不再询问你，Bot 可以在你的电脑上执行任何操作，包括删除文件、推送代码等危险命令。',
              )
        }
        onClose={() => setConfirming(null)}
        actions={[
          { label: t('取消'), onClick: () => setConfirming(null) },
          {
            label: t('确定允许'),
            variant: 'destructive',
            onClick: () => {
              if (confirming) onChange(applyAudienceLevel(value, confirming, 'full'))
              setConfirming(null)
            },
          },
        ]}
      />
    </>
  )
}
