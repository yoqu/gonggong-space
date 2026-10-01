import { type KeyboardEvent, type PointerEvent, useLayoutEffect, useRef, useState } from 'react'
import { t } from '../i18n'
import './chart.css'

/** Word-less trend line for stat tiles; the numbers live elsewhere, so it is hidden from assistive tech. */
export function Sparkline({
  values,
  width = 88,
  height = 28,
}: {
  values: number[]
  width?: number
  height?: number
}) {
  const max = Math.max(1, ...values)
  const pad = 3
  const x = (i: number) => pad + (i * (width - 2 * pad)) / Math.max(1, values.length - 1)
  const y = (v: number) => height - pad - (v / max) * (height - 2 * pad)
  const line = values.map((v, i) => `${i ? 'L' : 'M'}${x(i).toFixed(1)},${y(v).toFixed(1)}`).join('')
  const last = values.length - 1
  return (
    <svg className="ui-spark" width={width} height={height} aria-hidden="true">
      <path className="ui-spark__area" d={`${line}L${x(last)},${height - pad}L${x(0)},${height - pad}Z`} />
      <path className="ui-spark__line" d={line} />
      <circle className="ui-spark__dot" cx={x(last)} cy={y(values[last] ?? 0)} r={2.5} />
    </svg>
  )
}

export interface TrendPoint {
  /** Full label for the tooltip and screen readers, e.g. 9月25日. */
  label: string
  /** Short axis label, e.g. 9/25. */
  tick: string
  value: number
  /** Readout lines; the first one leads in the tooltip. */
  lines: string[]
}

const PAD = { top: 8, right: 4, bottom: 20, left: 40 }
const HEIGHT = 168

/** 1-2-5 step giving about three gridlines up to `max`. */
function ticksFor(max: number) {
  if (!max) return [0]
  const raw = max / 3
  const mag = 10 ** Math.floor(Math.log10(raw))
  const step = ([1, 2, 5, 10].find((m) => m * mag >= raw) ?? 10) * mag
  return Array.from({ length: Math.ceil(max / step) + 1 }, (_, i) => i * step)
}

function barPath(x: number, y: number, w: number, base: number) {
  const r = Math.min(4, w / 2, base - y)
  return `M${x},${base}V${y + r}Q${x},${y} ${x + r},${y}H${x + w - r}Q${x + w},${y} ${x + w},${y + r}V${base}Z`
}

/**
 * Daily column chart: hover or ←/→/Home/End picks a day, shown in a tooltip and announced through a live region.
 * `aria-label` should summarise the series (total, peak) so the chart reads without exploring it.
 */
export function TrendChart({
  points,
  format,
  'aria-label': ariaLabel,
}: {
  points: TrendPoint[]
  format: (n: number) => string
  'aria-label': string
}) {
  const wrap = useRef<HTMLDivElement>(null)
  const [width, setWidth] = useState(560)
  const [active, setActive] = useState<number | null>(null)
  useLayoutEffect(() => {
    const el = wrap.current
    if (!el) return
    const ro = new ResizeObserver(() => el.clientWidth && setWidth(el.clientWidth))
    ro.observe(el)
    if (el.clientWidth) setWidth(el.clientWidth)
    return () => ro.disconnect()
  }, [])

  const n = points.length
  const ticks = ticksFor(Math.max(0, ...points.map((p) => p.value)))
  const top = Math.max(1, ticks.at(-1) ?? 1)
  const base = HEIGHT - PAD.bottom
  const y = (v: number) => base - (v / top) * (base - PAD.top)
  const slot = (width - PAD.left - PAD.right) / Math.max(1, n)
  const bw = Math.max(2, Math.min(24, slot * 0.64))
  const cx = (i: number) => PAD.left + slot * (i + 0.5)
  const every = Math.max(1, Math.ceil(n / Math.max(1, Math.floor(width / 72))))

  const onPointer = (e: PointerEvent<HTMLDivElement>) => {
    const i = Math.floor((e.clientX - e.currentTarget.getBoundingClientRect().left - PAD.left) / slot)
    setActive(i >= 0 && i < n ? i : null)
  }
  const onKey = (e: KeyboardEvent) => {
    const last = n - 1
    const next = {
      ArrowLeft: Math.max(0, (active ?? n) - 1),
      ArrowRight: Math.min(last, (active ?? -1) + 1),
      Home: 0,
      End: last,
    }[e.key]
    if (e.key === 'Escape') setActive(null)
    if (next === undefined) return
    e.preventDefault()
    setActive(next)
  }
  const point = active === null ? undefined : points[active]

  return (
    <div className="ui-trend" ref={wrap}>
      {/* biome-ignore lint/a11y/useSemanticElements: a chart, not a form fieldset */}
      <div
        role="group"
        aria-roledescription={t('柱状图')}
        aria-label={ariaLabel}
        // biome-ignore lint/a11y/noNoninteractiveTabindex: the chart is explored with arrow keys
        tabIndex={0}
        className="ui-trend__plot"
        data-active={point ? '' : undefined}
        onKeyDown={onKey}
        onPointerMove={onPointer}
        onPointerLeave={() => setActive(null)}
        onBlur={() => setActive(null)}
      >
        <svg width={width} height={HEIGHT} aria-hidden="true">
          {ticks.map((t) => (
            <g key={t} className="ui-trend__grid">
              <line x1={PAD.left} x2={width - PAD.right} y1={y(t)} y2={y(t)} />
              <text x={PAD.left - 8} y={y(t)} dy="0.32em" textAnchor="end">
                {format(t)}
              </text>
            </g>
          ))}
          {point && active !== null ? (
            <rect
              className="ui-trend__band"
              x={cx(active) - slot / 2}
              y={PAD.top}
              width={slot}
              height={base - PAD.top}
              rx={4}
            />
          ) : null}
          {points.map((p, i) =>
            p.value ? (
              <path
                key={p.label}
                className="ui-trend__bar"
                data-active={i === active ? '' : undefined}
                d={barPath(cx(i) - bw / 2, y(p.value), bw, base)}
              />
            ) : null,
          )}
          {points.map((p, i) =>
            (n - 1 - i) % every === 0 ? (
              <text key={p.label} className="ui-trend__tick" x={cx(i)} y={HEIGHT - 4} textAnchor="middle">
                {p.tick}
              </text>
            ) : null,
          )}
        </svg>
        {point && active !== null ? (
          <div
            className="ui-trend__tip"
            style={{ left: cx(active), transform: `translateX(-${(active / Math.max(1, n - 1)) * 100}%)` }}
          >
            <strong>{point.lines[0]}</strong>
            {point.lines.slice(1).map((l) => (
              <span key={l}>{l}</span>
            ))}
            <span className="ui-trend__tip-label">{point.label}</span>
          </div>
        ) : null}
      </div>
      <div role="status" className="ui-chart__sr">
        {point ? [point.label, ...point.lines].join(' · ') : ''}
      </div>
    </div>
  )
}
