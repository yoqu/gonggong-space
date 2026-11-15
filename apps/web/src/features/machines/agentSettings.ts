import type { AgentSettingField, AgentSettingId, AgentSettingValues } from '@gonggong/protocol'
import { t } from '../../i18n'

const FIELD_LABEL: Record<AgentSettingId, string> = {
  contextWindow: t('上下文窗口'),
  autoCompactWindow: t('自动压缩窗口'),
  maxOutputTokens: t('输出上限'),
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
  bashTimeout: t('Bash 默认超时'),
  bashMaxTimeout: t('Bash 最长超时'),
  nonessentialTraffic: t('关闭非必要流量'),
}

/** A field id's label; conflict env names and unknown ids show as they are. */
export const fieldLabel = (id: string) => FIELD_LABEL[id as AgentSettingId] ?? id

/** `KEY=VALUE` per line; throws on a line without `=`. */
export function parseEnv(text: string): Record<string, string> {
  const env: Record<string, string> = {}
  for (const raw of text.split('\n')) {
    const line = raw.trim()
    if (!line) continue
    const at = line.indexOf('=')
    if (at <= 0) throw new Error(t('环境变量每行一个 KEY=VALUE：{line}', { line }))
    env[line.slice(0, at).trim()] = line.slice(at + 1).trim()
  }
  return env
}

export const envText = (env: Record<string, string>) =>
  Object.entries(env)
    .map(([k, v]) => `${k}=${v}`)
    .join('\n')

/** 262144 → 256K, 1000000 → 1M. */
export function tokensLabel(n: number) {
  if (n % 1_000_000 === 0) return `${n / 1_000_000}M`
  if (n % 1000 === 0) return `${n / 1000}K`
  if (n % 1024 === 0) return `${n / 1024}K`
  return String(n)
}

/** `262144`, `300k`, `1.5m`; a listed option's label (`256K`) means that option. */
export function parseTokens(text: string, field?: Pick<AgentSettingField, 'options'>): number | null {
  const s = text.replace(/[,_\s]/g, '')
  const m = /^(\d+(?:\.\d+)?)([km])?$/i.exec(s)
  if (!m) return null
  const hit = field?.options?.find((o) => tokensLabel(Number(o)).toLowerCase() === s.toLowerCase())
  if (hit) return Number(hit)
  const unit = m[2]?.toLowerCase()
  const n = Math.round(Number(m[1]) * (unit === 'k' ? 1000 : unit === 'm' ? 1_000_000 : 1))
  return n > 0 && Number.isSafeInteger(n) ? n : null
}

const MS_UNIT: Record<string, number> = { ms: 1, s: 1000, m: 60_000, min: 60_000, h: 3_600_000 }

/** `600000`, `600s`, `10m`, `1h`. */
export function parseMs(text: string): number | null {
  const m = /^(\d+(?:\.\d+)?)\s*(ms|s|min|m|h)?$/i.exec(text.trim())
  if (!m) return null
  const n = Math.round(Number(m[1]) * (MS_UNIT[m[2]?.toLowerCase() ?? 'ms'] ?? 1))
  return n > 0 && Number.isSafeInteger(n) ? n : null
}

export function msLabel(n: number) {
  if (n % 3_600_000 === 0) return `${n / 3_600_000}h`
  if (n % 60_000 === 0) return `${n / 60_000}m`
  if (n % 1000 === 0) return `${n / 1000}s`
  return `${n}ms`
}

/** `auto` / `auto:N`: tool search only. */
export type BoolState = 'default' | 'on' | 'off' | 'auto'
export const boolState = (raw: string): BoolState =>
  raw === 'true' || raw === '1'
    ? 'on'
    : raw === 'false' || raw === '0'
      ? 'off'
      : raw === 'auto' || raw.startsWith('auto:')
        ? 'auto'
        : 'default'
export const BOOL_RAW: Record<BoolState, string> = { default: '', on: 'true', off: 'false', auto: 'auto' }

/** Whether the daemon accepts `raw` for a flag / bool / enum field (agent_settings.rs `valid`); others pass. */
export function validValue(field: AgentSettingField, raw: string) {
  if (field.type === 'flag') return raw === '1' || raw === 'true'
  if (field.type === 'bool')
    return raw === 'true' || raw === 'false' || (field.id === 'toolSearch' && /^auto(:\d+)?$/.test(raw))
  if (field.type === 'enum') return !!field.options?.includes(raw)
  return true
}

const NUMERIC = /^\d+$/

/** What a field's control shows for a stored value: tokens and durations with units, the rest as stored. */
export function textOf(field: AgentSettingField, raw: string) {
  if (!NUMERIC.test(raw)) return raw
  if (field.type === 'tokens') return tokensLabel(Number(raw))
  if (field.type === 'ms') return msLabel(Number(raw))
  return raw
}

/** A stored value for display: 开 / 关, units, 不署名. */
export function valueLabel(field: AgentSettingField, raw: string) {
  if (field.type === 'bool') {
    const n = /^auto:(\d+)$/.exec(raw)?.[1]
    if (n) return t('自动（{n}%）', { n })
    return { on: t('开'), off: t('关'), auto: t('自动'), default: raw }[boolState(raw)]
  }
  if (field.type === 'flag') return t('开')
  if (field.type === 'enum' && raw === 'none') return t('不署名')
  return textOf(field, raw)
}

export const fieldTexts = (fields: readonly AgentSettingField[], values: AgentSettingValues) =>
  Object.fromEntries(fields.map((f) => [f.id, textOf(f, values[f.id] ?? '')]))

/** The value to store for what a control shows; one left as it was keeps its stored form. */
function rawOf(field: AgentSettingField, text: string, initial = '') {
  if (text === textOf(field, initial)) return initial
  const s = text.trim()
  if (!s) return ''
  const invalid = () =>
    new Error(t('「{label}」不是有效的值：{text}', { label: fieldLabel(field.id), text: s }))
  if (field.type !== 'tokens' && field.type !== 'ms') {
    if (!validValue(field, s)) throw invalid()
    return s
  }
  const n = field.type === 'tokens' ? parseTokens(s, field) : parseMs(s)
  if (n === null) throw invalid()
  return String(n)
}

/** Control texts → field values; empty ones are left out (Claude Code's default). */
export function toValues(
  fields: readonly AgentSettingField[],
  texts: Record<string, string>,
  initial: AgentSettingValues,
): AgentSettingValues {
  const out: AgentSettingValues = {}
  for (const f of fields) {
    const v = rawOf(f, texts[f.id] ?? '', initial[f.id])
    if (v) out[f.id] = v
  }
  return out
}

/** A provider's env → its known fields (by id) and the other variables. */
export function splitEnv(env: Record<string, string>, fields: readonly AgentSettingField[]) {
  const values: AgentSettingValues = {}
  const other: Record<string, string> = {}
  for (const [k, v] of Object.entries(env)) {
    const f = fields.find((x) => x.key === k)
    if (f) values[f.id] = v
    else other[k] = v
  }
  return { values, other }
}

/**
 * The provider env to save: the fields' values plus the other variables. Throws on a known variable among the
 * others or an invalid value; the auto-compact window is checked only when changed, against the window in effect.
 */
export function joinProviderEnv({
  fields,
  texts,
  initial,
  other,
  modelWindow,
}: {
  fields: readonly AgentSettingField[]
  texts: Record<string, string>
  initial: AgentSettingValues
  other: string
  /** The selected model's window when the provider sets none. */
  modelWindow?: number
}): Record<string, string> {
  const rest = parseEnv(other)
  for (const k of Object.keys(rest)) {
    const f = fields.find((x) => x.key === k)
    if (f) throw new Error(t('请在上方「{label}」设置', { label: fieldLabel(f.id) }))
  }
  const values = toValues(fields, texts, initial)
  const compact = fields.find((f) => f.id === 'autoCompactWindow')
  const n = Number(values.autoCompactWindow)
  if (compact && values.autoCompactWindow && values.autoCompactWindow !== initial.autoCompactWindow) {
    if ((compact.min && n < compact.min) || (compact.max && n > compact.max))
      throw new Error(
        t('「{label}」应在 {min}–{max} 之间', {
          label: fieldLabel(compact.id),
          min: compact.min ?? 0,
          max: compact.max ?? 0,
        }),
      )
    const window = values.contextWindow ? Number(values.contextWindow) : modelWindow
    if (window && n > window)
      throw new Error(t('「自动压缩窗口」不能大于上下文窗口（{n}）', { n: tokensLabel(window) }))
  }
  const env = { ...rest }
  for (const f of fields) {
    const v = values[f.id]
    if (v) env[f.key] = v
  }
  return env
}

/** 上下文 256K · 输出 128K, from a provider's env. */
export function providerSummary(env: Record<string, string>) {
  const ctx = env.CLAUDE_CODE_MAX_CONTEXT_TOKENS ?? ''
  const out = env.CLAUDE_CODE_MAX_OUTPUT_TOKENS ?? ''
  return [
    NUMERIC.test(ctx) ? t('上下文 {n}', { n: tokensLabel(Number(ctx)) }) : '',
    NUMERIC.test(out) ? t('输出 {n}', { n: tokensLabel(Number(out)) }) : '',
  ]
    .filter(Boolean)
    .join(' · ')
}
