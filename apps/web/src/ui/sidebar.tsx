import { type CSSProperties, type ReactNode, useState } from 'react'
import { t } from '../i18n'
import { cx } from '../lib/cx'
import { useControlled } from './controlled'
import { type Glyph, renderGlyph } from './controls'
import { Icon } from './icon'
import { selectFollowsFocus } from './nav-rail'
import './sidebar.css'

export interface SidebarItem {
  id: string
  label: ReactNode
  icon?: Glyph
  /** A `var(--system-*)` color for the icon (or the tile); accent by default. */
  color?: string
  badge?: ReactNode
  /** Nested rows, indented 14px per level. */
  children?: SidebarItem[]
}

export interface SidebarSection {
  /** Key for `defaultCollapsed`; the title is used when absent. */
  id?: string
  title?: ReactNode
  /** The title toggles the section. */
  collapsible?: boolean
  items: SidebarItem[]
}

export interface SidebarProps {
  sections: SidebarSection[]
  selected?: string
  defaultSelected?: string
  onSelect?: (id: string) => void
  /** Section ids or titles shown collapsed. */
  defaultCollapsed?: string[]
  /** Item ids shown expanded. */
  defaultExpanded?: string[]
  /** `tile`: white glyph on a 22px color block (settings-style windows). */
  iconStyle?: 'glyph' | 'tile'
  className?: string
  style?: CSSProperties
  'aria-label'?: string
}

const toggle = (list: string[], key: string) =>
  list.includes(key) ? list.filter((k) => k !== key) : [...list, key]

const contains = (items: SidebarItem[], id: string | undefined): boolean =>
  items.some((it) => it.id === id || contains(it.children ?? [], id))

/**
 * Pane Sidebar: flush, colored icons, selected row as a fill. One tab stop; ↑↓ move and select across sections,
 * Home/End jump, → expands and ← collapses a nested row.
 */
export function Sidebar({
  sections,
  selected,
  defaultSelected,
  onSelect,
  defaultCollapsed = [],
  defaultExpanded = [],
  iconStyle = 'glyph',
  className,
  style,
  'aria-label': label = t('侧栏'),
}: SidebarProps) {
  const [current, setCurrent] = useControlled(selected, defaultSelected)
  const [collapsed, setCollapsed] = useState(defaultCollapsed)
  const [expanded, setExpanded] = useState(defaultExpanded)
  const all = sections.flatMap((s) => s.items)
  const stop = contains(all, current) ? current : all[0]?.id

  const rows = (items: SidebarItem[], level: number, tree: boolean): ReactNode[] =>
    items.flatMap((it) => {
      const kids = it.children?.length ? it.children : undefined
      const open = expanded.includes(it.id)
      const row = (
        <button
          key={it.id}
          type="button"
          className="ui-sidebar__item"
          aria-current={current === it.id ? 'page' : undefined}
          aria-expanded={kids ? open : undefined}
          tabIndex={it.id === stop ? 0 : -1}
          style={level > 1 ? { paddingLeft: 8 + (level - 1) * 14 } : undefined}
          onClick={() => {
            setCurrent(it.id)
            onSelect?.(it.id)
          }}
          onKeyDown={(e) => {
            if (!kids || (e.key === 'ArrowRight') === open || !['ArrowRight', 'ArrowLeft'].includes(e.key))
              return
            e.preventDefault()
            setExpanded(toggle(expanded, it.id))
          }}
        >
          {kids ? (
            <span
              className="ui-sidebar__disc"
              data-open={open || undefined}
              aria-hidden="true"
              onClick={(e) => {
                e.stopPropagation()
                setExpanded(toggle(expanded, it.id))
              }}
            >
              <Icon name="chevron-right" size={10} weight={2} />
            </span>
          ) : tree ? (
            <span className="ui-sidebar__disc" aria-hidden="true" />
          ) : null}
          {it.icon ? (
            <span
              className={cx('ui-sidebar__icon', iconStyle === 'tile' && 'ui-sidebar__icon--tile')}
              style={
                iconStyle === 'tile'
                  ? { background: it.color ?? 'var(--accent-fill)' }
                  : ({ '--icon-color': it.color } as CSSProperties)
              }
            >
              {renderGlyph(it.icon)}
            </span>
          ) : null}
          <span className="ui-sidebar__label">{it.label}</span>
          {it.badge != null ? <span className="ui-sidebar__badge">{it.badge}</span> : null}
        </button>
      )
      return kids && open ? [row, ...rows(kids, level + 1, tree)] : [row]
    })

  return (
    <nav
      className={cx('ui-sidebar', className)}
      style={style}
      aria-label={label}
      onKeyDown={(e) => selectFollowsFocus(e, '.ui-sidebar__item')}
    >
      {sections.map((sec, i) => {
        const key = sec.id ?? (typeof sec.title === 'string' ? sec.title : String(i))
        const isCollapsed = collapsed.includes(key)
        const tree = sec.items.some((it) => it.children?.length)
        return (
          // biome-ignore lint/suspicious/noArrayIndexKey: sections are a fixed, ordered list
          <div key={i} className="ui-sidebar__section">
            {sec.title && sec.collapsible ? (
              <button
                type="button"
                className="ui-sidebar__title ui-sidebar__title--toggle"
                aria-expanded={!isCollapsed}
                onClick={() => setCollapsed(toggle(collapsed, key))}
              >
                {sec.title}
                <span className="ui-sidebar__chev" aria-hidden="true">
                  <Icon name="chevron-right" size={10} weight={2} />
                </span>
              </button>
            ) : sec.title ? (
              <div className="ui-sidebar__title">{sec.title}</div>
            ) : null}
            {isCollapsed ? null : rows(sec.items, 1, tree)}
          </div>
        )
      })}
    </nav>
  )
}
