import {
  type CSSProperties,
  type InputHTMLAttributes,
  type ReactNode,
  type Ref,
  type TextareaHTMLAttributes,
  useId,
} from 'react'
import { cx } from '../lib/cx'
import { useControlled } from './controlled'
import { Icon } from './icon'
import './form.css'

export interface InputProps extends Omit<InputHTMLAttributes<HTMLInputElement>, 'size'> {
  ref?: Ref<HTMLInputElement>
  /** `sm`/`md` are pre-Pane names and render at the regular size. */
  size?: 'regular' | 'large' | 'sm' | 'md'
  mono?: boolean
  invalid?: boolean
}

export function Input({ size, mono, invalid, className, ...rest }: InputProps) {
  return (
    <input
      aria-invalid={invalid || undefined}
      className={cx('ui-input', size === 'large' && 'ui-input--large', mono && 'ui-input--mono', className)}
      {...rest}
    />
  )
}

export interface TextareaProps extends TextareaHTMLAttributes<HTMLTextAreaElement> {
  ref?: Ref<HTMLTextAreaElement>
  invalid?: boolean
}

export function Textarea({ invalid, className, ...rest }: TextareaProps) {
  return (
    <textarea
      aria-invalid={invalid || undefined}
      className={cx('ui-input', 'ui-input--multiline', className)}
      {...rest}
    />
  )
}

/** Stacked caption above a control passed as children; the wrapping <label> names it. */
export function Field({ label, children }: { label: ReactNode; children: ReactNode }) {
  return (
    // biome-ignore lint/a11y/noLabelWithoutControl: the control is passed in as children
    <label className="ui-field">
      <span className="ui-field__label">{label}</span>
      {children}
    </label>
  )
}

interface TextFieldOwnProps {
  label?: ReactNode
  hint?: ReactNode
  /** Replaces the hint, turns the stroke red and adds a warning sign, so it never relies on color alone. */
  error?: ReactNode
  size?: 'regular' | 'large'
  className?: string
  style?: CSSProperties
}

export type TextFieldProps = TextFieldOwnProps &
  (
    | ({ multiline?: false } & Omit<InputProps, 'size' | 'invalid' | 'className' | 'style'>)
    | ({ multiline: true } & Omit<TextareaProps, 'invalid' | 'className' | 'style'>)
  )

export function TextField({ label, hint, error, size, className, style, ...control }: TextFieldProps) {
  const id = useId()
  const note = error ?? hint
  const described = note ? `${id}-note` : undefined
  const common = { id: control.id ?? id, 'aria-describedby': described, invalid: !!error }
  let field: ReactNode
  if (control.multiline) {
    const { multiline: _, ...rest } = control
    field = <Textarea {...rest} {...common} />
  } else {
    const { multiline: _, ...rest } = control
    field = <Input type="text" {...rest} {...common} size={size} />
  }
  return (
    <div className={cx('ui-field', className)} style={style}>
      {label ? (
        <label className="ui-field__label" htmlFor={common.id}>
          {label}
        </label>
      ) : null}
      {field}
      {note ? (
        <span id={described} className={cx('ui-field__hint', error != null && 'ui-field__hint--error')}>
          {note}
        </span>
      ) : null}
    </div>
  )
}

export interface SearchFieldProps {
  placeholder?: string
  value?: string
  defaultValue?: string
  onChange?: (text: string) => void
  onSubmit?: (text: string) => void
  className?: string
  style?: CSSProperties
  'aria-label'?: string
}

export function SearchField({
  placeholder = '搜索',
  value,
  defaultValue = '',
  onChange,
  onSubmit,
  className,
  style,
  ...aria
}: SearchFieldProps) {
  const [text, setText] = useControlled(value, defaultValue)
  const set = (v: string) => {
    setText(v)
    onChange?.(v)
  }
  return (
    <div className={cx('ui-search', className)} style={style}>
      <Icon name="search" weight={1.7} />
      <input
        type="search"
        className="ui-input"
        placeholder={placeholder}
        value={text}
        aria-label={aria['aria-label'] ?? placeholder}
        onChange={(e) => set(e.target.value)}
        onKeyDown={(e) => {
          if (e.key === 'Enter') onSubmit?.(text)
        }}
      />
      {text ? (
        <button type="button" className="ui-search__clear" aria-label="清除" onClick={() => set('')}>
          <Icon name="xmark" weight={2.6} />
        </button>
      ) : null}
    </div>
  )
}

export interface SliderProps {
  min?: number
  max?: number
  step?: number
  value?: number
  defaultValue?: number
  onChange?: (value: number) => void
  /** Number of tick marks, for discrete steps. */
  ticks?: number
  minLabel?: ReactNode
  maxLabel?: ReactNode
  disabled?: boolean
  className?: string
  style?: CSSProperties
  'aria-label'?: string
}

export function Slider({
  min = 0,
  max = 100,
  step = 1,
  value,
  defaultValue = (min + max) / 2,
  onChange,
  ticks,
  minLabel,
  maxLabel,
  disabled,
  className,
  style,
  ...aria
}: SliderProps) {
  const [v, setV] = useControlled(value, defaultValue)
  const fill = { '--ui-fill': `${((v - min) / (max - min)) * 100}%` } as CSSProperties
  return (
    <div className={cx('ui-slider', disabled && 'ui-disabled', className)} style={{ ...fill, ...style }}>
      <input
        type="range"
        min={min}
        max={max}
        step={step}
        value={v}
        disabled={disabled}
        aria-label={aria['aria-label']}
        onChange={(e) => {
          const next = Number(e.target.value)
          setV(next)
          onChange?.(next)
        }}
      />
      {ticks ? (
        <div className="ui-slider__ticks">
          {Array.from({ length: ticks }, (_, i) => (
            // biome-ignore lint/suspicious/noArrayIndexKey: ticks are identical and positional
            <i key={i} />
          ))}
        </div>
      ) : null}
      {minLabel || maxLabel ? (
        <div className="ui-slider__labels">
          <span>{minLabel}</span>
          <span>{maxLabel}</span>
        </div>
      ) : null}
    </div>
  )
}
