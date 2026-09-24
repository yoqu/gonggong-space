import { Check, ChevronDown, X } from 'lucide-react'
import {
  type ButtonHTMLAttributes,
  type InputHTMLAttributes,
  type KeyboardEvent,
  type ReactNode,
  type TextareaHTMLAttributes,
  useEffect,
  useId,
  useRef,
  useState,
} from 'react'
import { cx } from '../lib/cx'
import { useEscape } from './overlay'

export type ButtonVariant = 'default' | 'primary' | 'outline' | 'ghost' | 'destructive'
export type ButtonSize = 'xs' | 'sm' | 'md' | 'lg'

export interface ButtonProps extends ButtonHTMLAttributes<HTMLButtonElement> {
  variant?: ButtonVariant
  size?: ButtonSize
  fullWidth?: boolean
}

export function Button({
  variant = 'default',
  size = 'md',
  fullWidth,
  className,
  type = 'button',
  ...rest
}: ButtonProps) {
  return (
    <button
      type={type}
      className={cx(
        'ui-btn',
        `ui-btn--${variant}`,
        `ui-btn--${size}`,
        fullWidth && 'ui-btn--full',
        className,
      )}
      {...rest}
    />
  )
}

export function IconButton({ className, type = 'button', ...rest }: ButtonHTMLAttributes<HTMLButtonElement>) {
  return <button type={type} aria-label={rest.title} className={cx('ui-icon-btn', className)} {...rest} />
}

export function CloseButton({ onClick, title = '关闭' }: { onClick?: () => void; title?: string }) {
  return (
    <button type="button" className="ui-close" onClick={onClick} title={title} aria-label={title}>
      <X size={16} aria-hidden="true" />
    </button>
  )
}

export interface TabItem<V extends string> {
  value: V
  label: ReactNode
  disabled?: boolean
}

/** Index of the next enabled item from `from` in direction `step`, wrapping around. */
function nextEnabled(items: { disabled?: boolean }[], from: number, step: 1 | -1) {
  for (let i = 1; i <= items.length; i++) {
    const j = (from + step * i + items.length) % items.length
    if (!items[j]?.disabled) return j
  }
  return from
}

export function Tabs<V extends string>({
  items,
  value,
  onChange,
  size = 'md',
}: {
  items: TabItem<V>[]
  value: V
  onChange: (value: V) => void
  size?: 'sm' | 'md'
}) {
  const current = items.findIndex((it) => it.value === value)
  const focusable = current >= 0 ? current : nextEnabled(items, -1, 1)
  const onKeyDown = (e: KeyboardEvent<HTMLDivElement>) => {
    const step = e.key === 'ArrowRight' ? 1 : e.key === 'ArrowLeft' ? -1 : 0
    if (!step) return
    e.preventDefault()
    const tabs = e.currentTarget.querySelectorAll<HTMLButtonElement>('[role="tab"]')
    const from = [...tabs].indexOf(e.target as HTMLButtonElement)
    const next = nextEnabled(items, from < 0 ? focusable : from, step)
    tabs[next]?.focus()
    const it = items[next]
    if (it) onChange(it.value)
  }
  return (
    <div role="tablist" className={cx('ui-tabs', size === 'sm' && 'ui-tabs--sm')} onKeyDown={onKeyDown}>
      {items.map((it, i) => (
        <button
          key={it.value}
          type="button"
          role="tab"
          className="ui-tab"
          aria-selected={it.value === value}
          tabIndex={i === focusable ? 0 : -1}
          disabled={it.disabled}
          onClick={() => onChange(it.value)}
        >
          {it.label}
        </button>
      ))}
    </div>
  )
}

interface ToggleProps {
  checked: boolean
  onChange: (checked: boolean) => void
  label?: ReactNode
  disabled?: boolean
}

export function Switch({ checked, onChange, label, disabled }: ToggleProps) {
  return (
    <label className={cx('ui-toggle', disabled && 'ui-toggle--disabled')}>
      <span className="ui-toggle__control">
        <input
          type="checkbox"
          role="switch"
          aria-checked={checked}
          checked={checked}
          disabled={disabled}
          onChange={(e) => onChange(e.target.checked)}
        />
        <span className="ui-switch__track">
          <span className="ui-switch__thumb" />
        </span>
      </span>
      {label ? <span>{label}</span> : null}
    </label>
  )
}

export function Checkbox({ checked, onChange, label, disabled }: ToggleProps) {
  return (
    <label className={cx('ui-toggle', disabled && 'ui-toggle--disabled')}>
      <span className="ui-toggle__control">
        <input
          type="checkbox"
          checked={checked}
          disabled={disabled}
          onChange={(e) => onChange(e.target.checked)}
        />
        <span className="ui-checkbox__box">{checked ? <Check size={11} strokeWidth={3} /> : null}</span>
      </span>
      {label ? <span>{label}</span> : null}
    </label>
  )
}

export interface InputProps extends Omit<InputHTMLAttributes<HTMLInputElement>, 'size'> {
  size?: 'sm' | 'md'
  mono?: boolean
  invalid?: boolean
}

export function Input({ size = 'md', mono, invalid, className, ...rest }: InputProps) {
  return (
    <input
      aria-invalid={invalid || undefined}
      className={cx('ui-input', size === 'sm' && 'ui-input--sm', mono && 'ui-input--mono', className)}
      {...rest}
    />
  )
}

export function Textarea({
  invalid,
  className,
  ...rest
}: TextareaHTMLAttributes<HTMLTextAreaElement> & { invalid?: boolean }) {
  return <textarea aria-invalid={invalid || undefined} className={cx('ui-textarea', className)} {...rest} />
}

/** Stacked form field: caption above the control; the wrapping <label> names the control. */
export function Field({ label, children }: { label: ReactNode; children: ReactNode }) {
  return (
    // biome-ignore lint/a11y/noLabelWithoutControl: the control is passed in as children
    <label className="ui-field">
      <span className="ui-field__label">{label}</span>
      {children}
    </label>
  )
}

export interface SelectOption<V extends string> {
  value: V
  label: string
  disabled?: boolean
}

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
  /** Accessible name of the trigger when no visible <label> wraps it. */
  label?: string
}) {
  const [open, setOpen] = useState(false)
  const [active, setActive] = useState(0)
  const ref = useRef<HTMLDivElement>(null)
  const trigger = useRef<HTMLButtonElement>(null)
  const list = useRef<HTMLDivElement>(null)
  const id = useId()
  useEffect(() => {
    if (!open) return
    list.current?.focus()
    const onDown = (e: MouseEvent) => {
      if (!ref.current?.contains(e.target as Node)) setOpen(false)
    }
    document.addEventListener('mousedown', onDown)
    return () => document.removeEventListener('mousedown', onDown)
  }, [open])
  const close = () => {
    setOpen(false)
    trigger.current?.focus()
  }
  useEscape(close, open)
  const selected = options.find((o) => o.value === value)
  const show = () => {
    const i = options.findIndex((o) => o.value === value)
    setActive(i >= 0 ? i : nextEnabled(options, -1, 1))
    setOpen(true)
  }
  const pick = (o: SelectOption<V>) => {
    if (o.disabled) return
    close()
    onChange(o.value)
  }
  const onListKey = (e: KeyboardEvent<HTMLDivElement>) => {
    if (e.key === 'ArrowDown' || e.key === 'ArrowUp') {
      e.preventDefault()
      setActive((i) => nextEnabled(options, i, e.key === 'ArrowDown' ? 1 : -1))
    } else if (e.key === 'Enter' || e.key === ' ') {
      e.preventDefault()
      const o = options[active]
      if (o) pick(o)
    } else if (e.key === 'Tab') close()
  }

  return (
    <div ref={ref} className={cx('ui-select', open && 'ui-select--open')}>
      <button
        ref={trigger}
        type="button"
        className="ui-select__trigger"
        aria-haspopup="listbox"
        aria-expanded={open}
        aria-label={label}
        disabled={disabled}
        onClick={() => (open ? setOpen(false) : show())}
        onKeyDown={(e) => {
          if (open || (e.key !== 'ArrowDown' && e.key !== 'ArrowUp')) return
          e.preventDefault()
          show()
        }}
      >
        <span className={cx('ui-select__value', !selected && 'ui-select__placeholder')}>
          {selected ? selected.label : placeholder}
        </span>
        <ChevronDown size={16} className="ui-select__chevron" aria-hidden="true" />
      </button>
      {open ? (
        <div
          ref={list}
          role="listbox"
          tabIndex={-1}
          aria-label={label}
          aria-activedescendant={`${id}-${active}`}
          className="ui-select__menu"
          onKeyDown={onListKey}
        >
          {options.map((o, i) => (
            // biome-ignore lint/a11y/useKeyWithClickEvents: keyboard is handled by the listbox (aria-activedescendant)
            // biome-ignore lint/a11y/useFocusableInteractive: focus stays on the listbox (aria-activedescendant)
            <div
              key={o.value}
              id={`${id}-${i}`}
              role="option"
              className="ui-select__option"
              data-active={i === active || undefined}
              aria-selected={o.value === value}
              aria-disabled={o.disabled || undefined}
              onMouseEnter={() => !o.disabled && setActive(i)}
              onClick={() => pick(o)}
            >
              {o.label}
            </div>
          ))}
        </div>
      ) : null}
    </div>
  )
}
