import type { CSSProperties, ReactNode } from 'react'
import { t } from '../i18n'
import { cx } from '../lib/cx'
import { useControlled } from './controlled'
import './level.css'

const STAR = 'M9 1.8l2.2 4.5 4.9.7-3.6 3.5.9 4.9L9 13.1l-4.4 2.3.9-4.9L1.9 7l4.9-.7z'

export interface LevelIndicatorProps {
  kind?: 'capacity' | 'discrete' | 'rating'
  value?: number
  defaultValue?: number
  onChange?: (value: number) => void
  /** Defaults to 100, or 5 for ratings. */
  max?: number
  warning?: number
  critical?: number
  segments?: number
  parts?: { value: number; color?: string; label?: string }[]
  /** Text above a capacity bar; color alone must not carry the level. */
  label?: ReactNode
  editable?: boolean
  /** Star size for ratings. */
  size?: number
  className?: string
  style?: CSSProperties
  'aria-label'?: string
}

/** NSLevelIndicator: continuous capacity bar, discrete segments or star rating. */
export function LevelIndicator({
  kind = 'capacity',
  value,
  defaultValue = 0,
  onChange,
  max = kind === 'rating' ? 5 : 100,
  warning,
  critical,
  segments = 10,
  parts,
  label,
  editable,
  size = 14,
  className,
  style,
  'aria-label': ariaLabel,
}: LevelIndicatorProps) {
  const [raw, setRaw] = useControlled(value, defaultValue)
  const v = Math.max(0, Math.min(max, raw))
  const tone =
    critical != null && v >= critical ? 'critical' : warning != null && v >= warning ? 'warning' : 'normal'
  const set = (n: number) => {
    const next = Math.max(0, Math.min(max, n))
    setRaw(next)
    onChange?.(next)
  }

  if (kind === 'rating') {
    const stars = Array.from({ length: max }, (_, i) => (
      <svg
        // biome-ignore lint/suspicious/noArrayIndexKey: stars are positional
        key={i}
        viewBox="0 0 18 18"
        width={size}
        height={size}
        className={i < v ? 'on' : undefined}
        aria-hidden="true"
        onClick={editable ? () => set(i + 1 === v ? 0 : i + 1) : undefined}
      >
        <path d={STAR} strokeLinejoin="round" />
      </svg>
    ))
    const name = t('{label}：{v} / {max}', { label: ariaLabel ?? t('评分'), v, max })
    return editable ? (
      <span
        className={cx('ui-rating', 'ui-rating--edit', className)}
        style={style}
        role="slider"
        tabIndex={0}
        aria-label={name}
        aria-valuemin={0}
        aria-valuemax={max}
        aria-valuenow={v}
        onKeyDown={(e) => {
          if (e.key === 'ArrowRight' || e.key === 'ArrowUp') {
            e.preventDefault()
            set(v + 1)
          } else if (e.key === 'ArrowLeft' || e.key === 'ArrowDown') {
            e.preventDefault()
            set(v - 1)
          } else if (/^[0-9]$/.test(e.key)) set(Number(e.key))
        }}
      >
        {stars}
      </span>
    ) : (
      <span className={cx('ui-rating', className)} style={style} role="img" aria-label={name}>
        {stars}
      </span>
    )
  }

  const meter = {
    role: 'meter',
    'aria-valuemin': 0,
    'aria-valuemax': max,
    'aria-valuenow': v,
    'aria-label': ariaLabel,
  } as const

  if (kind === 'discrete') {
    const on = Math.round((v / max) * segments)
    return (
      <span
        className={cx('ui-level', 'ui-level--discrete', `ui-level--${tone}`, className)}
        style={style}
        {...meter}
      >
        {Array.from({ length: segments }, (_, i) => (
          // biome-ignore lint/suspicious/noArrayIndexKey: segments are positional
          <i key={i} className={i < on ? 'on' : undefined} />
        ))}
      </span>
    )
  }

  const bars = parts ?? [{ value: v }]
  return (
    <div className={cx('ui-levelwrap', className)} style={style}>
      {label ? <div className="ui-levelwrap__label">{label}</div> : null}
      <span className={cx('ui-level', `ui-level--${tone}`)} {...meter}>
        {bars.map((p, i) => (
          <i
            // biome-ignore lint/suspicious/noArrayIndexKey: parts are positional
            key={i}
            style={{ width: `${(p.value / max) * 100}%`, background: p.color }}
            title={'label' in p ? p.label : undefined}
          />
        ))}
      </span>
      {parts?.some((p) => p.label) ? (
        <div className="ui-levelwrap__legend">
          {parts.map((p, i) => (
            // biome-ignore lint/suspicious/noArrayIndexKey: parts are positional
            <span key={i}>
              <i style={{ background: p.color }} />
              {p.label}
            </span>
          ))}
        </div>
      ) : null}
    </div>
  )
}
