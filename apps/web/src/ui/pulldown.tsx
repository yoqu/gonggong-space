import { type CSSProperties, type ReactNode, useEffect, useRef, useState } from 'react'
import { cx } from '../lib/cx'
import { useDismiss } from './anchor'
import { Button, type ButtonSize, type ButtonVariant, type Glyph } from './controls'
import { Icon } from './icon'
import { Menu, type MenuItem } from './menu'
import { usePresence } from './presence'
import './pulldown.css'

export interface PullDownButtonProps {
  label?: ReactNode
  icon?: Glyph
  items: MenuItem[]
  onSelect?: (value: string) => void
  variant?: ButtonVariant
  size?: ButtonSize
  /** `end` lines the menu up with the button's right edge (toolbar right side). */
  align?: 'start' | 'end'
  defaultOpen?: boolean
  disabled?: boolean
  /** Required when there is no `label`. */
  'aria-label'?: string
  style?: CSSProperties
}

/** Button with a fixed title that opens a menu of actions (pull-down NSPopUpButton). */
export function PullDownButton({
  label,
  icon,
  items,
  onSelect,
  variant,
  size,
  align = 'start',
  defaultOpen = false,
  disabled,
  style,
  ...aria
}: PullDownButtonProps) {
  const [open, setOpen] = useState(defaultOpen)
  const root = useRef<HTMLDivElement>(null)
  const trigger = useRef<HTMLButtonElement>(null)
  const menu = useRef<HTMLDivElement>(null)
  const presence = usePresence(open)
  const close = (refocus: boolean) => {
    setOpen(false)
    if (refocus) trigger.current?.focus()
  }
  useDismiss(open, root, close)
  // Focus only on a closed → open change, so a demo `defaultOpen` menu doesn't steal focus on mount.
  const wasOpen = useRef(open)
  useEffect(() => {
    if (open && !wasOpen.current)
      (menu.current?.querySelector<HTMLElement>('[role^="menuitem"]:not(:disabled)') ?? menu.current)?.focus()
    wasOpen.current = open
  }, [open])

  return (
    <div ref={root} className="ui-pulldown" style={style}>
      <Button
        ref={trigger}
        variant={variant}
        size={size}
        icon={icon}
        disabled={disabled}
        aria-haspopup="menu"
        aria-expanded={open}
        aria-label={aria['aria-label']}
        className={cx('ui-pulldown__btn', label == null && 'ui-pulldown__btn--icon')}
        onClick={() => setOpen(!open)}
        onKeyDown={(e) => {
          if (open || (e.key !== 'ArrowDown' && e.key !== 'ArrowUp')) return
          e.preventDefault()
          setOpen(true)
        }}
      >
        {label}
        <span className="ui-pulldown__chev" aria-hidden>
          <Icon name="chevron-down" weight={2.2} />
        </span>
      </Button>
      {presence.mounted ? (
        <Menu
          ref={menu}
          items={items}
          tabIndex={-1}
          className={cx('ui-pulldown__menu', align === 'end' && 'ui-pulldown__menu--end')}
          data-state={presence.state}
          onAnimationEnd={presence.onAnimationEnd}
          onSelect={(value) => {
            close(true)
            onSelect?.(value)
          }}
        />
      ) : null}
    </div>
  )
}
