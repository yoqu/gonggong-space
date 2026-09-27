import { type CSSProperties, type KeyboardEvent, type ReactNode, useId, useRef, useState } from 'react'
import { cx } from '../lib/cx'
import { useControlled } from './controlled'
import { type LineFieldProps, TextField } from './form'
import { Icon } from './icon'
import { useDismiss } from './popover'
import './fields.css'

export interface SecureFieldProps extends Omit<LineFieldProps, 'type' | 'multiline'> {
  /** `false` hides the show-password button (confirming an old password). */
  revealable?: boolean
}

/** Password field with a show/hide button and a caps-lock warning, like the macOS login field. */
export function SecureField({
  revealable = true,
  autoComplete = 'current-password',
  hint,
  onKeyDown,
  onKeyUp,
  onBlur,
  ...rest
}: SecureFieldProps) {
  const [shown, setShown] = useState(false)
  const [caps, setCaps] = useState(false)
  const track = (e: KeyboardEvent<HTMLInputElement>) => setCaps(e.getModifierState?.('CapsLock') ?? false)
  return (
    <TextField
      {...rest}
      type={shown ? 'text' : 'password'}
      autoComplete={autoComplete}
      onKeyDown={(e) => {
        track(e)
        onKeyDown?.(e)
      }}
      onKeyUp={(e) => {
        track(e)
        onKeyUp?.(e)
      }}
      onBlur={(e) => {
        setCaps(false)
        onBlur?.(e)
      }}
      hint={
        caps ? (
          <span className="ui-caps">
            <Icon name="capslock" />
            大写锁定已打开
          </span>
        ) : (
          hint
        )
      }
      trailing={
        <>
          {caps ? (
            <span className="ui-inputwrap__affix" title="大写锁定已打开">
              <Icon name="capslock" />
            </span>
          ) : null}
          {revealable ? (
            <button
              type="button"
              className="ui-inputwrap__btn"
              aria-label={shown ? '隐藏明文' : '显示明文'}
              aria-pressed={shown}
              onMouseDown={(e) => e.preventDefault()}
              onClick={() => setShown(!shown)}
            >
              <Icon name={shown ? 'eye-slash' : 'eye'} />
            </button>
          ) : null}
        </>
      }
    />
  )
}

export interface StepperProps {
  /** `null` shows an empty field (no value set); typing or an arrow sets one. */
  value?: number | null
  defaultValue?: number
  onChange?: (value: number) => void
  min?: number
  max?: number
  step?: number
  /** Decimal places shown; defaults to those of `step`. */
  precision?: number
  unit?: ReactNode
  label?: ReactNode
  /** Input width in px. */
  width?: number
  disabled?: boolean
  className?: string
  style?: CSSProperties
  'aria-label'?: string
}

/** Number field with NSStepper arrows; ↑↓ step, ⇧↑↓ ten steps, typed values commit on Enter or blur. */
export function Stepper({
  value,
  defaultValue,
  onChange,
  min = Number.NEGATIVE_INFINITY,
  max = Number.POSITIVE_INFINITY,
  step = 1,
  precision = (String(step).split('.')[1] ?? '').length,
  unit,
  label,
  width = 72,
  disabled,
  className,
  style,
  ...aria
}: StepperProps) {
  const id = useId()
  const [current, setCurrent] = useControlled<number | null>(
    value,
    defaultValue ?? (Number.isFinite(min) ? min : 0),
  )
  const base = current ?? (Number.isFinite(min) ? min : 0)
  const [draft, setDraft] = useState<string | null>(null)
  const set = (n: number) => {
    const next = Math.min(max, Math.max(min, Number(n.toFixed(precision))))
    setCurrent(next)
    setDraft(null)
    onChange?.(next)
  }
  const commit = () => {
    if (draft == null) return
    const n = Number.parseFloat(draft)
    if (Number.isNaN(n)) setDraft(null)
    else set(n)
  }
  return (
    <div className={cx('ui-field', 'ui-field--auto', className)} style={style}>
      {label ? (
        <label className="ui-field__label" htmlFor={id}>
          {label}
        </label>
      ) : null}
      <span className="ui-stepper">
        <input
          id={id}
          className="ui-input ui-stepper__input"
          inputMode="decimal"
          role="spinbutton"
          aria-valuemin={Number.isFinite(min) ? min : undefined}
          aria-valuemax={Number.isFinite(max) ? max : undefined}
          aria-valuenow={current ?? undefined}
          aria-label={label ? undefined : aria['aria-label']}
          disabled={disabled}
          value={draft ?? current?.toFixed(precision) ?? ''}
          style={{ width }}
          onChange={(e) => setDraft(e.target.value)}
          onBlur={commit}
          onKeyDown={(e) => {
            if (e.key === 'ArrowUp' || e.key === 'ArrowDown') {
              e.preventDefault()
              set(base + step * (e.shiftKey ? 10 : 1) * (e.key === 'ArrowUp' ? 1 : -1))
            } else if (e.key === 'Enter') commit()
          }}
        />
        {unit ? <span className="ui-stepper__unit">{unit}</span> : null}
        <span className="ui-stepper__arrows">
          <button
            type="button"
            tabIndex={-1}
            aria-label="增加"
            disabled={disabled || base >= max}
            onClick={() => set(base + step)}
          >
            <Icon name="chevron-up" weight={2.4} />
          </button>
          <button
            type="button"
            tabIndex={-1}
            aria-label="减少"
            disabled={disabled || base <= min}
            onClick={() => set(base - step)}
          >
            <Icon name="chevron-down" weight={2.4} />
          </button>
        </span>
      </span>
    </div>
  )
}

export interface ComboOption {
  value: string
  label: string
  /** Shown on the right of the row. */
  detail?: string
}

export interface ComboBoxProps {
  options: (string | ComboOption)[]
  value?: string
  defaultValue?: string
  /** Called when an option is picked from the list. */
  onChange?: (value: string, option: ComboOption) => void
  /** Called on free typing. */
  onInput?: (text: string) => void
  placeholder?: string
  label?: ReactNode
  defaultOpen?: boolean
  disabled?: boolean
  className?: string
  style?: CSSProperties
  /** Names the input when there is no visible `label`. */
  'aria-label'?: string
}

/** Text field with a suggestion list (NSComboBox): pick from the list or type any value. */
export function ComboBox({
  options,
  value,
  defaultValue = '',
  onChange,
  onInput,
  placeholder,
  label,
  defaultOpen = false,
  disabled,
  className,
  style,
  'aria-label': ariaLabel,
}: ComboBoxProps) {
  const id = useId()
  const listId = `${id}-list`
  const [text, setText] = useControlled(value, defaultValue)
  const [open, setOpen] = useState(defaultOpen)
  const [filtering, setFiltering] = useState(false)
  const [active, setActive] = useState(-1)
  const root = useRef<HTMLDivElement>(null)
  useDismiss(open, root, () => setOpen(false))
  const all = options.map((o) => (typeof o === 'string' ? { value: o, label: o } : o))
  const q = text.toLowerCase()
  const list = filtering && q ? all.filter((o) => o.label.toLowerCase().includes(q)) : all
  const shown = open && list.length > 0
  const choose = (o: ComboOption) => {
    setText(o.label)
    setOpen(false)
    setFiltering(false)
    setActive(-1)
    onChange?.(o.value, o)
  }
  return (
    <div ref={root} className={cx('ui-field', 'ui-combo', className)} style={style}>
      {label ? (
        <label className="ui-field__label" htmlFor={id}>
          {label}
        </label>
      ) : null}
      <span className={cx('ui-inputwrap', disabled && 'ui-disabled')}>
        <input
          id={id}
          className="ui-input ui-input--bare"
          role="combobox"
          aria-label={ariaLabel}
          aria-expanded={shown}
          aria-controls={listId}
          aria-autocomplete="list"
          aria-activedescendant={shown && active >= 0 ? `${listId}-${active}` : undefined}
          placeholder={placeholder}
          value={text}
          disabled={disabled}
          onChange={(e) => {
            setText(e.target.value)
            setFiltering(true)
            setOpen(true)
            setActive(0)
            onInput?.(e.target.value)
          }}
          onKeyDown={(e) => {
            if (e.key === 'ArrowDown') {
              e.preventDefault()
              if (open) setActive(Math.min(list.length - 1, active + 1))
              else {
                setOpen(true)
                setActive(0)
              }
            } else if (e.key === 'ArrowUp') {
              e.preventDefault()
              setActive(Math.max(0, active - 1))
            } else if (e.key === 'Enter' && shown && list[active]) {
              e.preventDefault()
              choose(list[active])
            }
          }}
        />
        <button
          type="button"
          tabIndex={-1}
          className="ui-inputwrap__btn"
          aria-label="显示选项"
          onClick={() => {
            setFiltering(false)
            setOpen(!open)
            setActive(-1)
          }}
        >
          <Icon name="chevron-down" weight={2.2} />
        </button>
      </span>
      {shown ? (
        <div id={listId} role="listbox" className="ui-float ui-float--menu ui-combo__list">
          {list.map((o, i) => (
            <div
              key={o.value}
              id={`${listId}-${i}`}
              role="option"
              tabIndex={-1}
              aria-selected={i === active}
              data-active={i === active || undefined}
              className="ui-float__item"
              onMouseEnter={() => setActive(i)}
              onMouseDown={(e) => {
                e.preventDefault()
                choose(o)
              }}
            >
              <span className="ui-float__label">{o.label}</span>
              {o.detail ? <span className="ui-float__detail">{o.detail}</span> : null}
            </div>
          ))}
        </div>
      ) : null}
    </div>
  )
}

export type Token = string | { label: string; tone?: 'blue' | 'gray' | 'orange' | 'green'; detail?: string }

const tokenOf = (t: Token) => (typeof t === 'string' ? { label: t } : t)

export interface TokenFieldProps {
  value?: Token[]
  defaultValue?: Token[]
  onChange?: (tokens: Token[]) => void
  /** Matched by substring while typing, up to six; `detail` shows on the right. */
  suggestions?: Token[]
  label?: ReactNode
  placeholder?: string
  hint?: ReactNode
  /** Turn leftover text into a token on blur (default true). */
  commitOnBlur?: boolean
  className?: string
  style?: CSSProperties
  /** Names the input when there is no visible `label` (a FormRow label). */
  'aria-label'?: string
}

/** Multi-value field (NSTokenField): Enter, Tab, comma or semicolon commits; Backspace on empty removes the last. */
export function TokenField({
  value,
  defaultValue = [],
  onChange,
  suggestions = [],
  label,
  placeholder,
  hint,
  commitOnBlur = true,
  className,
  style,
  'aria-label': ariaLabel,
}: TokenFieldProps) {
  const id = useId()
  const listId = `${id}-list`
  const [tokens, setTokens] = useControlled(value, defaultValue)
  const [text, setText] = useState('')
  const [active, setActive] = useState(0)
  const input = useRef<HTMLInputElement>(null)
  const labels = tokens.map((t) => tokenOf(t).label)
  const matches = text
    ? suggestions
        .map(tokenOf)
        .filter((s) => s.label.toLowerCase().includes(text.toLowerCase()) && !labels.includes(s.label))
        .slice(0, 6)
    : []
  const set = (next: Token[]) => {
    setTokens(next)
    onChange?.(next)
  }
  const add = (t: Exclude<Token, string>) => {
    const name = t.label.trim()
    setText('')
    setActive(0)
    if (!name || labels.includes(name)) return
    set([...tokens, t.tone || t.detail ? { ...t, label: name } : name])
  }
  const remove = (i: number) => {
    set(tokens.filter((_, j) => j !== i))
    input.current?.focus()
  }
  return (
    <div className={cx('ui-field', 'ui-tokenfield', className)} style={style}>
      {label ? (
        <label className="ui-field__label" htmlFor={id}>
          {label}
        </label>
      ) : null}
      {/* biome-ignore lint/a11y/noStaticElementInteractions: pressing the empty box area focuses the input */}
      <div
        className="ui-tokenfield__box"
        onMouseDown={(e) => {
          if (e.target !== e.currentTarget) return
          e.preventDefault()
          input.current?.focus()
        }}
      >
        {tokens.map((t, i) => {
          const k = tokenOf(t)
          return (
            <span key={k.label} className={cx('ui-token', k.tone && `ui-token--${k.tone}`)}>
              {k.label}
              <button
                type="button"
                tabIndex={-1}
                className="ui-token__x"
                aria-label={`移除 ${k.label}`}
                onClick={() => remove(i)}
              >
                <Icon name="xmark" weight={2.4} />
              </button>
            </span>
          )
        })}
        <input
          ref={input}
          id={id}
          className="ui-tokenfield__input"
          value={text}
          placeholder={tokens.length ? '' : placeholder}
          role="combobox"
          aria-label={label ? undefined : ariaLabel}
          aria-expanded={matches.length > 0}
          aria-controls={listId}
          aria-autocomplete="list"
          aria-activedescendant={matches.length ? `${listId}-${active}` : undefined}
          onChange={(e) => {
            const v = e.target.value
            if (/[,，;；]$/.test(v)) add({ label: v.slice(0, -1) })
            else {
              setText(v)
              setActive(0)
            }
          }}
          onKeyDown={(e) => {
            if (e.nativeEvent.isComposing) return
            if (matches.length && (e.key === 'ArrowDown' || e.key === 'ArrowUp')) {
              e.preventDefault()
              setActive((active + (e.key === 'ArrowDown' ? 1 : -1) + matches.length) % matches.length)
            } else if ((e.key === 'Enter' || e.key === 'Tab') && text) {
              e.preventDefault()
              add(matches[active] ?? { label: text })
            } else if (e.key === 'Backspace' && !text && tokens.length) remove(tokens.length - 1)
            else if (e.key === 'Escape') setText('')
          }}
          onBlur={() => {
            if (text && commitOnBlur) add({ label: text })
          }}
        />
      </div>
      {matches.length ? (
        <div id={listId} role="listbox" className="ui-float ui-float--menu ui-combo__list">
          {matches.map((s, i) => (
            <div
              key={s.label}
              id={`${listId}-${i}`}
              role="option"
              tabIndex={-1}
              aria-selected={i === active}
              data-active={i === active || undefined}
              className="ui-float__item"
              onMouseEnter={() => setActive(i)}
              onMouseDown={(e) => {
                e.preventDefault()
                add(s)
              }}
            >
              <span className="ui-float__label">{s.label}</span>
              {s.detail ? <span className="ui-float__detail">{s.detail}</span> : null}
            </div>
          ))}
        </div>
      ) : null}
      {hint ? <span className="ui-field__hint">{hint}</span> : null}
    </div>
  )
}
