import {
  type AgentKind,
  type AgentSettingField,
  type AgentSettingsReq,
  type AgentSettingValues,
  compareVersions,
  fieldsFor,
  LOCKED_CLAUDE_SETTINGS,
  type MachineDto,
  type ProviderStoreView,
} from '@gonggong/protocol'
import { type KeyboardEvent, useRef, useState } from 'react'
import { useWorkspace } from '../../app/workspace'
import { t } from '../../i18n'
import { api } from '../../lib/api'
import { Alert, GroupBox, GroupRow, SegmentedControl, Switch, TextField } from '../../ui'
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
import { commitOnBlur, SaveStatus, useSaves } from './save'

const SOURCE_LABEL = { default: t('默认'), cli: t('该机器 CLI'), agent: t('机器设置') }
const INHERIT = 'inheritCli'

/**
 * Machine defaults of one agent's agent-layer settings (design §4.2.2); the machine owner's alone. Every change is
 * saved by itself: choices at once, text on blur or Enter.
 */
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
  const cli = view.cli[agent]
  const [values, setValues] = useState<AgentSettingValues>(() => saved?.values ?? {})
  const [texts, setTexts] = useState(() => fieldTexts(fields, saved?.values ?? {}))
  const committed = useRef(texts)
  const [inheritCli, setInheritCli] = useState(saved?.inheritCli ?? true)
  const saves = useSaves()
  const bots = useWorkspace((st) => st.bots).filter(
    (b) => b.machineId === machine.id && b.agentKind === agent,
  )
  const title = t('{agent} Agent 设置', { agent: AGENT_LABEL[agent] })

  const put = (key: string, next: AgentSettingValues, inherit: boolean) =>
    saves.save(key, async () => {
      const body: AgentSettingsReq = { agent, values: next, inheritCli: inherit }
      onView(await api.put<ProviderStoreView>(`/machines/${machine.id}/agent-settings`, body))
      return undefined
    })

  const commit = (f: AgentSettingField, text: string) => {
    let raw: string
    try {
      raw = toValues([f], { [f.id]: text }, values)[f.id] ?? ''
    } catch (e) {
      return saves.refuse(f.id, (e as Error).message)
    }
    const { [f.id]: _, ...rest } = values
    const next = raw ? { ...rest, [f.id]: raw } : rest
    setValues(next)
    put(f.id, next, inheritCli)
  }

  // Where each value comes from: 共工设置 over the machine's CLI over the default, and the bots overriding it.
  const source = (f: AgentSettingField) => {
    const own = values[f.id]
    const fromCli = inheritCli ? cli?.values[f.id] : undefined
    const cliText = fromCli ? t('该机器 CLI：{v}', { v: valueLabel(f, fromCli) }) : null
    const overriding = bots.flatMap((b) => {
      const v = b.agentSettings[f.id]
      return v ? [t('{bot}（{v}）', { bot: b.name, v: valueLabel(f, v) })] : []
    })
    return (
      <span className="mx-inline mx-source">
        {own ? (
          <>
            <span>{t('来源：{s}', { s: SOURCE_LABEL.agent })}</span>
            {cliText ? <s>{cliText}</s> : null}
          </>
        ) : (
          <span>
            {fromCli
              ? t('来源：{s}（{v}）', { s: SOURCE_LABEL.cli, v: valueLabel(f, fromCli) })
              : t('来源：{s}', { s: SOURCE_LABEL.default })}
          </span>
        )}
        {overriding.length ? (
          <span>{t('{label}：{v}', { label: t('Bot 覆盖'), v: overriding.join(t('、')) })}</span>
        ) : null}
      </span>
    )
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
          <span className="mx-sub">{t('改动立即保存，下一轮生效')}</span>
        </span>
      </div>
      <GroupBox>
        {fields.map((f) => {
          const old = tooOld(f)
          const text = texts[f.id] ?? ''
          const typed = !CHOICE.includes(f.type)
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
              <span className="mx-inline">
                <SaveStatus state={saves.status(f.id)} />
                <SettingControl
                  field={f}
                  text={text}
                  disabled={old}
                  onChange={(v) => {
                    setTexts((x) => ({ ...x, [f.id]: v }))
                    if (!typed) commit(f, v)
                  }}
                  {...(typed
                    ? commitOnBlur(text, { current: committed.current[f.id] ?? '' }, (v) => {
                        committed.current = { ...committed.current, [f.id]: v }
                        commit(f, v)
                      })
                    : {})}
                />
              </span>
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
          <span className="mx-inline">
            <SaveStatus state={saves.status(INHERIT)} />
            <Switch
              aria-label={t('继承该机器 CLI 配置')}
              checked={inheritCli}
              onChange={(on) => {
                setInheritCli(on)
                put(INHERIT, values, on)
              }}
            />
          </span>
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
    </section>
  )
}

/** Field types whose control picks a value outright; the others are typed in. */
const CHOICE: AgentSettingField['type'][] = ['bool', 'enum', 'flag']

/** One agent-layer field: three-state for bools, a switch for flags, text with units for the rest. */
export function SettingControl({
  field,
  text,
  disabled,
  onChange,
  onBlur,
  onKeyDown,
}: {
  field: AgentSettingField
  text: string
  disabled?: boolean
  onChange: (text: string) => void
  /** Typed fields commit on blur or Enter. */
  onBlur?: () => void
  onKeyDown?: (e: KeyboardEvent<HTMLInputElement>) => void
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
      onBlur={onBlur}
      onKeyDown={onKeyDown}
    />
  )
}
