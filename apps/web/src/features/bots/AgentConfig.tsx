import {
  type AgentCatalog,
  type BotCatalogDto,
  effortName,
  fitEffort,
  modelEfforts,
  modelName,
} from '@gonggong/protocol'
import { useEffect, useState } from 'react'
import { api, errorText } from '../../lib/api'
import { FormRow, PopUpButton } from '../../ui'

export interface AgentConfig {
  model: string | null
  effort: string | null
}

/** `默认（Sonnet）` when the adapter names the model a fresh session starts with. */
export const defaultModelLabel = (catalog: AgentCatalog | null) =>
  catalog?.current ? `默认（${modelName(catalog, catalog.current)}）` : '默认'

/** The model options of a picker ('' = the adapter's default), keeping a value the catalog no longer lists. */
export function modelOptions(catalog: AgentCatalog | null, model: string | null) {
  const models = catalog?.models ?? []
  const stale = model && !models.some((m) => m.value === model) ? [{ value: model, name: model }] : []
  return [
    { value: '', label: defaultModelLabel(catalog) },
    ...[...models, ...stale].map((m) => ({ value: m.value, label: m.name })),
  ]
}

/** Effort options of `model` ('' = its starting level); empty when it has none. */
export function effortOptions(catalog: AgentCatalog | null, model: string | null) {
  const m = catalog && modelEfforts(catalog, model)
  if (!m?.efforts.length) return []
  return [
    { value: '', label: m.effort ? `默认（${effortName(m.effort)}）` : '默认' },
    ...m.efforts.map((e) => ({ value: e.value, label: effortName(e.value) })),
  ]
}

/** A new model keeps the effort only if it offers it. */
export const withModel = (catalog: AgentCatalog | null, effort: string | null, model: string | null) => ({
  model,
  effort: effort && fitEffort(catalog, model, effort) === effort ? effort : null,
})

/**
 * What a new session of the bot may pick (its provider's models when third-party, design §4.4); undefined while
 * asked. `key` refetches it, e.g. when the provider in effect changes.
 */
export function useBotCatalog(botId: string, key?: unknown) {
  const [state, setState] = useState<{ catalog: AgentCatalog | null; error: string | null }>()
  // biome-ignore lint/correctness/useExhaustiveDependencies: `key` only triggers a refetch
  useEffect(() => {
    let live = true
    api.get<BotCatalogDto>(`/bots/${botId}/catalog`).then(
      ({ catalog }) => live && setState({ catalog, error: null }),
      (e) => live && setState({ catalog: null, error: errorText(e) }),
    )
    return () => {
      live = false
    }
  }, [botId, key])
  return state
}

/** 模型 / 推理强度 rows of the bot forms; values not on the catalog stay selectable but none can be added. */
export function AgentConfigFields({
  catalog,
  value,
  disabled,
  onChange,
}: {
  catalog: AgentCatalog | null
  value: AgentConfig
  disabled?: boolean
  onChange: (next: AgentConfig) => void
}) {
  if (!catalog)
    return (
      <FormRow label="模型">
        <span className="bots-detail__unset">跟随默认 · 机器上报可选模型后可设置</span>
      </FormRow>
    )
  const efforts = effortOptions(catalog, value.model)
  return (
    <>
      <FormRow label="模型" hint="群内可临时切换，发消息时也可单条指定">
        <PopUpButton
          aria-label="模型"
          value={value.model ?? ''}
          disabled={disabled}
          options={modelOptions(catalog, value.model)}
          onChange={(v) => onChange(withModel(catalog, value.effort, v || null))}
        />
      </FormRow>
      {efforts.length ? (
        <FormRow label="推理强度">
          <PopUpButton
            aria-label="推理强度"
            value={value.effort ?? ''}
            disabled={disabled}
            options={efforts}
            onChange={(v) => onChange({ ...value, effort: v || null })}
          />
        </FormRow>
      ) : null}
    </>
  )
}
