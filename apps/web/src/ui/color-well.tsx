import { type CSSProperties, type KeyboardEvent, type ReactNode, useRef, useState } from 'react'
import { t } from '../i18n'
import { cx } from '../lib/cx'
import { useControlled } from './controlled'
import { TextField } from './form'
import { Float, useDismiss } from './popover'
import './color-well.css'

/** macOS system colors plus black and white. */
const SWATCHES = [
  '#ff383c',
  '#ff8d28',
  '#ffcc00',
  '#34c759',
  '#00c8b3',
  '#00c3d0',
  '#00c0e8',
  '#0088ff',
  '#6155f5',
  '#cb30e0',
  '#ff2d55',
  '#ac7f5e',
  '#8e8e93',
  '#1c1c1e',
  '#ffffff',
]

const same = (a: string, b: string) => a.toLowerCase() === b.toLowerCase()

export interface ColorWellProps {
  value?: string
  defaultValue?: string
  onChange?: (hex: string) => void
  colors?: string[]
  /** Chinese color names for screen readers and tooltips; required with `inline`. */
  names?: string[]
  /** A row of dots (accent-color picker) instead of the well + popover. */
  inline?: boolean
  label?: ReactNode
  defaultOpen?: boolean
  className?: string
  style?: CSSProperties
  'aria-label'?: string
}

/** Color well (NSColorWell) with a swatch popover and hex entry, or an inline radio row of dots. */
export function ColorWell({
  value,
  defaultValue = '#0088ff',
  onChange,
  colors = SWATCHES,
  names = [],
  inline,
  label,
  defaultOpen = false,
  className,
  style,
  ...aria
}: ColorWellProps) {
  const [color, setColor] = useControlled(value, defaultValue)
  const [open, setOpen] = useState(defaultOpen)
  const [draft, setDraft] = useState<string | null>(null)
  const root = useRef<HTMLSpanElement>(null)
  const trigger = useRef<HTMLButtonElement>(null)
  const close = (refocus: boolean) => {
    setOpen(false)
    setDraft(null)
    if (refocus) trigger.current?.focus()
  }
  useDismiss(open, root, close)
  const set = (c: string) => {
    setColor(c)
    onChange?.(c)
  }

  if (inline) {
    const onKeyDown = (e: KeyboardEvent<HTMLDivElement>) => {
      const at = colors.findIndex((c) => same(c, color))
      const next =
        e.key === 'ArrowRight' || e.key === 'ArrowDown'
          ? Math.min(colors.length - 1, at + 1)
          : e.key === 'ArrowLeft' || e.key === 'ArrowUp'
            ? Math.max(0, at - 1)
            : e.key === 'Home'
              ? 0
              : e.key === 'End'
                ? colors.length - 1
                : null
      if (next === null) return
      e.preventDefault()
      const c = colors[next]
      if (!c) return
      set(c)
      e.currentTarget.querySelectorAll<HTMLElement>('[role="radio"]')[next]?.focus()
    }
    const checkedAt = colors.findIndex((c) => same(c, color))
    return (
      <div
        role="radiogroup"
        aria-label={aria['aria-label'] ?? t('颜色')}
        className={cx('ui-colorrow', className)}
        style={style}
        onKeyDown={onKeyDown}
      >
        {colors.map((c, i) => (
          // biome-ignore lint/a11y/useSemanticElements: color dots are buttons in an ARIA radiogroup with one tab stop
          <button
            key={c}
            type="button"
            role="radio"
            aria-checked={i === checkedAt}
            aria-label={names[i] ?? c}
            title={names[i] ?? c}
            tabIndex={i === (checkedAt < 0 ? 0 : checkedAt) ? 0 : -1}
            className="ui-colorrow__dot"
            style={{ '--ui-c': c } as CSSProperties}
            onClick={() => set(c)}
          />
        ))}
      </div>
    )
  }

  const hexOk = draft == null || /^#?[0-9a-f]{6}$/i.test(draft)
  const typed = draft && hexOk ? (draft.startsWith('#') ? draft : `#${draft}`).toLowerCase() : null
  return (
    <div className={cx('ui-field', 'ui-field--auto', className)} style={style}>
      {label ? <span className="ui-field__label">{label}</span> : null}
      <span ref={root} className="ui-anchor">
        <button
          ref={trigger}
          type="button"
          className="ui-colorwell"
          aria-label={t('{label}：{color}', { label: aria['aria-label'] ?? t('颜色'), color })}
          aria-haspopup="dialog"
          aria-expanded={open}
          onClick={() => (open ? close(false) : setOpen(true))}
        >
          <span style={{ background: color }} />
        </button>
        <Float open={open} role="dialog" aria-label={t('选择颜色')} style={{ width: 232 }}>
          <div className="ui-colorwell__grid">
            {colors.map((c) => (
              <button
                key={c}
                type="button"
                aria-label={c}
                aria-pressed={same(c, color)}
                className={cx('ui-colorwell__sw', same(c, color) && 'ui-colorwell__sw--on')}
                style={{ background: c }}
                onClick={() => {
                  set(c)
                  close(true)
                }}
              />
            ))}
          </div>
          <div className="ui-colorwell__hex">
            <span className="ui-colorwell__preview" style={{ background: typed ?? color }} />
            <TextField
              aria-label={t('十六进制颜色')}
              value={draft ?? color}
              error={hexOk ? undefined : t('格式为 #RRGGBB')}
              style={{ flex: 1, minWidth: 0 }}
              onChange={(e) => setDraft(e.target.value)}
              onKeyDown={(e) => {
                if (e.key !== 'Enter' || !typed) return
                set(typed)
                close(true)
              }}
            />
          </div>
        </Float>
      </span>
    </div>
  )
}
