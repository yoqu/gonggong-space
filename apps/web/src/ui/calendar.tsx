import { type CSSProperties, type ReactNode, useEffect, useRef, useState } from 'react'
import { cx } from '../lib/cx'
import { Float, type Placement, useDismiss } from './anchor'
import { useControlled } from './controlled'
import { Button } from './controls'
import { Icon } from './icon'
import './form.css'
import './calendar.css'

/** `'YYYY-MM-DD'` or a Date; values leave as `'YYYY-MM-DD'` so no time zone sneaks in. */
export type DateValue = string | Date

interface Ymd {
  y: number
  m: number
  d: number
}

const ymdOf = (v: DateValue | null | undefined): Ymd | null => {
  if (!v) return null
  if (v instanceof Date) return { y: v.getFullYear(), m: v.getMonth() + 1, d: v.getDate() }
  const m = /^(\d{4})-(\d{1,2})-(\d{1,2})/.exec(v)
  return m ? { y: Number(m[1]), m: Number(m[2]), d: Number(m[3]) } : null
}
const iso = (o: Ymd) => `${o.y}-${String(o.m).padStart(2, '0')}-${String(o.d).padStart(2, '0')}`
const cmp = (a: Ymd, b: Ymd) => a.y - b.y || a.m - b.m || a.d - b.d
const at = (y: number, m: number, d: number) => ymdOf(new Date(y, m - 1, d)) as Ymd
const WEEK = ['日', '一', '二', '三', '四', '五', '六']
const formatDate = (o: Ymd, weekday: boolean) =>
  `${o.y}年${o.m}月${o.d}日${weekday ? ` 星期${WEEK[new Date(o.y, o.m - 1, o.d).getDay()]}` : ''}`

export interface CalendarProps {
  value?: DateValue | null
  defaultValue?: DateValue | null
  onChange?: (isoDate: string) => void
  min?: DateValue
  max?: DateValue
  /** Dates with events get a dot. */
  marks?: DateValue[]
  /** 1 (default) starts weeks on Monday, 0 on Sunday. */
  weekStart?: 0 | 1
  today?: DateValue
  className?: string
  style?: CSSProperties
  'aria-label'?: string
}

/** Month grid for one date: arrows move by day/week (paging across months), PageUp/PageDown by month. */
export function Calendar({
  value,
  defaultValue = null,
  onChange,
  min,
  max,
  marks = [],
  weekStart = 1,
  today: todayProp,
  className,
  style,
  ...aria
}: CalendarProps) {
  const [current, setCurrent] = useControlled<DateValue | null>(value, defaultValue)
  const sel = ymdOf(current)
  const today = ymdOf(todayProp ?? new Date()) as Ymd
  const [focus, setFocus] = useState<Ymd>(sel ?? today)
  const [view, setView] = useState({ y: focus.y, m: focus.m })
  const lo = ymdOf(min)
  const hi = ymdOf(max)
  const marked = new Set(marks.map((x) => iso(ymdOf(x) as Ymd)))
  const grid = useRef<HTMLDivElement>(null)
  const byKeyboard = useRef(false)
  useEffect(() => {
    if (!byKeyboard.current) return
    byKeyboard.current = false
    grid.current?.querySelector<HTMLElement>('[tabindex="0"]')?.focus()
  })

  const out = (o: Ymd) => (lo != null && cmp(o, lo) < 0) || (hi != null && cmp(o, hi) > 0)
  const go = (o: Ymd) => {
    setFocus(o)
    if (o.y !== view.y || o.m !== view.m) setView({ y: o.y, m: o.m })
  }
  const pick = (o: Ymd) => {
    if (out(o)) return
    setCurrent(iso(o))
    go(o)
    onChange?.(iso(o))
  }
  const shiftMonth = (n: number) => {
    const first = at(view.y, view.m + n, 1)
    const last = new Date(first.y, first.m, 0).getDate()
    setView({ y: first.y, m: first.m })
    setFocus({ ...first, d: Math.min(focus.d, last) })
  }

  const lead = (new Date(view.y, view.m - 1, 1).getDay() - weekStart + 7) % 7
  const cells = Array.from({ length: 42 }, (_, i) => at(view.y, view.m, 1 - lead + i))
  const focusKey = focus.y === view.y && focus.m === view.m ? iso(focus) : iso({ ...view, d: 1 })

  return (
    // biome-ignore lint/a11y/useSemanticElements: a labelled widget group, not a form fieldset
    <div
      role="group"
      aria-label={aria['aria-label'] ?? '日历'}
      className={cx('ui-cal', className)}
      style={style}
    >
      <div className="ui-cal__head">
        <span className="ui-cal__title" aria-live="polite">
          {view.y}年{view.m}月
        </span>
        <span className="ui-cal__nav">
          <button
            type="button"
            className="ui-inputwrap__btn"
            aria-label="上个月"
            onClick={() => shiftMonth(-1)}
          >
            <Icon name="chevron-left" weight={2} />
          </button>
          <button type="button" className="ui-cal__today" onClick={() => go(today)}>
            今天
          </button>
          <button
            type="button"
            className="ui-inputwrap__btn"
            aria-label="下个月"
            onClick={() => shiftMonth(1)}
          >
            <Icon name="chevron-right" weight={2} />
          </button>
        </span>
      </div>
      <div className="ui-cal__week" aria-hidden>
        {[0, 1, 2, 3, 4, 5, 6].map((k) => (
          <span key={k}>{WEEK[(k + weekStart) % 7]}</span>
        ))}
      </div>
      {/* biome-ignore lint/a11y/useSemanticElements: ARIA date grid; a table cannot hold the roving-focus buttons */}
      <div
        ref={grid}
        role="grid"
        className="ui-cal__grid"
        onKeyDown={(e) => {
          const step = { ArrowLeft: -1, ArrowRight: 1, ArrowUp: -7, ArrowDown: 7 }[e.key]
          if (step) {
            e.preventDefault()
            byKeyboard.current = true
            go(at(focus.y, focus.m, focus.d + step))
          } else if (e.key === 'PageUp' || e.key === 'PageDown') {
            e.preventDefault()
            byKeyboard.current = true
            shiftMonth(e.key === 'PageUp' ? -1 : 1)
          } else if (e.key === 'Enter' || e.key === ' ') {
            e.preventDefault()
            pick(focus)
          }
        }}
      >
        {cells.map((o) => {
          const key = iso(o)
          const isSel = sel != null && cmp(o, sel) === 0
          const isToday = cmp(o, today) === 0
          return (
            // biome-ignore lint/a11y/useSemanticElements: each day is a focusable button inside the ARIA grid
            <button
              key={key}
              type="button"
              role="gridcell"
              aria-selected={isSel}
              aria-current={isToday ? 'date' : undefined}
              aria-label={formatDate(o, true)}
              disabled={out(o)}
              tabIndex={key === focusKey ? 0 : -1}
              className={cx(
                'ui-cal__day',
                o.m !== view.m && 'ui-cal__day--other',
                isSel && 'ui-cal__day--sel',
                isToday && 'ui-cal__day--today',
              )}
              onClick={() => pick(o)}
            >
              {o.d}
              {marked.has(key) ? <i className="ui-cal__mark" aria-hidden /> : null}
            </button>
          )
        })}
      </div>
    </div>
  )
}

export interface DatePickerProps {
  value?: DateValue | null
  defaultValue?: DateValue | null
  onChange?: (isoDate: string) => void
  label?: ReactNode
  placeholder?: string
  min?: DateValue
  max?: DateValue
  marks?: DateValue[]
  /** Append 「星期四」 to the shown date (default true). */
  showWeekday?: boolean
  placement?: Placement
  defaultOpen?: boolean
  disabled?: boolean
  today?: DateValue
  className?: string
  style?: CSSProperties
}

/** Button-style date field that opens a Calendar popover and closes on pick. */
export function DatePicker({
  value,
  defaultValue = null,
  onChange,
  label,
  placeholder = '选择日期',
  min,
  max,
  marks,
  showWeekday = true,
  placement = 'bottom-start',
  defaultOpen = false,
  disabled,
  today,
  className,
  style,
}: DatePickerProps) {
  const [current, setCurrent] = useControlled<DateValue | null>(value, defaultValue)
  const [open, setOpen] = useState(defaultOpen)
  const root = useRef<HTMLSpanElement>(null)
  const trigger = useRef<HTMLButtonElement>(null)
  useDismiss(open, root, (refocus) => {
    setOpen(false)
    if (refocus) trigger.current?.focus()
  })
  const v = ymdOf(current)
  const name = `${typeof label === 'string' ? label : '日期'}：${v ? formatDate(v, true) : '未选择'}`
  return (
    <div className={cx('ui-field', 'ui-field--auto', className)} style={style}>
      {label ? <span className="ui-field__label">{label}</span> : null}
      <span ref={root} className="ui-anchor">
        <Button
          ref={trigger}
          className="ui-datepicker"
          aria-haspopup="dialog"
          aria-expanded={open}
          aria-label={name}
          disabled={disabled}
          onClick={() => setOpen(!open)}
        >
          <Icon name="calendar" />
          <span className={cx('ui-datepicker__value', !v && 'ui-datepicker__ph')}>
            {v ? formatDate(v, showWeekday) : placeholder}
          </span>
          <span className="ui-datepicker__chev">
            <Icon name="chevron-updown" weight={2.2} />
          </span>
        </Button>
        <Float open={open} placement={placement} role="dialog" aria-label="选择日期">
          <Calendar
            value={current}
            min={min}
            max={max}
            marks={marks}
            today={today}
            onChange={(d) => {
              setCurrent(d)
              setOpen(false)
              trigger.current?.focus()
              onChange?.(d)
            }}
          />
        </Float>
      </span>
    </div>
  )
}
