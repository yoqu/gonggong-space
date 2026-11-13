import {
  type AnchorHTMLAttributes,
  type ButtonHTMLAttributes,
  type ReactElement,
  type ReactNode,
  type Ref,
  useCallback,
  useEffect,
  useId,
  useLayoutEffect,
  useRef,
  useState,
} from 'react'
import { t } from '../i18n'
import { cx } from '../lib/cx'
import { useControlled } from './controlled'
import { ProgressIndicator } from './display'
import { Icon, type IconName } from './icon'
import { Float, type Placement, useDismiss } from './popover'
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
  /** Shows a spinner in place of the icon and disables the button; pair with a progressive label (「正在上传」). */
  loading?: boolean
  /** Briefly confirms the action finished: a drawn check, a green tint (see useFlash); pair with 「已…」. */
  done?: boolean
  /** The icon animates its own busy and done states (a GitGlyph): kept instead of the spinner and check. */
  liveIcon?: boolean
}

export type ButtonProps = ButtonBaseProps &
  ({ icon?: Glyph; children: ReactNode } | { icon: Glyph; children?: undefined; 'aria-label': string })

export function Button({
  ref,
  variant = 'default',
  size = 'regular',
  fullWidth,
  loading,
  done,
  liveIcon,
  icon,
  className,
  type = 'button',
  disabled,
  children,
  ...rest
}: ButtonProps) {
  const phase = loading ? 'loading' : done ? 'done' : 'idle'
  const own = useRef<HTMLButtonElement | null>(null)
  useWidthMorph(own, phase)
  const setRef = useCallback(
    (el: HTMLButtonElement | null) => {
      own.current = el
      if (typeof ref === 'function') ref(el)
      else if (ref) ref.current = el
    },
    [ref],
  )
  const glyph =
    liveIcon || phase === 'idle' ? (
      icon ? (
        renderGlyph(icon)
      ) : null
    ) : phase === 'loading' ? (
      <ProgressIndicator variant="spinner" aria-label={t('正在处理')} />
    ) : (
      <svg className="ui-btn__check" viewBox="0 0 16 16" aria-hidden="true">
        <path d="M3.5 8.5l3 3 6-7" />
      </svg>
    )
  return (
    <button
      ref={setRef}
      type={type}
      disabled={disabled || loading}
      aria-busy={loading || undefined}
      className={cx(
        'ui-btn',
        variant !== 'default' && `ui-btn--${variant}`,
        size !== 'regular' && size !== 'md' && `ui-btn--${size}`,
        icon && children == null && 'ui-btn--icon',
        loading && 'ui-btn--loading',
        done && !loading && 'ui-btn--done',
        fullWidth && 'ui-btn--full',
        className,
      )}
      {...rest}
    >
      {glyph ? (
        <span key={liveIcon ? 'live' : phase} className="ui-btn__glyph">
          {glyph}
        </span>
      ) : null}
      {children}
    </button>
  )
}

const reducedMotion = () =>
  typeof window.matchMedia === 'function' && window.matchMedia('(prefers-reduced-motion: reduce)').matches

/** A button turning busy or done changes its label: glide to the new width instead of jumping (other renders don't). */
function useWidthMorph(ref: { current: HTMLElement | null }, phase: string) {
  const last = useRef<{ phase: string; width: number } | null>(null)
  useLayoutEffect(() => {
    const el = ref.current
    if (!el) return
    const width = el.offsetWidth
    const prev = last.current
    last.current = { phase, width }
    if (!prev || prev.phase === phase || prev.width === width || !el.animate || reducedMotion()) return
    el.animate([{ width: `${prev.width}px` }, { width: `${width}px` }], {
      duration: 280,
      easing: 'cubic-bezier(0.2, 0.9, 0.25, 1)',
    })
  })
}

/** On for a moment after `trigger()` (a button's done state); retriggering restarts it. */
export function useFlash(ms = 1200): [boolean, () => void] {
  const [on, setOn] = useState(false)
  const timer = useRef<ReturnType<typeof setTimeout>>(undefined)
  useEffect(() => () => clearTimeout(timer.current), [])
  const trigger = useCallback(() => {
    clearTimeout(timer.current)
    setOn(true)
    timer.current = setTimeout(() => setOn(false), ms)
  }, [ms])
  return [on, trigger]
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

export function CloseButton({ onClick, title = t('关闭#close') }: { onClick?: () => void; title?: string }) {
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

export interface CheckboxGroupProps<V extends string> {
  options: { value: V; label: ReactNode; disabled?: boolean }[]
  value?: V[]
  defaultValue?: V[]
  onChange?: (value: V[]) => void
  direction?: 'column' | 'row'
  disabled?: boolean
  'aria-label'?: string
}

export function CheckboxGroup<V extends string>({
  options,
  value,
  defaultValue = [],
  onChange,
  direction = 'column',
  disabled,
  ...aria
}: CheckboxGroupProps<V>) {
  const [current, setCurrent] = useControlled(value, defaultValue)
  return (
    // biome-ignore lint/a11y/useSemanticElements: a <fieldset> would need a legend; the group is named by aria-label
    <div
      role="group"
      aria-label={aria['aria-label']}
      className={cx('ui-radiogroup', direction === 'row' && 'ui-radiogroup--row')}
    >
      {options.map((o) => (
        <Checkbox
          key={o.value}
          label={o.label}
          checked={current.includes(o.value)}
          disabled={disabled || o.disabled}
          onChange={(on) => {
            const next = on ? [...current, o.value] : current.filter((v) => v !== o.value)
            setCurrent(next)
            onChange?.(next)
          }}
        />
      ))}
    </div>
  )
}

export interface LinkProps extends AnchorHTMLAttributes<HTMLAnchorElement> {
  /** Opens in a new window and appends an external-link glyph that screen readers announce. */
  external?: boolean
}

/** Navigation text link; actions use `Button variant="plain"` instead. */
export function Link({ external, className, children, target, rel, ...rest }: LinkProps) {
  return (
    <a
      className={cx('ui-link', className)}
      target={external ? '_blank' : target}
      rel={external ? 'noopener noreferrer' : rel}
      {...rest}
    >
      {children}
      {external ? (
        <Icon name="external" weight={1.6} label={t('（在新窗口打开）')} className="ui-link__ext" />
      ) : null}
    </a>
  )
}

export interface HelpButtonProps {
  /** One or two sentences shown in a popover; without it the button calls `onClick` (open full help). */
  help?: ReactNode
  onClick?: () => void
  placement?: Placement
  defaultOpen?: boolean
  'aria-label'?: string
}

export function HelpButton({
  help,
  onClick,
  placement = 'top-start',
  defaultOpen = false,
  ...aria
}: HelpButtonProps) {
  const [open, setOpen] = useState(defaultOpen)
  const root = useRef<HTMLSpanElement>(null)
  const trigger = useRef<HTMLButtonElement>(null)
  useDismiss(open, root, (refocus) => {
    setOpen(false)
    if (refocus) trigger.current?.focus()
  })
  const label = aria['aria-label'] ?? t('帮助')
  return (
    <span ref={root} className="ui-anchor">
      <button
        ref={trigger}
        type="button"
        className="ui-helpbtn"
        aria-label={label}
        aria-haspopup={help ? 'dialog' : undefined}
        aria-expanded={help ? open : undefined}
        onClick={help ? () => setOpen(!open) : onClick}
      >
        ?
      </button>
      {help ? (
        <Float open={open} placement={placement} role="dialog" aria-label={t('帮助')} style={{ width: 260 }}>
          <div className="ui-helptext">{help}</div>
        </Float>
      ) : null}
    </span>
  )
}
