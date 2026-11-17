import {
  AGENT_KINDS,
  type AgentCatalog,
  type AgentDefault,
  type AgentKind,
  type AgentState,
  type ApiProtocol,
  agentMeta,
  canUse,
  clientRunsAgent,
  compareVersions,
  endpointFor,
  INHERIT_PROVIDER,
  MIN_NODE,
  modelName,
  OFFICIAL_PROVIDER,
  type ProviderEndpoint,
  type ProviderStoreView,
  type ProviderView,
  type RuntimeState,
} from '@gonggong/protocol'
import { t } from '../../i18n'

export const hasUpdate = (x: { version?: string | null; latest?: string | null }) =>
  !!(x.latest && x.version && compareVersions(x.latest, x.version) > 0)

/** Managed, or installed by the user in a way the daemon knows how to upgrade (brew, claude update, npm). */
export const canUpgrade = (x: {
  managed: boolean
  upgradeCommand?: string | null
  version?: string | null
  latest?: string | null
}) => (x.managed || !!x.upgradeCommand) && hasUpdate(x)

/**
 * One state, one main action: 安装 (missing), 升级到 x (update), 复制安装命令 (off npm, the owner installs it),
 * none (current, or an update 共工 cannot run).
 */
export type AgentStatus = 'missing' | 'command' | 'update' | 'stale' | 'current'

export function agentStatus(a: AgentState): AgentStatus {
  if (!a.available) return a.installCommand ? 'command' : 'missing'
  if (canUpgrade(a)) return 'update'
  return hasUpdate(a) ? 'stale' : 'current'
}

/** The agents the machine's client runs, in registry order; one it reported counts though `features` predate it. */
export const runnableAgents = (features: readonly string[], agents: AgentState[]) =>
  AGENT_KINDS.filter((k) => clientRunsAgent(features, k) || agents.some((a) => a.kind === k))

/** The registry entry of an agent the daemon did not report: not installed. */
export const missingAgent = (kind: AgentKind): AgentState => ({
  kind,
  available: false,
  version: null,
  path: null,
  minVersion: null,
  catalog: null,
  latest: null,
  managed: false,
  upgradeCommand: null,
  installCommand: null,
})

export type NodeStatus = 'ok' | 'missing' | 'old'
export const nodeStatus = (n: RuntimeState): NodeStatus =>
  !n.installed ? 'missing' : n.version && compareVersions(n.version, `${MIN_NODE}.0.0`) < 0 ? 'old' : 'ok'

export const PROTOCOL_LABEL: Record<ApiProtocol, string> = {
  anthropic: t('Anthropic 兼容'),
  openai: t('OpenAI 兼容'),
  gemini: 'Gemini',
  codebuddy: 'CodeBuddy',
}

/** The agent whose provider-layer settings an endpoint of `protocol` carries (the one that speaks it natively). */
export const PROTOCOL_AGENT: Record<ApiProtocol, AgentKind> = {
  anthropic: 'claude',
  openai: 'codex',
  gemini: 'gemini',
  codebuddy: 'codebuddy',
}

const list = (xs: string[], sep: string) => xs.join(sep)

/** Why `agent` cannot run on `p`; null when it can. */
export function whyNot(p: ProviderView, agent: AgentKind): string | null {
  if (canUse(p, agent)) return null
  const name = agentMeta(agent).name
  if (p.agents && !p.agents.includes(agent))
    return t('该供应商由旧版客户端登记，只能给 {agents} 用', {
      agents: list(
        p.agents.map((a) => agentMeta(a).name),
        t('、'),
      ),
    })
  const need = agentMeta(agent).protocols
  if (p.endpoints.some((e) => e.configDir && need.includes(e.protocol)))
    return t('该机器 Claude 配置目录只能给 Claude Code 用')
  return t('该供应商只提供 {have} 接口，{agent} 需要 {need}', {
    have: list([...new Set(p.endpoints.map((e) => PROTOCOL_LABEL[e.protocol]))], t('、')),
    agent: name,
    need: list(
      need.map((x) => PROTOCOL_LABEL[x]),
      t('或'),
    ),
  })
}

export const OFFICIAL_NAME = t('官方登录')

export const providerName = (view: ProviderStoreView, id: string) =>
  id === OFFICIAL_PROVIDER
    ? OFFICIAL_NAME
    : id === INHERIT_PROVIDER
      ? t('继承机器默认')
      : (view.providers.find((p) => p.id === id)?.name ?? t('已删除的供应商'))

/** The machine default of `agent`; absent = official with its default model. */
export const machineDefault = (view: ProviderStoreView, agent: AgentKind): AgentDefault =>
  view.machine[agent] ?? { provider: OFFICIAL_PROVIDER, model: null }

/** `Kimi / kimi-k2`, or the provider alone when the model is its default. */
export const choiceLabel = (view: ProviderStoreView, d: AgentDefault) =>
  d.model ? `${providerName(view, d.provider)} / ${d.model}` : providerName(view, d.provider)

/** A picker value: provider id (or `official` / `inherit`) and model ('' = the default). */
export const choiceValue = (provider: string, model: string | null) => `${provider}\n${model ?? ''}`
export const parseChoice = (value: string): AgentDefault => {
  const at = value.indexOf('\n')
  const provider = at < 0 ? value : value.slice(0, at)
  const model = at < 0 ? '' : value.slice(at + 1)
  return { provider, model: model || null }
}

export interface ChoiceOption {
  value: string
  label: string
  description?: string
  disabled?: boolean
}

function endpointModels(
  e: ProviderEndpoint,
  catalog: AgentCatalog | null,
): { value: string; name: string }[] {
  if (e.configDir) {
    if (e.modelOptions.length) return e.modelOptions.map((n) => ({ value: n, name: modelName(catalog, n) }))
    return catalog?.models ?? []
  }
  const tiers = e.models
    ? [e.models.haiku, e.models.sonnet, e.models.opus].filter((x): x is string => !!x)
    : []
  const names = [...new Set([...(tiers.length && e.model ? [e.model] : []), ...tiers, ...e.modelOptions])]
  return names.map((n) => ({ value: n, name: n }))
}

/**
 * 「供应商/模型」 options grouped by provider: each provider's default model first, then the models it offers. The
 * official login's models come from the agent's catalog, a provider's from its endpoint. Providers `agent` cannot
 * run on are listed disabled with why. `models` false (an older client) offers providers only.
 */
export function choiceOptions(
  view: ProviderStoreView,
  agent: AgentKind,
  { catalog, models, inherit }: { catalog: AgentCatalog | null; models: boolean; inherit?: AgentDefault },
): ChoiceOption[] {
  const out: ChoiceOption[] = []
  if (inherit)
    out.push({
      value: choiceValue(INHERIT_PROVIDER, null),
      label: t('继承机器默认（当前：{name}）', { name: choiceLabel(view, inherit) }),
    })
  const group = (
    id: string,
    name: string,
    def: string | null,
    options: { value: string; name: string }[],
  ) => {
    out.push({
      value: choiceValue(id, null),
      label: models ? `${name} / ${def ? t('默认（{name}）', { name: def }) : t('默认模型')}` : name,
    })
    if (!models) return
    for (const m of options) out.push({ value: choiceValue(id, m.value), label: `${name} / ${m.name}` })
  }
  group(OFFICIAL_PROVIDER, OFFICIAL_NAME, null, catalog?.models ?? [])
  for (const p of view.providers) {
    const e = endpointFor(p, agent)
    if (!e) {
      out.push({
        value: choiceValue(p.id, null),
        label: p.name,
        description: whyNot(p, agent) ?? '',
        disabled: true,
      })
      continue
    }
    group(p.id, p.name, e.model, endpointModels(e, catalog))
  }
  return out
}

/** Picker options with `value` kept selectable when nothing lists it (a model since dropped, an older choice). */
export function withCurrent(options: ChoiceOption[], value: string, view: ProviderStoreView) {
  if (options.some((o) => o.value === value)) return options
  return [...options, { value, label: choiceLabel(view, parseChoice(value)) }]
}
