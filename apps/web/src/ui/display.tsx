import type { CSSProperties, ReactNode } from 'react'
import { cx } from '../lib/cx'
import { type Glyph, renderGlyph } from './controls'
import { Icon } from './icon'
import './display.css'

export type TagTone = 'blue' | 'green' | 'orange' | 'red' | 'purple' | 'gray' | 'solid-red'

/** Identity and status label. Tones: orange external, blue bot, green official, purple everyone, gray department, solid-red urgent only. */
export function Tag({
  tone = 'gray',
  icon,
  className,
  children,
}: {
  tone?: TagTone
  icon?: Glyph
  className?: string
  children?: ReactNode
}) {
  return (
    <span className={cx('ui-tag', `ui-tag--${tone}`, className)}>
      {icon ? renderGlyph(icon) : null}
      {children}
    </span>
  )
}

/** Pre-Pane label badge variants; such badges now render as a Tag. */
export type BadgeVariant =
  | 'default'
  | 'secondary'
  | 'outline'
  | 'info'
  | 'success'
  | 'warning'
  | 'destructive'

const BADGE_TONE: Record<BadgeVariant, TagTone> = {
  default: 'blue',
  secondary: 'gray',
  outline: 'gray',
  info: 'blue',
  success: 'green',
  warning: 'orange',
  destructive: 'red',
}

export type BadgeProps =
  | { count: number; muted?: boolean }
  | { variant?: BadgeVariant; size?: 'xs' | 'sm'; children: ReactNode }

/** Unread count (`count`, capped at 99+, hidden at 0); with children it is a pre-Pane label badge. */
export function Badge(props: BadgeProps) {
  if (!('count' in props)) return <Tag tone={BADGE_TONE[props.variant ?? 'default']}>{props.children}</Tag>
  if (!props.count) return null
  return (
    <span
      className={cx('ui-badge', props.muted && 'ui-badge--muted')}
      role="img"
      aria-label={`${props.count} 条未读`}
    >
      {props.count > 99 ? '99+' : props.count}
    </span>
  )
}

const HAN = /[\u3400-\u9fff]/
const HAN_ALL = /[^\u3400-\u9fff]/g
const STATUS_TEXT = { online: '在线', busy: '忙碌', away: '离开' }

/** Chinese person → last two characters, group → first two; otherwise first letters of the first two words. */
function initials(name: string, group: boolean) {
  const n = name.trim()
  if (HAN.test(n)) {
    const han = n.replace(HAN_ALL, '')
    return group ? han.slice(0, 2) : han.slice(-2)
  }
  const [first = '', second = ''] = n.split(/\s+/)
  return `${first.charAt(0)}${second.charAt(0)}`.toUpperCase()
}

function hashIndex(s: string, n: number) {
  let x = 0
  for (let i = 0; i < s.length; i++) x = (x * 31 + s.charCodeAt(i)) >>> 0
  return x % n
}

export interface AvatarProps {
  name: string
  src?: string
  size?: number
  status?: keyof typeof STATUS_TEXT
  /** `square` for groups, bots and apps. */
  shape?: 'circle' | 'square'
  color?: string
  className?: string
  style?: CSSProperties
}

/**
 * Status dot ring takes `--pn-ring` from the parent (default content-bg); set it to the surface behind.
 * Initials follow Pane exactly (「系统管理员」→「理员」); pass `src` or `color` for role-like names.
 */
export function Avatar({
  name,
  src,
  size = 32,
  status,
  shape = 'circle',
  color,
  className,
  style,
}: AvatarProps) {
  const text = initials(name, shape === 'square')
  const bg = color ?? `var(--avatar-${hashIndex(name, 6) + 1})`
  return (
    <span
      className={cx('ui-avatar', shape === 'square' && 'ui-avatar--square', className)}
      title={name}
      role="img"
      aria-label={status ? `${name}（${STATUS_TEXT[status]}）` : name}
      style={{
        width: size,
        height: size,
        background: src ? 'var(--control-track)' : bg,
        fontSize: Math.round(size * (text.length > 1 && HAN.test(text) ? 0.34 : 0.4)),
        ...style,
      }}
    >
      {src ? <img src={src} alt="" /> : text}
      {status ? <span className={`ui-avatar__status ui-avatar__status--${status}`} /> : null}
    </span>
  )
}

export function AvatarGroup({
  people,
  size = 20,
  max = 3,
}: {
  people: AvatarProps[]
  size?: number
  max?: number
}) {
  return (
    <span className="ui-avatars">
      {people.slice(0, max).map((p) => (
        <Avatar key={p.name} size={size} {...p} />
      ))}
      {people.length > max ? <span className="ui-avatars__more">+{people.length - max}</span> : null}
    </span>
  )
}

function SpinnerGlyph({
  role,
  label,
  style,
}: {
  role: 'progressbar' | 'status'
  label: string
  style?: CSSProperties
}) {
  return (
    <svg className="ui-spinner" viewBox="0 0 16 16" role={role} aria-label={label} style={style}>
      {[0, 1, 2, 3, 4, 5, 6, 7].map((i) => (
        <rect
          key={i}
          x={7.1}
          y={1}
          width={1.8}
          height={4.2}
          rx={0.9}
          fill="currentColor"
          opacity={0.25 + i * 0.1}
          transform={`rotate(${i * 45} 8 8)`}
        />
      ))}
    </svg>
  )
}

export interface ProgressIndicatorProps {
  /** 0–100; omit for indeterminate. */
  value?: number
  variant?: 'bar' | 'spinner'
  className?: string
  style?: CSSProperties
  'aria-label'?: string
}

export function ProgressIndicator({
  value,
  variant = 'bar',
  className,
  style,
  ...aria
}: ProgressIndicatorProps) {
  if (variant === 'spinner')
    return <SpinnerGlyph role="progressbar" label={aria['aria-label'] ?? '正在载入'} style={style} />
  return (
    <div
      className={cx('ui-progress', value == null && 'ui-progress--indeterminate', className)}
      style={style}
      role="progressbar"
      aria-valuemin={0}
      aria-valuemax={100}
      aria-valuenow={value}
      aria-label={aria['aria-label']}
    >
      <div className="ui-progress__bar" style={value == null ? undefined : { width: `${value}%` }} />
    </div>
  )
}

const PROGRESS_COLOR = {
  default: 'var(--accent)',
  success: 'var(--system-green)',
  warning: 'var(--system-orange)',
  danger: 'var(--system-red)',
}
const PROGRESS_HEIGHT = { sm: 4, md: 6 }

/** Pre-Pane full-width determinate bar with a status color. */
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
  return (
    <ProgressIndicator
      value={Math.round(Math.min(100, Math.max(0, (value / max) * 100)))}
      style={
        {
          width: '100%',
          height: PROGRESS_HEIGHT[size],
          '--ui-progress-fill': PROGRESS_COLOR[variant],
        } as CSSProperties
      }
    />
  )
}

/** Inline wait indicator announced as a live status. */
export function Spinner({ size = 16, color }: { size?: number; color?: string }) {
  return <SpinnerGlyph role="status" label="正在载入" style={{ width: size, height: size, color }} />
}

export function GroupBox({
  children,
  className,
  style,
}: {
  children?: ReactNode
  className?: string
  style?: CSSProperties
}) {
  return (
    <div className={cx('ui-group', className)} style={style}>
      {children}
    </div>
  )
}

export interface GroupRowProps {
  label: ReactNode
  description?: ReactNode
  /** Trailing `label-secondary` text, e.g. the current choice of a drill-in row. */
  value?: ReactNode
  chevron?: boolean
  /** Makes the whole row a button with a trailing chevron. */
  onClick?: () => void
  /** Centered red label; put it in a GroupBox of its own. */
  destructive?: boolean
  className?: string
  children?: ReactNode
}

/** Settings row: label (and optional description) on the left, the control or value on the right. */
export function GroupRow({
  label,
  description,
  value,
  chevron,
  onClick,
  destructive,
  className,
  children,
}: GroupRowProps) {
  const trail = value != null || chevron || onClick
  const inner = (
    <>
      <div className="ui-group__text">
        <div className={destructive ? 'ui-group__danger' : undefined}>{label}</div>
        {description ? <div className="ui-group__desc">{description}</div> : null}
      </div>
      {trail ? (
        <div className="ui-group__trail">
          {children}
          {value != null ? <span className="ui-group__value">{value}</span> : null}
          {(chevron || onClick) && !destructive ? <Icon name="chevron-right" weight={1.8} /> : null}
        </div>
      ) : (
        children
      )}
    </>
  )
  return onClick ? (
    <button
      type="button"
      className={cx(
        'ui-group__row',
        'ui-group__row--button',
        destructive && 'ui-group__row--danger',
        className,
      )}
      onClick={onClick}
    >
      {inner}
    </button>
  ) : (
    <div className={cx('ui-group__row', className)}>{inner}</div>
  )
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
              <Icon name="check" size={14} weight={2.2} />
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

/** Inline notice on tinted fill (forms, pages). Pane's modal Alert is `AlertPanel` / `AlertDialog` in ./overlay. */
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
