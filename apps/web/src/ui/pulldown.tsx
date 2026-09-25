import { type CSSProperties, type ReactNode, useEffect, useLayoutEffect, useRef, useState } from 'react'
import { createPortal } from 'react-dom'
import { cx } from '../lib/cx'
import { Button, type ButtonSize, type ButtonVariant, type Glyph } from './controls'
import { Icon } from './icon'
import { Menu, type MenuItem } from './menu'
import { useEscape, useOutsidePress } from './overlay'
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
  /** Fix the menu in document.body so a scrolling ancestor (a Table row) cannot clip it; scrolling closes it. */
  portal?: boolean
  /** false hides the ▾, for icon-only row action buttons. */
  indicator?: boolean
  disabled?: boolean
  /** Required when there is no `label`. */
  'aria-label'?: string
  style?: CSSProperties
}

const GAP = 4

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
  portal,
  indicator = true,
  disabled,
  style,
  ...aria
}: PullDownButtonProps) {
  const [open, setOpen] = useState(defaultOpen)
  const root = useRef<HTMLDivElement>(null)
  const trigger = useRef<HTMLButtonElement>(null)
  const menu = useRef<HTMLDivElement>(null)
  const presence = usePresence(open)
  const portalled = (node: ReactNode) => (portal ? createPortal(node, document.body) : node)
  const close = (refocus: boolean) => {
    setOpen(false)
    if (refocus) trigger.current?.focus()
  }
  useEscape(() => close(true), open)
  useOutsidePress([root, menu], () => close(false), open)
  useLayoutEffect(() => {
    const el = menu.current
    const btn = trigger.current
    if (!portal || !open || !el || !btn) return
    const r = btn.getBoundingClientRect()
    const { width, height } = el.getBoundingClientRect()
    const below = r.bottom + GAP + height <= window.innerHeight - GAP
    el.style.top = `${below ? r.bottom + GAP : Math.max(GAP, r.top - GAP - height)}px`
    el.style.left = `${Math.max(GAP, align === 'end' ? r.right - width : r.left)}px`
    el.style.right = 'auto'
  }, [open, portal, align])
  useEffect(() => {
    if (!portal || !open) return
    const dismiss = (e: Event) => {
      if (!menu.current?.contains(e.target as Node)) close(false)
    }
    document.addEventListener('scroll', dismiss, true)
    window.addEventListener('resize', dismiss)
    return () => {
      document.removeEventListener('scroll', dismiss, true)
      window.removeEventListener('resize', dismiss)
    }
  })
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
        className={cx(
          'ui-pulldown__btn',
          label == null && 'ui-pulldown__btn--icon',
          !indicator && 'ui-pulldown__btn--bare',
        )}
        onClick={() => setOpen(!open)}
        onKeyDown={(e) => {
          if (open || (e.key !== 'ArrowDown' && e.key !== 'ArrowUp')) return
          e.preventDefault()
          setOpen(true)
        }}
      >
        {label}
        {indicator ? (
          <span className="ui-pulldown__chev" aria-hidden>
            <Icon name="chevron-down" weight={2.2} />
          </span>
        ) : null}
      </Button>
      {presence.mounted
        ? portalled(
            <Menu
              ref={menu}
              items={items}
              tabIndex={-1}
              className={cx(
                'ui-pulldown__menu',
                align === 'end' && 'ui-pulldown__menu--end',
                portal && 'ui-pulldown__menu--fixed',
              )}
              data-state={presence.state}
              onAnimationEnd={presence.onAnimationEnd}
              onSelect={(value) => {
                close(true)
                onSelect?.(value)
              }}
            />,
          )
        : null}
    </div>
  )
}
