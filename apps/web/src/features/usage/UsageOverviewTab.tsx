import type {
  AgentKind,
  UsageBreakdownBy,
  UsageBreakdownDto,
  UsageCapabilitiesDto,
  UsageHeatmapDto,
  UsageHeatmapMetric,
  UsageMetric,
  UsageOverviewDto,
  UsageTimeseriesBreakdown,
  UsageTimeseriesDto,
} from '@gonggong/protocol'
import { useMemo } from 'react'
import { t } from '../../i18n'
import { cx } from '../../lib/cx'
import { EmptyState, NoDataArt } from '../../ui'
import {
  fmtCompactTokens,
  fmtCostUsd,
  fmtCount,
  fmtDelta,
  fmtDurationMs,
  fmtRate,
  fmtTps,
} from './formatters'
import type { UsageChartMode, UsageFilterState } from './types'
import { UsageCalendarHeatmap } from './UsageHeatmap'
import { type UsageKpiCell, UsageKpiStrip } from './UsageKpiStrip'
import { UsageRankingSection } from './UsageRankingSection'
import { UsageSpeedTable } from './UsageSpeedTable'
import { UsageTrendPanel } from './UsageTrendPanel'

export interface UsageOverviewTabProps {
  overview: UsageOverviewDto | null
  capabilities: UsageCapabilitiesDto
  timeseries: UsageTimeseriesDto | null
  metric: UsageMetric
  onMetricChange: (m: UsageMetric) => void
  breakdown: UsageTimeseriesBreakdown
  onBreakdownChange: (b: UsageTimeseriesBreakdown) => void
  chartMode: UsageChartMode
  onChartModeChange: (m: UsageChartMode) => void
  agentRank: UsageBreakdownDto | null
  modelRank: UsageBreakdownDto | null
  botRank: UsageBreakdownDto | null
  userRank: UsageBreakdownDto | null
  groupRank: UsageBreakdownDto | null
  speedBy: UsageBreakdownBy
  onSpeedByChange: (by: UsageBreakdownBy) => void
  speedRows: UsageBreakdownDto | null
  calendarHeatmap: UsageHeatmapDto | null
  heatmapMetric: UsageHeatmapMetric
  onHeatmapMetricChange: (m: UsageHeatmapMetric) => void
  onFilterJump: (patch: Partial<UsageFilterState>) => void
  stale?: boolean
}

export function UsageOverviewTab({
  overview,
  capabilities,
  timeseries,
  metric,
  onMetricChange,
  breakdown,
  onBreakdownChange,
  chartMode,
  onChartModeChange,
  agentRank,
  modelRank,
  botRank,
  userRank,
  groupRank,
  speedBy,
  onSpeedByChange,
  speedRows,
  calendarHeatmap,
  heatmapMetric,
  onHeatmapMetricChange,
  onFilterJump,
  stale = false,
}: UsageOverviewTabProps) {
  const kpi = overview?.kpi
  const prev = overview?.previous

  const kpiCells = useMemo<UsageKpiCell[]>(() => {
    if (!kpi) return []
    const cells: UsageKpiCell[] = [
      {
        key: 'tokens',
        label: 'Token',
        value: fmtCompactTokens(kpi.totalTokens),
        delta: fmtDelta(kpi.totalTokens, prev?.totalTokens),
        sub: (
          <>
            {capabilities.hasInputOutput ? (
              <span>
                {t('输入 {in} · 输出 {out}', {
                  in: fmtCompactTokens(kpi.inputTokens),
                  out: fmtCompactTokens(kpi.outputTokens),
                })}
              </span>
            ) : (
              <span>{t('{n} 轮已上报', { n: fmtCount(kpi.tokenReportedRuns) })}</span>
            )}
            {kpi.unreportedRuns > 0 ? (
              <span className="usage-muted">{t('{n} 轮未上报', { n: fmtCount(kpi.unreportedRuns) })}</span>
            ) : null}
          </>
        ),
      },
      {
        key: 'runs',
        label: t('运行轮次'),
        value: fmtCount(kpi.totalRuns),
        delta: fmtDelta(kpi.totalRuns, prev?.totalRuns),
        sub: (
          <>
            {kpi.failedRuns > 0 ? (
              <span className="usage-tone--red">{t('{n} 失败', { n: kpi.failedRuns })}</span>
            ) : null}
            <span>{t('成功 {r}', { r: fmtRate(kpi.successRate) })}</span>
            {kpi.cancelledRuns > 0 ? <span>{t('{n} 取消', { n: kpi.cancelledRuns })}</span> : null}
            {kpi.liveRuns > 0 ? (
              <span className="usage-tone--blue">{t('{n} 进行中', { n: kpi.liveRuns })}</span>
            ) : null}
          </>
        ),
      },
    ]

    if (capabilities.hasCost && kpi.costReportedRuns > 0) {
      const partial = kpi.costReportedRuns < kpi.totalRuns
      cells.push({
        key: 'cost',
        label: t('费用'),
        value: fmtCostUsd(kpi.totalCostUsd, partial),
        tone: 'green',
        delta: fmtDelta(kpi.totalCostUsd, prev?.totalCostUsd),
        sub: partial ? (
          <span>{t('{n} 轮未计价', { n: fmtCount(kpi.totalRuns - kpi.costReportedRuns) })}</span>
        ) : (
          <span>{t('{n} 轮已计价', { n: fmtCount(kpi.costReportedRuns) })}</span>
        ),
      })
    }

    if (capabilities.hasCache && kpi.cacheReportedRuns > 0 && kpi.cacheHitRate != null) {
      cells.push({
        key: 'cache',
        label: t('缓存命中率'),
        value: fmtRate(kpi.cacheHitRate),
        progress: {
          ratio: kpi.cacheHitRate,
          tone: 'green',
          label: t('缓存命中率'),
        },
        sub: (
          <span>
            {t('读取 {r} · {n} 轮 · 近 {d} 天', {
              r: fmtCompactTokens(kpi.cacheReadTokens),
              n: fmtCount(kpi.cacheReportedRuns),
              d: capabilities.retentionDays,
            })}
          </span>
        ),
      })
    }

    cells.push({
      key: 'latency',
      label: t('平均耗时'),
      value: fmtDurationMs(kpi.avgDurationMs),
      inlineMeta: kpi.avgOutputTps != null ? fmtTps(kpi.avgOutputTps) : undefined,
      delta:
        kpi.avgDurationMs != null && prev?.avgDurationMs != null
          ? fmtDelta(kpi.avgDurationMs, prev.avgDurationMs)
          : null,
      sub: (
        <span>
          {t('P50 {p50} · P95 {p95}', {
            p50: fmtDurationMs(kpi.p50DurationMs),
            p95: fmtDurationMs(kpi.p95DurationMs),
          })}
        </span>
      ),
    })

    // Ensure 4-6 balanced KPI cells when neither cost nor cache is present.
    if (cells.length < 4) {
      cells.push({
        key: 'active',
        label: t('活跃范围'),
        value: t('{n} Bot', { n: kpi.activeBots }),
        sub: (
          <span>
            {t('{u} 触发人 · {g} 会话', {
              u: fmtCount(kpi.activeUsers),
              g: fmtCount(kpi.activeGroups),
            })}
          </span>
        ),
      })
    }

    return cells
  }, [kpi, prev, capabilities])

  const isEmpty = kpi && kpi.totalRuns === 0 && !timeseries?.buckets.some((b) => b.runs > 0)

  if (isEmpty) {
    return (
      <div className="usage-tab-stack" data-testid="usage-overview-empty">
        <EmptyState compact illustration={<NoDataArt />} title={t('当前时间范围内没有运行记录')} />
      </div>
    )
  }

  return (
    <div className={cx('usage-tab-stack', stale && 'usage-stale')} data-testid="usage-overview-tab">
      {kpiCells.length > 0 ? <UsageKpiStrip cells={kpiCells} aria-label={t('核心用量指标')} /> : null}

      <UsageTrendPanel
        data={timeseries}
        metric={metric}
        onMetricChange={onMetricChange}
        breakdown={breakdown}
        onBreakdownChange={onBreakdownChange}
        chartMode={chartMode}
        onChartModeChange={onChartModeChange}
        capabilities={capabilities}
      />

      {agentRank?.items.length ? (
        <UsageRankingSection
          title={t('Agent 类型')}
          items={agentRank.items}
          totalItems={agentRank.totalItems}
          hasCost={capabilities.hasCost}
          hasInputOutput={capabilities.hasInputOutput}
          kind="agentKind"
          onSelectRow={(row) => onFilterJump({ agentKind: row.key as AgentKind })}
        />
      ) : null}

      {capabilities.hasModels && modelRank?.items.length ? (
        <UsageRankingSection
          title={t('模型')}
          items={modelRank.items}
          totalItems={modelRank.totalItems}
          hasCost={capabilities.hasCost}
          hasInputOutput={capabilities.hasInputOutput}
          kind="model"
          onSelectRow={(row) => onFilterJump({ model: row.key })}
        />
      ) : null}

      <div className="usage-two-col">
        {botRank?.items.length ? (
          <UsageRankingSection
            title="Bot"
            items={botRank.items}
            totalItems={botRank.totalItems}
            hasCost={capabilities.hasCost}
            hasInputOutput={capabilities.hasInputOutput}
            kind="bot"
            compact
            onSelectRow={(row) => onFilterJump({ botId: row.key })}
          />
        ) : null}
        {userRank?.items.length ? (
          <UsageRankingSection
            title={t('触发人')}
            items={userRank.items}
            totalItems={userRank.totalItems}
            hasCost={capabilities.hasCost}
            hasInputOutput={capabilities.hasInputOutput}
            kind="user"
            compact
            onSelectRow={(row) => onFilterJump({ userId: row.key })}
          />
        ) : null}
      </div>

      {groupRank?.items.length ? (
        <UsageRankingSection
          title={t('群 / 会话')}
          items={groupRank.items}
          totalItems={groupRank.totalItems}
          hasCost={capabilities.hasCost}
          hasInputOutput={capabilities.hasInputOutput}
          kind="group"
          defaultOpen={false}
          onSelectRow={(row) => onFilterJump({ groupId: row.key })}
        />
      ) : null}

      {speedRows?.items.length ? (
        <UsageSpeedTable
          by={speedBy}
          onByChange={onSpeedByChange}
          items={speedRows.items}
          hasModels={capabilities.hasModels}
          hasCost={capabilities.hasCost}
        />
      ) : null}

      <UsageCalendarHeatmap
        data={calendarHeatmap}
        metric={heatmapMetric}
        onMetricChange={onHeatmapMetricChange}
        hasCost={capabilities.hasCost}
      />
    </div>
  )
}
