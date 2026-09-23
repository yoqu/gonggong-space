import { Check, ChevronDown } from 'lucide-react'
import {
  type ButtonHTMLAttributes,
  type InputHTMLAttributes,
  type ReactNode,
  type TextareaHTMLAttributes,
  useEffect,
  useRef,
  useState,
} from 'react'
import { cx } from '../lib/cx'

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
      <svg
        width="8"
        height="8"
        viewBox="0 0 24 24"
        fill="none"
        stroke="rgba(0,0,0,0.55)"
        strokeWidth="3.5"
        strokeLinecap="round"
        aria-hidden="true"
      >
        <path d="M18 6 6 18M6 6l12 12" />
      </svg>
    </button>
  )
}

export interface TabItem<V extends string> {
  value: V
  label: ReactNode
  disabled?: boolean
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
  return (
    <div role="tablist" className={cx('ui-tabs', size === 'sm' && 'ui-tabs--sm')}>
      {items.map((it) => (
        <button
          key={it.value}
          type="button"
          role="tab"
          className="ui-tab"
          aria-selected={it.value === value}
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
  const ref = useRef<HTMLDivElement>(null)
  useEffect(() => {
    if (!open) return
    const onDown = (e: MouseEvent) => {
      if (!ref.current?.contains(e.target as Node)) setOpen(false)
    }
    document.addEventListener('mousedown', onDown)
    return () => document.removeEventListener('mousedown', onDown)
  }, [open])
  const selected = options.find((o) => o.value === value)

  return (
    <div ref={ref} className={cx('ui-select', open && 'ui-select--open')}>
      <button
        type="button"
        className="ui-select__trigger"
        aria-haspopup="listbox"
        aria-expanded={open}
        aria-label={label}
        disabled={disabled}
        onClick={() => setOpen((v) => !v)}
      >
        <span className={cx('ui-select__value', !selected && 'ui-select__placeholder')}>
          {selected ? selected.label : placeholder}
        </span>
        <ChevronDown size={16} className="ui-select__chevron" aria-hidden="true" />
      </button>
      {open ? (
        <div role="listbox" className="ui-select__menu">
          {options.map((o) => (
            <button
              key={o.value}
              type="button"
              role="option"
              className="ui-select__option"
              aria-selected={o.value === value}
              disabled={o.disabled}
              onClick={() => {
                setOpen(false)
                onChange(o.value)
              }}
            >
              {o.label}
            </button>
          ))}
        </div>
      ) : null}
    </div>
  )
}
