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

/** Real USD cost formatting; appends `+` when some runs in the scope omitted costUsd. */
export function fmtCostUsd(usd: number | null | undefined, partial = false): string {
  if (usd == null || !Number.isFinite(usd)) return '—'
  const suffix = partial ? '+' : ''
  if (usd === 0) return `$0.00${suffix}`
  if (usd < 0.001) return `<$0.001${suffix}`
  if (usd < 0.1) return `$${usd.toFixed(3)}${suffix}`
  if (usd < 100) return `$${usd.toFixed(2)}${suffix}`
  return `$${usd.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}${suffix}`
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
  if (key === '__default__' || !name) return t('默认 / 未上报')
  if (key === '__other__') return t('其他')
  return name
}
