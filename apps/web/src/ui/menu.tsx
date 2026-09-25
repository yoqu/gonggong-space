import {
  type ButtonHTMLAttributes,
  type HTMLAttributes,
  type KeyboardEvent,
  type ReactElement,
  type ReactNode,
  type Ref,
  useEffect,
  useRef,
  useState,
} from 'react'
import { cx } from '../lib/cx'
import { Icon, type IconName } from './icon'
import { useEscape } from './overlay'
import { usePresence } from './presence'
import './menu.css'

export type MenuItem =
  | {
      label: ReactNode
      value: string
      shortcut?: string
      icon?: IconName | ReactElement
      /** Defined (true or false) makes the item a checkbox item with a check column. */
      checked?: boolean
      disabled?: boolean
      destructive?: boolean
    }
  | { separator: true }
  | { header: ReactNode }

export interface MenuProps extends Omit<HTMLAttributes<HTMLDivElement>, 'onSelect'> {
  items: MenuItem[]
  onSelect?: (value: string) => void
  /** Pre-highlighted item (demo only). */
  activeValue?: string
  ref?: Ref<HTMLDivElement>
}

const ITEM = '[role^="menuitem"]:not(:disabled)'

function onMenuKeyDown(e: KeyboardEvent<HTMLDivElement>) {
  const items = [...e.currentTarget.querySelectorAll<HTMLElement>(ITEM)]
  const at = items.indexOf(document.activeElement as HTMLElement)
  const next =
    e.key === 'ArrowDown'
      ? (at + 1) % items.length
      : e.key === 'ArrowUp'
        ? (at - 1 + items.length) % items.length
        : e.key === 'Home'
          ? 0
          : e.key === 'End'
            ? items.length - 1
            : null
  if (next === null) return
  e.preventDefault()
  items[next]?.focus()
}

/** Liquid Glass menu (Pane Menu). Arrow keys move focus between enabled items; Enter/Space activate. */
export function Menu({ items, onSelect, activeValue, className, onKeyDown, ...rest }: MenuProps) {
  const hasCheck = items.some((it) => 'checked' in it && it.checked !== undefined)
  const first = items.find((it) => 'value' in it && !it.disabled)
  return (
    <div
      role="menu"
      className={cx('ui-menu', className)}
      onKeyDown={(e) => {
        onMenuKeyDown(e)
        onKeyDown?.(e)
      }}
      {...rest}
    >
      {items.map((it, i) => {
        // biome-ignore lint/suspicious/noArrayIndexKey: separators have no identity of their own
        if ('separator' in it) return <hr key={`s${i}`} className="ui-menu__sep" />
        if ('header' in it)
          return (
            // biome-ignore lint/suspicious/noArrayIndexKey: headers have no identity of their own
            <div key={`h${i}`} className="ui-menu__header">
              {it.header}
            </div>
          )
        return (
          // biome-ignore lint/a11y/useAriaPropsSupportedByRole: the role is menuitemcheckbox whenever aria-checked is set
          <button
            key={it.value}
            type="button"
            role={it.checked === undefined ? 'menuitem' : 'menuitemcheckbox'}
            aria-checked={it.checked}
            disabled={it.disabled}
            tabIndex={it === first ? 0 : -1}
            data-active={it.value === activeValue || undefined}
            className={cx('ui-menu__item', it.destructive && 'ui-menu__item--destructive')}
            onClick={() => onSelect?.(it.value)}
          >
            {hasCheck ? (
              <span className="ui-menu__check">
                {it.checked ? <Icon name="check" size={13} weight={2} /> : null}
              </span>
            ) : null}
            {it.icon ? (
              <span className="ui-menu__icon">
                {typeof it.icon === 'string' ? <Icon name={it.icon} size={13} /> : it.icon}
              </span>
            ) : null}
            <span className="ui-menu__label">{it.label}</span>
            {it.shortcut ? <span className="ui-menu__shortcut">{it.shortcut}</span> : null}
          </button>
        )
      })}
    </div>
  )
}

export interface MenuButtonProps extends Omit<ButtonHTMLAttributes<HTMLButtonElement>, 'onSelect'> {
  items: MenuItem[]
  onSelect: (value: string) => void
  /** Which trigger edge the menu lines up with. */
  align?: 'start' | 'end'
  onOpenChange?: (open: boolean) => void
}

/** Trigger button with an anchored glass Menu; closes on select, Escape (refocusing the trigger) or an outside press. */
export function MenuButton({
  items,
  onSelect,
  align = 'start',
  onOpenChange,
  onClick,
  onKeyDown,
  ...rest
}: MenuButtonProps) {
  const [open, setOpenState] = useState(false)
  const root = useRef<HTMLDivElement>(null)
  const trigger = useRef<HTMLButtonElement>(null)
  const menu = useRef<HTMLDivElement>(null)
  const presence = usePresence(open)
  const setOpen = (next: boolean) => {
    setOpenState(next)
    onOpenChange?.(next)
  }
  const close = () => {
    setOpen(false)
    trigger.current?.focus()
  }
  useEscape(close, open)
  // biome-ignore lint/correctness/useExhaustiveDependencies: setOpen only wraps state and a callback prop
  useEffect(() => {
    if (!open) return
    menu.current?.querySelector<HTMLElement>(ITEM)?.focus()
    const outside = (e: MouseEvent) => {
      if (!root.current?.contains(e.target as Node)) setOpen(false)
    }
    document.addEventListener('mousedown', outside)
    return () => document.removeEventListener('mousedown', outside)
  }, [open])

  return (
    <div ref={root} className="ui-menu-anchor">
      <button
        ref={trigger}
        type="button"
        aria-haspopup="menu"
        aria-expanded={open}
        onClick={(e) => {
          setOpen(!open)
          onClick?.(e)
        }}
        onKeyDown={(e) => {
          if (e.key === 'ArrowDown' && !open) {
            e.preventDefault()
            setOpen(true)
          }
          onKeyDown?.(e)
        }}
        {...rest}
      />
      {presence.mounted ? (
        <Menu
          ref={menu}
          items={items}
          className={cx('ui-menu--popover', align === 'end' && 'ui-menu--end')}
          data-state={presence.state}
          onAnimationEnd={presence.onAnimationEnd}
          onSelect={(value) => {
            close()
            onSelect(value)
          }}
        />
      ) : null}
    </div>
  )
}
