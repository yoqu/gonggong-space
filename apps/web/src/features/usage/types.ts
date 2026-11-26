import type {
  AgentKind,
  UsageBreakdownBy,
  UsageCapabilitiesDto,
  UsageExportFormat,
  UsageHeatmapMetric,
  UsageHeatmapMode,
  UsageMetric,
  UsageRunsSortBy,
  UsageSessionSort,
  UsageSortDir,
  UsageStatusFilter,
  UsageTimePreset,
  UsageTimeseriesBreakdown,
} from '@gonggong/protocol'
import { browserTimeZone } from '../../lib/time'

export type UsageWorkspaceTab = 'overview' | 'runs' | 'sessions'
export type UsageChartMode = 'bar' | 'line'
export type UsageGroupKind = 'group' | 'dm'

export interface UsageFilterState {
  preset: UsageTimePreset
  from: string
  to: string
  teamId: string
  agentKind: AgentKind | ''
  model: string
  provider: string
  botId: string
  userId: string
  groupId: string
  groupKind: UsageGroupKind | ''
  status: UsageStatusFilter
  q: string
}

export const DEFAULT_USAGE_FILTERS: UsageFilterState = {
  preset: '30d',
  from: '',
  to: '',
  teamId: '',
  agentKind: '',
  model: '',
  provider: '',
  botId: '',
  userId: '',
  groupId: '',
  groupKind: '',
  status: 'all',
  q: '',
}

export const EMPTY_CAPABILITIES: UsageCapabilitiesDto = {
  hasInputOutput: false,
  hasCost: false,
  hasCache: false,
  hasProvider: false,
  hasModels: false,
  hasTools: false,
  hasPlugins: false,
  retentionDays: 30,
}

export function hasActiveSecondaryFilters(f: UsageFilterState): boolean {
  return !!(
    f.teamId ||
    f.agentKind ||
    f.model ||
    f.provider ||
    f.botId ||
    f.userId ||
    f.groupId ||
    f.groupKind ||
    f.status !== 'all' ||
    f.q.trim()
  )
}

/** Builds URLSearchParams for all `/api[/admin]/usage/*` analytics endpoints. */
export function buildUsageParams(
  filters: UsageFilterState,
  extra?: Record<string, string | number | boolean | undefined>,
): string {
  const sp = new URLSearchParams()
  sp.set('preset', filters.preset)
  sp.set('tz', browserTimeZone)
  if (filters.preset === 'custom') {
    if (filters.from) sp.set('from', filters.from)
    if (filters.to) sp.set('to', filters.to)
  }
  if (filters.teamId) sp.set('teamId', filters.teamId)
  if (filters.agentKind) sp.set('agentKind', filters.agentKind)
  if (filters.model) sp.set('model', filters.model)
  if (filters.provider) sp.set('provider', filters.provider)
  if (filters.botId) sp.set('botId', filters.botId)
  if (filters.userId) sp.set('userId', filters.userId)
  if (filters.groupId) sp.set('groupId', filters.groupId)
  if (filters.groupKind) sp.set('groupKind', filters.groupKind)
  if (filters.status !== 'all') sp.set('status', filters.status)
  const q = filters.q.trim()
  if (q) sp.set('q', q)
  if (extra) {
    for (const [k, v] of Object.entries(extra)) {
      if (v !== undefined && v !== '') sp.set(k, String(v))
    }
  }
  return sp.toString()
}

export function usageEndpoint(
  base: string,
  sub: 'facets' | 'overview' | 'timeseries' | 'breakdown' | 'heatmap' | 'insights' | 'runs' | 'export',
  filters: UsageFilterState,
  extra?: Record<string, string | number | boolean | undefined>,
): string | null {
  if (filters.preset === 'custom' && !filters.from) return null
  return `${base}/${sub}?${buildUsageParams(filters, extra)}`
}

export interface UsageTimeseriesOptions {
  metric: UsageMetric
  breakdown: UsageTimeseriesBreakdown
  chartMode: UsageChartMode
}

export interface UsageRunsOptions {
  page: number
  pageSize: number
  sortBy: UsageRunsSortBy
  sortDir: UsageSortDir
  onlySlow: boolean
  onlyError: boolean
}

export type {
  UsageBreakdownBy,
  UsageExportFormat,
  UsageHeatmapMetric,
  UsageHeatmapMode,
  UsageMetric,
  UsageRunsSortBy,
  UsageSessionSort,
  UsageSortDir,
  UsageStatusFilter,
  UsageTimePreset,
  UsageTimeseriesBreakdown,
}
