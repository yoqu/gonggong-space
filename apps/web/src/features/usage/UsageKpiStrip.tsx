import type { CSSProperties, ReactNode } from 'react'
import { cx } from '../../lib/cx'
import { RollingNumber } from '../../ui'

export interface UsageKpiCell {
  key: string
  label: string
  value: string
  /** Optional tone for primary value (e.g. green cost). */
  tone?: 'default' | 'green' | 'orange' | 'red'
  /** Optional secondary inline suffix next to primary value (e.g. "905 次计时"). */
  inlineMeta?: string
  /** Optional thin composite scaleX progress bar ratio in [0, 1]. */
  progress?: {
    ratio: number
    tone?: 'green' | 'blue' | 'orange'
    label?: string
  }
  /** Sub-metric lines below primary figure. */
  sub?: ReactNode
  /** Prior-period delta tag. */
  delta?: { label: string; dir: 'up' | 'down' | 'flat' } | null
}

/**
 * Magpie-inspired unified single-frame KPI strip with hairline dividers.
 * Keeps balanced grid columns across desktop (4-6 cols), tablet (2-3 cols), and mobile (2 cols, no orphan gaps).
 */
export function UsageKpiStrip({
  cells,
  stale = false,
  'aria-label': ariaLabel,
}: {
  cells: UsageKpiCell[]
  stale?: boolean
  'aria-label'?: string
}) {
  const count = Math.max(1, cells.length)
  return (
    <section
      className={cx('usage-kpi-strip', stale && 'usage-stale')}
      data-cols={count}
      aria-label={ariaLabel}
      data-testid="usage-kpi-strip"
      style={{ '--kpi-cols': count } as CSSProperties}
    >
      {cells.map((cell, i) => (
        <div
          key={cell.key}
          className="usage-kpi-cell"
          style={{ '--i': i } as CSSProperties}
          data-testid={`usage-kpi-${cell.key}`}
        >
          <div className="usage-kpi-cell__head">
            <span className="usage-kpi-cell__label">{cell.label}</span>
            {cell.delta ? (
              <span className={cx('usage-kpi-cell__delta', `usage-kpi-cell__delta--${cell.delta.dir}`)}>
                {cell.delta.label}
              </span>
            ) : null}
          </div>
          <div className="usage-kpi-cell__value-row">
            <span className={cx('usage-kpi-cell__value', cell.tone && `usage-tone--${cell.tone}`)}>
              <RollingNumber value={cell.value} />
            </span>
            {cell.inlineMeta ? <span className="usage-kpi-cell__inline">{cell.inlineMeta}</span> : null}
          </div>
          {cell.progress ? (
            <div
              className="usage-kpi-cell__bar"
              role="progressbar"
              aria-valuemin={0}
              aria-valuemax={100}
              aria-valuenow={Math.round(cell.progress.ratio * 100)}
              aria-label={cell.progress.label ?? cell.label}
            >
              <span
                className={cx(
                  'usage-kpi-cell__bar-fill',
                  cell.progress.tone && `usage-kpi-cell__bar-fill--${cell.progress.tone}`,
                )}
                style={{ transform: `scaleX(${Math.max(0, Math.min(1, cell.progress.ratio))})` }}
              />
            </div>
          ) : null}
          {cell.sub ? <div className="usage-kpi-cell__sub">{cell.sub}</div> : null}
        </div>
      ))}
    </section>
  )
}
