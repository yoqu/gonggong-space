import type { KeyboardEvent, ReactNode } from 'react'
import { cx } from '../lib/cx'
import { nextEnabled, useControlled } from './controlled'
import { type Glyph, renderGlyph } from './controls'
import './segmented.css'

export interface SegmentItem<V extends string> {
  value: V
  label?: ReactNode
  icon?: Glyph
  /** Required for icon-only segments. */
  'aria-label'?: string
  disabled?: boolean
}

type SegmentSize = 'small' | 'regular' | 'large'

/** Shared segmented bar: arrow keys move selection and focus (roving tabindex). */
function Segments<V extends string>({
  items,
  value,
  onChange,
  size,
  tabs,
  label,
}: {
  items: SegmentItem<V>[]
  value: V | undefined
  onChange: (value: V) => void
  size: SegmentSize
  tabs: boolean
  label?: string
}) {
  const current = items.findIndex((it) => it.value === value)
  const focusable = current >= 0 ? current : nextEnabled(items, -1, 1)
  const onKeyDown = (e: KeyboardEvent<HTMLDivElement>) => {
    const step = e.key === 'ArrowRight' ? 1 : e.key === 'ArrowLeft' ? -1 : 0
    if (!step) return
    e.preventDefault()
    const buttons = [...e.currentTarget.querySelectorAll<HTMLButtonElement>('.ui-seg__item')]
    const from = buttons.indexOf(e.target as HTMLButtonElement)
    const next = nextEnabled(items, from < 0 ? focusable : from, step)
    buttons[next]?.focus()
    const it = items[next]
    if (it) onChange(it.value)
  }
  return (
    // biome-ignore lint/a11y/noStaticElementInteractions lint/a11y/useAriaPropsSupportedByRole: role is tablist or group, both interactive and nameable
    <div
      role={tabs ? 'tablist' : 'group'}
      aria-label={label}
      className={cx('ui-seg', size !== 'regular' && `ui-seg--${size}`)}
      onKeyDown={onKeyDown}
    >
      {items.map((it, i) => {
        const selected = it.value === value
        return (
          // biome-ignore lint/a11y/useAriaPropsSupportedByRole: aria-selected is only set when role is tab
          <button
            key={it.value}
            type="button"
            role={tabs ? 'tab' : undefined}
            aria-selected={tabs ? selected : undefined}
            aria-pressed={tabs ? undefined : selected}
            aria-label={it.label ? undefined : it['aria-label']}
            data-selected={selected || undefined}
            className="ui-seg__item"
            tabIndex={i === focusable ? 0 : -1}
            disabled={it.disabled}
            onClick={() => onChange(it.value)}
          >
            {it.icon ? renderGlyph(it.icon) : null}
            {it.label}
          </button>
        )
      })}
    </div>
  )
}

export interface SegmentedControlProps<V extends string> {
  items: SegmentItem<V>[]
  value?: V
  defaultValue?: V
  onChange?: (value: V) => void
  size?: SegmentSize
  'aria-label'?: string
}

export function SegmentedControl<V extends string>({
  items,
  value,
  defaultValue,
  onChange,
  size = 'regular',
  ...aria
}: SegmentedControlProps<V>) {
  const [current, setCurrent] = useControlled(value, defaultValue ?? items[0]?.value)
  return (
    <Segments
      items={items}
      value={current}
      size={size}
      tabs={false}
      label={aria['aria-label']}
      onChange={(v) => {
        setCurrent(v)
        onChange?.(v)
      }}
    />
  )
}

export interface TabItem<V extends string> {
  value: V
  label: ReactNode
  disabled?: boolean
}

/** Page-level view switcher with tab semantics, drawn as a SegmentedControl. */
export function Tabs<V extends string>({
  items,
  value,
  onChange,
  size = 'md',
  'aria-label': label,
}: {
  items: TabItem<V>[]
  value: V
  onChange: (value: V) => void
  size?: 'sm' | 'md'
  'aria-label'?: string
}) {
  return (
    <Segments
      items={items}
      value={value}
      onChange={onChange}
      size={size === 'sm' ? 'small' : 'regular'}
      tabs
      label={label}
    />
  )
}
