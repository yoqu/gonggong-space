import type { UsageDayDto, UsageRowDto } from '@gonggong/protocol'
import { useEffect, useState } from 'react'
import { api } from '../../lib/api'
import { Alert, Dialog, EmptyState, NoDataArt, SegmentedControl, Spinner, Table, Tabs } from '../../ui'
import { Sparkline, TrendChart } from '../../ui/chart'
import { AdminPage } from '../admin/AdminPage'
import { errorText } from '../auth/AuthCard'
import './usage.css'

type By = 'bot' | 'user' | 'group'
type Metric = 'totalTokens' | 'runs' | 'unreported'

const TABS: { value: By; label: string }[] = [
  { value: 'bot', label: '按 Bot' },
  { value: 'user', label: '按触发人' },
  { value: 'group', label: '按群' },
]
export const WINDOW = 30
export const TZ = Intl.DateTimeFormat().resolvedOptions().timeZone

export const fmtTokens = (n: number) =>
  n >= 999_500 ? `${+(n / 1e6).toFixed(1)}M` : n >= 1000 ? `${Math.round(n / 1000)}k` : String(n)

/** GET `path`; `data` stays null while loading. */
export function useGet<T>(path: string) {
  const [data, setData] = useState<T | null>(null)
  const [error, setError] = useState('')
  useEffect(() => {
    setData(null)
    setError('')
    api
      .get<T>(path)
      .then(setData)
      .catch((e) => setError(errorText(e)))
  }, [path])
  return { data, error }
}

/** GET /api/usage; `rows` stays null while loading. */
export function useUsage(query: string) {
  const { data: rows, error } = useGet<UsageRowDto[]>(`/usage?${query}`)
  return { rows, error }
}

function Bar({ value, max, color = 'var(--system-blue)' }: { value: number; max: number; color?: string }) {
  return (
    <span className="usage-bar" aria-hidden="true">
      <span style={{ width: `${(value / max) * 100}%`, background: color }} />
    </span>
  )
}

/** Compact bars scaled to the largest token total (Bot detail); unreported-only rows show 未上报. */
export function UsageBars({ rows }: { rows: UsageRowDto[] }) {
  const max = Math.max(1, ...rows.map((r) => r.totalTokens))
  return (
    <div className="usage-bars">
      {rows.map((r) => (
        <div key={r.key} className="usage-bars__row" data-testid="usage-row">
          <span className="usage-bars__name">{r.name}</span>
          <Bar value={r.totalTokens} max={max} />
          <span className="usage-bars__value">{r.totalTokens ? fmtTokens(r.totalTokens) : '未上报'}</span>
        </div>
      ))}
    </div>
  )
}

const UNIT: Record<By, string> = { bot: '个 Bot', user: '位触发人', group: '个群' }
const NAME_COLUMN: Record<By, string> = { bot: 'Bot', user: '触发人', group: '群' }
/** Categorical order keeps neighbours apart in hue; a sixth entity folds into 其他. */
const PALETTE = [
  'var(--system-blue)',
  'var(--system-orange)',
  'var(--system-indigo)',
  'var(--system-teal)',
  'var(--system-pink)',
]
const OTHER = 'var(--system-gray)'

/** Top token users get the palette in order; the table bars and the share bar use the same map. */
function colorsFor(rows: UsageRowDto[]) {
  const top = [...rows].filter((r) => r.totalTokens).sort((a, b) => b.totalTokens - a.totalTokens)
  return new Map(top.slice(0, PALETTE.length).map((r, i) => [r.key, PALETTE[i] as string]))
}

const sumOf = (xs: { [k in Metric]: number }[], k: Metric) => xs.reduce((n, x) => n + x[k], 0)

function Delta({ daily, metric }: { daily: UsageDayDto[]; metric: Metric }) {
  const prev = sumOf(daily.slice(0, -WINDOW), metric)
  if (!prev) return null
  const pct = Math.round(((sumOf(daily.slice(-WINDOW), metric) - prev) / prev) * 100)
  return (
    <span className="usage-stat__delta">
      <span>{pct ? `${pct > 0 ? '↑' : '↓'} ${Math.abs(pct)}%` : '持平'}</span>
      <span>较前 {WINDOW} 天</span>
    </span>
  )
}

function Stats({ rows, by, daily }: { rows: UsageRowDto[]; by: By; daily: UsageDayDto[] | null }) {
  const tiles: { label: string; value: string; metric?: Metric }[] = [
    { label: 'token 合计', value: fmtTokens(sumOf(rows, 'totalTokens')), metric: 'totalTokens' },
    { label: '运行轮次', value: String(sumOf(rows, 'runs')), metric: 'runs' },
    { label: '未上报轮次', value: String(sumOf(rows, 'unreported')), metric: 'unreported' },
    { label: '参与统计', value: `${rows.length} ${UNIT[by]}` },
  ]
  return (
    <div className="usage-stats">
      {tiles.map((t) => (
        <div key={t.label} className="usage-stat">
          <span className="usage-stat__label">{t.label}</span>
          <div className="usage-stat__body">
            <span className="usage-stat__value">{t.value}</span>
            {daily && t.metric ? (
              <Sparkline values={daily.slice(-WINDOW).map((d) => d[t.metric as Metric])} />
            ) : null}
          </div>
          {daily && t.metric ? <Delta daily={daily} metric={t.metric} /> : null}
        </div>
      ))}
    </div>
  )
}

const dayParts = (day: string) => day.split('-').slice(1).map(Number) as [number, number]

/** Daily columns for the last 30 days; token or run count. */
export function Trend({ daily }: { daily: UsageDayDto[] }) {
  const [metric, setMetric] = useState<'totalTokens' | 'runs'>('totalTokens')
  const days = daily.slice(-WINDOW)
  const tokens = metric === 'totalTokens'
  const fmt = (n: number) => (tokens ? `${fmtTokens(n)} tokens` : `${n} 轮`)
  const points = days.map((d) => {
    const [m, dd] = dayParts(d.day)
    const lines = [`${fmtTokens(d.totalTokens)} tokens`, `${d.runs} 轮`]
    return {
      label: `${m}月${dd}日`,
      tick: `${m}/${dd}`,
      value: d[metric],
      lines: [...(tokens ? lines : lines.reverse()), ...(d.unreported ? [`${d.unreported} 轮未上报`] : [])],
    }
  })
  const peak = points.reduce((a, b) => (b.value > a.value ? b : a), points[0] ?? { label: '', value: 0 })
  const summary = `近 ${WINDOW} 天每日${tokens ? ' token' : '运行轮次'}：合计 ${fmt(sumOf(days, metric))}${
    peak.value ? `，峰值 ${peak.label} ${fmt(peak.value)}` : ''
  }`
  return (
    <section className="usage-card">
      <div className="usage-card__head">
        <span className="usage-card__title">每日趋势</span>
        <SegmentedControl
          size="small"
          aria-label="趋势指标"
          value={metric}
          onChange={setMetric}
          items={[
            { value: 'totalTokens', label: 'token' },
            { value: 'runs', label: '轮次' },
          ]}
        />
      </div>
      <TrendChart points={points} format={tokens ? fmtTokens : String} aria-label={summary} />
    </section>
  )
}

const pctOf = (v: number, total: number) => {
  const p = (v / total) * 100
  return p < 1 ? '<1%' : `${Math.round(p)}%`
}

/** Token share of the top five, the rest folded into 其他. */
function Share({ rows, colors }: { rows: UsageRowDto[]; colors: Map<string, string> }) {
  const total = sumOf(rows, 'totalTokens')
  if (!total) return null
  const shown = rows.filter((r) => colors.has(r.key)).sort((a, b) => b.totalTokens - a.totalTokens)
  const rest = total - sumOf(shown, 'totalTokens')
  const parts = [
    ...shown.map((r) => ({ key: r.key, name: r.name, value: r.totalTokens, color: colors.get(r.key) })),
    ...(rest ? [{ key: '', name: '其他', value: rest, color: OTHER }] : []),
  ]
  return (
    <section className="usage-card">
      <div className="usage-card__head">
        <span className="usage-card__title">token 分布</span>
        <span className="usage-card__meta">合计 {fmtTokens(total)} tokens</span>
      </div>
      <div
        className="usage-share"
        role="img"
        aria-label={`token 分布：${parts.map((p) => `${p.name} ${pctOf(p.value, total)}`).join('，')}`}
      >
        {parts.map((p) => (
          <span key={p.key} style={{ flexGrow: p.value, background: p.color }} />
        ))}
      </div>
      <ul className="usage-legend" aria-label="token 分布图例">
        {parts.map((p) => (
          <li key={p.key}>
            <span className="usage-legend__swatch" style={{ background: p.color }} aria-hidden="true" />
            <span className="usage-legend__name">{p.name}</span>
            <span className="usage-legend__value">{fmtTokens(p.value)}</span>
            <span className="usage-legend__pct">{pctOf(p.value, total)}</span>
          </li>
        ))}
      </ul>
    </section>
  )
}

/** Last 30 days by bot, trigger user or group; the server scopes members to their own bots (spec §3.7). */
function UsagePanel() {
  const [by, setBy] = useState<By>('bot')
  const { rows, error } = useUsage(`by=${by}&days=${WINDOW}`)
  // Twice the window so the tiles can compare against the prior period.
  const daily = useGet<UsageDayDto[]>(`/usage/daily?days=${WINDOW * 2}&tz=${encodeURIComponent(TZ)}`)
  const max = Math.max(1, ...(rows ?? []).map((r) => r.totalTokens))
  const colors = colorsFor(rows ?? [])
  return (
    <>
      <Tabs value={by} onChange={setBy} items={TABS} />
      {error || daily.error ? <Alert variant="error" description={error || daily.error} /> : null}
      {rows?.length ? (
        <>
          <Stats rows={rows} by={by} daily={daily.data} />
          {daily.data ? <Trend daily={daily.data} /> : null}
          <Share rows={rows} colors={colors} />
        </>
      ) : null}
      {rows === null ? (
        error ? null : (
          <Spinner size={18} />
        )
      ) : rows.length ? (
        <Table<UsageRowDto & { id: string }>
          aria-label="用量明细"
          rows={rows.map((r) => ({ ...r, id: r.key }))}
          multiple={false}
          defaultSort={{ key: 'totalTokens', dir: 'desc' }}
          columns={[
            { key: 'name', title: NAME_COLUMN[by], sortable: true },
            {
              key: 'share',
              title: '占比',
              width: 140,
              render: (r) => <Bar value={r.totalTokens} max={max} color={colors.get(r.key) ?? OTHER} />,
            },
            {
              key: 'totalTokens',
              title: 'token',
              width: 96,
              align: 'right',
              sortable: true,
              render: (r) => (r.totalTokens ? fmtTokens(r.totalTokens) : '未上报'),
            },
            { key: 'runs', title: '轮次', width: 64, align: 'right', sortable: true },
            {
              key: 'unreported',
              title: '未上报',
              width: 72,
              align: 'right',
              secondary: true,
              sortable: true,
            },
          ]}
        />
      ) : (
        <EmptyState compact illustration={<NoDataArt />} title="近 30 天没有运行" />
      )}
      <p className="usage-note">
        近 30 天 · 不做配额限制 · Codex 适配器未上报的轮次计为「未上报」，不计入 token 合计。
      </p>
    </>
  )
}

/** 管理后台 · 用量: every bot in the system. */
export function UsagePage() {
  return (
    <AdminPage title="用量" desc="按 Bot、触发人、群汇总 token 用量。">
      <UsagePanel />
    </AdminPage>
  )
}

/** 我的用量 from the account menu: my bots only. */
export function UsageDialog({ onClose }: { onClose: () => void }) {
  return (
    <Dialog open title="我的用量" subtitle="我的 Bot 近 30 天用量" width={600} onClose={onClose}>
      <UsagePanel />
    </Dialog>
  )
}
