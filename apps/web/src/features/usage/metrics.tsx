import type { ReactNode } from 'react'
import { t } from '../../i18n'
import './usage.css'

/** Percentage change against a prior window of `days` days. */
export function Delta({ now, before, days }: { now: number; before: number; days: number }) {
  if (!before) return null
  const pct = Math.round(((now - before) / before) * 100)
  return (
    <span className="usage-stat__delta">
      <span>{pct ? `${pct > 0 ? '↑' : '↓'} ${Math.abs(pct)}%` : t('持平')}</span>
      <span>{t('较前 {n} 天', { n: days })}</span>
    </span>
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
