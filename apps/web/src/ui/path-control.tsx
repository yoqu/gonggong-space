import { type CSSProperties, Fragment, type ReactNode } from 'react'
import { t } from '../i18n'
import { cx } from '../lib/cx'
import { type Glyph, renderGlyph } from './controls'
import { Icon } from './icon'
import { MenuButton } from './menu'
import './path-control.css'

export interface PathItem {
  id: string
  label: ReactNode
  icon?: Glyph
  color?: string
}

/** NSPathControl: root → current, every level clickable; middle levels fold into a「…」menu beyond `maxItems`. */
export function PathControl({
  items,
  onSelect,
  maxItems = 5,
  className,
  style,
  'aria-label': ariaLabel = t('路径'),
}: {
  items: PathItem[]
  onSelect?: (id: string) => void
  maxItems?: number
  className?: string
  style?: CSSProperties
  'aria-label'?: string
}) {
  const tail = maxItems - 2
  const folded = items.length > maxItems
  const hidden = folded ? items.slice(1, items.length - tail) : []
  const shown: (PathItem | null)[] = folded ? [items[0] as PathItem, null, ...items.slice(-tail)] : items

  return (
    <nav className={cx('ui-path', className)} style={style} aria-label={ariaLabel}>
      {shown.map((it, i) => (
        <Fragment key={it?.id ?? '…'}>
          {i ? (
            <span className="ui-path__sep" aria-hidden="true">
              <Icon name="chevron-right" weight={2} />
            </span>
          ) : null}
          {it ? (
            <button
              type="button"
              className={cx('ui-path__seg', i === shown.length - 1 && 'ui-path__seg--last')}
              aria-current={i === shown.length - 1 ? 'location' : undefined}
              onClick={() => onSelect?.(it.id)}
            >
              {it.icon ? (
                <span className="ui-path__icon" style={it.color ? { color: it.color } : undefined}>
                  {renderGlyph(it.icon)}
                </span>
              ) : null}
              <span className="ui-path__label">{it.label}</span>
            </button>
          ) : (
            <MenuButton
              className="ui-path__seg"
              aria-label={t('显示上层文件夹')}
              items={hidden.map((x) => ({ label: x.label, value: x.id, icon: x.icon ?? 'folder' }))}
              onSelect={(id) => onSelect?.(id)}
            >
              …
            </MenuButton>
          )}
        </Fragment>
      ))}
    </nav>
  )
}
