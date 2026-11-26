import type {
  UsageCalendarCellDto,
  UsageHeatmapDto,
  UsageHeatmapMetric,
  UsageWeekHourCellDto,
} from '@gonggong/protocol'
import { type PointerEvent, useMemo, useState } from 'react'
import { t } from '../../i18n'
import { cx } from '../../lib/cx'
import { browserTimeZone } from '../../lib/time'
import { SegmentedControl } from '../../ui'
import { DEFAULT_COST_FORMAT, fmtCompactTokens, fmtCost, fmtCount, type UsageCostFormat } from './formatters'

function intensityLevel(value: number, max: number): 0 | 1 | 2 | 3 | 4 {
  if (value <= 0 || max <= 0) return 0
  const r = value / max
  if (r <= 0.15) return 1
  if (r <= 0.4) return 2
  if (r <= 0.72) return 3
  return 4
}

/** Monday-first weekday labels aligned with PostgreSQL extract(dow): 1=Mon..6=Sat, 0=Sun. */
const WEEK_ORDER = [1, 2, 3, 4, 5, 6, 0] as const
const HOURS = [0, 1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12, 13, 14, 15, 16, 17, 18, 19, 20, 21, 22, 23] as const
const WEEK_LABELS: Record<number, string> = {
  1: t('周一#short'),
  2: t('周二#short'),
  3: t('周三#short'),
  4: t('周四#short'),
  5: t('周五#short'),
  6: t('周六#short'),
  0: t('周日#short'),
}

function fmtCellPrimary(
  metric: UsageHeatmapMetric,
  runs: number,
  tokens: number,
  costUsd: number,
  costFormat: UsageCostFormat,
): string {
  if (metric === 'cost') return fmtCost(costUsd, { format: costFormat })
  if (metric === 'runs') return t('{n} 轮', { n: fmtCount(runs) })
  return `${fmtCompactTokens(tokens)} tokens`
}

function cellTooltipStyle(x: number, y: number, row: number, cellH: number, svgW: number) {
  const below = row <= 2
  const tx = x < 96 ? '0%' : x > svgW - 96 ? '-100%' : '-50%'
  const ty = below ? '0%' : '-100%'
  return {
    left: x,
    top: below ? y + cellH + 6 : Math.max(0, y - 6),
    transform: `translate(${tx}, ${ty})`,
  }
}

export function UsageCalendarHeatmap({
  data,
  metric,
  onMetricChange,
  hasCost,
  costFormat = DEFAULT_COST_FORMAT,
  stale = false,
}: {
  data: UsageHeatmapDto | null
  metric: UsageHeatmapMetric
  onMetricChange: (m: UsageHeatmapMetric) => void
  hasCost: boolean
  costFormat?: UsageCostFormat
  stale?: boolean
}) {
  const [hovered, setHovered] = useState<{
    cell: UsageCalendarCellDto
    x: number
    y: number
    row: number
  } | null>(null)

  const grid = useMemo(() => {
    const map = new Map((data?.calendar ?? []).map((c) => [c.day, c]))
    const today = new Date()
    const end = new Date(today.getFullYear(), today.getMonth(), today.getDate())
    const endDowMon = (end.getDay() + 6) % 7
    const totalWeeks = 53
    const start = new Date(end)
    start.setDate(end.getDate() - (totalWeeks - 1) * 7 - endDowMon)

    const cols: {
      weekIndex: number
      monthLabel?: string
      days: { day: string; row: number; cell: UsageCalendarCellDto; future: boolean }[]
    }[] = []
    let lastMonth = -1

    for (let w = 0; w < totalWeeks; w++) {
      const days: { day: string; row: number; cell: UsageCalendarCellDto; future: boolean }[] = []
      let monthLabel: string | undefined
      for (let r = 0; r < 7; r++) {
        const d = new Date(start)
        d.setDate(start.getDate() + w * 7 + r)
        const iso = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`
        const future = d > end
        if (r === 0 && d.getMonth() !== lastMonth) {
          lastMonth = d.getMonth()
          monthLabel = t('{m}月', { m: d.getMonth() + 1 })
        }
        const existing = map.get(iso)
        days.push({
          day: iso,
          row: r,
          future,
          cell: existing ?? { day: iso, runs: 0, totalTokens: 0, costUsd: 0, value: 0 },
        })
      }
      cols.push({ weekIndex: w, monthLabel, days })
    }
    return cols
  }, [data?.calendar])

  const maxVal = data?.maxValue ?? 0
  const cellSize = 11
  const gap = 3
  const step = cellSize + gap
  const leftPad = 32
  const topPad = 18
  const svgW = leftPad + 53 * step + 4
  const svgH = topPad + 7 * step + 2

  const onStageMove = (e: PointerEvent<HTMLDivElement>) => {
    const rect = e.currentTarget.getBoundingClientRect()
    const col = Math.floor((e.clientX - rect.left - leftPad) / step)
    const row = Math.floor((e.clientY - rect.top - topPad) / step)
    const item = grid[col]?.days[row]
    if (!item || item.future) {
      setHovered(null)
      return
    }
    setHovered({ cell: item.cell, x: leftPad + col * step + cellSize / 2, y: topPad + row * step, row })
  }

  return (
    <section
      className={cx('usage-panel usage-heatmap', stale && 'usage-stale')}
      data-testid="usage-calendar-heatmap"
    >
      <div className="usage-panel__head">
        <div>
          <span className="usage-panel__title">{t('用量热力图')}</span>
          <span className="usage-panel__sub">{t('近 53 周每日活跃分布')}</span>
        </div>
        <SegmentedControl
          size="small"
          aria-label={t('热力图指标')}
          value={metric}
          onChange={onMetricChange}
          items={[
            { value: 'tokens', label: 'Token' },
            { value: 'runs', label: t('轮次') },
            ...(hasCost ? [{ value: 'cost' as const, label: t('费用') }] : []),
          ]}
        />
      </div>

      <div className="usage-heatmap__scroll">
        {/* biome-ignore lint/a11y/useSemanticElements: interactive SVG heatmap plot */}
        <div
          role="group"
          aria-label={t('近 53 周每日用量热力图')}
          className="usage-heatmap__stage"
          style={{ width: svgW }}
          onPointerMove={onStageMove}
          onPointerLeave={() => setHovered(null)}
        >
          <svg width={svgW} height={svgH} aria-hidden="true">
            {grid.map((col) =>
              col.monthLabel ? (
                <text
                  key={`m-${col.weekIndex}`}
                  className="usage-heatmap__axis"
                  x={leftPad + col.weekIndex * step}
                  y={11}
                >
                  {col.monthLabel}
                </text>
              ) : null,
            )}
            {[0, 2, 4, 6].map((row) => {
              const dow = WEEK_ORDER[row]
              return (
                <text
                  key={`w-${row}`}
                  className="usage-heatmap__axis"
                  x={leftPad - 6}
                  y={topPad + row * step + cellSize - 2}
                  textAnchor="end"
                >
                  {dow !== undefined ? WEEK_LABELS[dow] : ''}
                </text>
              )
            })}
            {grid.map((col) =>
              col.days.map((item) => {
                if (item.future) return null
                const x = leftPad + col.weekIndex * step
                const y = topPad + item.row * step
                return (
                  <rect
                    key={item.day}
                    className="usage-heatmap__cell"
                    data-level={intensityLevel(item.cell.value, maxVal)}
                    x={x}
                    y={y}
                    width={cellSize}
                    height={cellSize}
                    rx={2}
                  />
                )
              }),
            )}
          </svg>
          {hovered ? (
            <div
              className="usage-tooltip usage-tooltip--cell"
              style={cellTooltipStyle(hovered.x, hovered.y, hovered.row, cellSize, svgW)}
            >
              <strong>{hovered.cell.day}</strong>
              <span>
                {fmtCellPrimary(
                  metric,
                  hovered.cell.runs,
                  hovered.cell.totalTokens,
                  hovered.cell.costUsd,
                  costFormat,
                )}
              </span>
              {metric !== 'runs' ? <span>{t('{n} 轮', { n: fmtCount(hovered.cell.runs) })}</span> : null}
              {hasCost && hovered.cell.costUsd > 0 && metric !== 'cost' ? (
                <span className="usage-tone--green">
                  {fmtCost(hovered.cell.costUsd, { format: costFormat })}
                </span>
              ) : null}
            </div>
          ) : null}
        </div>
      </div>

      <div className="usage-heatmap__foot">
        <span className="usage-heatmap__tz">{browserTimeZone}</span>
        <div className="usage-heatmap__legend" aria-hidden="true">
          <span>{t('少')}</span>
          {[0, 1, 2, 3, 4].map((lvl) => (
            <span key={lvl} className="usage-heatmap__swatch" data-level={lvl} />
          ))}
          <span>{t('多')}</span>
        </div>
      </div>
    </section>
  )
}

export function UsageWeekHourHeatmap({
  data,
  hasCost,
  costFormat = DEFAULT_COST_FORMAT,
  stale = false,
}: {
  data: UsageHeatmapDto | null
  hasCost: boolean
  costFormat?: UsageCostFormat
  stale?: boolean
}) {
  const [hovered, setHovered] = useState<{
    cell: UsageWeekHourCellDto
    x: number
    y: number
    row: number
  } | null>(null)

  const { cellMap, busiest } = useMemo(() => {
    const map = new Map<string, UsageWeekHourCellDto>()
    let peak: UsageWeekHourCellDto | null = null
    for (const c of data?.weekHour ?? []) {
      map.set(`${c.dow}-${c.hour}`, c)
      if (c.value > 0 && (!peak || c.value > peak.value)) peak = c
    }
    return { cellMap: map, busiest: peak }
  }, [data?.weekHour])

  const maxVal = data?.maxValue ?? 0
  const metric = data?.metric ?? 'tokens'
  const cellW = 14
  const cellH = 14
  const gap = 3
  const stepX = cellW + gap
  const stepY = cellH + gap
  const leftPad = 34
  const topPad = 8
  const svgW = leftPad + 24 * stepX + 4
  const svgH = topPad + 7 * stepY + 18

  const onStageMove = (e: PointerEvent<HTMLDivElement>) => {
    const rect = e.currentTarget.getBoundingClientRect()
    const hour = Math.floor((e.clientX - rect.left - leftPad) / stepX)
    const row = Math.floor((e.clientY - rect.top - topPad) / stepY)
    const dow = WEEK_ORDER[row]
    if (dow === undefined || hour < 0 || hour > 23) {
      setHovered(null)
      return
    }
    const cell = cellMap.get(`${dow}-${hour}`) ?? {
      dow,
      hour,
      runs: 0,
      totalTokens: 0,
      costUsd: 0,
      value: 0,
    }
    setHovered({ cell, x: leftPad + hour * stepX + cellW / 2, y: topPad + row * stepY, row })
  }

  return (
    <section
      className={cx('usage-panel usage-heatmap', stale && 'usage-stale')}
      data-testid="usage-weekhour-heatmap"
    >
      <div className="usage-panel__head">
        <span className="usage-panel__title">{t('按时段')}</span>
        <span className="usage-heatmap__tz">{browserTimeZone}</span>
      </div>

      <div className="usage-heatmap__scroll">
        {/* biome-ignore lint/a11y/useSemanticElements: interactive SVG heatmap plot */}
        <div
          role="group"
          aria-label={t('按星期与小时活跃热力图')}
          className="usage-heatmap__stage"
          style={{ width: svgW }}
          onPointerMove={onStageMove}
          onPointerLeave={() => setHovered(null)}
        >
          <svg width={svgW} height={svgH} aria-hidden="true">
            {WEEK_ORDER.map((dow, row) => (
              <text
                key={`dow-${dow}`}
                className="usage-heatmap__axis"
                x={leftPad - 6}
                y={topPad + row * stepY + cellH - 3}
                textAnchor="end"
              >
                {WEEK_LABELS[dow]}
              </text>
            ))}
            {WEEK_ORDER.map((dow, row) =>
              HOURS.map((hour) => {
                const cell = cellMap.get(`${dow}-${hour}`) ?? {
                  dow,
                  hour,
                  runs: 0,
                  totalTokens: 0,
                  costUsd: 0,
                  value: 0,
                }
                return (
                  <rect
                    key={`${dow}-${hour}`}
                    className="usage-heatmap__cell"
                    data-level={intensityLevel(cell.value, maxVal)}
                    x={leftPad + hour * stepX}
                    y={topPad + row * stepY}
                    width={cellW}
                    height={cellH}
                    rx={2}
                  />
                )
              }),
            )}
            {[0, 6, 12, 18, 23].map((h) => (
              <text
                key={`hr-${h}`}
                className="usage-heatmap__axis"
                x={leftPad + h * stepX + cellW / 2}
                y={topPad + 7 * stepY + 13}
                textAnchor="middle"
              >
                {h}
              </text>
            ))}
          </svg>
          {hovered ? (
            <div
              className="usage-tooltip usage-tooltip--cell"
              style={cellTooltipStyle(hovered.x, hovered.y, hovered.row, cellH, svgW)}
            >
              <strong>
                {WEEK_LABELS[hovered.cell.dow]} {String(hovered.cell.hour).padStart(2, '0')}:00
              </strong>
              <span>
                {fmtCellPrimary(
                  metric,
                  hovered.cell.runs,
                  hovered.cell.totalTokens,
                  hovered.cell.costUsd,
                  costFormat,
                )}
              </span>
              {metric !== 'runs' ? <span>{t('{n} 轮', { n: fmtCount(hovered.cell.runs) })}</span> : null}
              {hasCost && hovered.cell.costUsd > 0 && metric !== 'cost' ? (
                <span className="usage-tone--green">
                  {fmtCost(hovered.cell.costUsd, { format: costFormat })}
                </span>
              ) : null}
            </div>
          ) : null}
        </div>
      </div>

      <div className="usage-heatmap__foot">
        <span className="usage-heatmap__busiest">
          {busiest
            ? t('最忙：{day} {hour}:00', {
                day: WEEK_LABELS[busiest.dow] ?? '',
                hour: String(busiest.hour).padStart(2, '0'),
              })
            : t('暂无活跃记录')}
        </span>
        <div className="usage-heatmap__legend" aria-hidden="true">
          <span>{t('少')}</span>
          {[0, 1, 2, 3, 4].map((lvl) => (
            <span key={lvl} className="usage-heatmap__swatch" data-level={lvl} />
          ))}
          <span>{t('多')}</span>
        </div>
      </div>
    </section>
  )
}
