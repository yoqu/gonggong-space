import { type CSSProperties, type ReactNode, useId } from 'react'
import { t } from '../i18n'
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
      aria-label={t('{n} 条未读', { n: props.count })}
    >
      {props.count > 99 ? '99+' : props.count}
    </span>
  )
}

const HAN = /[\u3400-\u9fff]/
const HAN_ALL = /[^\u3400-\u9fff]/g
const STATUS_TEXT = { online: t('在线'), busy: t('忙碌'), away: t('离开') }

/**
 * Chinese person name (2–3 characters) → last two characters; groups and longer Chinese names
 * (roles like 「系统管理员」) → first two; otherwise (incl. mixed names with a lone Chinese character such as
 * 「yoqu的 Codex」) first letters of the first two words.
 */
function initials(name: string, group: boolean) {
  const n = name.trim()
  const han = n.replace(HAN_ALL, '')
  if (HAN.test(n) && han.length >= 2) {
    return group || han.length > 3 ? han.slice(0, 2) : han.slice(-2)
  }
  const [first = '', second = ''] = n.split(/\s+/)
  return `${first.charAt(0)}${second.charAt(0)}`.toUpperCase()
}

function hash(s: string) {
  let x = 0
  for (let i = 0; i < s.length; i++) x = (x * 31 + s.charCodeAt(i)) >>> 0
  return x
}

const paletteColor = (name: string) => `var(--avatar-${(hash(name) % 6) + 1})`

/** One character per mosaic tile: a Chinese given name's last character, else the first letter. */
function tileChar(name: string) {
  const t = initials(name, false)
  return HAN.test(t) ? t.slice(-1) : t.charAt(0)
}

const INK = { fill: '#fff' }
const RING = { fill: 'none', stroke: '#fff', strokeWidth: 3 }
/** Soft white shapes on a 40×40 canvas, rotated per name; hidden in high-contrast themes. */
const PATTERNS = [
  <>
    <circle cx={34} cy={6} r={16} {...INK} opacity={0.16} />
    <circle cx={5} cy={37} r={8} {...INK} opacity={0.12} />
  </>,
  <g key="rings" opacity={0.14}>
    <circle cx={40} cy={40} r={12} {...RING} />
    <circle cx={40} cy={40} r={21} {...RING} />
    <circle cx={40} cy={40} r={30} {...RING} />
  </g>,
  <>
    <path d="M-4 26 26-4h9L-4 35z" {...INK} opacity={0.14} />
    <path d="M10 44 44 10v10L20 44z" {...INK} opacity={0.1} />
  </>,
  <>
    <path d="M0 40 40 14v26z" {...INK} opacity={0.14} />
    <path d="M0 0h22L0 24z" {...INK} opacity={0.1} />
  </>,
  <>
    <circle cx={20} cy={48} r={22} {...INK} opacity={0.14} />
    <circle cx={31} cy={10} r={4} {...INK} opacity={0.18} />
  </>,
]

type Box = [x: number, y: number, w: number, h: number]
const HALF = 19.25
const FAR = 40 - HALF
const MOSAIC: Record<number, Box[]> = {
  2: [
    [0, 0, HALF, 40],
    [FAR, 0, HALF, 40],
  ],
  3: [
    [0, 0, HALF, 40],
    [FAR, 0, HALF, HALF],
    [FAR, FAR, HALF, HALF],
  ],
  4: [
    [0, 0, HALF, HALF],
    [FAR, 0, HALF, HALF],
    [0, FAR, HALF, HALF],
    [FAR, FAR, HALF, HALF],
  ],
}

export interface AvatarTile {
  name: string
  /** Image (e.g. a bot's SVG data URI) shown instead of the generated tile. */
  src?: string
}

/** Palette fill, a name-seeded pattern and a light-to-shade sheen; or one tile per member (Feishu group style). */
function AvatarArt({ name, color, members }: { name: string; color?: string; members?: AvatarTile[] }) {
  const sheen = useId()
  const h = hash(name)
  const pattern = (h >>> 3) % PATTERNS.length
  const gloss = (x = 0, y = 0, w = 40, ht = 40) => (
    <rect x={x} y={y} width={w} height={ht} fill={`url(#${sheen})`} className="ui-avatar__deco" />
  )
  return (
    <svg
      className="ui-avatar__art"
      viewBox="0 0 40 40"
      aria-hidden="true"
      data-pattern={members ? undefined : pattern}
    >
      <defs>
        <linearGradient id={sheen} x1="0" y1="0" x2="1" y2="1">
          <stop offset="0" stopColor="#fff" stopOpacity={0.24} />
          <stop offset="0.55" stopColor="#fff" stopOpacity={0} />
          <stop offset="1" stopColor="#000" stopOpacity={0.14} />
        </linearGradient>
      </defs>
      {members ? (
        (MOSAIC[members.length] ?? []).map(([x, y, w, ht], i) => {
          const m = members[i] as AvatarTile
          return (
            <g key={`${x},${y}`} className="ui-avatar__tile">
              {m.src ? (
                <image href={m.src} x={x} y={y} width={w} height={ht} preserveAspectRatio="xMidYMid slice" />
              ) : (
                <>
                  <rect x={x} y={y} width={w} height={ht} style={{ fill: paletteColor(m.name) }} />
                  {gloss(x, y, w, ht)}
                  <text
                    x={x + w / 2}
                    y={y + ht / 2}
                    fontSize={Math.min(w, ht) * 0.5}
                    textAnchor="middle"
                    dominantBaseline="central"
                    fill="currentColor"
                  >
                    {tileChar(m.name)}
                  </text>
                </>
              )}
            </g>
          )
        })
      ) : (
        <>
          <rect width={40} height={40} style={{ fill: color ?? paletteColor(name) }} />
          <g className="ui-avatar__deco" transform={`rotate(${((h >>> 7) % 4) * 90} 20 20)`}>
            {PATTERNS[pattern]}
          </g>
          {gloss()}
        </>
      )}
    </svg>
  )
}

export interface AvatarProps {
  name: string
  src?: string
  size?: number
  status?: keyof typeof STATUS_TEXT
  /** `square` for groups, bots and apps. */
  shape?: 'circle' | 'square'
  color?: string
  /** Group members; two or more (first four used) tile a mosaic instead of initials. */
  members?: AvatarTile[]
  className?: string
  style?: CSSProperties
}

/**
 * Status dot ring takes `--pn-ring` from the parent (default content-bg); set it to the surface behind.
 */
export function Avatar({
  name,
  src,
  size = 32,
  status,
  shape = 'circle',
  color,
  members,
  className,
  style,
}: AvatarProps) {
  const text = initials(name, shape === 'square')
  const tiles = !src && members && members.length > 1 ? members.slice(0, 4) : undefined
  return (
    <span
      className={cx('ui-avatar', shape === 'square' && 'ui-avatar--square', className)}
      title={name}
      role="img"
      aria-label={status ? `${name}（${STATUS_TEXT[status]}）` : name}
      style={{
        width: size,
        height: size,
        fontSize: Math.round(size * (text.length > 1 && HAN.test(text) ? 0.34 : 0.4)),
        ...style,
      }}
    >
      {src ? (
        <img src={src} alt="" />
      ) : (
        <>
          <AvatarArt name={name} color={color} members={tiles} />
          {tiles ? null : <span className="ui-avatar__text">{text}</span>}
        </>
      )}
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
    return <SpinnerGlyph role="progressbar" label={aria['aria-label'] ?? t('正在载入')} style={style} />
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
  return <SpinnerGlyph role="status" label={t('正在载入')} style={{ width: size, height: size, color }} />
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
  /** Long values (model names, versions) take the row's room instead of the 160px cap. */
  wideValue?: boolean
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
  wideValue,
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
          {value != null ? (
            <span className={cx('ui-group__value', wideValue && 'ui-group__value--wide')}>{value}</span>
          ) : null}
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
              <span style={{ fontSize: 'var(--text-callout-size)', fontWeight: 700, lineHeight: 1 }}>!</span>
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
        {description ? (
          <p className="ui-alert__desc">
            {variant === 'error' && !title && !children ? (
              <Icon name="warning" size={12} className="ui-alert__desc-icon" />
            ) : null}
            {description}
          </p>
        ) : null}
        {children}
      </div>
    </div>
  )
}
