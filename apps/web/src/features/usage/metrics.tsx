import type { ReactNode } from 'react'
import { t } from '../../i18n'
import { Button, EmptyState, NoDataArt } from '../../ui'
import { fmtDelta, isSmallSample } from './formatters'
import './usage.css'

/** Change against a prior window of `days` days; a small prior window shows its raw value (see `isSmallSample`). */
export function Delta({ now, before, days }: { now: number; before: number; days: number }) {
  if (isSmallSample(before))
    return <span className="usage-stat__delta">{t('前 {n} 天：{v}', { n: days, v: before })}</span>
  return (
    <span className="usage-stat__delta">
      <span>{fmtDelta(now, before)?.label}</span>
      <span>{t('较前 {n} 天', { n: days })}</span>
    </span>
  )
}

const EMPTY_TITLE = {
  runs: [t('当前时间范围内没有运行记录'), t('当前筛选条件下没有运行记录')],
  sessions: [t('当前时间范围内没有会话记录'), t('当前筛选条件下没有会话记录')],
} as const

/** An empty usage view: with filters on it says so and offers 清除筛选; otherwise the time range had nothing. */
export function UsageEmpty({
  what,
  onClearFilters,
}: {
  what: keyof typeof EMPTY_TITLE
  onClearFilters?: () => void
}) {
  return (
    <EmptyState
      compact
      illustration={<NoDataArt />}
      title={EMPTY_TITLE[what][onClearFilters ? 1 : 0]}
      action={onClearFilters ? <Button onClick={onClearFilters}>{t('清除筛选')}</Button> : undefined}
    />
  )
}

/** Share percentage: non-zero slices under 1% render as `<1%` instead of `0%`. */
export function sharePct(value: number, total: number) {
  if (!total || value <= 0) return '0%'
  const p = (value / total) * 100
  return p < 1 ? '<1%' : `${Math.round(p)}%`
}

export interface SharePart {
  key: string
  name: string
  value: number
  color?: string
  display?: ReactNode
}

/** Stacked distribution bar + legend card shared by Usage and Conversation Stats. */
export function ShareCard({
  title,
  meta,
  barLabel,
  legendLabel,
  parts,
  total,
}: {
  title: string
  meta: string
  barLabel: string
  legendLabel: string
  parts: SharePart[]
  total: number
}) {
  return (
    <section className="usage-card">
      <div className="usage-card__head">
        <span className="usage-card__title">{title}</span>
        <span className="usage-card__meta">{meta}</span>
      </div>
      <div className="usage-share" role="img" aria-label={barLabel}>
        {parts.map((p) => (
          <span key={p.key} style={{ flexGrow: p.value, background: p.color }} />
        ))}
      </div>
      <ul className="usage-legend" aria-label={legendLabel}>
        {parts.map((p) => (
          <li key={p.key}>
            <span className="usage-legend__swatch" style={{ background: p.color }} aria-hidden="true" />
            <span className="usage-legend__name">{p.name}</span>
            <span className="usage-legend__value">{p.display ?? p.value}</span>
            <span className="usage-legend__pct">{sharePct(p.value, total)}</span>
          </li>
        ))}
      </ul>
    </section>
  )
}

/** Parses `YYYY-MM-DD` into `{ label: 'M月D日', tick: 'M/D' }` for TrendChart points. */
export function dayLabel(day: string) {
  const [m, d] = day.split('-').slice(1).map(Number) as [number, number]
  return { label: t('{m}月{d}日', { m, d }), tick: `${m}/${d}` }
}

/** Highest-value point in a TrendChart series. */
export function peakOf(points: { label: string; value: number }[]) {
  return points.reduce((a, b) => (b.value > a.value ? b : a), points[0] ?? { label: '', value: 0 })
}
