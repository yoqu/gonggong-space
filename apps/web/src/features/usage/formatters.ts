import type { UsageCostSource, UsageModelSource, UsageModelUnitPriceDto } from '@gonggong/protocol'
import { locale, t } from '../../i18n'

/** Ordered categorical series palette (spec #9): 6 distinct hues + gray for Other. */
export const SERIES_PALETTE = [
  'var(--system-indigo)',
  'var(--system-cyan)',
  'var(--system-teal)',
  'var(--system-orange)',
  'var(--system-pink)',
  'var(--system-purple)',
] as const

export const SERIES_OTHER = 'var(--system-gray)'

export type UsageCurrency = 'cny' | 'usd'

export interface UsageCostFormat {
  currency: UsageCurrency
  usdToCny: number
}

export const DEFAULT_USD_TO_CNY = 7.2
export const CURRENCY_STORAGE_KEY = 'gg.usage.currency'
export const DEFAULT_COST_FORMAT: UsageCostFormat = { currency: 'cny', usdToCny: DEFAULT_USD_TO_CNY }

export function readStoredCurrency(): UsageCurrency {
  try {
    const raw = typeof localStorage !== 'undefined' ? localStorage.getItem(CURRENCY_STORAGE_KEY) : null
    return raw === 'usd' ? 'usd' : 'cny'
  } catch {
    return 'cny'
  }
}

export function writeStoredCurrency(currency: UsageCurrency) {
  try {
    if (typeof localStorage !== 'undefined') localStorage.setItem(CURRENCY_STORAGE_KEY, currency)
  } catch {}
}

export function seriesColor(index: number, key?: string): string {
  if (key === '__other__' || key === 'other') return SERIES_OTHER
  return SERIES_PALETTE[index % SERIES_PALETTE.length] ?? SERIES_OTHER
}

function trimFixed(n: number, digits: number): string {
  return Number(n.toFixed(digits)).toString()
}

/** High-density compact token count: zh uses 万/亿 like Magpie; en uses k/M/B. */
export function fmtCompactTokens(n: number): string {
  if (!Number.isFinite(n)) return '—'
  const abs = Math.abs(n)
  const sign = n < 0 ? '-' : ''
  if (locale === 'zh') {
    if (abs >= 1e8) return `${sign}${trimFixed(abs / 1e8, 2)} 亿`
    if (abs >= 1e4) return `${sign}${trimFixed(abs / 1e4, abs >= 1e6 ? 0 : 1)} 万`
    return Math.round(n).toLocaleString('en-US')
  }
  if (abs >= 1e9) return `${sign}${trimFixed(abs / 1e9, 2)}B`
  if (abs >= 1e6) return `${sign}${trimFixed(abs / 1e6, abs >= 1e8 ? 0 : 1)}M`
  if (abs >= 1e3) return `${sign}${trimFixed(abs / 1e3, abs >= 1e5 ? 0 : 1)}k`
  return Math.round(n).toLocaleString('en-US')
}

/** Compact count formatter for runs / tool calls / messages. */
export function fmtCount(n: number): string {
  if (!Number.isFinite(n)) return '—'
  const abs = Math.abs(n)
  if (locale === 'zh') {
    if (abs >= 1e8) return `${trimFixed(n / 1e8, 2)} 亿`
    if (abs >= 1e4) return `${trimFixed(n / 1e4, 1)} 万`
    return Math.round(n).toLocaleString('en-US')
  }
  if (abs >= 1e6) return `${trimFixed(n / 1e6, 1)}M`
  if (abs >= 1e4) return `${trimFixed(n / 1e3, 1)}k`
  return Math.round(n).toLocaleString('en-US')
}

function formatMoneyAmount(amount: number, symbol: '¥' | '$', partial: boolean): string {
  const suffix = partial ? '+' : ''
  const abs = Math.abs(amount)
  const sign = amount < 0 ? '-' : ''
  if (abs === 0) return `${symbol}0.00${suffix}`
  if (abs >= 100) return `${sign}${symbol}${Math.round(abs).toLocaleString('en-US')}${suffix}`
  if (abs >= 1) return `${sign}${symbol}${abs.toFixed(2)}${suffix}`
  if (abs >= 0.001) return `${sign}${symbol}${abs.toFixed(3)}${suffix}`
  return `${sign}${symbol}${abs.toFixed(4)}${suffix}`
}

/** Formats USD cost in active display currency (CNY ¥ by default using live FX, fallback 7.2). */
export function fmtCost(
  usd: number | null | undefined,
  opts?: { partial?: boolean; format?: UsageCostFormat },
): string {
  if (usd == null || !Number.isFinite(usd)) return '—'
  const fmt = opts?.format ?? DEFAULT_COST_FORMAT
  const rate = fmt.usdToCny > 0 ? fmt.usdToCny : DEFAULT_USD_TO_CNY
  const isCny = fmt.currency === 'cny'
  return formatMoneyAmount(isCny ? usd * rate : usd, isCny ? '¥' : '$', opts?.partial ?? false)
}

/** Compact axis tick for cost series. */
export function fmtCostAxis(usd: number, format: UsageCostFormat = DEFAULT_COST_FORMAT): string {
  if (!Number.isFinite(usd) || usd === 0) return '0'
  const rate = format.usdToCny > 0 ? format.usdToCny : DEFAULT_USD_TO_CNY
  const isCny = format.currency === 'cny'
  const sym = isCny ? '¥' : '$'
  const v = isCny ? usd * rate : usd
  if (v >= 1000) return `${sym}${trimFixed(v / 1000, 1)}k`
  if (v >= 10) return `${sym}${Math.round(v)}`
  return `${sym}${trimFixed(v, 2)}`
}

/** Explicit USD cost formatting (used for dual currency readout in Run Inspector Drawer). */
export function fmtCostUsd(usd: number | null | undefined, partial = false): string {
  if (usd == null || !Number.isFinite(usd)) return '—'
  return formatMoneyAmount(usd, '$', partial)
}

/** Formats per-1M-token input/output unit prices in active currency. */
export function fmtUnitPrice(
  unit: UsageModelUnitPriceDto | null | undefined,
  format: UsageCostFormat = DEFAULT_COST_FORMAT,
): string {
  if (!unit) return '—'
  const rate = format.usdToCny > 0 ? format.usdToCny : DEFAULT_USD_TO_CNY
  const isCny = format.currency === 'cny'
  const sym = isCny ? '¥' : '$'
  const scale = isCny ? rate : 1
  const fmtNum = (n: number) => {
    const v = n * scale
    if (v === 0) return `${sym}0`
    if (v >= 100) return `${sym}${Math.round(v)}`
    if (v >= 1) return `${sym}${trimFixed(v, 1)}`
    return `${sym}${trimFixed(v, 2)}`
  }
  return `${fmtNum(unit.input)} / ${fmtNum(unit.output)}`
}

export function fmtUnitPriceDetail(
  unit: UsageModelUnitPriceDto,
  format: UsageCostFormat = DEFAULT_COST_FORMAT,
): string {
  const rate = format.usdToCny > 0 ? format.usdToCny : DEFAULT_USD_TO_CNY
  const isCny = format.currency === 'cny'
  const sym = isCny ? '¥' : '$'
  const scale = isCny ? rate : 1
  const f = (n: number) => `${sym}${trimFixed(n * scale, n * scale >= 10 ? 1 : 2)}`
  const parts = [t('输入 {p}', { p: f(unit.input) }), t('输出 {p}', { p: f(unit.output) })]
  if (unit.cacheRead > 0) parts.push(t('缓存读 {p}', { p: f(unit.cacheRead) }))
  if (unit.cacheWrite > 0) parts.push(t('缓存写 {p}', { p: f(unit.cacheWrite) }))
  return `${parts.join(' · ')} / 1M`
}

export function fmtCostSource(source: UsageCostSource | undefined): string {
  if (source === 'reported') return t('适配器上报')
  if (source === 'catalog') return t('models.dev 估算')
  if (source === 'unpriced') return t('未计价')
  return '—'
}

export function fmtModelSource(source: UsageModelSource | undefined): string {
  if (source === 'recorded') return t('运行上报')
  if (source === 'bot_default') return t('Bot 默认配置')
  if (source === 'machine_default') return t('主机默认配置')
  if (source === 'unknown') return t('未知#modelSource')
  return '—'
}

/** Wall-clock duration in ms -> human compact string. */
export function fmtDurationMs(ms: number | null | undefined): string {
  if (ms == null || !Number.isFinite(ms) || ms < 0) return '—'
  if (ms < 1000) return `${Math.round(ms)} ms`
  const sec = ms / 1000
  if (sec < 60) return t('{s} 秒', { s: trimFixed(sec, sec < 10 ? 1 : 0) })
  const totalMin = Math.floor(sec / 60)
  const remSec = Math.round(sec % 60)
  if (totalMin < 60) {
    return remSec > 0 ? t('{m} 分 {s} 秒', { m: totalMin, s: remSec }) : t('{m} 分', { m: totalMin })
  }
  const h = Math.floor(totalMin / 60)
  const remMin = totalMin % 60
  return remMin > 0 ? t('{h} 小时 {m} 分', { h, m: remMin }) : t('{h} 小时', { h })
}

/** Ratio in [0, 1] -> percentage string. */
export function fmtRate(ratio: number | null | undefined, digits = 1): string {
  if (ratio == null || !Number.isFinite(ratio)) return '—'
  const pct = ratio * 100
  if (pct === 0) return '0%'
  if (pct >= 99.95) return '100%'
  if (pct < 0.1) return '<0.1%'
  return `${trimFixed(pct, digits)}%`
}

/** Effective turn output throughput (outputTokens / wall-clock sec). */
export function fmtTps(tps: number | null | undefined): string {
  if (tps == null || !Number.isFinite(tps) || tps <= 0) return '—'
  return t('{n} token/秒', { n: tps >= 10 ? Math.round(tps) : trimFixed(tps, 1) })
}

/** Percentage delta between current and previous periods. */
export function fmtDelta(
  now: number,
  before: number | null | undefined,
): { label: string; dir: 'up' | 'down' | 'flat' } | null {
  if (before == null || before <= 0) return null
  const pct = Math.round(((now - before) / before) * 100)
  if (pct === 0) return { label: t('持平'), dir: 'flat' }
  return {
    label: `${pct > 0 ? '↑' : '↓'} ${Math.abs(pct)}%`,
    dir: pct > 0 ? 'up' : 'down',
  }
}

export function fmtShortTime(iso: string | null | undefined): string {
  if (!iso) return '—'
  const d = new Date(iso)
  if (Number.isNaN(d.getTime())) return '—'
  const now = new Date()
  const sameDay =
    d.getFullYear() === now.getFullYear() && d.getMonth() === now.getMonth() && d.getDate() === now.getDate()
  const hh = String(d.getHours()).padStart(2, '0')
  const mm = String(d.getMinutes()).padStart(2, '0')
  const ss = String(d.getSeconds()).padStart(2, '0')
  if (sameDay) return `${hh}:${mm}:${ss}`
  return `${d.getMonth() + 1}/${d.getDate()} ${hh}:${mm}`
}

export function fmtAgentKind(kind: string): string {
  const MAP: Record<string, string> = {
    claude: 'Claude Code',
    codex: 'Codex',
    gemini: 'Gemini',
    codebuddy: 'CodeBuddy',
    pi: 'Pi',
    deepseek: 'DeepSeek',
    antigravity: 'Antigravity',
    opencode: 'OpenCode',
    qwen: 'Qwen',
    kimi: 'Kimi',
    goose: 'Goose',
    copilot: 'Copilot',
  }
  return MAP[kind] ?? kind
}

export function fmtTriggerSource(src: string): string {
  const MAP: Record<string, string> = {
    web_group: t('群聊'),
    web_dm: t('私聊'),
    feishu: t('飞书'),
    schedule: t('定时任务'),
    webhook: 'Webhook',
    relay: t('接力'),
    continuation: t('续写'),
  }
  return MAP[src] ?? src
}

export function fmtToolKind(kind: string): string {
  const MAP: Record<string, string> = {
    read: t('读取'),
    edit: t('编辑'),
    delete: t('删除'),
    move: t('移动'),
    search: t('搜索'),
    execute: t('执行'),
    think: t('思考'),
    fetch: t('网络'),
    other: t('其他'),
  }
  return MAP[kind] ?? kind
}

export function fmtRunStatusLabel(
  status: string,
  cancelled: boolean,
): { label: string; tone: 'green' | 'red' | 'orange' | 'blue' | 'gray' } {
  if (cancelled) return { label: t('已取消'), tone: 'gray' }
  switch (status) {
    case 'completed':
      return { label: t('成功'), tone: 'green' }
    case 'interrupted':
    case 'expired':
    case 'forbidden':
      return { label: t('失败'), tone: 'red' }
    case 'running':
    case 'queued':
      return { label: t('进行中'), tone: 'blue' }
    case 'awaiting_approval':
    case 'awaiting_answer':
    case 'offline_wait':
      return { label: t('等待中'), tone: 'orange' }
    default:
      return { label: status, tone: 'gray' }
  }
}

export function fmtEntityLabel(key: string, name: string): string {
  if (key.startsWith('__default__:')) {
    if (name && name !== key) return name
    const agent = key.slice('__default__:'.length)
    return t('默认模型 · {agent}', { agent: fmtAgentKind(agent) })
  }
  if (key === '__default__' || !name) return t('默认 / 未上报')
  if (key === '__other__') return t('其他')
  return name
}
