import { Check } from 'lucide-react'
import type { ReactNode } from 'react'
import { cx } from '../lib/cx'

export type BadgeVariant =
  | 'default'
  | 'secondary'
  | 'outline'
  | 'info'
  | 'success'
  | 'warning'
  | 'destructive'

export function Badge({
  variant = 'default',
  size = 'sm',
  children,
}: {
  variant?: BadgeVariant
  size?: 'xs' | 'sm'
  children: ReactNode
}) {
  return <span className={cx('ui-badge', `ui-badge--${variant}`, `ui-badge--${size}`)}>{children}</span>
}

export function Avatar({ name, size = 28 }: { name: string; size?: number }) {
  return (
    <span
      className="ui-avatar"
      title={name}
      style={{ width: size, height: size, fontSize: Math.round(size * 0.43) }}
    >
      {Array.from(name)[0] ?? ''}
    </span>
  )
}

const PROGRESS_COLOR = {
  default: 'var(--color-system-blue)',
  success: 'var(--color-success)',
  warning: 'var(--color-brand-warm)',
  danger: 'var(--color-danger)',
}
const PROGRESS_HEIGHT = { sm: 4, md: 8 }

export function Progress({
  value,
  max = 100,
  variant = 'default',
  size = 'md',
}: {
  value: number
  max?: number
  variant?: keyof typeof PROGRESS_COLOR
  size?: keyof typeof PROGRESS_HEIGHT
}) {
  const pct = Math.min(100, Math.max(0, (value / max) * 100))
  return (
    <div
      className="ui-progress"
      role="progressbar"
      aria-valuenow={Math.round(pct)}
      aria-valuemin={0}
      aria-valuemax={100}
      style={{ height: PROGRESS_HEIGHT[size] }}
    >
      <div className="ui-progress__bar" style={{ width: `${pct}%`, background: PROGRESS_COLOR[variant] }} />
    </div>
  )
}

export function Spinner({ size = 14, color = 'var(--color-text-muted)' }: { size?: number; color?: string }) {
  return <span className="ui-spinner" role="status" style={{ width: size, height: size, color }} />
}

export type StepStatus = 'completed' | 'active' | 'pending' | 'error'

export function StepIndicator({ steps }: { steps: { label: string; status: StepStatus }[] }) {
  return (
    <ol className="ui-steps">
      {steps.map((s) => (
        <li key={s.label} className="ui-step" data-status={s.status}>
          <span className="ui-step__mark">
            {s.status === 'active' ? (
              <Spinner size={14} color="currentColor" />
            ) : s.status === 'completed' ? (
              <Check size={14} strokeWidth={2.5} />
            ) : s.status === 'error' ? (
              <span style={{ fontSize: 12, fontWeight: 700, lineHeight: 1 }}>!</span>
            ) : (
              <span className="ui-step__dot" />
            )}
          </span>
          <span className="ui-step__label">{s.label}</span>
        </li>
      ))}
    </ol>
  )
}

export function Alert({
  variant = 'info',
  title,
  description,
  icon,
  children,
}: {
  variant?: 'info' | 'success' | 'warning' | 'error'
  title?: ReactNode
  description?: ReactNode
  icon?: ReactNode
  children?: ReactNode
}) {
  return (
    <div role="alert" className={cx('ui-alert', `ui-alert--${variant}`)}>
      {icon ? <span className="ui-alert__icon">{icon}</span> : null}
      <div className="ui-alert__body">
        {title ? <h5 className="ui-alert__title">{title}</h5> : null}
        {description ? <p className="ui-alert__desc">{description}</p> : null}
        {children}
      </div>
    </div>
  )
}

export function EmptyState({
  icon,
  illustration,
  title,
  description,
  actions,
  bare,
}: {
  icon?: ReactNode
  /** Image src of a decorative illustration, shown at up to 160px. */
  illustration?: string
  title?: ReactNode
  description?: ReactNode
  actions?: ReactNode
  bare?: boolean
}) {
  return (
    <div className={cx('ui-empty', bare && 'ui-empty--bare')}>
      {illustration ? (
        <img className="ui-empty__art" src={illustration} alt="" width={160} height={160} />
      ) : null}
      {icon ? <div className="ui-empty__icon">{icon}</div> : null}
      {title ? <div className="ui-empty__title">{title}</div> : null}
      {description ? <div className="ui-empty__desc">{description}</div> : null}
      {actions ? <div className="ui-empty__actions">{actions}</div> : null}
    </div>
  )
}
