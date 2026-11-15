import { type AgentKind, type AgentSettingField, type AgentSettingId, fieldsFor } from '@gonggong/protocol'
import { t } from '../i18n'

const FIELD_LABEL: Record<AgentSettingId, string> = {
  contextWindow: t('上下文'),
  autoCompactWindow: t('自动压缩'),
  maxOutputTokens: t('输出'),
  disableThinking: t('关闭思考参数'),
  disableBetas: t('关闭实验性 beta'),
  toolSearch: t('工具搜索'),
  apiTimeout: t('API 超时'),
  language: t('语言'),
  thinking: t('扩展思考'),
  attribution: t('提交署名'),
  gitInstructions: t('内置 git 指令'),
  autoMemory: t('自动记忆'),
  autoCompact: t('自动压缩'),
  bashTimeout: t('Bash 超时'),
  bashMaxTimeout: t('Bash 最长超时'),
  nonessentialTraffic: t('关闭非必要流量'),
}

const ENUM_LABEL: Record<string, string> = { none: t('不署名') }

/** 262144 → 256K, 200000 → 200K, 1000000 → 1M; anything else as is. */
export function formatTokens(v: string): string {
  const n = Number(v)
  if (!Number.isInteger(n) || n <= 0) return v
  for (const [unit, sizes] of [
    ['M', [1_000_000, 1_048_576]],
    ['K', [1_000, 1_024]],
  ] as const) {
    const size = sizes.find((s) => n % s === 0)
    if (size) return `${n / size}${unit}`
  }
  return v
}

function formatMs(v: string): string {
  const n = Number(v)
  if (!Number.isInteger(n) || n <= 0) return v
  if (n % 60_000 === 0) return t('{n} 分钟', { n: n / 60_000 })
  if (n % 1_000 === 0) return t('{n} 秒', { n: n / 1_000 })
  return `${n} ms`
}

function formatSetting(field: AgentSettingField, v: string): string {
  switch (field.type) {
    case 'tokens':
      return formatTokens(v)
    case 'ms':
      return formatMs(v)
    case 'flag':
      return v === '1' || v === 'true' ? t('是') : t('否')
    case 'bool':
      return v === 'true' ? t('开') : v === 'false' ? t('关') : v
    case 'enum':
      return ENUM_LABEL[v] ?? v
    default:
      return v
  }
}

const label = (f: AgentSettingField) => FIELD_LABEL[f.id as AgentSettingId]

/** 「上下文 256K · 输出 128K」: the provider-layer settings a provider's (or the official login's) env sets. */
export function providerSummary(agent: AgentKind, env: Record<string, string>): string {
  return fieldsFor(agent, 'provider')
    .flatMap((f) => {
      const v = env[f.key]
      if (v === undefined) return []
      return f.type === 'flag' ? label(f) : `${label(f)} ${formatSetting(f, v)}`
    })
    .join(' · ')
}

/** The agent-layer settings set in `values` (field id → raw value), in field order. */
export function agentSettingRows(agent: AgentKind, values: Record<string, string>) {
  return fieldsFor(agent, 'agent').flatMap((f) => {
    const v = values[f.id]
    return v === undefined ? [] : { id: f.id, label: label(f), value: formatSetting(f, v) }
  })
}
