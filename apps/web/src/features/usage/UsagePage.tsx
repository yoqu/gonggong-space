import type { UsageDayDto, UsageRowDto } from '@gonggong/protocol'
import { useEffect, useState } from 'react'
import { t } from '../../i18n'
import { fmtTokens } from '../../lib/format'
import { browserTimeZone } from '../../lib/time'
import { useGet } from '../../lib/useGet'
import {
  Alert,
  Dialog,
  EmptyState,
  NoDataArt,
  RollingNumber,
  SegmentedControl,
  Spinner,
  Table,
  Tabs,
} from '../../ui'
import { Sparkline, TrendChart } from '../../ui/chart'
import { AdminPage } from '../admin/AdminPage'
import { Delta, dayLabel, peakOf, ShareCard, sharePct } from './metrics'
import { UsageWorkspace } from './UsageWorkspace'

type By = 'bot' | 'user' | 'group'
type Metric = 'totalTokens' | 'runs' | 'unreported'

const TABS: { value: By; label: string }[] = [
  { value: 'bot', label: t('按 Bot') },
  { value: 'user', label: t('按触发人') },
  { value: 'group', label: t('按群') },
]
export const WINDOW = 30

/** GET /api/usage; `rows` stays null while loading. */
export function useUsage(query: string) {
  const { data: rows, error } = useGet<UsageRowDto[]>(`/usage?${query}`)
  return { rows, error }
}

function Bar({ value, max, color = 'var(--system-blue)' }: { value: number; max: number; color?: string }) {
  const ratio = max > 0 ? Math.max(0.02, Math.min(1, value / max)) : 0
  return (
    <span className="usage-bar" aria-hidden="true">
      {value > 0 ? <span style={{ transform: `scaleX(${ratio})`, background: color }} /> : null}
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
          <span className="usage-bars__value">{r.totalTokens ? fmtTokens(r.totalTokens) : t('未上报')}</span>
        </div>
      ))}
    </div>
  )
}

const COUNT: Record<By, (n: number) => string> = {
  bot: (n) => t('{n} 个 Bot', { n }),
  user: (n) => t('{n} 位触发人', { n }),
  group: (n) => t('{n} 个群', { n }),
}
const NAME_COLUMN: Record<By, string> = { bot: 'Bot', user: t('触发人'), group: t('群') }
/** Categorical order keeps neighbours apart in hue; a sixth entity folds into 其他. */
const PALETTE = [
  'var(--system-indigo)',
  'var(--system-cyan)',
  'var(--system-teal)',
  'var(--system-orange)',
  'var(--system-pink)',
]
const OTHER = 'var(--system-gray)'

/** Top token users get the palette in order; the table bars and the share bar use the same map. */
function colorsFor(rows: UsageRowDto[]) {
  const top = [...rows].filter((r) => r.totalTokens).sort((a, b) => b.totalTokens - a.totalTokens)
  return new Map(top.slice(0, PALETTE.length).map((r, i) => [r.key, PALETTE[i] as string]))
}

const sumOf = (xs: { [k in Metric]: number }[], k: Metric) => xs.reduce((n, x) => n + x[k], 0)

function Stats({ rows, by, daily }: { rows: UsageRowDto[]; by: By; daily: UsageDayDto[] | null }) {
  const tiles: { label: string; value: string; metric?: Metric }[] = [
    { label: t('token 合计'), value: fmtTokens(sumOf(rows, 'totalTokens')), metric: 'totalTokens' },
    { label: t('运行轮次'), value: String(sumOf(rows, 'runs')), metric: 'runs' },
    { label: t('未上报轮次'), value: String(sumOf(rows, 'unreported')), metric: 'unreported' },
    { label: t('参与统计'), value: COUNT[by](rows.length) },
  ]
  return (
    <div className="usage-stats">
      {tiles.map((tile) => (
        <div key={tile.label} className="usage-stat">
          <span className="usage-stat__label">{tile.label}</span>
          <div className="usage-stat__body">
            <span className="usage-stat__value">
              <RollingNumber value={tile.value} />
            </span>
            {daily && tile.metric ? (
              <Sparkline values={daily.slice(-WINDOW).map((d) => d[tile.metric as Metric])} />
            ) : null}
          </div>
          {daily && tile.metric ? (
            <Delta
              now={sumOf(daily.slice(-WINDOW), tile.metric)}
              before={sumOf(daily.slice(0, -WINDOW), tile.metric)}
              days={WINDOW}
            />
          ) : null}
        </div>
      ))}
    </div>
  )
}

/** Daily columns for the last 30 days; token or run count. */
export function Trend({ daily }: { daily: UsageDayDto[] }) {
  const [metric, setMetric] = useState<'totalTokens' | 'runs'>('totalTokens')
  const days = daily.slice(-WINDOW)
  const tokens = metric === 'totalTokens'
  const fmt = (n: number) => (tokens ? `${fmtTokens(n)} tokens` : t('{n} 轮', { n }))
  const points = days.map((d) => {
    const { label, tick } = dayLabel(d.day)
    const lines = [`${fmtTokens(d.totalTokens)} tokens`, t('{n} 轮', { n: d.runs })]
    return {
      label,
      tick,
      value: d[metric],
      lines: [
        ...(tokens ? lines : lines.reverse()),
        ...(d.unreported ? [t('{n} 轮未上报', { n: d.unreported })] : []),
      ],
    }
  })
  const peak = peakOf(points)
  const summary =
    t(tokens ? '近 {n} 天每日 token：合计 {total}' : '近 {n} 天每日运行轮次：合计 {total}', {
      n: WINDOW,
      total: fmt(sumOf(days, metric)),
    }) + (peak.value ? t('，峰值 {day} {value}', { day: peak.label, value: fmt(peak.value) }) : '')
  return (
    <section className="usage-card">
      <div className="usage-card__head">
        <span className="usage-card__title">{t('每日趋势')}</span>
        <SegmentedControl
          size="small"
          aria-label={t('趋势指标')}
          value={metric}
          onChange={setMetric}
          items={[
            { value: 'totalTokens', label: 'token' },
            { value: 'runs', label: t('轮次') },
          ]}
        />
      </div>
      <TrendChart points={points} format={tokens ? fmtTokens : String} aria-label={summary} />
    </section>
  )
}

/** Token share of the top five, the rest folded into 其他. */
function Share({ rows, colors }: { rows: UsageRowDto[]; colors: Map<string, string> }) {
  const total = sumOf(rows, 'totalTokens')
  if (!total) return null
  const shown = rows.filter((r) => colors.has(r.key)).sort((a, b) => b.totalTokens - a.totalTokens)
  const rest = total - sumOf(shown, 'totalTokens')
  const parts = [
    ...shown.map((r) => ({
      key: r.key,
      name: r.name,
      value: r.totalTokens,
      color: colors.get(r.key),
      display: fmtTokens(r.totalTokens),
    })),
    ...(rest ? [{ key: '', name: t('其他'), value: rest, color: OTHER, display: fmtTokens(rest) }] : []),
  ]
  return (
    <ShareCard
      title={t('token 分布')}
      meta={t('合计 {total} tokens', { total: fmtTokens(total) })}
      barLabel={t('token 分布：{parts}', {
        parts: parts.map((p) => `${p.name} ${sharePct(p.value, total)}`).join(t('，')),
      })}
      legendLabel={t('token 分布图例')}
      parts={parts}
      total={total}
    />
  )
}

/**
 * Compact 30-day usage panel used by TeamSettings and AccountMenu ("我的用量").
 * Preserves the legacy `/usage` & `/usage/daily` contract while avoiding table spinner collapse on tab switch.
 */
export function UsagePanel({ base = '/usage', teamId = '' }: { base?: string; teamId?: string }) {
  const [by, setBy] = useState<By>('bot')
  const scope = `${base}|${teamId}`
  const team = teamId ? `&teamId=${teamId}` : ''
  const {
    data: rows,
    error,
    loading,
    reload,
  } = useGet<UsageRowDto[]>(`${base}?by=${by}&days=${WINDOW}${team}`)
  // Keep previous rows of the same scope while switching `by` so Stats/Trend/Share/Table never collapse and flash.
  const [cached, setCached] = useState<{ scope: string; by: By; rows: UsageRowDto[] } | null>(null)
  useEffect(() => {
    if (rows !== null) setCached({ scope, by, rows })
  }, [scope, by, rows])
  const visible = rows ?? (cached?.scope === scope ? cached.rows : null)
  const visibleBy = rows !== null ? by : cached?.scope === scope ? cached.by : by
  const daily = useGet<UsageDayDto[]>(
    `${base}/daily?days=${WINDOW * 2}&tz=${encodeURIComponent(browserTimeZone)}${team}`,
  )
  const hasDaily = !!daily.data?.some((d) => d.runs > 0 || d.totalTokens > 0)
  const max = Math.max(1, ...(visible ?? []).map((r) => r.totalTokens))
  const colors = colorsFor(visible ?? [])
  const stale = rows === null && visible !== null
  return (
    <>
      <Tabs value={by} onChange={setBy} items={TABS} />
      {error || daily.error ? (
        <Alert
          variant="error"
          description={error || daily.error}
          retrying={loading || daily.loading}
          onRetry={() => {
            reload()
            daily.reload()
          }}
        />
      ) : null}
      {visible?.length ? <Stats rows={visible} by={visibleBy} daily={daily.data} /> : null}
      {daily.data && (hasDaily || visible?.length) ? <Trend daily={daily.data} /> : null}
      {visible?.length ? <Share rows={visible} colors={colors} /> : null}
      {visible === null ? (
        error ? null : (
          <Spinner size={18} />
        )
      ) : visible.length ? (
        <div className={stale ? 'usage-stale' : undefined}>
          <Table<UsageRowDto & { id: string }>
            aria-label={t('用量明细')}
            rows={visible.map((r) => ({ ...r, id: r.key }))}
            multiple={false}
            defaultSort={{ key: 'totalTokens', dir: 'desc' }}
            columns={[
              { key: 'name', title: NAME_COLUMN[visibleBy], sortable: true },
              {
                key: 'share',
                title: t('占比'),
                width: 140,
                render: (r) => <Bar value={r.totalTokens} max={max} color={colors.get(r.key) ?? OTHER} />,
              },
              {
                key: 'totalTokens',
                title: 'token',
                width: 96,
                align: 'right',
                sortable: true,
                render: (r) => (r.totalTokens ? fmtTokens(r.totalTokens) : t('未上报')),
              },
              { key: 'runs', title: t('轮次'), width: 64, align: 'right', sortable: true },
              {
                key: 'unreported',
                title: t('未上报'),
                width: 72,
                align: 'right',
                secondary: true,
                sortable: true,
              },
            ]}
          />
        </div>
      ) : (
        <EmptyState compact illustration={<NoDataArt />} title={t('近 30 天没有运行')} />
      )}
      <p className="usage-note">
        {t('近 30 天 · 不做配额限制 · Codex 适配器未上报的轮次计为「未上报」，不计入 token 合计。')}
      </p>
    </>
  )
}

/** 管理后台 · AI 用量: full layered analytics workspace (概览 / 运行明细 / 会话洞察). */
export function UsagePage() {
  return (
    <AdminPage title={t('用量')} desc={t('全平台 AI 运行 Token、费用、耗时与会话行为分析。')}>
      <UsageWorkspace base="/admin/usage" showTeamFilter />
    </AdminPage>
  )
}

/** 我的用量 from the account menu: my bots only. */
export function UsageDialog({ onClose }: { onClose: () => void }) {
  return (
    <Dialog open title={t('我的用量')} subtitle={t('我的 Bot 近 30 天用量')} width={600} onClose={onClose}>
      <UsagePanel />
    </Dialog>
  )
}
