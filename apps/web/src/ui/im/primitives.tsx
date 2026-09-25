import type { ButtonHTMLAttributes, CSSProperties, ReactElement, ReactNode } from 'react'
import { cx } from '../../lib/cx'
import { Icon, type IconName } from '../icon'
import './primitives.css'

// Private Pane primitives so ui/im does not depend on the concurrent W1a/W1b rebuild; dedupe once those land.

export type IconLike = IconName | ReactElement
export const renderIcon = (icon: IconLike) => (typeof icon === 'string' ? <Icon name={icon} /> : icon)

export type TagTone = 'blue' | 'green' | 'orange' | 'red' | 'purple' | 'gray' | 'solid-red'
export interface TagSpec {
  label: string
  tone: TagTone
}

export function Tag({
  tone = 'gray',
  icon,
  children,
}: {
  tone?: TagTone
  icon?: IconLike
  children?: ReactNode
}) {
  return (
    <span className={cx('im-tag', `im-tag--${tone}`)}>
      {icon && renderIcon(icon)}
      {children}
    </span>
  )
}

export const Tags = ({ items }: { items?: TagSpec[] }) =>
  items?.map((t) => (
    <Tag key={t.label} tone={t.tone}>
      {t.label}
    </Tag>
  ))

export function Badge({ count, muted }: { count: number; muted?: boolean }) {
  if (!count) return null
  return (
    <span className={cx('im-badge', muted && 'im-badge--muted')} role="img" aria-label={`${count} 条未读`}>
      {count > 99 ? '99+' : count}
    </span>
  )
}

export type Presence = 'online' | 'busy' | 'away'
const PRESENCE: Record<Presence, string> = { online: '在线', busy: '忙碌', away: '离开' }

export interface AvatarProps {
  name: string
  src?: string
  size?: number
  status?: Presence
  shape?: 'circle' | 'square'
  color?: string
}

const HAN = /[㐀-鿿]/

function hashIndex(str: string, n: number) {
  let x = 0
  for (let i = 0; i < str.length; i++) x = (x * 31 + str.charCodeAt(i)) >>> 0
  return x % n
}

/** Chinese person → last two chars, group → first two, Latin → initials. */
export function initials(name: string, group: boolean) {
  const s = name.trim()
  if (!s) return ''
  if (HAN.test(s)) {
    const han = s.replace(/[^㐀-鿿]/g, '')
    return group ? han.slice(0, 2) : han.slice(-2)
  }
  const [a = '', b = ''] = s.split(/\s+/)
  return (a.charAt(0) + b.charAt(0)).toUpperCase()
}

export function Avatar({ name, src, size = 32, status, shape = 'circle', color }: AvatarProps) {
  const txt = initials(name, shape === 'square')
  const style: CSSProperties = {
    width: size,
    height: size,
    background: src ? 'var(--control-track)' : (color ?? `var(--avatar-${hashIndex(name, 6) + 1})`),
    fontSize: Math.round(size * (txt.length > 1 && HAN.test(txt) ? 0.34 : 0.4)),
  }
  return (
    <span
      className={cx('im-avatar', shape === 'square' && 'im-avatar--square')}
      title={name}
      role="img"
      aria-label={status ? `${name}（${PRESENCE[status]}）` : name}
      style={style}
    >
      {src ? <img src={src} alt="" /> : txt}
      {status && <span className={`im-avatar__status im-avatar__status--${status}`} />}
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
    <span className="im-avatars">
      {people.slice(0, max).map((p) => (
        <Avatar key={p.name} size={size} {...p} />
      ))}
      {people.length > max && <span className="im-avatars__more">+{people.length - max}</span>}
    </span>
  )
}

export type ButtonVariant = 'default' | 'primary' | 'destructive' | 'glass' | 'plain'

export function Button({
  variant = 'default',
  size = 'regular',
  icon,
  className,
  children,
  ...rest
}: ButtonHTMLAttributes<HTMLButtonElement> & {
  variant?: ButtonVariant
  size?: 'small' | 'regular'
  icon?: IconLike
}) {
  return (
    <button
      type="button"
      {...rest}
      className={cx(
        'im-btn',
        variant !== 'default' && `im-btn--${variant}`,
        size === 'small' && 'im-btn--small',
        icon != null && children == null && 'im-btn--icon',
        className,
      )}
    >
      {icon != null && renderIcon(icon)}
      {children}
    </button>
  )
}

export function Spinner({ label = '正在载入' }: { label?: string }) {
  return (
    <svg className="im-spinner" viewBox="0 0 16 16" role="progressbar" aria-label={label}>
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

export function ProgressBar({ value, label }: { value: number; label: string }) {
  return (
    <div
      className="im-progress"
      role="progressbar"
      aria-valuemin={0}
      aria-valuemax={100}
      aria-valuenow={value}
      aria-label={label}
    >
      <div className="im-progress__bar" style={{ width: `${value}%` }} />
    </div>
  )
}

/** Glass capsule of toolbar buttons (Pane ToolbarGroup/ToolbarButton). */
export function GlassGroup({ children }: { children: ReactNode }) {
  return <div className="im-glassgroup">{children}</div>
}

export function GlassButton({
  icon,
  label,
  active,
  onClick,
}: {
  icon: IconLike
  label: string
  active?: boolean
  onClick?: () => void
}) {
  return (
    <button
      type="button"
      className="im-glassgroup__btn"
      aria-label={label}
      title={label}
      aria-pressed={active}
      onClick={onClick}
    >
      {renderIcon(icon)}
    </button>
  )
}

export function CloseButton({ label, onClick }: { label: string; onClick: () => void }) {
  return (
    <button type="button" className="im-close" aria-label={label} onClick={onClick}>
      <Icon name="xmark" weight={2.2} />
    </button>
  )
}
