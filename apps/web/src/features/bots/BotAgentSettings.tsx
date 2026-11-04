import { type AgentKind, type AgentSettingValues, fieldsFor } from '@gonggong/protocol'
import { t } from '../../i18n'
import { Divider, FormRow, PopUpButton, TextField } from '../../ui'
import { fieldLabel, valueLabel } from '../machines/agentSettings'

const FOLLOW = '__follow'

/** The bot's overrides without the empty ones (an empty one follows the machine). */
export const cleanOverrides = (v: AgentSettingValues): AgentSettingValues =>
  Object.fromEntries(Object.entries(v).flatMap(([k, x]) => (x.trim() ? [[k, x.trim()]] : [])))

/**
 * The `botOverride` agent settings of a bot: 跟随机器设置 or its own value; the bot owner's alone. `machine` is the machine's
 * defaults when known, to name what following means.
 */
export function BotAgentSettingRows({
  agent,
  value,
  machine,
  outdated,
  editable,
  onChange,
}: {
  agent: AgentKind
  value: AgentSettingValues
  machine: AgentSettingValues | undefined
  /** The bound machine's daemon predates agent settings: the overrides would be ignored. */
  outdated: boolean
  editable: boolean
  onChange: (value: AgentSettingValues) => void
}) {
  const fields = fieldsFor(agent, 'agent').filter((f) => f.botOverride)
  if (!fields.length) return null
  const title = <Divider label={t('Agent 设置')} />
  if (!editable)
    return (
      <>
        {title}
        <FormRow label={t('覆盖')} hint={t('只有 Bot 主人可以修改 Agent 设置')}>
          {fields
            .map((f) =>
              t('{label}：{v}', {
                label: fieldLabel(f.id),
                v: value[f.id] ? valueLabel(f, value[f.id] ?? '') : t('跟随机器设置'),
              }),
            )
            .join(' · ')}
        </FormRow>
      </>
    )
  return (
    <>
      {title}
      {fields.map((f, i) => {
        const label = fieldLabel(f.id)
        const own = value[f.id] ?? ''
        const current = machine?.[f.id]
        const follow = machine
          ? t('跟随机器设置（当前：{v}）', { v: current ? valueLabel(f, current) : t('默认') })
          : t('跟随机器设置')
        const set = (v: string) => onChange({ ...value, [f.id]: v })
        const choices = f.type === 'bool' ? ['true', 'false'] : (f.options ?? [])
        return (
          <FormRow
            key={f.id}
            label={label}
            hint={
              i === fields.length - 1
                ? outdated
                  ? t('该机器的 daemon 版本过旧，覆盖不会生效')
                  : t('「跟随机器设置」使用机器上的 Agent 设置；下次启动 agent 时生效')
                : undefined
            }
          >
            {f.type === 'text' ? (
              <TextField
                aria-label={label}
                value={own}
                maxLength={64}
                placeholder={follow}
                onChange={(e) => set(e.target.value)}
              />
            ) : (
              <PopUpButton<string>
                aria-label={label}
                value={own || FOLLOW}
                onChange={(v) => set(v === FOLLOW ? '' : v)}
                options={[
                  { value: FOLLOW, label: follow },
                  ...choices.map((c) => ({ value: c, label: valueLabel(f, c) })),
                ]}
              />
            )}
          </FormRow>
        )
      })}
    </>
  )
}
