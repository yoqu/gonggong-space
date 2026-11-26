import type {
  AdminTeamDto,
  UsageBreakdownBy,
  UsageBreakdownDto,
  UsageExportFormat,
  UsageFacetsDto,
  UsageHeatmapDto,
  UsageHeatmapMetric,
  UsageInsightsDto,
  UsageMetric,
  UsageOverviewDto,
  UsageRunsDto,
  UsageSessionSort,
  UsageTimeseriesBreakdown,
  UsageTimeseriesDto,
} from '@gonggong/protocol'
import { useCallback, useEffect, useState } from 'react'
import { t } from '../../i18n'
import { downloadUrl } from '../../lib/download'
import { useGet } from '../../lib/useGet'
import { Alert, Skeleton, Tabs } from '../../ui'
import {
  DEFAULT_USAGE_FILTERS,
  EMPTY_CAPABILITIES,
  type UsageChartMode,
  type UsageFilterState,
  type UsageRunsOptions,
  type UsageWorkspaceTab,
  usageEndpoint,
} from './types'
import { UsageFilterBar } from './UsageFilterBar'
import { UsageOverviewTab } from './UsageOverviewTab'
import { UsageRequestsTab } from './UsageRequestsTab'
import { UsageSessionsTab } from './UsageSessionsTab'
import { useAutoRefresh, useUsageQuery } from './useUsageQuery'
import './usage.css'
import './usage-charts.css'

const WORKSPACE_TABS: { value: UsageWorkspaceTab; label: string }[] = [
  { value: 'overview', label: t('概览') },
  { value: 'runs', label: t('运行明细') },
  { value: 'sessions', label: t('会话洞察') },
]

export function UsageWorkspace({
  base = '/admin/usage',
  showTeamFilter = true,
}: {
  base?: string
  showTeamFilter?: boolean
}) {
  const [tab, setTab] = useState<UsageWorkspaceTab>('overview')
  const [filters, setFilters] = useState<UsageFilterState>(DEFAULT_USAGE_FILTERS)
  const [refreshSec, setRefreshSec] = useState(0)
  const [refreshKey, setRefreshKey] = useState(0)

  // Overview chart & table controls
  const [metric, setMetric] = useState<UsageMetric>('tokens')
  const [breakdown, setBreakdown] = useState<UsageTimeseriesBreakdown>('model')
  const [chartMode, setChartMode] = useState<UsageChartMode>('bar')
  const [speedBy, setSpeedBy] = useState<UsageBreakdownBy>('model')
  const [heatmapMetric, setHeatmapMetric] = useState<UsageHeatmapMetric>('tokens')

  // Runs tab controls
  const [runsOpt, setRunsOpt] = useState<UsageRunsOptions>({
    page: 1,
    pageSize: 25,
    sortBy: 'startedAt',
    sortDir: 'desc',
    onlySlow: false,
    onlyError: false,
  })

  // Sessions tab controls
  const [sessionSort, setSessionSort] = useState<UsageSessionSort>('tokens')

  const teamsReq = useGet<AdminTeamDto[]>(showTeamFilter ? '/admin/teams' : null)
  const teams = teamsReq.data ?? []

  const updateFilters = useCallback((patch: Partial<UsageFilterState>) => {
    setFilters((prev) => ({ ...prev, ...patch }))
    setRunsOpt((prev) => ({ ...prev, page: 1 }))
  }, [])

  const resetFilters = useCallback(() => {
    setFilters((prev) => ({
      ...DEFAULT_USAGE_FILTERS,
      preset: prev.preset,
      from: prev.from,
      to: prev.to,
    }))
    setRunsOpt((prev) => ({ ...prev, page: 1, onlySlow: false, onlyError: false }))
  }, [])

  const triggerRefresh = useCallback(() => setRefreshKey((n) => n + 1), [])
  useAutoRefresh(refreshSec, triggerRefresh)

  // Core shared queries — `/facets` depends only on time + team scope so dim/status/search filters don't refetch it.
  const facetsPath = usageEndpoint(base, 'facets', {
    ...DEFAULT_USAGE_FILTERS,
    preset: filters.preset,
    from: filters.from,
    to: filters.to,
    teamId: filters.teamId,
  })
  const overviewPath = usageEndpoint(base, 'overview', filters)
  const facetsQ = useUsageQuery<UsageFacetsDto>(facetsPath, refreshKey)
  const overviewQ = useUsageQuery<UsageOverviewDto>(overviewPath, refreshKey)

  const capabilities = overviewQ.data?.capabilities ?? facetsQ.data?.capabilities ?? EMPTY_CAPABILITIES

  // Keep selected metric/breakdown valid against real capabilities.
  useEffect(() => {
    if (!overviewQ.data && !facetsQ.data) return
    if (metric === 'cost' && !capabilities.hasCost) setMetric('tokens')
    if (metric === 'throughput' && !capabilities.hasInputOutput) setMetric('tokens')
    if (heatmapMetric === 'cost' && !capabilities.hasCost) setHeatmapMetric('tokens')
    if (breakdown === 'model' && !capabilities.hasModels) setBreakdown('agentKind')
    if (breakdown === 'provider' && !capabilities.hasProvider) setBreakdown('agentKind')
    if (speedBy === 'model' && !capabilities.hasModels) setSpeedBy('agentKind')
  }, [
    overviewQ.data,
    facetsQ.data,
    capabilities.hasCost,
    capabilities.hasInputOutput,
    capabilities.hasModels,
    capabilities.hasProvider,
    metric,
    heatmapMetric,
    breakdown,
    speedBy,
  ])

  const effectiveMetric: UsageMetric =
    (metric === 'cost' && !capabilities.hasCost) || (metric === 'throughput' && !capabilities.hasInputOutput)
      ? 'tokens'
      : metric
  const effectiveBreakdown: UsageTimeseriesBreakdown =
    breakdown === 'model' && !capabilities.hasModels
      ? 'agentKind'
      : breakdown === 'provider' && !capabilities.hasProvider
        ? 'agentKind'
        : breakdown
  const effectiveSpeedBy: UsageBreakdownBy =
    speedBy === 'model' && !capabilities.hasModels ? 'agentKind' : speedBy
  const effectiveHeatmapMetric: UsageHeatmapMetric =
    heatmapMetric === 'cost' && !capabilities.hasCost ? 'tokens' : heatmapMetric

  // Overview-specific queries (active only on overview tab)
  const isOverview = tab === 'overview'
  const isRuns = tab === 'runs'
  const isSessions = tab === 'sessions'

  const timeseriesQ = useUsageQuery<UsageTimeseriesDto>(
    isOverview
      ? usageEndpoint(base, 'timeseries', filters, {
          metric: effectiveMetric,
          breakdown: effectiveBreakdown,
          topN: 5,
          granularity: 'auto',
        })
      : null,
    refreshKey,
  )
  const agentRankQ = useUsageQuery<UsageBreakdownDto>(
    isOverview ? usageEndpoint(base, 'breakdown', filters, { by: 'agentKind', limit: 20 }) : null,
    refreshKey,
  )
  const modelRankQ = useUsageQuery<UsageBreakdownDto>(
    (isOverview || isSessions) && capabilities.hasModels
      ? usageEndpoint(base, 'breakdown', filters, { by: 'model', limit: 20 })
      : null,
    refreshKey,
  )
  const botRankQ = useUsageQuery<UsageBreakdownDto>(
    isOverview ? usageEndpoint(base, 'breakdown', filters, { by: 'bot', limit: 20 }) : null,
    refreshKey,
  )
  const userRankQ = useUsageQuery<UsageBreakdownDto>(
    isOverview || (isSessions && !capabilities.hasModels)
      ? usageEndpoint(base, 'breakdown', filters, { by: 'user', limit: 20 })
      : null,
    refreshKey,
  )
  const groupRankQ = useUsageQuery<UsageBreakdownDto>(
    isOverview || isSessions ? usageEndpoint(base, 'breakdown', filters, { by: 'group', limit: 20 }) : null,
    refreshKey,
  )
  const calendarHeatmapQ = useUsageQuery<UsageHeatmapDto>(
    isOverview
      ? usageEndpoint(base, 'heatmap', filters, { mode: 'calendar', metric: effectiveHeatmapMetric })
      : null,
    refreshKey,
  )

  // Runs tab query
  const runsQ = useUsageQuery<UsageRunsDto>(
    isRuns
      ? usageEndpoint(base, 'runs', filters, {
          page: runsOpt.page,
          pageSize: runsOpt.pageSize,
          sortBy: runsOpt.sortBy,
          sortDir: runsOpt.sortDir,
          onlySlow: runsOpt.onlySlow || undefined,
          onlyError: runsOpt.onlyError || undefined,
        })
      : null,
    refreshKey,
  )

  // Sessions tab queries
  const insightsQ = useUsageQuery<UsageInsightsDto>(
    isSessions ? usageEndpoint(base, 'insights', filters, { sessionSort }) : null,
    refreshKey,
  )
  const weekHourQ = useUsageQuery<UsageHeatmapDto>(
    isSessions ? usageEndpoint(base, 'heatmap', filters, { mode: 'week_hour', metric: 'tokens' }) : null,
    refreshKey,
  )

  const handleExport = (format: UsageExportFormat) => {
    const sub = usageEndpoint(base, 'export', filters, {
      format,
      onlySlow: isRuns && runsOpt.onlySlow ? true : undefined,
      onlyError: isRuns && runsOpt.onlyError ? true : undefined,
    })
    if (!sub) return
    downloadUrl(`/api${sub}`)
  }

  const speedRows =
    effectiveSpeedBy === 'model'
      ? modelRankQ.data
      : effectiveSpeedBy === 'bot'
        ? botRankQ.data
        : agentRankQ.data

  const activeError =
    overviewQ.error ||
    (isOverview ? timeseriesQ.error : '') ||
    (isRuns ? runsQ.error : '') ||
    (isSessions ? insightsQ.error : '')

  const activeLoading =
    overviewQ.loading ||
    (isOverview && (timeseriesQ.loading || agentRankQ.loading)) ||
    (isRuns && runsQ.loading) ||
    (isSessions && insightsQ.loading)

  const retryActive = () => {
    facetsQ.reload()
    overviewQ.reload()
    if (isOverview) {
      timeseriesQ.reload()
      agentRankQ.reload()
      modelRankQ.reload()
      botRankQ.reload()
      userRankQ.reload()
      groupRankQ.reload()
      calendarHeatmapQ.reload()
    } else if (isRuns) {
      runsQ.reload()
    } else {
      insightsQ.reload()
      weekHourQ.reload()
      groupRankQ.reload()
      modelRankQ.reload()
      userRankQ.reload()
    }
  }

  const initialSkeleton =
    (isOverview && overviewQ.initialLoading) ||
    (isRuns && runsQ.initialLoading) ||
    (isSessions && insightsQ.initialLoading)

  return (
    <div className="usage-ws" data-testid="usage-workspace">
      <div className="usage-ws__nav">
        <Tabs value={tab} onChange={setTab} items={WORKSPACE_TABS} aria-label={t('用量分析视图')} />
      </div>

      <UsageFilterBar
        filters={filters}
        onChange={updateFilters}
        onResetFilters={resetFilters}
        facets={facetsQ.data}
        teams={teams}
        kpi={overviewQ.data?.kpi ?? null}
        hasCost={capabilities.hasCost}
        refreshSec={refreshSec}
        onRefreshSecChange={setRefreshSec}
        onManualRefresh={triggerRefresh}
        refreshing={activeLoading}
        onExport={handleExport}
        showTeamFilter={showTeamFilter}
      />

      {activeError ? (
        <Alert variant="error" description={activeError} retrying={activeLoading} onRetry={retryActive} />
      ) : null}

      {initialSkeleton && !activeError ? (
        <div className="usage-skeleton" aria-busy="true">
          <Skeleton width="100%" height={84} />
          <Skeleton width="100%" height={240} />
          <Skeleton width="100%" height={180} />
        </div>
      ) : (
        <div key={tab} className="ui-panel-swap">
          {isOverview ? (
            <UsageOverviewTab
              overview={overviewQ.data}
              capabilities={capabilities}
              timeseries={timeseriesQ.data}
              metric={effectiveMetric}
              onMetricChange={setMetric}
              breakdown={effectiveBreakdown}
              onBreakdownChange={setBreakdown}
              chartMode={chartMode}
              onChartModeChange={setChartMode}
              agentRank={agentRankQ.data}
              modelRank={modelRankQ.data}
              botRank={botRankQ.data}
              userRank={userRankQ.data}
              groupRank={groupRankQ.data}
              speedBy={effectiveSpeedBy}
              onSpeedByChange={setSpeedBy}
              speedRows={speedRows}
              calendarHeatmap={calendarHeatmapQ.data}
              heatmapMetric={effectiveHeatmapMetric}
              onHeatmapMetricChange={setHeatmapMetric}
              onFilterJump={updateFilters}
              stale={overviewQ.stale || timeseriesQ.stale}
            />
          ) : null}

          {isRuns ? (
            <UsageRequestsTab
              data={runsQ.data}
              capabilities={capabilities}
              options={runsOpt}
              onOptionsChange={(patch) => setRunsOpt((prev) => ({ ...prev, ...patch }))}
              onFilterJump={updateFilters}
              stale={runsQ.stale}
            />
          ) : null}

          {isSessions ? (
            <UsageSessionsTab
              insights={insightsQ.data}
              heatmap={weekHourQ.data}
              groupBreakdown={groupRankQ.data}
              secondaryBreakdown={capabilities.hasModels ? modelRankQ.data : userRankQ.data}
              secondaryTitle={capabilities.hasModels ? t('按模型') : t('按触发人')}
              secondaryKind={capabilities.hasModels ? 'model' : 'user'}
              capabilities={capabilities}
              sessionSort={sessionSort}
              onSessionSortChange={setSessionSort}
              stale={insightsQ.stale || weekHourQ.stale}
            />
          ) : null}
        </div>
      )}

      <p className="usage-note">
        {t(
          '所有指标均基于真实运行记录统计 · 未上报 Token 的轮次不计入合计 · 费用与缓存仅统计适配器实际回报的数据 · 工具调用明细按 {days} 天事件保留期统计。',
          { days: capabilities.retentionDays },
        )}
      </p>
    </div>
  )
}
