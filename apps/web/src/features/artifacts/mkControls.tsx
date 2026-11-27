import { type KeyboardEvent, type ReactNode, useState } from 'react'
import { t } from '../../i18n'
import { Icon, IconButton, MenuButton } from '../../ui'
import { hexOf } from './Inspector'

/** Enter in a one-line field is done typing: it saves, as leaving it does. */
export const blurOnEnter = (e: KeyboardEvent<HTMLInputElement>) => {
  if (e.key === 'Enter') e.currentTarget.blur()
}

/** A 墨刀 section: a bold title with a fold chevron (and an optional action), its rows below. */
export function Fold({
  title,
  open: initial = true,
  action,
  children,
}: {
  title: string
  open?: boolean
  action?: ReactNode
  children?: ReactNode
}) {
  const [open, setOpen] = useState(initial)
  return (
    <section className="mk-fold">
      <header className="mk-fold__head">
        <h4>{title}</h4>
        {action}
        {children ? (
          <IconButton
            size="small"
            title={open ? t('收起') : t('展开')}
            aria-expanded={open}
            onClick={() => setOpen(!open)}
          >
            {open ? ('chevron-up' as const) : ('chevron-down' as const)}
          </IconButton>
        ) : null}
      </header>
      {open && children ? <div className="mk-fold__body">{children}</div> : null}
    </section>
  )
}

/** A number with its letter (W, H, X…) or icon before it, 墨刀's compact field; `unit` is added to a bare number. */
export function NumField({
  label,
  icon,
  value,
  placeholder,
  unit = 'px',
  invalid,
  disabled,
  readOnly,
  onChange,
}: {
  label: string
  icon?: ReactNode
  value: string
  placeholder?: string
  unit?: string
  invalid?: boolean
  disabled?: boolean
  readOnly?: boolean
  onChange?: (value: string) => void
}) {
  return (
    <label className={`mk-num${invalid ? ' mk-num--bad' : ''}`} title={label}>
      <span className="mk-num__key" aria-hidden="true">
        {icon ?? label.slice(0, 1)}
      </span>
      <input
        aria-label={label}
        value={value}
        placeholder={placeholder}
        disabled={disabled}
        readOnly={readOnly}
        onChange={(e) => onChange?.(e.target.value)}
        onBlur={(e) => {
          const v = e.target.value.trim()
          if (unit && /^-?\d+(\.\d+)?$/.test(v)) onChange?.(`${v}${unit}`)
        }}
        onKeyDown={blurOnEnter}
      />
    </label>
  )
}

const ALPHA = /^#([0-9a-f]{6})([0-9a-f]{2})?$/i

/**
 * 墨刀's colour row: a swatch (any colour), its hex and its opacity; the design system's colours in a menu beside.
 * `value` is the inline value ('' none, `var(--x)` a token, `#rrggbb[aa]`), `shown` the computed colour.
 */
export function ColorField({
  label,
  value,
  shown,
  colors,
  disabled,
  onChange,
}: {
  label: string
  value: string
  shown: string
  colors: [string, string][]
  disabled?: boolean
  onChange: (value: string) => void
}) {
  const token = value.startsWith('var(') ? value : ''
  const m = ALPHA.exec(value)
  const hex = m
    ? `#${m[1]}`
    : hexOf(token ? (colors.find(([k]) => `var(${k})` === token)?.[1] ?? shown) : shown)
  const alpha = m?.[2] ? Math.round((Number.parseInt(m[2], 16) / 255) * 100) : 100
  const set = (h: string, a: number) =>
    onChange(
      a >= 100
        ? h
        : `${h}${Math.round((a / 100) * 255)
            .toString(16)
            .padStart(2, '0')}`,
    )
  return (
    <div className="mk-color">
      <input
        type="color"
        className="art-el__picker"
        aria-label={t('{name}：任意颜色', { name: label })}
        disabled={disabled}
        value={hex}
        onChange={(e) => set(e.target.value, alpha)}
      />
      <span className="mk-color__hex">{token ? token.slice(6, -1) : hex.slice(1).toUpperCase()}</span>
      <input
        className="mk-color__alpha"
        aria-label={t('{name}不透明度', { name: label })}
        value={`${alpha}`}
        disabled={disabled || !!token}
        onChange={(e) => {
          const n = Number(e.target.value)
          if (Number.isFinite(n)) set(hex, Math.max(0, Math.min(100, n)))
        }}
        onKeyDown={blurOnEnter}
      />
      <span className="mk-color__pct">%</span>
      <MenuButton
        className="ui-btn ui-btn--plain ui-btn--small mk-color__tokens"
        aria-label={label}
        title={t('设计系统颜色')}
        disabled={disabled}
        items={[
          { label: t('默认'), value: '', checked: !value },
          ...colors.map(([k]) => ({
            label: k.slice('--color-'.length),
            value: `var(${k})`,
            checked: value === `var(${k})`,
          })),
        ]}
        onSelect={onChange}
      >
        <Icon name="palette" size={13} />
      </MenuButton>
    </div>
  )
}

/** A row of 墨刀's icon toggles (B I U S, alignments): the pressed one's value, or '' when none. */
export function Toggles({
  items,
  disabled,
}: {
  items: { label: string; mark: ReactNode; on: boolean; onClick: () => void }[]
  disabled?: boolean
}) {
  return (
    <div className="mk-toggles">
      {items.map((it) => (
        <button
          key={it.label}
          type="button"
          className="art-el__toggle"
          aria-label={it.label}
          title={it.label}
          aria-pressed={it.on}
          disabled={disabled}
          onClick={it.onClick}
        >
          {it.mark}
        </button>
      ))}
    </div>
  )
}

export const AlignIcon = ({ side }: { side: 'left' | 'center' | 'right' | 'justify' }) => (
  <svg width="14" height="14" viewBox="0 0 14 14" aria-hidden="true">
    {[2, 5.5, 9, 12.5].map((y, i) => {
      const w = side === 'justify' || i % 2 === 0 ? 12 : 8
      const x = side === 'left' || side === 'justify' ? 1 : side === 'right' ? 13 - w : 7 - w / 2
      return <rect key={y} x={x} y={y - 0.6} width={w} height={1.3} rx={0.6} fill="currentColor" />
    })}
  </svg>
)

export const VAlignIcon = ({ side }: { side: 'start' | 'center' | 'end' }) => (
  <svg width="14" height="14" viewBox="0 0 14 14" aria-hidden="true">
    <rect
      x={1}
      y={side === 'start' ? 1 : side === 'end' ? 12 : 6.4}
      width={12}
      height={1.2}
      fill="currentColor"
    />
    <path
      d={
        side === 'start'
          ? 'M7 4v8M4.5 6.5 7 4l2.5 2.5'
          : side === 'end'
            ? 'M7 2v8M4.5 7.5 7 10l2.5-2.5'
            : 'M7 1v4M7 9v4'
      }
      stroke="currentColor"
      strokeWidth="1.2"
      fill="none"
    />
  </svg>
)
