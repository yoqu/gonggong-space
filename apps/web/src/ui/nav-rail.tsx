import type { CSSProperties, KeyboardEvent, ReactNode } from 'react'
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
  /** Pinned below the footer items, e.g. the account menu trigger. */
  trailing?: ReactNode
  /** `horizontal` lays the rail out as a bottom tab bar (narrow windows); ←→ then switch modules. */
  orientation?: 'vertical' | 'horizontal'
  selected?: string
  defaultSelected?: string
  onSelect?: (id: string) => void
  className?: string
  style?: CSSProperties
  'aria-label'?: string
}

const PREV = { vertical: 'ArrowUp', horizontal: 'ArrowLeft' }
const NEXT = { vertical: 'ArrowDown', horizontal: 'ArrowRight' }

/** Moves focus among `selector` inside the list with ↑↓ (←→ when horizontal) Home End and selects by clicking the new row. */
export function selectFollowsFocus(
  e: KeyboardEvent<HTMLElement>,
  selector: string,
  orientation: 'vertical' | 'horizontal' = 'vertical',
) {
  const prev = PREV[orientation]
  const fwd = NEXT[orientation]
  if (![prev, fwd, 'Home', 'End'].includes(e.key)) return
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
        : Math.max(0, Math.min(rows.length - 1, at + (e.key === fwd ? 1 : -1)))
  e.preventDefault()
  rows[next]?.focus()
  rows[next]?.click()
}

/** Pane NavRail: app module column at the window's left edge; one tab stop, ↑↓ switch modules. */
export function NavRail({
  items,
  footer,
  avatar,
  trailing,
  orientation = 'vertical',
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
        aria-label={
          it.badge ? `${it.label}（${it.badge} 条未读）` : it.dot ? `${it.label}（有新内容）` : it.label
        }
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
      className={cx('ui-rail', orientation === 'horizontal' && 'ui-rail--bar', className)}
      style={style}
      aria-label={label}
      onKeyDown={(e) => selectFollowsFocus(e, '.ui-rail__item', orientation)}
    >
      {avatar ? (
        <div className="ui-rail__me">
          <Avatar size={32} {...avatar} />
        </div>
      ) : null}
      <div className="ui-rail__items">{items.map(item)}</div>
      {footer ? <div className="ui-rail__items ui-rail__footer">{footer.map(item)}</div> : null}
      {trailing ? (
        <div className={cx('ui-rail__trailing', !footer && 'ui-rail__footer')}>{trailing}</div>
      ) : null}
    </nav>
  )
}
