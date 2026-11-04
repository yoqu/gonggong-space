import {
  type AgentKind,
  type AgentSettingField,
  type AgentSettingsReq,
  compareVersions,
  fieldsFor,
  LOCKED_CLAUDE_SETTINGS,
  type MachineDto,
  type ProviderStoreView,
} from '@gonggong/protocol'
import { useState } from 'react'
import { t } from '../../i18n'
import { api } from '../../lib/api'
import { toastError } from '../../lib/errors'
import { Alert, Button, GroupBox, GroupRow, SegmentedControl, Switch, TextField, toast } from '../../ui'
import { AGENT_LABEL } from '../bots/model'
import {
  BOOL_RAW,
  type BoolState,
  boolState,
  fieldLabel,
  fieldTexts,
  toValues,
  valueLabel,
} from './agentSettings'
import { BOOL_ITEMS } from './ProviderSettings'

const SOURCE_LABEL = { default: t('默认'), cli: t('该机器 CLI'), agent: t('Agent 设置') }

/** Machine defaults of one agent's agent-layer settings (design §4.2.2); the machine owner's alone. */
export function AgentSettingsBox({
  machine,
  agent,
  view,
  onView,
}: {
  machine: MachineDto
  agent: AgentKind
  view: ProviderStoreView
  onView: (view: ProviderStoreView) => void
}) {
  const fields = fieldsFor(agent, 'agent')
  const saved = view.agentSettings[agent]
  const initial = saved?.values ?? {}
  const cli = view.cli[agent]
  const [texts, setTexts] = useState(() => fieldTexts(fields, initial))
  const [inheritCli, setInheritCli] = useState(saved?.inheritCli ?? true)
  const [error, setError] = useState('')
  const [saving, setSaving] = useState(false)
  const title = t('{agent} Agent 设置', { agent: AGENT_LABEL[agent] })
  const set = (id: string, text: string) => setTexts((x) => ({ ...x, [id]: text }))

  const save = async () => {
    let values: AgentSettingsReq['values']
    try {
      values = toValues(fields, texts, initial)
    } catch (e) {
      return setError((e as Error).message)
    }
    setError('')
    setSaving(true)
    try {
      const body: AgentSettingsReq = { agent, values, inheritCli }
      onView(await api.put<ProviderStoreView>(`/machines/${machine.id}/agent-settings`, body))
      toast({ type: 'success', message: t('Agent 设置已保存，将在下一轮生效') })
    } catch (e) {
      toastError(e)
    } finally {
      setSaving(false)
    }
  }

  const source = (f: AgentSettingField) => {
    const own = texts[f.id] ?? ''
    const fromCli = inheritCli ? cli?.values[f.id] : undefined
    const cliText = fromCli ? t('该机器 CLI：{v}', { v: valueLabel(f, fromCli) }) : null
    if (own)
      return (
        <span className="mx-inline">
          <span>{t('来源：{s}', { s: SOURCE_LABEL.agent })}</span>
          {cliText ? <s>{cliText}</s> : null}
        </span>
      )
    return fromCli
      ? t('来源：{s}（{v}）', { s: SOURCE_LABEL.cli, v: valueLabel(f, fromCli) })
      : t('来源：{s}', { s: SOURCE_LABEL.default })
  }
  const tooOld = (f: AgentSettingField) =>
    !!f.minVersion && !!cli?.version && compareVersions(cli.version, f.minVersion) < 0

  return (
    <section aria-label={title} className="mx-section">
      <div className="mx-section__head">
        <span className="mx-row__main">
          <span className="mx-strong">{t('Agent 设置')}</span>
          <span className="mx-sub">
            {t('这台机器上所有 Bot 的默认设置，Bot 可单独覆盖语言、扩展思考与提交署名')}
          </span>
        </span>
      </div>
      <GroupBox>
        {fields.map((f) => {
          const old = tooOld(f)
          return (
            <GroupRow
              key={f.id}
              label={fieldLabel(f.id)}
              description={
                old
                  ? t('需要 {agent} {v} 及以上', { agent: AGENT_LABEL[agent], v: f.minVersion ?? '' })
                  : source(f)
              }
            >
              <SettingControl
                field={f}
                text={texts[f.id] ?? ''}
                disabled={old}
                onChange={(v) => set(f.id, v)}
              />
            </GroupRow>
          )
        })}
      </GroupBox>
      <GroupBox>
        <GroupRow
          label={t('继承该机器 CLI 配置')}
          description={
            inheritCli
              ? t('同时加载这台机器上 CLI 自己的用户配置')
              : t('已关闭：同时不再加载个人 CLAUDE.md、记忆、hooks 和用户 Skill')
          }
        >
          <Switch aria-label={t('继承该机器 CLI 配置')} checked={inheritCli} onChange={setInheritCli} />
        </GroupRow>
        {inheritCli && cli && (cli.hooks || cli.permissionRules) ? (
          <GroupRow
            label={t('该机器 CLI')}
            description={t('{hooks} 个 hooks、{rules} 条权限规则会随继承一起生效', {
              hooks: cli.hooks,
              rules: cli.permissionRules,
            })}
          />
        ) : null}
        {agent === 'claude' ? (
          <GroupRow
            label={t('由共工管理')}
            description={t('权限、模型、MCP、插件与密钥由共工统一管理，该机器 CLI 中的同名设置不生效')}
          >
            <span className="mx-sub mx-mono">{LOCKED_CLAUDE_SETTINGS.join(' · ')}</span>
          </GroupRow>
        ) : null}
      </GroupBox>
      {inheritCli && cli?.conflicts.length ? (
        <Alert
          variant="warning"
          description={t('该机器 CLI 设置了 {names}，会覆盖 Bot 的 effort/模型等设置', {
            names: cli.conflicts.join('、'),
          })}
        />
      ) : null}
      {error ? (
        <p className="mx-danger" role="alert">
          {error}
        </p>
      ) : null}
      <div className="mx-row mx-row--end">
        <Button variant="primary" disabled={saving} onClick={() => void save()}>
          {t('保存设置')}
        </Button>
      </div>
    </section>
  )
}

/** One agent-layer field: three-state for bools, a switch for flags, text with units for the rest. */
export function SettingControl({
  field,
  text,
  disabled,
  onChange,
}: {
  field: AgentSettingField
  text: string
  disabled?: boolean
  onChange: (text: string) => void
}) {
  const label = fieldLabel(field.id)
  if (field.type === 'bool')
    return (
      <SegmentedControl<BoolState>
        aria-label={label}
        size="small"
        value={boolState(text)}
        onChange={(v) => onChange(BOOL_RAW[v])}
        items={BOOL_ITEMS.map((i) => ({ ...i, disabled }))}
      />
    )
  if (field.type === 'enum')
    return (
      <SegmentedControl
        aria-label={label}
        size="small"
        value={text || 'default'}
        onChange={(v) => onChange(v === 'default' ? '' : v)}
        items={[
          { value: 'default', label: t('默认'), disabled },
          ...(field.options ?? []).map((o) => ({ value: o, label: valueLabel(field, o), disabled })),
        ]}
      />
    )
  if (field.type === 'flag')
    return (
      <Switch
        aria-label={label}
        checked={!!text && text !== '0'}
        disabled={disabled}
        onChange={(on) => onChange(on ? '1' : '')}
      />
    )
  return (
    <TextField
      aria-label={label}
      value={text}
      disabled={disabled}
      placeholder={field.type === 'ms' ? t('默认，如 10m、600s') : t('默认')}
      onChange={(e) => onChange(e.target.value)}
    />
  )
}
