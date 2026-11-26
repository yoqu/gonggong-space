import type {
  UsageCapabilitiesDto,
  UsageMetric,
  UsageTimeseriesBreakdown,
  UsageTimeseriesDto,
} from '@gonggong/protocol'
import { type KeyboardEvent, type PointerEvent, useLayoutEffect, useMemo, useRef, useState } from 'react'
import { t } from '../../i18n'
import { cx } from '../../lib/cx'
import { SegmentedControl } from '../../ui'
import {
  fmtAgentKind,
  fmtCompactTokens,
  fmtCostUsd,
  fmtCount,
  fmtDurationMs,
  fmtEntityLabel,
  fmtRate,
  fmtTps,
  seriesColor,
} from './formatters'
import type { UsageChartMode } from './types'

const PAD = { top: 12, right: 16, bottom: 24, left: 48 }
const HEIGHT = 216

function niceTicks(max: number): number[] {
  if (!max || !Number.isFinite(max)) return [0]
  const raw = max / 4
  const mag = 10 ** Math.floor(Math.log10(raw))
  const step = ([1, 2, 2.5, 5, 10].find((m) => m * mag >= raw) ?? 10) * mag
  const count = Math.max(1, Math.ceil(max / step))
  return Array.from({ length: count + 1 }, (_, i) => i * step)
}

function fmtMetricValue(metric: UsageMetric, value: number): string {
  if (metric === 'cost') return fmtCostUsd(value)
  if (metric === 'runs') return fmtCount(value)
  if (metric === 'duration') return fmtDurationMs(value)
  if (metric === 'throughput') return fmtTps(value)
  return fmtCompactTokens(value)
}

function fmtAxisTick(metric: UsageMetric, value: number): string {
  if (value === 0) return '0'
  if (metric === 'cost') return `$${value >= 10 ? Math.round(value) : Number(value.toFixed(2))}`
  if (metric === 'runs') return fmtCount(value)
  if (metric === 'duration') return fmtDurationMs(value)
  if (metric === 'throughput') return `${Math.round(value)}`
  return fmtCompactTokens(value)
}

export interface UsageTrendPanelProps {
  data: UsageTimeseriesDto | null
  metric: UsageMetric
  onMetricChange: (m: UsageMetric) => void
  breakdown: UsageTimeseriesBreakdown
  onBreakdownChange: (b: UsageTimeseriesBreakdown) => void
  chartMode: UsageChartMode
  onChartModeChange: (m: UsageChartMode) => void
  capabilities: UsageCapabilitiesDto
  stale?: boolean
}

export function UsageTrendPanel({
  data,
  metric,
  onMetricChange,
  breakdown,
  onBreakdownChange,
  chartMode,
  onChartModeChange,
  capabilities,
  stale = false,
}: UsageTrendPanelProps) {
  const wrapRef = useRef<HTMLDivElement>(null)
  const [width, setWidth] = useState(640)
  const [activeIdx, setActiveIdx] = useState<number | null>(null)
  const [hoveredSeries, setHoveredSeries] = useState<string | null>(null)
  const [pinnedSeries, setPinnedSeries] = useState<string | null>(null)

  useLayoutEffect(() => {
    const el = wrapRef.current
    if (!el) return
    const ro = new ResizeObserver(() => {
      if (el.clientWidth > 0) setWidth(el.clientWidth)
    })
    ro.observe(el)
    if (el.clientWidth > 0) setWidth(el.clientWidth)
    return () => ro.disconnect()
  }, [])

  const buckets = data?.buckets ?? []
  const series = data?.series ?? []
  const focusedSeries = hoveredSeries ?? pinnedSeries
  const isolatedSeries = pinnedSeries && series.some((s) => s.key === pinnedSeries) ? pinnedSeries : null
  const additive = metric === 'tokens' || metric === 'cost' || metric === 'runs'
  const stacked =
    chartMode === 'bar' && breakdown !== 'none' && series.length > 0 && additive && !isolatedSeries

  const colorMap = useMemo(() => new Map(series.map((s, i) => [s.key, seriesColor(i, s.key)])), [series])

  const maxVal = useMemo(() => {
    if (!buckets.length) return 0
    if (isolatedSeries) {
      return Math.max(0, ...buckets.map((b) => b.bySeries[isolatedSeries] ?? 0))
    }
    if (stacked) {
      return Math.max(0, ...buckets.map((b) => series.reduce((sum, s) => sum + (b.bySeries[s.key] ?? 0), 0)))
    }
    if (breakdown !== 'none' && series.length > 0 && !additive) {
      return Math.max(0, ...buckets.flatMap((b) => series.map((s) => b.bySeries[s.key] ?? 0)))
    }
    return Math.max(0, ...buckets.map((b) => b.total))
  }, [buckets, series, stacked, isolatedSeries, breakdown, additive])

  const ticks = useMemo(() => niceTicks(maxVal), [maxVal])
  const top = Math.max(1e-9, ticks.at(-1) ?? 1)
  const plotW = Math.max(40, width - PAD.left - PAD.right)
  const base = HEIGHT - PAD.bottom
  const plotH = base - PAD.top
  const n = buckets.length
  const slot = plotW / Math.max(1, n)
  const bw = Math.max(3, Math.min(28, slot * 0.66))
  const xOf = (i: number) => PAD.left + slot * (i + 0.5)
  const yOf = (v: number) => base - Math.max(0, Math.min(1, v / top)) * plotH
  const tickEvery = Math.max(1, Math.ceil(n / Math.max(1, Math.floor(plotW / 68))))

  const onPointerMove = (e: PointerEvent<HTMLDivElement>) => {
    if (!n) return
    const rect = e.currentTarget.getBoundingClientRect()
    const i = Math.floor((e.clientX - rect.left - PAD.left) / slot)
    setActiveIdx(i >= 0 && i < n ? i : null)
  }

  const onKeyDown = (e: KeyboardEvent) => {
    if (!n) return
    const last = n - 1
    if (e.key === 'Escape') {
      setActiveIdx(null)
      return
    }
    const next = {
      ArrowLeft: Math.max(0, (activeIdx ?? n) - 1),
      ArrowRight: Math.min(last, (activeIdx ?? -1) + 1),
      Home: 0,
      End: last,
    }[e.key]
    if (next === undefined) return
    e.preventDefault()
    setActiveIdx(next)
  }

  const metricItems: { value: UsageMetric; label: string }[] = [
    { value: 'tokens', label: 'Token' },
    ...(capabilities.hasCost ? [{ value: 'cost' as const, label: t('费用') }] : []),
    { value: 'runs', label: t('轮次') },
    { value: 'duration', label: t('平均耗时') },
    ...(capabilities.hasInputOutput ? [{ value: 'throughput' as const, label: t('产出速率') }] : []),
  ]

  const breakdownItems: { value: UsageTimeseriesBreakdown; label: string }[] = [
    { value: 'none', label: t('总计') },
    ...(capabilities.hasModels ? [{ value: 'model' as const, label: t('模型') }] : []),
    { value: 'agentKind', label: 'Agent' },
    ...(capabilities.hasProvider ? [{ value: 'provider' as const, label: t('供应商') }] : []),
    { value: 'bot', label: 'Bot' },
    { value: 'user', label: t('触发人') },
    { value: 'group', label: t('会话') },
  ]

  const activeBucket = activeIdx !== null ? buckets[activeIdx] : undefined
  const showLegend = breakdown !== 'none' && series.length > 0
  const maxSeriesTotal = Math.max(1e-9, ...series.map((s) => s.total))

  const lineSeries = useMemo(() => {
    if (chartMode !== 'line' || !n) return []
    const px = (i: number) => PAD.left + slot * (i + 0.5)
    const py = (v: number) => base - Math.max(0, Math.min(1, v / top)) * plotH
    if (breakdown === 'none' || !series.length) {
      const pts = buckets.map((b, i) => `${px(i).toFixed(1)},${py(b.total).toFixed(1)}`).join(' ')
      const firstX = px(0).toFixed(1)
      const lastX = px(n - 1).toFixed(1)
      return [
        {
          key: '__total__',
          color: 'var(--system-indigo)',
          points: pts,
          area: `M${firstX},${base} L${pts.replace(/ /g, ' L')} L${lastX},${base} Z`,
        },
      ]
    }
    return series.map((s) => {
      const pts = buckets
        .map((b, i) => `${px(i).toFixed(1)},${py(b.bySeries[s.key] ?? 0).toFixed(1)}`)
        .join(' ')
      return {
        key: s.key,
        color: colorMap.get(s.key) ?? 'var(--system-indigo)',
        points: pts,
        area: '',
      }
    })
  }, [chartMode, n, breakdown, series, buckets, colorMap, slot, base, top, plotH])

  const seriesDisplayName = (key: string, name: string) =>
    breakdown === 'agentKind' ? fmtAgentKind(name || key) : fmtEntityLabel(key, name)

  return (
    <section
      className={cx('usage-panel usage-trend', stale && 'usage-stale')}
      data-testid="usage-trend-panel"
    >
      <div className="usage-trend__head">
        <div className="usage-trend__controls">
          <SegmentedControl
            size="small"
            aria-label={t('趋势指标')}
            value={metric}
            onChange={onMetricChange}
            items={metricItems}
          />
          <SegmentedControl
            size="small"
            aria-label={t('图表样式')}
            value={chartMode}
            onChange={onChartModeChange}
            items={[
              { value: 'bar', label: t('柱状') },
              { value: 'line', label: t('折线') },
            ]}
          />
        </div>
        <div className="usage-trend__controls">
          <span className="usage-trend__dim-label">{t('拆分维度')}</span>
          <SegmentedControl
            size="small"
            aria-label={t('拆分维度')}
            value={breakdown}
            onChange={(next) => {
              setPinnedSeries(null)
              setHoveredSeries(null)
              onBreakdownChange(next)
            }}
            items={breakdownItems}
          />
        </div>
      </div>

      <div className={cx('usage-trend__body', showLegend && 'usage-trend__body--split')}>
        <div className="usage-trend__chart" ref={wrapRef}>
          {/* biome-ignore lint/a11y/useSemanticElements: interactive SVG trend plot */}
          <div
            role="group"
            aria-roledescription={chartMode === 'bar' ? t('柱状图') : t('折线图')}
            aria-label={t('用量趋势图')}
            // biome-ignore lint/a11y/noNoninteractiveTabindex: chart supports keyboard exploration
            tabIndex={0}
            className="usage-trend__plot"
            data-active={activeBucket ? '' : undefined}
            onPointerMove={onPointerMove}
            onPointerLeave={() => setActiveIdx(null)}
            onBlur={() => setActiveIdx(null)}
            onKeyDown={onKeyDown}
          >
            <svg width={width} height={HEIGHT} aria-hidden="true">
              {ticks.map((tk) => (
                <g key={tk} className="usage-trend__grid">
                  <line x1={PAD.left} x2={width - PAD.right} y1={yOf(tk)} y2={yOf(tk)} />
                  <text x={PAD.left - 8} y={yOf(tk)} dy="0.32em" textAnchor="end">
                    {fmtAxisTick(metric, tk)}
                  </text>
                </g>
              ))}

              {activeBucket && activeIdx !== null ? (
                chartMode === 'bar' ? (
                  <rect
                    className="usage-trend__band"
                    x={xOf(activeIdx) - slot / 2}
                    y={PAD.top}
                    width={slot}
                    height={plotH}
                    rx={4}
                  />
                ) : (
                  <line
                    className="usage-trend__crosshair"
                    x1={xOf(activeIdx)}
                    x2={xOf(activeIdx)}
                    y1={PAD.top}
                    y2={base}
                  />
                )
              ) : null}

              {chartMode === 'bar' ? (
                <g className="usage-trend__bars">
                  {buckets.map((b, bi) => {
                    const x = xOf(bi) - bw / 2
                    const dimmedBucket = activeIdx !== null && activeIdx !== bi
                    if (stacked) {
                      let cursorY = base
                      return (
                        <g key={b.ts} className={cx('usage-trend__col', dimmedBucket && 'is-dimmed')}>
                          {series.map((s) => {
                            const v = b.bySeries[s.key] ?? 0
                            if (v <= 0) return null
                            const h = (v / top) * plotH
                            cursorY -= h
                            const dimmedSeg = focusedSeries !== null && focusedSeries !== s.key
                            return (
                              <rect
                                key={s.key}
                                className={cx('usage-trend__seg', dimmedSeg && 'is-dimmed')}
                                x={x}
                                y={cursorY}
                                width={bw}
                                height={Math.max(1.5, h)}
                                rx={1.5}
                                fill={colorMap.get(s.key)}
                              />
                            )
                          })}
                        </g>
                      )
                    }
                    const singleKey =
                      isolatedSeries ?? (focusedSeries && breakdown !== 'none' ? focusedSeries : null)
                    const v = singleKey ? (b.bySeries[singleKey] ?? 0) : b.total
                    const h = v > 0 ? Math.max(2, (v / top) * plotH) : 0
                    const fill =
                      singleKey && colorMap.has(singleKey) ? colorMap.get(singleKey) : 'var(--system-indigo)'
                    return h > 0 ? (
                      <rect
                        key={b.ts}
                        className={cx('usage-trend__bar', dimmedBucket && 'is-dimmed')}
                        x={x}
                        y={base - h}
                        width={bw}
                        height={h}
                        rx={Math.min(3, bw / 2)}
                        fill={fill}
                      />
                    ) : null
                  })}
                </g>
              ) : (
                <g className="usage-trend__lines">
                  {lineSeries.map((ls) => {
                    const dimmed =
                      focusedSeries !== null && ls.key !== '__total__' && ls.key !== focusedSeries
                    return (
                      <g key={ls.key} className={cx('usage-trend__line-group', dimmed && 'is-dimmed')}>
                        {ls.area ? <path className="usage-trend__area" d={ls.area} fill={ls.color} /> : null}
                        <polyline className="usage-trend__polyline" points={ls.points} stroke={ls.color} />
                      </g>
                    )
                  })}
                  {activeBucket && activeIdx !== null
                    ? lineSeries.map((ls) => {
                        const v =
                          ls.key === '__total__' ? activeBucket.total : (activeBucket.bySeries[ls.key] ?? 0)
                        const dimmed =
                          focusedSeries !== null && ls.key !== '__total__' && ls.key !== focusedSeries
                        return (
                          <circle
                            key={ls.key}
                            className={cx('usage-trend__dot', dimmed && 'is-dimmed')}
                            cx={xOf(activeIdx)}
                            cy={yOf(v)}
                            r={3.5}
                            fill={ls.color}
                          />
                        )
                      })
                    : null}
                </g>
              )}

              {buckets.map((b, i) =>
                (n - 1 - i) % tickEvery === 0 ? (
                  <text
                    key={b.ts}
                    className="usage-trend__tick"
                    x={xOf(i)}
                    y={HEIGHT - 5}
                    textAnchor="middle"
                  >
                    {b.label}
                  </text>
                ) : null,
              )}
            </svg>

            {activeBucket && activeIdx !== null ? (
              <div
                className="usage-tooltip"
                style={{
                  left: xOf(activeIdx),
                  transform: `translateX(-${(activeIdx / Math.max(1, n - 1)) * 100}%)`,
                }}
              >
                <div className="usage-tooltip__head">
                  <strong>{activeBucket.label}</strong>
                  <span>{fmtMetricValue(metric, activeBucket.total)}</span>
                </div>
                <div className="usage-tooltip__meta">
                  <span>{t('{n} 轮', { n: fmtCount(activeBucket.runs) })}</span>
                  {activeBucket.totalTokens > 0 && metric !== 'tokens' ? (
                    <span>{fmtCompactTokens(activeBucket.totalTokens)}</span>
                  ) : null}
                  {capabilities.hasCost && activeBucket.costUsd > 0 && metric !== 'cost' ? (
                    <span className="usage-tone--green">{fmtCostUsd(activeBucket.costUsd)}</span>
                  ) : null}
                  {activeBucket.failedRuns > 0 ? (
                    <span className="usage-tone--red">{t('{n} 失败', { n: activeBucket.failedRuns })}</span>
                  ) : null}
                </div>
                {showLegend ? (
                  <div className="usage-tooltip__series">
                    {series
                      .map((s) => ({ s, v: activeBucket.bySeries[s.key] ?? 0 }))
                      .filter((x) => x.v > 0)
                      .sort((a, b) => b.v - a.v)
                      .slice(0, 5)
                      .map(({ s, v }) => (
                        <div key={s.key} className="usage-tooltip__srow">
                          <span className="usage-swatch" style={{ background: colorMap.get(s.key) }} />
                          <span className="usage-tooltip__sname">{seriesDisplayName(s.key, s.name)}</span>
                          <span className="usage-tooltip__sval">{fmtMetricValue(metric, v)}</span>
                        </div>
                      ))}
                  </div>
                ) : null}
              </div>
            ) : null}
          </div>
          <div role="status" className="ui-chart__sr">
            {activeBucket ? `${activeBucket.label} · ${fmtMetricValue(metric, activeBucket.total)}` : ''}
          </div>
        </div>

        {showLegend ? (
          <section className="usage-trend__legend" aria-label={t('拆分图例排行')}>
            {series.map((s) => {
              const color = colorMap.get(s.key) ?? 'var(--system-indigo)'
              const ratio = Math.max(0.02, Math.min(1, s.total / maxSeriesTotal))
              const active = focusedSeries === s.key
              const dimmed = focusedSeries !== null && !active
              const label = seriesDisplayName(s.key, s.name)
              return (
                <button
                  key={s.key}
                  type="button"
                  className={cx(
                    'usage-legend-item',
                    active && 'usage-legend-item--active',
                    dimmed && 'is-dimmed',
                  )}
                  aria-pressed={pinnedSeries === s.key}
                  onMouseEnter={() => setHoveredSeries(s.key)}
                  onMouseLeave={() => setHoveredSeries(null)}
                  onFocus={() => setHoveredSeries(s.key)}
                  onBlur={() => setHoveredSeries(null)}
                  onClick={() => setPinnedSeries((cur) => (cur === s.key ? null : s.key))}
                >
                  <div className="usage-legend-item__top">
                    <span className="usage-swatch" style={{ background: color }} aria-hidden="true" />
                    <span className="usage-legend-item__name" title={label}>
                      {label}
                    </span>
                    <span className="usage-legend-item__val">{fmtMetricValue(metric, s.total)}</span>
                  </div>
                  <div className="usage-legend-item__bar" aria-hidden="true">
                    <span style={{ transform: `scaleX(${ratio})`, background: color }} />
                  </div>
                  <div className="usage-legend-item__sub">
                    <span>{t('{n} 轮', { n: fmtCount(s.runs) })}</span>
                    {capabilities.hasCost && s.costUsd > 0 ? (
                      <span className="usage-tone--green">{fmtCostUsd(s.costUsd)}</span>
                    ) : null}
                    {s.avgOutputTps != null ? <span>{fmtTps(s.avgOutputTps)}</span> : null}
                    <span>{fmtRate(s.share)}</span>
                    {s.failedRuns > 0 ? (
                      <span className="usage-tone--red">{t('{n} 失败', { n: s.failedRuns })}</span>
                    ) : null}
                  </div>
                </button>
              )
            })}
          </section>
        ) : null}
      </div>
    </section>
  )
}
