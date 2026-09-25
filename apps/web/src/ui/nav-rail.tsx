import type { CSSProperties, KeyboardEvent } from 'react'
import { cx } from '../lib/cx'
import { useControlled } from './controlled'
import { type Glyph, renderGlyph } from './controls'
import { Avatar, type AvatarProps, Badge } from './display'
import './nav-rail.css'

export interface NavRailItem {
  id: string
  /** Two or three characters. */
  label: string
  icon: Glyph
  badge?: number
  muted?: boolean
  /** New content without a count. */
  dot?: boolean
}

export interface NavRailProps {
  /** 4–7 modules. */
  items: NavRailItem[]
  /** Pinned to the bottom, e.g. settings. */
  footer?: NavRailItem[]
  avatar?: AvatarProps
  selected?: string
  defaultSelected?: string
  onSelect?: (id: string) => void
  className?: string
  style?: CSSProperties
  'aria-label'?: string
}

const KEYS = ['ArrowDown', 'ArrowUp', 'Home', 'End']

/** Moves focus among `selector` inside the list with ↑↓ Home End and selects by clicking the new row. */
export function selectFollowsFocus(e: KeyboardEvent<HTMLElement>, selector: string) {
  if (!KEYS.includes(e.key)) return
  const rows = [...e.currentTarget.querySelectorAll<HTMLElement>(selector)].filter(
    (el) => !(el as HTMLButtonElement).disabled,
  )
  if (!rows.length) return
  const at = rows.indexOf(document.activeElement as HTMLElement)
  const next =
    e.key === 'Home'
      ? 0
      : e.key === 'End'
        ? rows.length - 1
        : Math.max(0, Math.min(rows.length - 1, at + (e.key === 'ArrowDown' ? 1 : -1)))
  e.preventDefault()
  rows[next]?.focus()
  rows[next]?.click()
}

/** Pane NavRail: app module column at the window's left edge; one tab stop, ↑↓ switch modules. */
export function NavRail({
  items,
  footer,
  avatar,
  selected,
  defaultSelected,
  onSelect,
  className,
  style,
  'aria-label': label = '应用导航',
}: NavRailProps) {
  const [current, setCurrent] = useControlled(selected, defaultSelected ?? items[0]?.id)
  const all = [...items, ...(footer ?? [])]
  const stop = all.some((it) => it.id === current) ? current : all[0]?.id
  const item = (it: NavRailItem) => {
    const on = current === it.id
    return (
      <button
        key={it.id}
        type="button"
        className="ui-rail__item"
        aria-current={on ? 'page' : undefined}
        title={it.label}
        tabIndex={it.id === stop ? 0 : -1}
        onClick={() => {
          setCurrent(it.id)
          onSelect?.(it.id)
        }}
      >
        <span className="ui-rail__tile">
          {renderGlyph(it.icon)}
          {it.badge ? (
            <span className="ui-rail__badge">
              <Badge count={it.badge} muted={it.muted} />
            </span>
          ) : it.dot ? (
            <span className="ui-rail__dot" role="img" aria-label="有新内容" />
          ) : null}
        </span>
        <span className="ui-rail__label">{it.label}</span>
      </button>
    )
  }
  return (
    <nav
      className={cx('ui-rail', className)}
      style={style}
      aria-label={label}
      onKeyDown={(e) => selectFollowsFocus(e, '.ui-rail__item')}
    >
      {avatar ? (
        <div className="ui-rail__me">
          <Avatar size={32} {...avatar} />
        </div>
      ) : null}
      <div className="ui-rail__items">{items.map(item)}</div>
      {footer ? <div className="ui-rail__items ui-rail__footer">{footer.map(item)}</div> : null}
    </nav>
  )
}
