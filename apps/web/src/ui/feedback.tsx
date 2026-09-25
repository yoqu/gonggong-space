import type { CSSProperties, ReactNode } from 'react'
import { cx } from '../lib/cx'
import { type Glyph, renderGlyph } from './controls'
import './feedback.css'

export interface EmptyStateProps {
  /** Say what the state is:「选择一个会话」「没有找到“季度复盘”」. */
  title: ReactNode
  description?: ReactNode
  /** Shown in a 64px circle; defaults to a message icon, `false` removes it. */
  icon?: Glyph | ReactNode | false
  /** Decorative SVG from ./illustrations, replacing the icon circle. */
  illustration?: ReactNode
  action?: ReactNode
  /** @deprecated use `action` */
  actions?: ReactNode
  compact?: boolean
  /** @deprecated Pane empty states never draw a card; kept so pre-Pane callers compile. */
  bare?: boolean
  className?: string
  style?: CSSProperties
}

/** Placeholder for an empty list or panel: icon, title, one sentence and up to two actions. */
export function EmptyState({
  title,
  description,
  icon = 'message',
  illustration,
  action,
  actions,
  compact,
  className,
  style,
}: EmptyStateProps) {
  const act = action ?? actions
  return (
    <div className={cx('ui-empty', compact && 'ui-empty--compact', className)} style={style}>
      {illustration ? (
        <div className="ui-empty__art">{illustration}</div>
      ) : icon !== false ? (
        <span className="ui-empty__icon" aria-hidden="true">
          {typeof icon === 'string' ? renderGlyph(icon as Glyph) : icon}
        </span>
      ) : null}
      <div className="ui-empty__title">{title}</div>
      {description ? <div className="ui-empty__desc">{description}</div> : null}
      {act ? <div className="ui-empty__action">{act}</div> : null}
    </div>
  )
}

const WIDTHS = [72, 48, 86, 60, 78]

/** Loading placeholder shaped like the content it replaces; the shimmer stops under reduced motion. */
export function Skeleton({
  variant = 'text',
  count = 3,
  width = '100%',
  height = 120,
  label = '正在载入',
  className,
  style,
}: {
  variant?: 'text' | 'conversation' | 'message' | 'block'
  count?: number
  width?: number | string
  height?: number | string
  label?: string
  className?: string
  style?: CSSProperties
}) {
  const rows = Array.from({ length: count }, (_, i) => {
    const w = WIDTHS[i % WIDTHS.length] as number
    if (variant === 'conversation')
      return (
        // biome-ignore lint/suspicious/noArrayIndexKey: placeholder rows are positional
        <div key={i} className="ui-skel__conv">
          <i className="ui-skel ui-skel--circle" style={{ width: 40, height: 40 }} />
          <span className="ui-skel__lines">
            <i className="ui-skel" style={{ width: `${w - 20}%` }} />
            <i className="ui-skel" style={{ width: `${w}%` }} />
          </span>
        </div>
      )
    if (variant === 'message') {
      const self = i % 3 === 2
      return (
        // biome-ignore lint/suspicious/noArrayIndexKey: placeholder rows are positional
        <div key={i} className={cx('ui-skel__msg', self && 'ui-skel__msg--self')}>
          <i className="ui-skel ui-skel--circle" style={{ width: 32, height: 32 }} />
          <span className="ui-skel__lines">
            {self ? null : <i className="ui-skel" style={{ width: 64, height: 10 }} />}
            <i className="ui-skel ui-skel--bubble" style={{ width: w * 3 }} />
          </span>
        </div>
      )
    }
    const style = variant === 'block' ? { width, height } : { width: i === count - 1 ? '60%' : '100%' }
    // biome-ignore lint/suspicious/noArrayIndexKey: placeholder rows are positional
    return <i key={i} className={cx('ui-skel', variant === 'block' && 'ui-skel--block')} style={style} />
  })
  return (
    <div
      className={cx('ui-skeleton', `ui-skeleton--${variant}`, className)}
      style={style}
      role="status"
      aria-busy="true"
      aria-label={label}
    >
      {rows}
    </div>
  )
}

/** Key caps in press order, e.g. `keys={['⌘', '⇧', 'N']}`; menus write shortcuts as plain symbols instead. */
export function Kbd({ keys, children }: { keys?: string[]; children?: ReactNode }) {
  return (
    <span className="ui-kbds">
      {(keys ?? [children]).map((k, i) => (
        // biome-ignore lint/suspicious/noArrayIndexKey: keys may repeat and are positional
        <kbd key={i} className="ui-kbd">
          {k}
        </kbd>
      ))}
    </span>
  )
}
