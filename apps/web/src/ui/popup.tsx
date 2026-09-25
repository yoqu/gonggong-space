import { type KeyboardEvent, type ReactNode, useEffect, useId, useRef, useState } from 'react'
import { cx } from '../lib/cx'
import { nextEnabled, useControlled } from './controlled'
import { Button, type ButtonSize } from './controls'
import { Icon } from './icon'
import { useEscape } from './overlay'
import { usePresence } from './presence'
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

/** Pane pop-up button: a default Button with an up/down chevron that opens a checked option list. */
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
  // -1: nothing highlighted, as when opened by pointer.
  const [active, setActive] = useState(-1)
  const root = useRef<HTMLDivElement>(null)
  const trigger = useRef<HTMLButtonElement>(null)
  const list = useRef<HTMLDivElement>(null)
  const id = useId()
  const menu = usePresence(open)

  useEffect(() => {
    if (!open) return
    list.current?.focus({ preventScroll: true })
    const onDown = (e: MouseEvent) => {
      if (!root.current?.contains(e.target as Node)) setOpen(false)
    }
    document.addEventListener('mousedown', onDown)
    return () => document.removeEventListener('mousedown', onDown)
  }, [open])

  const close = () => {
    setOpen(false)
    trigger.current?.focus()
  }
  useEscape(close, open)

  const show = (highlight: boolean) => {
    const i = options.findIndex((o) => o.value === current)
    setActive(highlight ? (i >= 0 ? i : nextEnabled(options, -1, 1)) : -1)
    setOpen(true)
  }
  const pick = (o: PopUpOption<V>) => {
    if (o.disabled) return
    close()
    setCurrent(o.value)
    onChange?.(o.value)
  }
  const onListKey = (e: KeyboardEvent<HTMLDivElement>) => {
    if (e.key === 'ArrowDown' || e.key === 'ArrowUp') {
      e.preventDefault()
      const step = e.key === 'ArrowDown' ? 1 : -1
      setActive((i) => nextEnabled(options, i < 0 && step < 0 ? options.length : i, step))
    } else if (e.key === 'Enter' || e.key === ' ') {
      e.preventDefault()
      const o = options[active]
      if (o) pick(o)
    } else if (e.key === 'Tab') close()
  }
  const selected = options.find((o) => o.value === current)

  return (
    <div ref={root} className="ui-popup">
      <Button
        ref={trigger}
        className="ui-popup__btn"
        size={size}
        disabled={disabled}
        aria-haspopup="listbox"
        aria-expanded={open}
        aria-label={aria['aria-label']}
        onClick={() => (open ? setOpen(false) : show(false))}
        onKeyDown={(e) => {
          if (open || (e.key !== 'ArrowDown' && e.key !== 'ArrowUp')) return
          e.preventDefault()
          show(true)
        }}
      >
        <span className={cx('ui-popup__value', !selected && 'ui-popup__placeholder')}>
          {selected ? selected.label : placeholder}
        </span>
        <span className="ui-popup__chev">
          <Icon name="chevron-updown" weight={2.2} />
        </span>
      </Button>
      {menu.mounted ? (
        <div
          ref={list}
          role="listbox"
          tabIndex={-1}
          aria-label={aria['aria-label']}
          aria-activedescendant={active >= 0 ? `${id}-${active}` : undefined}
          className="ui-popup__menu"
          data-state={menu.state}
          onAnimationEnd={menu.onAnimationEnd}
          onKeyDown={onListKey}
        >
          {options.map((o, i) => (
            // biome-ignore lint/a11y/useKeyWithClickEvents: keyboard is handled by the listbox (aria-activedescendant)
            // biome-ignore lint/a11y/useFocusableInteractive: focus stays on the listbox (aria-activedescendant)
            <div
              key={o.value}
              id={`${id}-${i}`}
              role="option"
              className="ui-popup__item"
              data-active={i === active || undefined}
              aria-selected={o.value === current}
              aria-disabled={o.disabled || undefined}
              onMouseEnter={() => !o.disabled && setActive(i)}
              onMouseLeave={() => setActive(-1)}
              onClick={() => pick(o)}
            >
              <span className="ui-popup__check">
                {o.value === current ? <Icon name="check" weight={2} /> : null}
              </span>
              <span className="ui-popup__label">{o.label}</span>
            </div>
          ))}
        </div>
      ) : null}
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
