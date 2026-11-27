import type {
  UsageCapabilitiesDto,
  UsageFacetsDto,
  UsageInsightsDto,
  UsageKpiDto,
  UsageOverviewDto,
  UsageRunsDto,
  UsageTimeseriesDto,
} from '@gonggong/protocol'
import { fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { fmtDelta } from '../src/features/usage/formatters'
import { Delta } from '../src/features/usage/metrics'
import { UsageWorkspace } from '../src/features/usage/UsageWorkspace'
import { api } from '../src/lib/api'

const CAPS: UsageCapabilitiesDto = {
  hasInputOutput: false,
  hasCost: true,
  hasCache: false,
  hasProvider: false,
  hasModels: false,
  hasTools: false,
  hasPlugins: false,
  retentionDays: 30,
}

const kpi = (o: Partial<UsageKpiDto>): UsageKpiDto => ({
  totalTokens: 0,
  inputTokens: 0,
  outputTokens: 0,
  tokenReportedRuns: 0,
  unreportedRuns: 0,
  totalRuns: 0,
  endedRuns: 0,
  completedRuns: 0,
  failedRuns: 0,
  cancelledRuns: 0,
  liveRuns: 0,
  successRate: null,
  totalCostUsd: 0,
  costReportedRuns: 0,
  cacheReadTokens: 0,
  cacheInputTokens: 0,
  cacheHitRate: null,
  cacheReportedRuns: 0,
  avgDurationMs: null,
  p50DurationMs: null,
  p95DurationMs: null,
  avgOutputTps: null,
  activeUsers: 0,
  activeBots: 0,
  activeGroups: 0,
  ...o,
})

const overview = (current: UsageKpiDto, previous: UsageKpiDto | null): UsageOverviewDto => ({
  range: {
    from: '2026-10-28T00:00:00Z',
    to: '2026-11-27T00:00:00Z',
    previousFrom: '2026-09-28T00:00:00Z',
    previousTo: '2026-10-28T00:00:00Z',
    granularity: 'day',
  },
  kpi: current,
  previous,
  capabilities: CAPS,
})

const facets: UsageFacetsDto = {
  models: [],
  providers: [],
  agentKinds: [],
  bots: [],
  users: [],
  groups: [],
  capabilities: CAPS,
}
const emptySeries: UsageTimeseriesDto = {
  granularity: 'day',
  metric: 'tokens',
  breakdown: 'model',
  buckets: [],
  series: [],
}
const emptyRuns: UsageRunsDto = { items: [], total: 0, page: 1, pageSize: 25 } as unknown as UsageRunsDto

const emptyInsights: UsageInsightsDto = {
  sessionShape: {
    totalSessions: 0,
    totalActiveDurationMs: 0,
    totalTokens: 0,
    avgTurnsPerSession: 0,
    avgTokensPerSession: 0,
    medianTokensPerSession: null,
    p90TokensPerSession: null,
    groupCount: 0,
    dmCount: 0,
    turnBuckets: [],
    durationBuckets: [],
    triggerSources: [],
  },
  topSessions: [],
  recentSessions: [],
  toolUsage: {
    coveredRuns: 0,
    purgedRuns: 0,
    retentionDays: 30,
    byToolKind: [],
    byMcpTool: [],
    byToolName: [],
    weeklyByKind: [],
  },
  pluginUsage: { items: [], runsWithPersonalSkills: 0 },
}

function stub(ov: UsageOverviewDto) {
  return vi.spyOn(api, 'get').mockImplementation(async (path: string) => {
    if (path === '/admin/teams') return []
    if (path.includes('/facets?')) return facets
    if (path.includes('/overview?')) return ov
    if (path.includes('/timeseries?')) return emptySeries
    if (path.includes('/breakdown?')) return { by: 'agentKind', items: [], totalItems: 0 }
    if (path.includes('/heatmap?')) return null
    if (path.includes('/runs?')) return emptyRuns
    if (path.includes('/insights?')) return emptyInsights
    throw new Error(`Unexpected GET ${path}`)
  })
}

afterEach(() => vi.restoreAllMocks())

describe('Delta: under 10 in the prior window shows the raw value instead of a swinging percentage', () => {
  it('shows the prior value, not ↓ 100%, for a tiny previous window', () => {
    const { container, rerender } = render(<Delta now={0} before={1} days={7} />)
    expect(container.textContent).toBe('前 7 天：1')
    rerender(<Delta now={0} before={0} days={7} />)
    expect(container.textContent).toBe('前 7 天：0')
    rerender(<Delta now={10} before={20} days={7} />)
    expect(container.textContent).toBe('↓ 50%较前 7 天')
  })

  it('fmtDelta applies the same rule, judged by the prior sample size and showing the prior value', () => {
    expect(fmtDelta(0, 3)).toEqual({ label: '上期 3', dir: 'flat' })
    expect(fmtDelta(500, 300, { sample: 2, prior: '300' })).toEqual({ label: '上期 300', dir: 'flat' })
    expect(fmtDelta(50, 100)).toEqual({ label: '↓ 50%', dir: 'down' })
    // Nothing reported this period: the drop to 0 is missing data, not a change.
    expect(fmtDelta(0, 5000, { sample: 20, reported: 0 })).toBeNull()
    expect(fmtDelta(5, null)).toBeNull()
  })
})

describe('用量 · 概览 KPI 小样本', () => {
  it('shows 上期 N instead of ±100% when the previous period had fewer than 10 runs', async () => {
    stub(
      overview(
        kpi({
          totalRuns: 40,
          tokenReportedRuns: 40,
          totalTokens: 90_000,
          costReportedRuns: 40,
          totalCostUsd: 2,
        }),
        kpi({
          totalRuns: 2,
          tokenReportedRuns: 2,
          totalTokens: 3_000,
          costReportedRuns: 2,
          totalCostUsd: 0.1,
        }),
      ),
    )
    render(<UsageWorkspace base="/admin/usage" />)
    const runs = await screen.findByTestId('usage-kpi-runs')
    expect(runs.textContent).toContain('上期 2')
    expect(runs.textContent).not.toContain('%')
    expect(screen.getByTestId('usage-kpi-tokens').textContent).toContain('上期 3,000')
    expect(screen.getByTestId('usage-kpi-cost').textContent).not.toMatch(/↑|↓/)
  })
})

describe('用量 · 本期无上报', () => {
  it('reads 未上报 with no change, not a 0 token total that fell 100%', async () => {
    stub(
      overview(
        kpi({ totalRuns: 6, tokenReportedRuns: 0, totalTokens: 0, unreportedRuns: 6 }),
        kpi({ totalRuns: 40, tokenReportedRuns: 40, totalTokens: 90_000 }),
      ),
    )
    render(<UsageWorkspace base="/admin/usage" />)
    const tokens = await screen.findByTestId('usage-kpi-tokens')
    expect(tokens.querySelector('.usage-kpi-cell__value')?.textContent).toBe('未上报')
    expect(tokens.textContent).not.toMatch(/↑|↓|%/)
  })
})

describe('用量 · 筛选后无结果', () => {
  it('says the filters, not the time range, came up empty and offers 清除筛选', async () => {
    const spy = stub(overview(kpi({}), kpi({})))
    render(<UsageWorkspace base="/admin/usage" />)
    expect(await screen.findByText('当前时间范围内没有运行记录')).toBeTruthy()
    expect(screen.queryByRole('button', { name: '清除筛选' })).toBeNull()

    fireEvent.click(screen.getByRole('radio', { name: '失败' }))
    const empty = await screen.findByTestId('usage-overview-empty')
    expect(within(empty).getByText('当前筛选条件下没有运行记录')).toBeTruthy()
    fireEvent.click(within(empty).getByRole('button', { name: '清除筛选' }))
    await waitFor(() =>
      expect(within(screen.getByTestId('usage-overview-empty')).queryByRole('button')).toBeNull(),
    )
    const last = spy.mock.calls.filter(([p]) => p.includes('/overview?')).at(-1)?.[0] ?? ''
    expect(last).not.toContain('status=failed')
  })

  it('names the filter bar reset 清除筛选 like the rest of the app', async () => {
    stub(overview(kpi({ totalRuns: 20 }), null))
    render(<UsageWorkspace base="/admin/usage" />)
    await screen.findByTestId('usage-kpi-strip')
    fireEvent.click(screen.getByRole('radio', { name: '失败' }))
    const bar = screen.getByTestId('usage-filterbar')
    expect(within(bar).getByRole('button', { name: '清除筛选' })).toBeTruthy()
    expect(within(bar).queryByRole('button', { name: '重置' })).toBeNull()
  })

  it('offers 清除筛选 on the empty runs and sessions tabs too', async () => {
    stub(overview(kpi({}), null))
    render(<UsageWorkspace base="/admin/usage" />)
    await screen.findByTestId('usage-overview-empty')
    fireEvent.click(screen.getByRole('radio', { name: '失败' }))
    fireEvent.click(screen.getByRole('tab', { name: '运行明细' }))
    expect(await screen.findByText('当前筛选条件下没有运行记录')).toBeTruthy()
    expect(screen.getAllByRole('button', { name: '清除筛选' }).length).toBe(2)
    fireEvent.click(screen.getByRole('tab', { name: '会话洞察' }))
    expect(await screen.findByText('当前筛选条件下没有会话记录')).toBeTruthy()
  })
})

describe('用量 · 定价弹层', () => {
  it('does not repeat 汇率 in the reference-rate value', async () => {
    stub(overview(kpi({ totalRuns: 20 }), null))
    render(<UsageWorkspace base="/admin/usage" />)
    await screen.findByTestId('usage-kpi-strip')
    fireEvent.click(screen.getByTestId('usage-pricing-pill'))
    const pop = await screen.findByTestId('usage-pricing-popover')
    expect(within(pop).getByText(/^1 USD = ¥/)).toBeTruthy()
    expect(pop.textContent).not.toContain('汇率 1 USD')
  })
})
