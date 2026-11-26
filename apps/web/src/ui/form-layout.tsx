import { type CSSProperties, type FormEvent, type ReactNode, useEffect, useRef } from 'react'
import { cx } from '../lib/cx'
import './form-layout.css'

/** Classic preferences form for sheets and dialogs: right-aligned label column, controls on the left of the next. */
export function Form({
  id,
  children,
  labelWidth,
  onSubmit,
  className,
  style,
  'aria-label': ariaLabel,
}: {
  id?: string
  children?: ReactNode
  /** Defaults to the longest label; fix it to align several forms in one window. */
  labelWidth?: number | string
  onSubmit?: (e: FormEvent<HTMLFormElement>) => void
  className?: string
  style?: CSSProperties
  'aria-label'?: string
}) {
  const col =
    labelWidth == null ? 'max-content' : typeof labelWidth === 'number' ? `${labelWidth}px` : labelWidth
  return (
    <form
      id={id}
      noValidate
      className={cx('ui-form', className)}
      style={{ gridTemplateColumns: `${col} minmax(0, 1fr)`, ...style }}
      aria-label={ariaLabel}
      onSubmit={(e) => {
        e.preventDefault()
        onSubmit?.(e)
      }}
    >
      {children}
    </form>
  )
}

/** `align="top"` pins the label to the first line of multi-line controls. */
export function FormRow({
  label,
  hint,
  align = 'center',
  colon = true,
  highlighted = false,
  focusTag,
  badge,
  children,
}: {
  label?: string
  hint?: ReactNode
  align?: 'center' | 'top'
  colon?: boolean
  /** Emphasizes and scrolls this row into view when opened from a contextual shortcut. */
  highlighted?: boolean
  focusTag?: string
  badge?: ReactNode
  children?: ReactNode
}) {
  const controlRef = useRef<HTMLDivElement>(null)
  useEffect(() => {
    if (highlighted) controlRef.current?.scrollIntoView?.({ block: 'nearest' })
  }, [highlighted])
  const top = align === 'top' || Boolean(hint) || Boolean(badge)
  return (
    <>
      <div
        className={cx(
          'ui-form__label',
          top && 'ui-form__label--top',
          highlighted && 'ui-form__label--highlight',
        )}
      >
        {label ? `${label}${colon ? '：' : ''}` : null}
      </div>
      <div
        ref={controlRef}
        data-focus-row={focusTag || undefined}
        className={cx(
          'ui-form__control',
          top && 'ui-form__control--top',
          highlighted && 'ui-form__control--highlight',
        )}
      >
        {children}
        {badge ? <div className="ui-form__focus-badge">{badge}</div> : null}
        {hint ? <div className="ui-form__hint">{hint}</div> : null}
      </div>
    </>
  )
}

/** Bottom button row, right-aligned with primary last. */
export function FormActions({ children }: { children?: ReactNode }) {
  return <div className="ui-form__actions">{children}</div>
}

/** Hairline separator; `label` centers text in it, `vertical` sits between inline actions. */
export function Divider({
  vertical,
  label,
  className,
  style,
}: {
  vertical?: boolean
  label?: ReactNode
  className?: string
  style?: CSSProperties
}) {
  if (vertical)
    return (
      // biome-ignore lint/a11y/useSemanticElements: <hr> cannot hold a label or sit inline
      <span
        role="separator"
        aria-orientation="vertical"
        className={cx('ui-divider', 'ui-divider--v', className)}
        style={style}
      />
    )
  return (
    // biome-ignore lint/a11y/useSemanticElements: <hr> cannot hold a label or sit inline
    <div
      role="separator"
      className={cx('ui-divider', label != null && 'ui-divider--label', className)}
      style={style}
    >
      {label != null ? <span>{label}</span> : null}
    </div>
  )
}
