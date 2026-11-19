import { type CSSProperties, type ReactElement, useRef, useState } from 'react'
import { t } from '../../i18n'
import { Icon, type IconName, MenuButton, type MenuItem, Tooltip } from '../../ui'

export { ActivityLayer } from './ActivityLayer'

/** The title's inline rename (Stitch's Rename): Enter saves, Esc or leaving cancels. */
export function RenameField({
  title,
  style,
  onDone,
}: {
  title: string
  style: CSSProperties
  onDone: (title: string | null) => void
}) {
  const [value, setValue] = useState(title)
  const done = useRef(false)
  const finish = (next: string | null) => {
    if (done.current) return
    done.current = true
    onDone(next)
  }
  return (
    <input
      className="art-title art-title__input"
      style={style}
      aria-label={t('重命名')}
      value={value}
      maxLength={80}
      // biome-ignore lint/a11y/noAutofocus: opened on purpose by Rename
      autoFocus
      onFocus={(e) => e.currentTarget.select()}
      onChange={(e) => setValue(e.target.value)}
      onKeyDown={(e) => {
        if (e.key === 'Enter' && !e.nativeEvent.isComposing) finish(value.trim() || null)
        else if (e.key === 'Escape') {
          e.stopPropagation()
          finish(null)
        }
      }}
      onBlur={() => finish(null)}
    />
  )
}

/** A menu of the selection toolbar; `compact` (a narrow canvas) shows its icon only, the label in a tooltip. */
export function FloatMenu({
  icon,
  label,
  compact,
  items,
  onSelect,
}: {
  icon: IconName
  label: string
  compact: boolean
  items: MenuItem[]
  onSelect: (value: string) => void
}) {
  const menu = (
    <MenuButton
      className="ui-btn ui-btn--plain ui-btn--small art-float__btn"
      aria-label={compact ? label : undefined}
      items={items}
      onSelect={onSelect}
    >
      <Icon name={icon} size={14} />
      {compact ? null : label}
      <Icon name="chevron-down" size={10} weight={2} />
    </MenuButton>
  )
  return compact ? (
    <Tooltip content={label} placement="bottom">
      {menu}
    </Tooltip>
  ) : (
    menu
  )
}

/**
 * A tool of the right-hand toolbar; tools without `onClick` are not available (yet), `off` says why one is not right
 * now. `badge`: a count on its corner (open annotations).
 */
export function ToolButton({
  icon,
  label,
  shortcut,
  on,
  off,
  badge = 0,
  onClick,
}: {
  icon: IconName
  label: string
  shortcut?: string
  on?: boolean
  off?: string
  badge?: number
  onClick?: () => void
}): ReactElement {
  const usable = !!onClick && !off
  return (
    <Tooltip
      content={
        off
          ? `${label} · ${off}`
          : onClick
            ? badge
              ? t('{name}（{n} 条待处理）', { name: label, n: badge })
              : label
            : t('{name}（即将支持）', { name: label })
      }
      shortcut={shortcut}
      placement="left"
    >
      <button
        type="button"
        className="art-tools__btn"
        aria-label={label}
        aria-pressed={usable && on !== undefined ? !!on : undefined}
        disabled={!usable}
        onClick={onClick}
      >
        <Icon name={icon} size={16} />
        {badge ? (
          <span className="art-tools__badge" data-testid="art-tool-badge">
            {badge > 99 ? '99+' : badge}
          </span>
        ) : null}
      </button>
    </Tooltip>
  )
}
