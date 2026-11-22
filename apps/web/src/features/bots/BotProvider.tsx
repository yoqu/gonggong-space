import {
  type AgentCatalog,
  type AgentKind,
  type BotCatalogDto,
  INHERIT_PROVIDER,
  type MachineDto,
  type ProviderStoreView,
} from '@gonggong/protocol'
import { useEffect, useState } from 'react'
import { t } from '../../i18n'
import { api } from '../../lib/api'
import { toastError } from '../../lib/errors'
import { FormRow, PopUpButton } from '../../ui'
import { choiceValue, machineDefault, parseChoice } from '../agents/model'
import { ProviderModelPicker } from '../agents/ProviderModelPicker'
import {
  type AgentConfig,
  AgentConfigFields,
  type CatalogRefresh,
  EffortField,
  RefreshButton,
  withModel,
} from './AgentConfig'
import { reportedAgent } from './model'

/** The machine's provider store (design §4.2), read live from it; null while asked or when `blocked`. */
export function useMachineProviders(machineId: string | null, blocked: boolean) {
  const [view, setView] = useState<ProviderStoreView | null>(null)
  useEffect(() => {
    setView(null)
    if (!machineId || blocked) return
    let live = true
    api.get<ProviderStoreView>(`/machines/${machineId}/providers`).then(
      (v) => live && setView(v),
      (e) => live && toastError(e),
    )
    return () => {
      live = false
    }
  }, [machineId, blocked])
  return [view, setView] as const
}

/** What a session of `agent` on the machine may pick with `provider`; null while asked or when `provider` is null. */
export function useProviderCatalog(machineId: string | null, agent: AgentKind, provider: string | null) {
  const [catalog, setCatalog] = useState<AgentCatalog | null>(null)
  useEffect(() => {
    setCatalog(null)
    if (!machineId || provider === null) return
    let live = true
    const query = new URLSearchParams({ agent, provider })
    api.get<BotCatalogDto>(`/machines/${machineId}/catalog?${query}`).then(
      (r) => live && setCatalog(r.catalog),
      (e) => live && toastError(e),
    )
    return () => {
      live = false
    }
  }, [machineId, agent, provider])
  return catalog
}

/** The provider a bot's choice runs on: its own, else the machine default of its agent. */
export const choiceProvider = (view: ProviderStoreView, agent: AgentKind, provider: string) =>
  provider === INHERIT_PROVIDER ? machineDefault(view, agent).provider : provider

export interface ProviderModel {
  /** A provider id, `official` or `inherit`. */
  provider: string
  config: AgentConfig
}

/**
 * 供应商/模型 and 推理强度 of the bot forms: one pick of provider and model, inheriting the machine default unless
 * overridden. Only the owner of the bot and its online machine may pick (`reason` says why not); the others get the
 * models the bot's catalog lists. `catalog` is that of the provider in effect, for the levels.
 */
export function ProviderModelFields({
  reason,
  view,
  machine,
  agent,
  value,
  catalog,
  disabled,
  refresh,
  onChange,
}: {
  reason: string | null
  view: ProviderStoreView | null
  machine: MachineDto | undefined
  agent: AgentKind
  value: ProviderModel
  catalog: AgentCatalog | null
  disabled?: boolean
  refresh?: CatalogRefresh
  onChange: (next: ProviderModel) => void
}) {
  if (reason)
    return (
      <>
        <FormRow label={t('供应商/模型')} hint={reason}>
          <PopUpButton aria-label={t('供应商/模型')} value={null} placeholder="--" disabled options={[]} />
        </FormRow>
        <AgentConfigFields
          catalog={catalog}
          value={value.config}
          disabled={disabled}
          refresh={refresh}
          onChange={(config) => onChange({ ...value, config })}
        />
      </>
    )
  const models = !!machine?.features.includes('protocolProviders')
  return (
    <>
      <FormRow
        label={t('供应商/模型')}
        hint={models ? t('只保存在 Bot 所在的电脑上') : t('升级这台电脑的共工客户端后可同时选择模型')}
      >
        <div className="bots-detail__buttons">
          <ProviderModelPicker
            view={view}
            agent={agent}
            catalog={(machine ? reportedAgent(machine, agent)?.catalog : null) ?? catalog}
            models={models}
            inherit={view ? machineDefault(view, agent) : undefined}
            value={choiceValue(value.provider, models ? value.config.model : null)}
            disabled={disabled}
            onChange={(v) => {
              const next = parseChoice(v)
              const same = next.provider === value.provider
              onChange({
                provider: next.provider,
                // A new provider starts from its default model and levels.
                config: models
                  ? same
                    ? withModel(catalog, value.config.effort, next.model)
                    : { model: next.model, effort: null }
                  : same
                    ? value.config
                    : { model: null, effort: null },
              })
            }}
          />
          {models ? <RefreshButton refresh={refresh} /> : null}
        </div>
      </FormRow>
      {models ? (
        <EffortField
          catalog={catalog}
          model={value.config.model}
          effort={value.config.effort}
          disabled={disabled}
          onChange={(effort) => onChange({ ...value, config: { ...value.config, effort } })}
        />
      ) : (
        // An older client takes no model with the provider: the bot's own model, from its catalog.
        <AgentConfigFields
          catalog={catalog}
          value={value.config}
          disabled={disabled}
          refresh={refresh}
          onChange={(config) => onChange({ ...value, config })}
        />
      )}
    </>
  )
}
