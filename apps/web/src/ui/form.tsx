import {
  type CSSProperties,
  type InputHTMLAttributes,
  type ReactNode,
  type Ref,
  type RefObject,
  type TextareaHTMLAttributes,
  useId,
  useLayoutEffect,
  useRef,
} from 'react'
import { t } from '../i18n'
import { cx } from '../lib/cx'
import { useControlled } from './controlled'
import { ICON_NAMES, Icon, type IconName } from './icon'
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

/** Bare multi-line control, styled like TextArea but without label, hint or count. */
export function Textarea({ invalid, className, ...rest }: TextareaProps) {
  return (
    <textarea
      aria-invalid={invalid || undefined}
      className={cx('ui-input', 'ui-input--multiline', className)}
      {...rest}
    />
  )
}

function assignRef<T>(ref: Ref<T> | undefined, el: T | null) {
  if (typeof ref === 'function') ref(el)
  else if (ref) (ref as RefObject<T | null>).current = el
}

/** Hint line under a field; an error replaces the hint and gets a warning icon so it never relies on color alone. */
function FieldNote({
  id,
  hint,
  error,
  extra,
}: {
  id: string
  hint?: ReactNode
  error?: ReactNode
  extra?: ReactNode
}) {
  const note = error ?? hint
  if (note == null && extra == null) return null
  return (
    <span id={id} className={cx('ui-field__hint', error != null && 'ui-field__hint--error')}>
      {error != null ? <Icon name="warning" size={12} className="ui-field__hint-icon" /> : null}
      {note}
      {extra}
    </span>
  )
}

/** An icon name renders as that icon; anything else (「https://」「元 / 月」) as text. */
const affix = (x: ReactNode) =>
  typeof x === 'string' && (ICON_NAMES as string[]).includes(x) ? <Icon name={x as IconName} /> : x

interface FieldCommon {
  label?: ReactNode
  hint?: ReactNode
  /** Replaces the hint, turns the stroke red and adds a warning sign. */
  error?: ReactNode
  className?: string
  style?: CSSProperties
}

export interface LineFieldProps
  extends FieldCommon,
    Omit<InputProps, 'size' | 'invalid' | 'className' | 'style' | 'prefix'> {
  multiline?: false
  size?: 'regular' | 'large'
  /** Text or an icon name inside the field, before the input. */
  prefix?: ReactNode
  /** Text (a unit) or an icon name inside the field, after the input. */
  suffix?: ReactNode
  /** Shows a clear button while there is text. */
  clearable?: boolean
  onClear?: () => void
  /** Extra controls inside the field, before the suffix (SecureField's eye button). */
  trailing?: ReactNode
  inputRef?: RefObject<HTMLInputElement | null>
}

export interface TextAreaProps
  extends FieldCommon,
    Omit<TextareaHTMLAttributes<HTMLTextAreaElement>, 'prefix'> {
  ref?: Ref<HTMLTextAreaElement>
  /** Grows with the content up to `maxHeight` (default 240). */
  autoGrow?: boolean
  maxHeight?: number
  /** With `maxLength`, shows 「已输入 / 上限」 unless false. */
  showCount?: boolean
}

export type TextFieldProps = LineFieldProps | ({ multiline: true; size?: 'regular' } & TextAreaProps)

export function TextField(props: TextFieldProps) {
  if (props.multiline) {
    const { multiline: _, size: __, ...rest } = props
    return <TextArea {...rest} />
  }
  return <LineField {...props} />
}

function LineField({
  label,
  hint,
  error,
  size,
  className,
  style,
  prefix,
  suffix,
  clearable,
  onClear,
  trailing,
  inputRef,
  ref,
  id: idProp,
  value,
  defaultValue,
  onChange,
  multiline: _,
  ...rest
}: LineFieldProps) {
  const autoId = useId()
  const id = idProp ?? autoId
  const noteId = `${id}-note`
  const [text, setText] = useControlled<InputProps['value']>(value, defaultValue ?? '')
  const own = useRef<HTMLInputElement | null>(null)
  const affixed = prefix != null || suffix != null || clearable || trailing != null
  const input = (
    <Input
      type="text"
      {...rest}
      ref={(el) => {
        own.current = el
        if (inputRef) inputRef.current = el
        assignRef(ref, el)
      }}
      id={id}
      value={text}
      invalid={error != null}
      aria-describedby={error != null || hint != null ? noteId : undefined}
      size={affixed ? undefined : size}
      className={affixed ? 'ui-input--bare' : undefined}
      onChange={(e) => {
        setText(e.target.value)
        onChange?.(e)
      }}
    />
  )
  return (
    <div className={cx('ui-field', className)} style={style}>
      {label ? (
        <label className="ui-field__label" htmlFor={id}>
          {label}
        </label>
      ) : null}
      {affixed ? (
        <span
          className={cx(
            'ui-inputwrap',
            size === 'large' && 'ui-inputwrap--large',
            error != null && 'ui-inputwrap--invalid',
            rest.disabled && 'ui-disabled',
          )}
        >
          {prefix != null ? <span className="ui-inputwrap__affix">{affix(prefix)}</span> : null}
          {input}
          {clearable && String(text) ? (
            <button
              type="button"
              className="ui-search__clear ui-inputwrap__clear"
              aria-label={t('清除')}
              onClick={() => {
                setText('')
                onClear?.()
                own.current?.focus()
              }}
            >
              <Icon name="xmark" weight={2.6} />
            </button>
          ) : null}
          {trailing}
          {suffix != null ? <span className="ui-inputwrap__affix">{affix(suffix)}</span> : null}
        </span>
      ) : (
        input
      )}
      <FieldNote id={noteId} hint={hint} error={error} />
    </div>
  )
}

export function TextArea({
  label,
  hint,
  error,
  autoGrow,
  maxHeight = 240,
  showCount = true,
  className,
  style,
  id: idProp,
  rows = 3,
  value,
  defaultValue,
  onChange,
  ref,
  ...rest
}: TextAreaProps) {
  const autoId = useId()
  const id = idProp ?? autoId
  const noteId = `${id}-note`
  const [text, setText] = useControlled<TextAreaProps['value']>(value, defaultValue ?? '')
  const own = useRef<HTMLTextAreaElement | null>(null)
  // biome-ignore lint/correctness/useExhaustiveDependencies: re-measure whenever the text changes
  useLayoutEffect(() => {
    const t = own.current
    if (!autoGrow || !t) return
    t.style.height = 'auto'
    t.style.height = `${Math.min(t.scrollHeight + 2, maxHeight)}px`
  }, [text, autoGrow, maxHeight])
  const count =
    rest.maxLength && showCount ? (
      <span className="ui-field__count" aria-live="polite">
        {String(text).length} / {rest.maxLength}
      </span>
    ) : null
  return (
    <div className={cx('ui-field', 'ui-field--wide', className)} style={style}>
      {label ? (
        <label className="ui-field__label" htmlFor={id}>
          {label}
        </label>
      ) : null}
      <Textarea
        {...rest}
        ref={(el) => {
          own.current = el
          assignRef(ref, el)
        }}
        id={id}
        rows={rows}
        value={text}
        invalid={error != null}
        aria-describedby={error != null || hint != null || count ? noteId : undefined}
        onChange={(e) => {
          setText(e.target.value)
          onChange?.(e)
        }}
      />
      <FieldNote id={noteId} hint={hint} error={error} extra={count} />
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
  placeholder = t('搜索'),
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
        <button type="button" className="ui-search__clear" aria-label={t('清除')} onClick={() => set('')}>
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
