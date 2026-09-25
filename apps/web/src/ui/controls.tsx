import {
  type ButtonHTMLAttributes,
  type ReactElement,
  type ReactNode,
  type Ref,
  useEffect,
  useId,
  useRef,
} from 'react'
import { cx } from '../lib/cx'
import { useControlled } from './controlled'
import { Icon, type IconName } from './icon'
import './controls.css'

/** An icon by name, or a ready-made icon element. */
export type Glyph = IconName | ReactElement

export const renderGlyph = (g: Glyph) => (typeof g === 'string' ? <Icon name={g} /> : g)

/** `outline` and `ghost` are pre-Pane names kept for existing callers; they render as default and plain-muted. */
export type ButtonVariant = 'default' | 'primary' | 'destructive' | 'glass' | 'plain' | 'outline' | 'ghost'
/** `xs`/`sm`/`md`/`lg` are pre-Pane names: xs and sm → small, md → regular, lg → large. */
export type ButtonSize = 'small' | 'regular' | 'large' | 'xlarge' | 'xs' | 'sm' | 'md' | 'lg'

interface ButtonBaseProps extends ButtonHTMLAttributes<HTMLButtonElement> {
  ref?: Ref<HTMLButtonElement>
  variant?: ButtonVariant
  size?: ButtonSize
  fullWidth?: boolean
}

export type ButtonProps = ButtonBaseProps &
  ({ icon?: Glyph; children: ReactNode } | { icon: Glyph; children?: undefined; 'aria-label': string })

export function Button({
  variant = 'default',
  size = 'regular',
  fullWidth,
  icon,
  className,
  type = 'button',
  children,
  ...rest
}: ButtonProps) {
  return (
    <button
      type={type}
      className={cx(
        'ui-btn',
        variant !== 'default' && `ui-btn--${variant}`,
        size !== 'regular' && size !== 'md' && `ui-btn--${size}`,
        icon && children == null && 'ui-btn--icon',
        fullWidth && 'ui-btn--full',
        className,
      )}
      {...rest}
    >
      {icon ? renderGlyph(icon) : null}
      {children}
    </button>
  )
}

export interface IconButtonProps extends Omit<ButtonHTMLAttributes<HTMLButtonElement>, 'children'> {
  /** Accessible name and tooltip. */
  title: string
  /** `glass`: toolbar button on a glass capsule. */
  variant?: 'plain' | 'glass'
  size?: ButtonSize
  children: Glyph
}

export function IconButton({
  title,
  variant = 'plain',
  size = 'large',
  children,
  className,
  ...rest
}: IconButtonProps) {
  return (
    <Button
      variant={variant}
      size={size}
      icon={children}
      title={title}
      aria-label={title}
      className={cx('ui-icon-btn', className)}
      {...rest}
    />
  )
}

export function CloseButton({ onClick, title = '关闭' }: { onClick?: () => void; title?: string }) {
  return (
    <IconButton title={title} onClick={onClick} className="ui-close">
      <Icon name="xmark" />
    </IconButton>
  )
}

export interface SwitchProps {
  checked?: boolean
  defaultChecked?: boolean
  onChange?: (checked: boolean) => void
  size?: 'small' | 'regular'
  disabled?: boolean
  label?: ReactNode
  labelPosition?: 'before' | 'after'
  'aria-label'?: string
  /** Pre-Pane alias of `aria-label`, for when the visible label is a state text. */
  ariaLabel?: string
}

export function Switch({
  checked,
  defaultChecked = false,
  onChange,
  size = 'regular',
  disabled,
  label,
  labelPosition = 'before',
  ariaLabel,
  ...aria
}: SwitchProps) {
  const [on, setOn] = useControlled(checked, defaultChecked)
  const text = label ? <span>{label}</span> : null
  return (
    <label className={cx('ui-switch', size === 'small' && 'ui-switch--small', disabled && 'ui-disabled')}>
      {labelPosition === 'before' ? text : null}
      <input
        type="checkbox"
        role="switch"
        aria-label={ariaLabel ?? aria['aria-label']}
        aria-checked={on}
        checked={on}
        disabled={disabled}
        onChange={(e) => {
          setOn(e.target.checked)
          onChange?.(e.target.checked)
        }}
      />
      <span className="ui-switch__track">
        <span className="ui-switch__knob" />
      </span>
      {labelPosition === 'after' ? text : null}
    </label>
  )
}

export interface CheckboxProps {
  checked?: boolean
  defaultChecked?: boolean
  indeterminate?: boolean
  onChange?: (checked: boolean) => void
  label?: ReactNode
  disabled?: boolean
}

export function Checkbox({
  checked,
  defaultChecked = false,
  indeterminate = false,
  onChange,
  label,
  disabled,
}: CheckboxProps) {
  const [on, setOn] = useControlled(checked, defaultChecked)
  const ref = useRef<HTMLInputElement>(null)
  useEffect(() => {
    if (ref.current) ref.current.indeterminate = indeterminate
  }, [indeterminate])
  return (
    <label className={cx('ui-check', indeterminate && 'ui-check--mixed', disabled && 'ui-disabled')}>
      <input
        ref={ref}
        type="checkbox"
        checked={on}
        disabled={disabled}
        onChange={(e) => {
          setOn(e.target.checked)
          onChange?.(e.target.checked)
        }}
      />
      <span className="ui-check__box">
        <Icon name={indeterminate ? 'minus' : 'check'} weight={2.4} />
      </span>
      {label != null ? <span>{label}</span> : null}
    </label>
  )
}

export interface RadioGroupProps<V extends string> {
  options: { value: V; label: ReactNode; disabled?: boolean }[]
  value?: V
  defaultValue?: V
  onChange?: (value: V) => void
  direction?: 'column' | 'row'
  name?: string
  disabled?: boolean
  'aria-label'?: string
}

export function RadioGroup<V extends string>({
  options,
  value,
  defaultValue,
  onChange,
  direction = 'column',
  name,
  disabled,
  ...aria
}: RadioGroupProps<V>) {
  const [current, setCurrent] = useControlled(value, defaultValue)
  const fallbackName = useId()
  return (
    <div
      role="radiogroup"
      aria-label={aria['aria-label']}
      className={cx('ui-radiogroup', direction === 'row' && 'ui-radiogroup--row')}
    >
      {options.map((o) => (
        <label key={o.value} className={cx('ui-radio', (disabled || o.disabled) && 'ui-disabled')}>
          <input
            type="radio"
            name={name ?? fallbackName}
            value={o.value}
            checked={current === o.value}
            disabled={disabled || o.disabled}
            onChange={() => {
              setCurrent(o.value)
              onChange?.(o.value)
            }}
          />
          <span className="ui-radio__dot" />
          <span>{o.label}</span>
        </label>
      ))}
    </div>
  )
}
