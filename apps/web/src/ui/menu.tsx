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
import { useEscape, useOutsidePress } from './overlay'
import { usePresence } from './presence'
import './menu.css'

export type MenuItem =
  | {
      label: ReactNode
      /** Defaults to the label text. */
      value?: string
      shortcut?: string
      icon?: IconName | ReactElement
      /** Defined (true or false) makes the item a checkbox item with a check column. */
      checked?: boolean
      disabled?: boolean
      destructive?: boolean
      /** One level only; opens to the right on hover, → or Enter. */
      submenu?: MenuItem[]
    }
  | { separator: true }
  | { header: ReactNode }

export interface MenuProps extends Omit<HTMLAttributes<HTMLDivElement>, 'onSelect'> {
  items: MenuItem[]
  onSelect?: (value: string) => void
  /** Escape (and ← in a submenu) calls this. */
  onClose?: () => void
  /** Pre-highlighted item (demo only). */
  activeValue?: string
  /** Focus the active (or first) item on mount — pass for popup menus. */
  autoFocus?: boolean
  /** Index in `items` of a submenu shown open on mount (demo only). */
  defaultOpenSubmenu?: number
  isSubmenu?: boolean
  ref?: Ref<HTMLDivElement>
}

const ITEM = '[role^="menuitem"]:not(:disabled)'

const itemValue = (it: { label: ReactNode; value?: string }) => it.value ?? String(it.label)

/** Enabled items of this menu level, excluding any open submenu's. */
function ownItems(menu: HTMLElement) {
  return [...menu.querySelectorAll<HTMLElement>(ITEM)].filter((el) => el.closest('[role="menu"]') === menu)
}

/**
 * Liquid Glass menu (Pane Menu). Focus moves between items and one row is highlighted for hover and keyboard alike;
 * ↑↓ Home End move, → / Enter open a submenu, ← / Esc close it, a letter jumps to the next item starting with it.
 */
export function Menu({
  items,
  onSelect,
  onClose,
  activeValue,
  autoFocus,
  defaultOpenSubmenu = -1,
  isSubmenu,
  className,
  onKeyDown,
  onMouseLeave,
  ref,
  ...rest
}: MenuProps) {
  const [active, setActive] = useState(activeValue)
  const [openSub, setOpenSub] = useState(defaultOpenSubmenu)
  const [subFocus, setSubFocus] = useState(false)
  const own = useRef<HTMLDivElement | null>(null)
  const hasCheck = items.some((it) => 'label' in it && it.checked !== undefined)
  const hasIcon = items.some((it) => 'label' in it && it.icon)

  // biome-ignore lint/correctness/useExhaustiveDependencies: focus once on mount
  useEffect(() => {
    const menu = own.current
    if (!autoFocus || !menu) return
    const list = ownItems(menu)
    ;(list.find((el) => el.dataset.value === activeValue) ?? list[0] ?? menu).focus()
  }, [])

  const setRef = (el: HTMLDivElement | null) => {
    own.current = el
    if (typeof ref === 'function') ref(el)
    else if (ref) ref.current = el
  }

  const closeSub = (index: number) => {
    setOpenSub(-1)
    own.current?.querySelector<HTMLElement>(`[data-index="${index}"]`)?.focus()
  }

  const keyDown = (e: KeyboardEvent<HTMLDivElement>) => {
    onKeyDown?.(e)
    const menu = e.currentTarget
    if (e.defaultPrevented || (e.target as HTMLElement).closest('[role="menu"]') !== menu) return
    const list = ownItems(menu)
    const at = list.indexOf(document.activeElement as HTMLElement)
    const current = at >= 0 ? items[Number(list[at]?.dataset.index)] : undefined
    const move = (i: number) => {
      e.preventDefault()
      setOpenSub(-1)
      list[i]?.focus()
    }
    if (e.key === 'ArrowDown') move((at + 1) % list.length)
    else if (e.key === 'ArrowUp') move(((at < 0 ? 0 : at) - 1 + list.length) % list.length)
    else if (e.key === 'Home') move(0)
    else if (e.key === 'End') move(list.length - 1)
    else if (
      ['ArrowRight', 'Enter', ' '].includes(e.key) &&
      current &&
      'label' in current &&
      current.submenu
    ) {
      e.preventDefault()
      setOpenSub(Number(list[at]?.dataset.index))
      setSubFocus(true)
    } else if (e.key === 'ArrowLeft' && isSubmenu && onClose) {
      e.preventDefault()
      onClose()
    } else if (e.key === 'Escape' && onClose) {
      e.preventDefault()
      e.stopPropagation()
      onClose()
    } else if (e.key.length === 1 && /\S/.test(e.key) && !e.metaKey && !e.ctrlKey && !e.altKey) {
      const k = e.key.toLowerCase()
      for (let n = 1; n <= list.length; n++) {
        const el = list[(at + n) % list.length]
        const label = el?.querySelector('.ui-menu__label')?.textContent?.trim().toLowerCase() ?? ''
        if (label.startsWith(k)) return move((at + n) % list.length)
      }
    }
  }

  return (
    <div
      ref={setRef}
      role="menu"
      tabIndex={-1}
      className={cx('ui-menu', className)}
      onKeyDown={keyDown}
      onMouseLeave={(e) => {
        if (openSub < 0) setActive(undefined)
        onMouseLeave?.(e)
      }}
      {...rest}
    >
      {items.map((it, i) => {
        // biome-ignore lint/suspicious/noArrayIndexKey: separators have no identity of their own
        if ('separator' in it) return <hr key={`s${i}`} className="ui-menu__sep" />
        if ('header' in it)
          return (
            // biome-ignore lint/suspicious/noArrayIndexKey: headers have no identity of their own
            <div key={`h${i}`} className="ui-menu__header" role="presentation">
              {it.header}
            </div>
          )
        const value = itemValue(it)
        const sub = it.submenu
        const item = (
          // biome-ignore lint/a11y/useAriaPropsSupportedByRole: the role is menuitemcheckbox whenever aria-checked is set
          <button
            key={value}
            type="button"
            role={it.checked === undefined ? 'menuitem' : 'menuitemcheckbox'}
            aria-checked={it.checked}
            aria-haspopup={sub ? 'menu' : undefined}
            aria-expanded={sub ? openSub === i : undefined}
            disabled={it.disabled}
            tabIndex={-1}
            data-index={i}
            data-value={value}
            data-active={value === active || undefined}
            className={cx('ui-menu__item', it.destructive && 'ui-menu__item--destructive')}
            onFocus={() => setActive(value)}
            onMouseEnter={(e) => {
              if (it.disabled) return
              e.currentTarget.focus()
              setOpenSub(sub ? i : -1)
              setSubFocus(false)
            }}
            onClick={() => {
              if (sub) setOpenSub(i)
              else onSelect?.(value)
            }}
          >
            {hasCheck ? (
              <span className="ui-menu__check">
                {it.checked ? <Icon name="check" size={13} weight={2} /> : null}
              </span>
            ) : null}
            {hasIcon ? (
              <span className="ui-menu__icon">
                {typeof it.icon === 'string' ? <Icon name={it.icon} size={13} /> : it.icon}
              </span>
            ) : null}
            <span className="ui-menu__label">{it.label}</span>
            {it.shortcut ? <span className="ui-menu__shortcut">{it.shortcut}</span> : null}
            {sub ? (
              <span className="ui-menu__sub">
                <Icon name="chevron-right" size={10} weight={2.2} />
              </span>
            ) : null}
          </button>
        )
        if (!sub) return item
        return (
          <div key={value} className="ui-menu__subwrap" role="none">
            {item}
            {openSub === i ? (
              <Menu
                items={sub}
                isSubmenu
                autoFocus={subFocus}
                className="ui-menu--sub"
                onSelect={onSelect}
                onClose={() => closeSub(i)}
              />
            ) : null}
          </div>
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
  /** Open upward, for triggers pinned to the bottom of the window. */
  placement?: 'below' | 'above'
  onOpenChange?: (open: boolean) => void
}

/** Trigger button with an anchored glass Menu; closes on select, Escape (refocusing the trigger) or an outside press. */
export function MenuButton({
  items,
  onSelect,
  align = 'start',
  placement = 'below',
  onOpenChange,
  onClick,
  onKeyDown,
  ...rest
}: MenuButtonProps) {
  const [open, setOpenState] = useState(false)
  const root = useRef<HTMLDivElement>(null)
  const trigger = useRef<HTMLButtonElement>(null)
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
  useOutsidePress([root], () => setOpen(false), open)

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
          items={items}
          autoFocus
          className={cx(
            'ui-menu--popover',
            align === 'end' && 'ui-menu--end',
            placement === 'above' && 'ui-menu--above',
          )}
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
