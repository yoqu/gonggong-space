import {
  type AgentCatalog,
  agentConfigLabel,
  type BotCatalogDto,
  effortName,
  fitEffort,
  modelEfforts,
  modelName,
} from '@gonggong/protocol'
import { useEffect, useState } from 'react'
import { t } from '../../i18n'
import { api, errorText } from '../../lib/api'
import { toastError } from '../../lib/errors'
import { Button, FormRow, PopUpButton, toast } from '../../ui'

export interface AgentConfig {
  model: string | null
  effort: string | null
}

const effortLabel = (value: string) => t.text({ key: effortName(value) })
/** `agentConfigLabel` in the reader's language. */
export const agentLabel = (catalog: AgentCatalog | null, model: string | null, effort: string | null) =>
  agentConfigLabel(catalog, model, effort, (key) => t.text({ key }))

/** `默认（Sonnet）` when the adapter names the model a fresh session starts with. */
export const defaultModelLabel = (catalog: AgentCatalog | null) =>
  catalog?.current ? t('默认（{name}）', { name: modelName(catalog, catalog.current) }) : t('默认')

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
    { value: '', label: m.effort ? t('默认（{name}）', { name: effortLabel(m.effort) }) : t('默认') },
    ...m.efforts.map((e) => ({ value: e.value, label: effortLabel(e.value) })),
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
  const [refreshing, setRefreshing] = useState(false)
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
  /** 刷新模型: the machine probes the agent again, e.g. after its CLI config was edited. */
  const refresh = async () => {
    setRefreshing(true)
    try {
      const { catalog } = await api.post<BotCatalogDto>(`/bots/${botId}/catalog/refresh`)
      setState({ catalog, error: null })
      toast({ type: 'success', message: t('已刷新，共 {n} 个可选模型', { n: catalog?.models.length ?? 0 }) })
    } catch (e) {
      toastError(e)
    } finally {
      setRefreshing(false)
    }
  }
  return state && { ...state, refresh: { run: refresh, busy: refreshing } }
}

/** Asks the bot's machine to probe the agent for its models again. */
export interface CatalogRefresh {
  run: () => void
  busy: boolean
}

function RefreshButton({ refresh }: { refresh?: CatalogRefresh }) {
  if (!refresh) return null
  return (
    <Button size="small" loading={refresh.busy} onClick={refresh.run}>
      {t('刷新模型')}
    </Button>
  )
}

/** 模型 / 推理强度 rows of the bot forms; values not on the catalog stay selectable but none can be added. */
export function AgentConfigFields({
  catalog,
  value,
  disabled,
  refresh,
  onChange,
}: {
  catalog: AgentCatalog | null
  value: AgentConfig
  disabled?: boolean
  refresh?: CatalogRefresh
  onChange: (next: AgentConfig) => void
}) {
  if (!catalog)
    return (
      <FormRow label={t('模型')}>
        <div className="bots-detail__buttons">
          <span className="bots-detail__unset">{t('跟随默认 · 机器上报可选模型后可设置')}</span>
          <RefreshButton refresh={refresh} />
        </div>
      </FormRow>
    )
  const efforts = effortOptions(catalog, value.model)
  return (
    <>
      <FormRow label={t('模型')} hint={t('群内可临时切换，发消息时也可单条指定')}>
        <div className="bots-detail__buttons">
          <PopUpButton
            aria-label={t('模型')}
            value={value.model ?? ''}
            disabled={disabled}
            options={modelOptions(catalog, value.model)}
            onChange={(v) => onChange(withModel(catalog, value.effort, v || null))}
          />
          <RefreshButton refresh={refresh} />
        </div>
      </FormRow>
      {efforts.length ? (
        <FormRow label={t('推理强度')}>
          <PopUpButton
            aria-label={t('推理强度')}
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
