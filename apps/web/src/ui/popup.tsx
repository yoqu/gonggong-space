import { type KeyboardEvent, type ReactNode, useEffect, useId, useRef, useState } from 'react'
import { cx } from '../lib/cx'
import { nextEnabled, useControlled } from './controlled'
import { Button, type ButtonSize } from './controls'
import { Icon } from './icon'
import { Float, useDismiss } from './popover'
import './popup.css'

export interface PopUpOption<V extends string> {
  value: V
  label: ReactNode
  disabled?: boolean
}

export interface PopUpButtonProps<V extends string> {
  options: PopUpOption<V>[]
  /** `null` shows the placeholder. */
  value?: V | null
  defaultValue?: V
  onChange?: (value: V) => void
  size?: ButtonSize
  placeholder?: ReactNode
  defaultOpen?: boolean
  disabled?: boolean
  'aria-label'?: string
}

/**
 * Keyboard for a menu whose focus stays on the container (aria-activedescendant):
 * ↑↓ move (wrapping), Home/End, a letter jumps to the next item starting with it.
 */
function menuKeyTarget(
  e: KeyboardEvent,
  items: { label: ReactNode; disabled?: boolean }[],
  active: number,
): number | null {
  if (e.key === 'ArrowDown' || e.key === 'ArrowUp') {
    const step = e.key === 'ArrowDown' ? 1 : -1
    return nextEnabled(items, active < 0 && step < 0 ? items.length : active, step)
  }
  if (e.key === 'Home') return nextEnabled(items, -1, 1)
  if (e.key === 'End') return nextEnabled(items, items.length, -1)
  if (e.key.length === 1 && /\S/.test(e.key)) {
    const k = e.key.toLowerCase()
    for (let i = 1; i <= items.length; i++) {
      const j = (active + i + items.length) % items.length
      const it = items[j]
      if (it && !it.disabled && String(it.label).toLowerCase().startsWith(k)) return j
    }
  }
  return null
}

/** Pane pop-up button: a default Button with an up/down chevron that opens a checked menu of values. */
export function PopUpButton<V extends string>({
  options,
  value,
  defaultValue,
  onChange,
  size,
  placeholder,
  defaultOpen = false,
  disabled,
  ...aria
}: PopUpButtonProps<V>) {
  const [current, setCurrent] = useControlled<V | null>(value, defaultValue ?? options[0]?.value ?? null)
  const [open, setOpen] = useState(defaultOpen)
  const [active, setActive] = useState(() => options.findIndex((o) => o.value === current))
  const root = useRef<HTMLDivElement>(null)
  const trigger = useRef<HTMLButtonElement>(null)
  const list = useRef<HTMLDivElement>(null)
  const id = useId()

  // Focus only on a closed → open change, so a demo `defaultOpen` menu doesn't steal focus on mount.
  const wasOpen = useRef(open)
  useEffect(() => {
    if (open && !wasOpen.current) list.current?.focus({ preventScroll: true })
    wasOpen.current = open
  }, [open])

  const close = (refocus: boolean) => {
    setOpen(false)
    if (refocus) trigger.current?.focus()
  }
  useDismiss(open, root, close)

  const show = () => {
    const i = options.findIndex((o) => o.value === current)
    setActive(i >= 0 && !options[i]?.disabled ? i : nextEnabled(options, -1, 1))
    setOpen(true)
  }
  const pick = (o: PopUpOption<V>) => {
    if (o.disabled) return
    close(true)
    setCurrent(o.value)
    onChange?.(o.value)
  }
  const onListKey = (e: KeyboardEvent<HTMLDivElement>) => {
    const next = menuKeyTarget(e, options, active)
    if (next !== null) {
      e.preventDefault()
      setActive(next)
    } else if (e.key === 'Enter' || e.key === ' ') {
      e.preventDefault()
      const o = options[active]
      if (o) pick(o)
    } else if (e.key === 'Tab') close(false)
  }
  const selected = options.find((o) => o.value === current)

  return (
    <div ref={root} className="ui-popup">
      <Button
        ref={trigger}
        className="ui-popup__btn"
        size={size}
        disabled={disabled}
        aria-haspopup="menu"
        aria-expanded={open}
        aria-label={aria['aria-label']}
        onClick={() => (open ? setOpen(false) : show())}
        onKeyDown={(e) => {
          if (open || (e.key !== 'ArrowDown' && e.key !== 'ArrowUp')) return
          e.preventDefault()
          show()
        }}
      >
        <span className={cx('ui-popup__value', !selected && 'ui-popup__placeholder')}>
          {selected ? selected.label : placeholder}
        </span>
        <span className="ui-popup__chev">
          <Icon name="chevron-updown" weight={2.2} />
        </span>
      </Button>
      <Float
        ref={list}
        open={open}
        kind="menu"
        role="menu"
        tabIndex={-1}
        aria-label={aria['aria-label']}
        aria-activedescendant={active >= 0 ? `${id}-${active}` : undefined}
        className="ui-popup__menu"
        onKeyDown={onListKey}
      >
        {options.map((o, i) => (
          // biome-ignore lint/a11y/useKeyWithClickEvents: keyboard is handled by the menu (aria-activedescendant)
          <div
            key={o.value}
            id={`${id}-${i}`}
            role="menuitemcheckbox"
            tabIndex={-1}
            className="ui-float__item"
            data-active={i === active || undefined}
            aria-checked={o.value === current}
            aria-disabled={o.disabled || undefined}
            onMouseEnter={() => !o.disabled && setActive(i)}
            onMouseLeave={() => setActive(-1)}
            onClick={() => pick(o)}
          >
            <span className="ui-popup__check">
              {o.value === current ? <Icon name="check" weight={2} /> : null}
            </span>
            <span className="ui-float__label">{o.label}</span>
          </div>
        ))}
      </Float>
    </div>
  )
}

export type SelectOption<V extends string> = PopUpOption<V> & { label: string }

/** Pre-Pane form select, now a PopUpButton; `label` names the trigger when no visible <label> wraps it. */
export function Select<V extends string>({
  options,
  value,
  onChange,
  placeholder = '请选择',
  disabled,
  label,
}: {
  options: SelectOption<V>[]
  value: V | null
  onChange: (value: V) => void
  placeholder?: string
  disabled?: boolean
  label?: string
}) {
  return (
    <PopUpButton
      options={options}
      value={value}
      onChange={onChange}
      placeholder={placeholder}
      disabled={disabled}
      aria-label={label}
    />
  )
}
