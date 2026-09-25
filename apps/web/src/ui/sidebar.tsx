import { type CSSProperties, type ReactNode, useState } from 'react'
import { cx } from '../lib/cx'
import { Icon, type IconName } from './icon'
import './sidebar.css'

export interface SidebarItem {
  id: string
  label: ReactNode
  icon?: IconName
  /** A `var(--system-*)` color for the icon; accent by default. */
  color?: string
  badge?: ReactNode
}

export interface SidebarProps {
  sections: { title?: ReactNode; items: SidebarItem[] }[]
  selected?: string
  defaultSelected?: string
  onSelect?: (id: string) => void
  className?: string
  style?: CSSProperties
  'aria-label'?: string
}

/** Pane sidebar: flush with the window edge, no shadow, colored icons, selected row as a fill. */
export function Sidebar({
  sections,
  selected,
  defaultSelected,
  onSelect,
  className,
  style,
  'aria-label': label = '侧栏',
}: SidebarProps) {
  const [own, setOwn] = useState(defaultSelected)
  const current = selected ?? own
  return (
    <nav className={cx('ui-sidebar', className)} style={style} aria-label={label}>
      {sections.map((sec, i) => (
        // biome-ignore lint/suspicious/noArrayIndexKey: sections are a fixed, ordered list
        <div key={i} className="ui-sidebar__section">
          {sec.title ? <div className="ui-sidebar__title">{sec.title}</div> : null}
          {sec.items.map((it) => (
            <button
              key={it.id}
              type="button"
              className="ui-sidebar__item"
              aria-current={current === it.id ? 'page' : undefined}
              onClick={() => {
                setOwn(it.id)
                onSelect?.(it.id)
              }}
            >
              {it.icon ? (
                <span className="ui-sidebar__icon" style={{ '--icon-color': it.color } as CSSProperties}>
                  <Icon name={it.icon} />
                </span>
              ) : null}
              <span className="ui-sidebar__label">{it.label}</span>
              {it.badge != null ? <span className="ui-sidebar__badge">{it.badge}</span> : null}
            </button>
          ))}
        </div>
      ))}
    </nav>
  )
}
