import type { AgentCatalog, AgentKind, BotCatalogDto, ProviderStoreView } from '@gonggong/protocol'
import { useEffect, useState } from 'react'
import { t } from '../../i18n'
import { api } from '../../lib/api'
import { toastError } from '../../lib/errors'
import { FormRow, PopUpButton } from '../../ui'
import { botProviderOptions } from '../machines/providers'
import { type AgentConfig, AgentConfigFields } from './AgentConfig'

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

/**
 * 供应商 / 模型 / 推理强度 of the bot forms. Only the owner of the bot and its online machine may pick a provider
 * (`reason` says why not); a new provider starts from its default model.
 */
export function ProviderModelFields({
  reason,
  view,
  agent,
  provider,
  catalog,
  config,
  disabled,
  onChange,
}: {
  reason: string | null
  view: ProviderStoreView | null
  agent: AgentKind
  provider: string
  catalog: AgentCatalog | null
  config: AgentConfig
  disabled?: boolean
  onChange: (next: { provider: string; config: AgentConfig }) => void
}) {
  return (
    <>
      <FormRow label={t('供应商')} hint={reason ?? t('只保存在 Bot 所在的机器上')}>
        <PopUpButton
          aria-label={t('供应商')}
          value={view ? provider : null}
          placeholder={reason ? '--' : t('读取中…')}
          disabled={!!reason || !view}
          options={view ? botProviderOptions(view, agent) : []}
          onChange={(next) => onChange({ provider: next, config: { model: null, effort: null } })}
        />
      </FormRow>
      <AgentConfigFields
        catalog={catalog}
        value={config}
        disabled={disabled}
        onChange={(next) => onChange({ provider, config: next })}
      />
    </>
  )
}
