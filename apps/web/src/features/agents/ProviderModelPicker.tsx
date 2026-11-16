import type { AgentCatalog, AgentDefault, AgentKind, ProviderStoreView } from '@gonggong/protocol'
import { t } from '../../i18n'
import { PopUpButton } from '../../ui'
import { choiceOptions, withCurrent } from './model'

/**
 * One 「供应商/模型」 pick: grouped by provider, each provider's default model first, then the models it lists. A
 * provider the agent cannot run on is shown disabled with why. Values are `choiceValue(provider, model)`.
 */
export function ProviderModelPicker({
  view,
  agent,
  catalog,
  models,
  inherit,
  value,
  disabled,
  placeholder,
  onChange,
}: {
  view: ProviderStoreView | null
  agent: AgentKind
  /** The agent's own catalog: the official login's models. */
  catalog: AgentCatalog | null
  /** The client takes a model with the provider (`protocolProviders`); false offers providers only. */
  models: boolean
  /** Offers 继承机器默认, naming what it currently is. */
  inherit?: AgentDefault
  value: string | null
  disabled?: boolean
  placeholder?: string
  onChange: (value: string) => void
}) {
  const base = view ? choiceOptions(view, agent, { catalog, models, inherit }) : []
  const options = view && value !== null ? withCurrent(base, value, view) : base
  return (
    <PopUpButton
      aria-label={t('供应商/模型')}
      value={view ? value : null}
      placeholder={placeholder ?? t('读取中…')}
      disabled={disabled || !view}
      options={options}
      onChange={onChange}
    />
  )
}
