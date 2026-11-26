import type {
  UsageBreakdownDto,
  UsageCapabilitiesDto,
  UsageFacetsDto,
  UsageHeatmapDto,
  UsageInsightsDto,
  UsageOverviewDto,
  UsagePricingStatusDto,
  UsageRunsDto,
  UsageTimeseriesDto,
} from '@gonggong/protocol'
import { fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { useSession } from '../src/app/session'
import { CURRENCY_STORAGE_KEY, fmtCost, fmtUnitPrice } from '../src/features/usage/formatters'
import { UsageTrendPanel } from '../src/features/usage/UsageTrendPanel'
import { UsageWorkspace } from '../src/features/usage/UsageWorkspace'
import { api } from '../src/lib/api'
import { DURATION, EASE, prefersReducedMotion, STAGGER, TRANSITION } from '../src/lib/motion'

const FULL_CAPS: UsageCapabilitiesDto = {
  hasInputOutput: true,
  hasCost: true,
  hasCache: true,
  hasProvider: true,
  hasModels: true,
  hasTools: true,
  hasPlugins: true,
  retentionDays: 30,
}

const MINIMAL_CAPS: UsageCapabilitiesDto = {
  hasInputOutput: false,
  hasCost: false,
  hasCache: false,
  hasProvider: false,
  hasModels: false,
  hasTools: false,
  hasPlugins: false,
  retentionDays: 30,
}

function makeFixtures(caps: UsageCapabilitiesDto) {
  const facets: UsageFacetsDto = {
    models: caps.hasModels
      ? [
          { value: 'claude-opus-4-6', label: 'claude-opus-4-6', count: 120 },
          { value: 'gpt-5-codex', label: 'gpt-5-codex', count: 40 },
        ]
      : [],
    providers: caps.hasProvider
      ? [
          { value: 'anthropic', label: 'anthropic', count: 100 },
          { value: '__default__', label: '默认', count: 60 },
        ]
      : [],
    agentKinds: [
      { value: 'claude', label: 'claude', count: 120 },
      { value: 'codex', label: 'codex', count: 40 },
    ],
    bots: [
      { value: 'b1', label: '研发 Claude', count: 120 },
      { value: 'b2', label: '构建 Codex', count: 40 },
    ],
    users: [
      { value: 'u1', label: '张三', count: 100 },
      { value: 'u2', label: '李四', count: 60 },
    ],
    groups: [
      { value: 'g1', label: '核心研发群', count: 110 },
      { value: 'g2', label: '私聊', count: 50 },
    ],
    capabilities: caps,
  }

  const overview: UsageOverviewDto = {
    range: {
      from: '2026-10-27T00:00:00Z',
      to: '2026-11-26T00:00:00Z',
      previousFrom: '2026-09-27T00:00:00Z',
      previousTo: '2026-10-27T00:00:00Z',
      granularity: 'day',
    },
    kpi: {
      totalTokens: 1_520_000,
      inputTokens: 1_120_000,
      outputTokens: 400_000,
      tokenReportedRuns: 150,
      unreportedRuns: 10,
      totalRuns: 160,
      endedRuns: 158,
      completedRuns: 152,
      failedRuns: 4,
      cancelledRuns: 2,
      liveRuns: 2,
      successRate: 152 / 158,
      totalCostUsd: caps.hasCost ? 42.85 : 0,
      costReportedRuns: caps.hasCost ? 120 : 0,
      reportedCostRuns: caps.hasCost ? 80 : 0,
      estimatedCostRuns: caps.hasCost ? 40 : 0,
      cacheReadTokens: caps.hasCache ? 9_800_000 : 0,
      cacheInputTokens: caps.hasCache ? 10_200_000 : 0,
      cacheHitRate: caps.hasCache ? 9_800_000 / 10_200_000 : null,
      cacheReportedRuns: caps.hasCache ? 118 : 0,
      avgDurationMs: 14_500,
      p50DurationMs: 9_200,
      p95DurationMs: 68_000,
      avgOutputTps: 64.5,
      activeUsers: 5,
      activeBots: 4,
      activeGroups: 6,
    },
    previous: {
      totalTokens: 1_000_000,
      inputTokens: 750_000,
      outputTokens: 250_000,
      tokenReportedRuns: 100,
      unreportedRuns: 5,
      totalRuns: 105,
      endedRuns: 105,
      completedRuns: 100,
      failedRuns: 5,
      cancelledRuns: 0,
      liveRuns: 0,
      successRate: 100 / 105,
      totalCostUsd: caps.hasCost ? 30 : 0,
      costReportedRuns: caps.hasCost ? 90 : 0,
      cacheReadTokens: 0,
      cacheInputTokens: 0,
      cacheHitRate: null,
      cacheReportedRuns: 0,
      avgDurationMs: 16_000,
      p50DurationMs: 10_000,
      p95DurationMs: 70_000,
      avgOutputTps: 50,
      activeUsers: 4,
      activeBots: 3,
      activeGroups: 4,
    },
    reportedCostRuns: caps.hasCost ? 80 : 0,
    estimatedCostRuns: caps.hasCost ? 40 : 0,
    pricing: {
      source: 'models.dev',
      syncedAt: '2026-11-26T08:00:00Z',
      providerCount: 95,
      modelCount: 3800,
      stale: false,
      refreshing: false,
      fx: {
        usdToCny: 7.25,
        syncedAt: '2026-11-26T08:00:00Z',
        source: 'open.er-api.com',
        stale: false,
      },
    },
    capabilities: caps,
  }

  const timeseries: UsageTimeseriesDto = {
    granularity: 'day',
    metric: 'tokens',
    breakdown: caps.hasModels ? 'model' : 'agentKind',
    buckets: [
      {
        ts: '2026-11-25',
        label: '11/25',
        total: 620_000,
        totalTokens: 620_000,
        inputTokens: 450_000,
        outputTokens: 170_000,
        costUsd: caps.hasCost ? 18.2 : 0,
        runs: 60,
        completedRuns: 58,
        failedRuns: 2,
        unreportedRuns: 0,
        avgDurationMs: 12_000,
        avgOutputTps: 60,
        bySeries: { s1: 420_000, s2: 200_000 },
      },
      {
        ts: '2026-11-26',
        label: '11/26',
        total: 900_000,
        totalTokens: 900_000,
        inputTokens: 670_000,
        outputTokens: 230_000,
        costUsd: caps.hasCost ? 24.65 : 0,
        runs: 100,
        completedRuns: 94,
        failedRuns: 2,
        unreportedRuns: 10,
        avgDurationMs: 16_000,
        avgOutputTps: 68,
        bySeries: { s1: 700_000, s2: 200_000 },
      },
    ],
    series: [
      {
        key: 's1',
        name: caps.hasModels ? 'claude-opus-4-6' : 'claude',
        total: 1_120_000,
        share: 0.74,
        runs: 120,
        failedRuns: 2,
        totalTokens: 1_120_000,
        costUsd: caps.hasCost ? 36.1 : 0,
        avgDurationMs: 13_000,
        avgOutputTps: 72,
      },
      {
        key: 's2',
        name: caps.hasModels ? 'gpt-5-codex' : 'codex',
        total: 400_000,
        share: 0.26,
        runs: 40,
        failedRuns: 2,
        totalTokens: 400_000,
        costUsd: caps.hasCost ? 6.75 : 0,
        avgDurationMs: 18_500,
        avgOutputTps: 45,
      },
    ],
  }

  const breakdown = (by: UsageBreakdownDto['by']): UsageBreakdownDto => ({
    by,
    totalItems: 2,
    items: [
      {
        key: by === 'agentKind' ? 'claude' : 'k1',
        name: by === 'agentKind' ? 'claude' : by === 'model' ? 'claude-opus-4-6' : '研发 Claude',
        sublabel: by === 'model' ? 'anthropic' : null,
        runs: 120,
        completedRuns: 116,
        failedRuns: 2,
        cancelledRuns: 2,
        unreportedRuns: 0,
        successRate: 116 / 120,
        totalTokens: 1_120_000,
        inputTokens: 820_000,
        outputTokens: 300_000,
        costUsd: caps.hasCost ? 36.1 : 0,
        costReportedRuns: caps.hasCost ? 120 : 0,
        avgDurationMs: 13_000,
        p95DurationMs: 42_000,
        avgOutputTps: 72,
        tokenShare: 0.74,
        runShare: 0.75,
        costShare: caps.hasCost ? 0.84 : 0,
        modelDisplayName: by === 'model' ? 'Claude Opus 4.6' : null,
        unitPrice:
          by === 'model'
            ? {
                input: 15,
                output: 75,
                cacheRead: 1.5,
                cacheWrite: 18.75,
                provider: 'anthropic',
                matchedId: 'anthropic/claude-opus-4-6',
                aliasMatched: false,
              }
            : null,
      },
      {
        key: by === 'agentKind' ? 'codex' : by === 'model' ? '__default__:codex' : 'k2',
        name: by === 'agentKind' ? 'codex' : by === 'model' ? '__default__:codex' : '构建 Codex',
        sublabel: null,
        runs: 40,
        completedRuns: 36,
        failedRuns: 2,
        cancelledRuns: 0,
        unreportedRuns: 10,
        successRate: 36 / 38,
        totalTokens: 400_000,
        inputTokens: 300_000,
        outputTokens: 100_000,
        costUsd: 0,
        costReportedRuns: 0,
        avgDurationMs: 18_500,
        p95DurationMs: 68_000,
        avgOutputTps: 45,
        tokenShare: 0.26,
        runShare: 0.25,
        costShare: 0,
      },
    ],
  })

  const calendarHeatmap: UsageHeatmapDto = {
    mode: 'calendar',
    metric: 'tokens',
    maxValue: 900_000,
    calendar: [
      {
        day: '2026-11-26',
        runs: 100,
        totalTokens: 900_000,
        costUsd: caps.hasCost ? 24.65 : 0,
        value: 900_000,
      },
    ],
  }

  const weekHourHeatmap: UsageHeatmapDto = {
    mode: 'week_hour',
    metric: 'tokens',
    maxValue: 450_000,
    weekHour: [
      { dow: 4, hour: 16, runs: 32, totalTokens: 450_000, costUsd: caps.hasCost ? 12.1 : 0, value: 450_000 },
    ],
  }

  const runs: UsageRunsDto = {
    total: 2,
    page: 1,
    pageSize: 25,
    slowThresholdMs: 60_000,
    summary: {
      totalRuns: 2,
      totalTokens: 180_000,
      inputTokens: 140_000,
      outputTokens: 40_000,
      costUsd: caps.hasCost ? 1.42 : 0,
      costReportedRuns: caps.hasCost ? 1 : 0,
      failedRuns: 1,
      cancelledRuns: 0,
      unreportedRuns: 0,
      slowRuns: 1,
      bySource: [
        { source: 'web_group', runs: 1, totalTokens: 120_000, costUsd: caps.hasCost ? 1.42 : 0 },
        { source: 'feishu', runs: 1, totalTokens: 60_000, costUsd: 0 },
      ],
    },
    items: [
      {
        id: 'run-slow-1',
        groupId: 'g1',
        groupName: '核心研发群',
        groupKind: 'group',
        botId: 'b1',
        botName: '研发 Claude',
        agentKind: 'claude',
        userId: 'u1',
        userName: '张三',
        model: caps.hasModels ? 'claude-opus-4-6' : null,
        effort: 'high',
        provider: caps.hasProvider ? 'anthropic' : null,
        status: 'completed',
        isError: false,
        isCancelled: false,
        isSlow: true,
        step: '',
        summary: '完成用量模块重构',
        queuedAt: '2026-11-26T09:00:00Z',
        startedAt: '2026-11-26T09:00:01Z',
        endedAt: '2026-11-26T09:01:25Z',
        durationMs: 84_000,
        inputTokens: 90_000,
        outputTokens: 30_000,
        totalTokens: 120_000,
        costUsd: caps.hasCost ? 1.42 : null,
        costSource: caps.hasCost ? 'catalog' : 'unpriced',
        modelDisplayName: caps.hasModels ? 'Claude Opus 4.6' : null,
        modelSource: caps.hasModels ? 'recorded' : 'unknown',
        unitPrice: caps.hasCost
          ? {
              input: 15,
              output: 75,
              cacheRead: 1.5,
              cacheWrite: 18.75,
              provider: 'anthropic',
              matchedId: 'anthropic/claude-opus-4-6',
              aliasMatched: false,
            }
          : null,
        outputTps: 357,
        filesChanged: 5,
        hop: 1,
        sessionId: 'sess-1',
        triggerSource: 'web_group',
        plugins: caps.hasPlugins ? ['ego-browser'] : [],
        personalSkills: caps.hasPlugins ? 2 : 0,
      },
      {
        id: 'run-err-2',
        groupId: 'g2',
        groupName: '飞书协作群',
        groupKind: 'group',
        botId: 'b2',
        botName: '构建 Codex',
        agentKind: 'codex',
        userId: 'u2',
        userName: '李四',
        model: null,
        effort: null,
        provider: null,
        status: 'interrupted',
        isError: true,
        isCancelled: false,
        isSlow: false,
        step: '运行出错：连接超时',
        summary: '',
        queuedAt: '2026-11-26T08:30:00Z',
        startedAt: '2026-11-26T08:30:01Z',
        endedAt: '2026-11-26T08:30:12Z',
        durationMs: 11_000,
        inputTokens: 50_000,
        outputTokens: 10_000,
        totalTokens: 60_000,
        costUsd: null,
        outputTps: null,
        filesChanged: 0,
        hop: 1,
        sessionId: 'sess-2',
        triggerSource: 'feishu',
        plugins: [],
        personalSkills: 0,
      },
    ],
  }

  const insights: UsageInsightsDto = {
    sessionShape: {
      totalSessions: 42,
      totalActiveDurationMs: 7_200_000,
      totalTokens: 1_520_000,
      avgTurnsPerSession: 3.8,
      avgTokensPerSession: 36_190,
      medianTokensPerSession: 24_000,
      p90TokensPerSession: 120_000,
      groupCount: 30,
      dmCount: 12,
      turnBuckets: [
        { bucket: '1', sessions: 15, totalTokens: 180_000, costUsd: 5 },
        { bucket: '2-3', sessions: 14, totalTokens: 420_000, costUsd: 12 },
        { bucket: '4-10', sessions: 10, totalTokens: 620_000, costUsd: 18 },
        { bucket: '11+', sessions: 3, totalTokens: 300_000, costUsd: 7.85 },
      ],
      durationBuckets: [
        { bucket: '<10s', runs: 50, totalTokens: 200_000 },
        { bucket: '10-30s', runs: 80, totalTokens: 600_000 },
        { bucket: '30-120s', runs: 25, totalTokens: 520_000 },
        { bucket: '2-5m', runs: 5, totalTokens: 200_000 },
      ],
      triggerSources: [
        { source: 'web_group', runs: 110, totalTokens: 1_100_000, costUsd: 30 },
        { source: 'feishu', runs: 50, totalTokens: 420_000, costUsd: 12.85 },
      ],
    },
    topSessions: [
      {
        sessionKey: 'sess-1',
        groupId: 'g1',
        groupName: '核心研发群',
        groupKind: 'group',
        botId: 'b1',
        botName: '研发 Claude',
        agentKind: 'claude',
        model: caps.hasModels ? 'claude-opus-4-6' : null,
        userId: 'u1',
        userName: '张三',
        turns: 12,
        failedTurns: 0,
        totalTokens: 320_000,
        inputTokens: 240_000,
        outputTokens: 80_000,
        costUsd: caps.hasCost ? 12.5 : 0,
        costReportedRuns: caps.hasCost ? 12 : 0,
        totalDurationMs: 360_000,
        firstAt: '2026-11-25T10:00:00Z',
        lastAt: '2026-11-26T09:01:25Z',
      },
    ],
    recentSessions: [
      {
        sessionKey: 'sess-1',
        groupId: 'g1',
        groupName: '核心研发群',
        groupKind: 'group',
        botId: 'b1',
        botName: '研发 Claude',
        agentKind: 'claude',
        model: caps.hasModels ? 'claude-opus-4-6' : null,
        userId: 'u1',
        userName: '张三',
        turns: 12,
        failedTurns: 0,
        totalTokens: 320_000,
        inputTokens: 240_000,
        outputTokens: 80_000,
        costUsd: caps.hasCost ? 12.5 : 0,
        costReportedRuns: caps.hasCost ? 12 : 0,
        totalDurationMs: 360_000,
        firstAt: '2026-11-25T10:00:00Z',
        lastAt: '2026-11-26T09:01:25Z',
      },
    ],
    toolUsage: {
      coveredRuns: caps.hasTools ? 140 : 0,
      purgedRuns: caps.hasTools ? 20 : 0,
      retentionDays: 30,
      byToolKind: caps.hasTools
        ? [
            { toolKind: 'execute', calls: 420, failedCalls: 8, runs: 110 },
            { toolKind: 'read', calls: 310, failedCalls: 0, runs: 95 },
          ]
        : [],
      byMcpTool: caps.hasTools
        ? [{ server: 'feishu', tool: 'send', calls: 15, failedCalls: 0, runs: 12 }]
        : [],
      byToolName: caps.hasTools
        ? [
            { name: 'Bash', kind: 'execute', calls: 420, estTokens: 80_000, runs: 110 },
            { name: 'Read', kind: 'read', calls: 310, estTokens: 45_000, runs: 95 },
          ]
        : [],
      weeklyByKind: caps.hasTools
        ? [{ week: '2026-11-23', total: 730, byKind: { execute: 420, read: 310 } }]
        : [],
    },
    pluginUsage: {
      items: caps.hasPlugins ? [{ name: 'ego-browser', runs: 28, totalTokens: 210_000 }] : [],
      runsWithPersonalSkills: caps.hasPlugins ? 14 : 0,
    },
  }

  return { facets, overview, timeseries, breakdown, calendarHeatmap, weekHourHeatmap, runs, insights }
}

function stubUsageApi(caps: UsageCapabilitiesDto) {
  const f = makeFixtures(caps)
  return vi.spyOn(api, 'get').mockImplementation(async (path: string) => {
    if (path === '/admin/teams') return []
    if (path.includes('/facets?')) return f.facets
    if (path.includes('/overview?')) return f.overview
    if (path.includes('/timeseries?')) return f.timeseries
    if (path.includes('/breakdown?')) {
      const m = /by=([^&]+)/.exec(path)
      return f.breakdown((m?.[1] ?? 'agentKind') as UsageBreakdownDto['by'])
    }
    if (path.includes('/heatmap?')) {
      return path.includes('mode=week_hour') ? f.weekHourHeatmap : f.calendarHeatmap
    }
    if (path.includes('/runs?')) return f.runs
    if (path.includes('/insights?')) return f.insights
    throw new Error(`Unexpected GET ${path}`)
  })
}

describe('UsageWorkspace & unified motion tokens', () => {
  afterEach(() => {
    vi.restoreAllMocks()
    vi.unstubAllGlobals()
    localStorage.removeItem(CURRENCY_STORAGE_KEY)
    useSession.setState({ user: null })
  })

  it('exports unified motion curves, durations, transitions, stagger cap, and reduced-motion check', () => {
    expect(EASE.standard).toEqual([0.2, 0, 0, 1])
    expect(DURATION.data).toBe(0.24)
    expect(TRANSITION.data).toEqual({ duration: 0.24, ease: [0.2, 0, 0, 1] })
    expect(STAGGER.delay(0)).toBe(0)
    expect(STAGGER.delay(3)).toBeCloseTo(0.06)
    expect(STAGGER.delay(20)).toBeCloseTo(0.12)
    expect(typeof prefersReducedMotion()).toBe('boolean')
  })

  it('formats CNY default and USD currency with exact precision rules and unit prices', () => {
    const cny = { currency: 'cny' as const, usdToCny: 7.2 }
    const usd = { currency: 'usd' as const, usdToCny: 7.2 }
    expect(fmtCost(20, { format: cny })).toBe('¥144')
    expect(fmtCost(2, { format: cny, partial: true })).toBe('¥14.40+')
    expect(fmtCost(0.02, { format: cny })).toBe('¥0.144')
    expect(fmtCost(0.00005, { format: cny })).toBe('¥0.0004')
    expect(fmtCost(42.85, { format: usd, partial: true })).toBe('$42.85+')
    expect(fmtUnitPrice({ input: 15, output: 75, cacheRead: 1.5, cacheWrite: 18.75 }, cny)).toBe(
      '¥108 / ¥540',
    )
    expect(fmtUnitPrice({ input: 15, output: 75, cacheRead: 1.5, cacheWrite: 18.75 }, usd)).toBe('$15 / $75')

    // Trend chart computes nice round CNY Y-axis ticks in display currency (24.65 * 7.25 = 178.7 -> ¥50/¥100/¥150/¥200)
    const { container } = render(
      <UsageTrendPanel
        data={{
          granularity: 'day',
          metric: 'cost',
          breakdown: 'none',
          buckets: [
            {
              ts: '2026-11-26',
              label: '11/26',
              total: 24.65,
              totalTokens: 900_000,
              inputTokens: 670_000,
              outputTokens: 230_000,
              costUsd: 24.65,
              runs: 100,
              completedRuns: 94,
              failedRuns: 2,
              unreportedRuns: 0,
              avgDurationMs: 16_000,
              avgOutputTps: 68,
              bySeries: {},
            },
          ],
          series: [],
        }}
        metric="cost"
        onMetricChange={() => {}}
        breakdown="none"
        onBreakdownChange={() => {}}
        chartMode="bar"
        onChartModeChange={() => {}}
        capabilities={FULL_CAPS}
        costFormat={{ currency: 'cny', usdToCny: 7.25 }}
      />,
    )
    const tickLabels = Array.from(container.querySelectorAll('.usage-trend__grid text')).map(
      (el) => el.textContent,
    )
    expect(tickLabels).toEqual(['0', '¥50', '¥100', '¥150', '¥200'])
  })

  it('renders full 3-tab analytics with default CNY cost, model pricing provenance, and Run Inspector Drawer', async () => {
    stubUsageApi(FULL_CAPS)
    render(<UsageWorkspace base="/admin/usage" />)

    // Overview KPI strip defaults to CNY (42.85 * 7.25 = 310.6625 -> ¥311+), shows mixed provenance & cache
    const kpiStrip = await screen.findByTestId('usage-kpi-strip')
    expect(within(kpiStrip).getByTestId('usage-kpi-tokens')).toBeTruthy()
    expect(within(kpiStrip).getByTestId('usage-kpi-runs')).toBeTruthy()
    expect(within(kpiStrip).getByTestId('usage-kpi-cost').textContent).toContain('¥311+')
    expect(within(kpiStrip).getByTestId('usage-kpi-cost').textContent).toContain('80 轮上报')
    expect(within(kpiStrip).getByTestId('usage-kpi-cost').textContent).toContain('40 轮目录估算')
    expect(within(kpiStrip).getByTestId('usage-kpi-cost').textContent).toContain('40 轮未计价')
    expect(within(kpiStrip).getByTestId('usage-kpi-cache').textContent).toContain('96.1%')
    expect(within(kpiStrip).getByTestId('usage-kpi-latency')).toBeTruthy()

    // Speed table shows per-1M unit price in CNY (15*7.25=109, 75*7.25=544) and clean legacy default model label
    const speedTable = await screen.findByTestId('usage-speed-table')
    expect(within(speedTable).getByText('单价 (/1M)')).toBeTruthy()
    expect(within(speedTable).getByText('¥109 / ¥544')).toBeTruthy()
    expect(within(speedTable).getByText('默认模型 · Codex')).toBeTruthy()

    // Trend panel switches Bar -> Line cleanly
    const trend = screen.getByTestId('usage-trend-panel')
    fireEvent.click(within(trend).getByRole('radio', { name: '折线' }))
    expect(trend.querySelector('.usage-trend__lines')).not.toBeNull()

    // Switch to Runs tab and inspect a row via the right-side Drawer (dual currency + provenance)
    fireEvent.click(screen.getByRole('tab', { name: '运行明细' }))
    const runsTab = await screen.findByTestId('usage-runs-tab')
    expect(within(runsTab).getByText('核心研发群')).toBeTruthy()
    expect(within(runsTab).getByText('默认模型 · Codex')).toBeTruthy()
    fireEvent.mouseDown(within(runsTab).getByText('核心研发群'))
    const drawer = await screen.findByRole('dialog')
    expect(within(drawer).getByText('run-slow-1')).toBeTruthy()
    expect(within(drawer).getByText('完成用量模块重构')).toBeTruthy()
    expect(within(drawer).getByText('¥10.29 ($1.42)')).toBeTruthy()
    expect(within(drawer).getByText('models.dev 估算')).toBeTruthy()
    expect(within(drawer).getByText('运行上报')).toBeTruthy()
    expect(within(drawer).getByText('claude-opus-4-6 (Claude Opus 4.6)')).toBeTruthy()
    fireEvent.click(within(drawer).getByRole('button', { name: '关闭' }))

    // Switch to Sessions tab and verify heatmap, session shape, plugins, and tool usage
    fireEvent.click(screen.getByRole('tab', { name: '会话洞察' }))
    const sessionsTab = await screen.findByTestId('usage-sessions-tab')
    expect(within(sessionsTab).getByTestId('usage-weekhour-heatmap').textContent).toContain(
      '最忙：周四 16:00',
    )
    expect(within(sessionsTab).getByTestId('usage-plugins-card').textContent).toContain('ego-browser')
    expect(within(sessionsTab).getByTestId('usage-tools-card').textContent).toContain('Bash')
    expect(within(sessionsTab).getByTestId('usage-tools-card').textContent).toContain('30 天保留窗')
  })

  it('switches currency in Pricing Popover (persisted to localStorage) and allows sysadmin to sync models.dev pricing', async () => {
    useSession.setState({
      user: {
        id: 'u1',
        account: 'admin',
        name: 'Admin',
        role: 'sysadmin',
        mustChangePassword: false,
        disabled: false,
        gitProtocol: 'auto',
        email: null,
        avatar: null,
      },
    })
    const getSpy = stubUsageApi(FULL_CAPS)
    const syncedStatus: UsagePricingStatusDto = {
      source: 'models.dev',
      syncedAt: '2026-11-26T09:30:00Z',
      providerCount: 98,
      modelCount: 3912,
      stale: false,
      refreshing: false,
      fx: {
        usdToCny: 7.3,
        syncedAt: '2026-11-26T09:30:00Z',
        source: 'open.er-api.com',
        stale: false,
      },
    }
    const postSpy = vi.spyOn(api, 'post').mockResolvedValue(syncedStatus)

    render(<UsageWorkspace base="/admin/usage" />)
    await screen.findByTestId('usage-kpi-strip')
    await screen.findByTestId('usage-speed-table')

    // Open pricing catalog pill
    const pill = screen.getByTestId('usage-pricing-pill')
    expect(pill.textContent).toContain('models.dev · 3,800 模型定价')
    fireEvent.click(pill)

    const pop = await screen.findByTestId('usage-pricing-popover')
    expect(pop.textContent).toContain('95 供应商 · 3,800 模型')
    expect(pop.textContent).toContain('汇率 1 USD = ¥7.25')

    // Switch CNY -> USD and check KPI + SpeedTable + localStorage update
    fireEvent.click(within(pop).getByRole('radio', { name: '$ 美元' }))
    expect(localStorage.getItem(CURRENCY_STORAGE_KEY)).toBe('usd')
    expect(screen.getByTestId('usage-kpi-cost').textContent).toContain('$42.85+')
    expect(within(screen.getByTestId('usage-speed-table')).getByText('$15 / $75')).toBeTruthy()

    // Trigger sysadmin pricing sync
    const overviewCallsBefore = getSpy.mock.calls.filter(([p]) => p.includes('/overview?')).length
    fireEvent.click(within(pop).getByRole('button', { name: '同步最新价格' }))
    await waitFor(() => expect(postSpy).toHaveBeenCalledWith('/admin/usage/pricing/sync'))
    await waitFor(() => expect(pill.textContent).toContain('models.dev · 3,912 模型定价'))
    await waitFor(() =>
      expect(getSpy.mock.calls.filter(([p]) => p.includes('/overview?')).length).toBeGreaterThan(
        overviewCallsBefore,
      ),
    )
  })

  it('strictly hides unavailable dimensions (cost, cache, tools, plugins) — zero fabricated data', async () => {
    stubUsageApi(MINIMAL_CAPS)
    render(<UsageWorkspace base="/admin/usage" />)

    const kpiStrip = await screen.findByTestId('usage-kpi-strip')
    expect(within(kpiStrip).queryByTestId('usage-kpi-cost')).toBeNull()
    expect(within(kpiStrip).queryByTestId('usage-kpi-cache')).toBeNull()
    expect(within(kpiStrip).getByTestId('usage-kpi-active')).toBeTruthy()

    // Trend panel hides Cost/Throughput metrics and Model/Provider breakdown options
    const trend = screen.getByTestId('usage-trend-panel')
    expect(within(trend).queryByRole('radio', { name: '费用' })).toBeNull()
    expect(within(trend).queryByRole('radio', { name: '产出速率' })).toBeNull()
    expect(within(trend).queryByRole('radio', { name: '模型' })).toBeNull()

    // Runs tab hides Model column when hasModels=false
    fireEvent.click(screen.getByRole('tab', { name: '运行明细' }))
    const runsTab = await screen.findByTestId('usage-runs-tab')
    expect(within(runsTab).queryByRole('columnheader', { name: '模型' })).toBeNull()

    // Sessions tab omits Tools and Plugins cards when unavailable
    fireEvent.click(screen.getByRole('tab', { name: '会话洞察' }))
    await screen.findByTestId('usage-sessions-tab')
    expect(screen.queryByTestId('usage-tools-card')).toBeNull()
    expect(screen.queryByTestId('usage-plugins-card')).toBeNull()
  })

  it('keeps previous overview mounted (single-layer stale-while-revalidate) and avoids redundant /facets refetches on status change', async () => {
    const f = makeFixtures(FULL_CAPS)
    let resolveNext!: (v: UsageOverviewDto) => void
    const getSpy = vi.spyOn(api, 'get').mockImplementation((path: string) => {
      if (path === '/admin/teams') return Promise.resolve([])
      if (path.includes('/overview?') && path.includes('preset=7d')) {
        return new Promise<UsageOverviewDto>((r) => {
          resolveNext = r
        })
      }
      if (path.includes('/facets?')) return Promise.resolve(f.facets)
      if (path.includes('/overview?')) return Promise.resolve(f.overview)
      if (path.includes('/timeseries?')) return Promise.resolve(f.timeseries)
      if (path.includes('/breakdown?')) return Promise.resolve(f.breakdown('agentKind'))
      if (path.includes('/heatmap?')) return Promise.resolve(f.calendarHeatmap)
      return Promise.resolve([])
    })

    render(<UsageWorkspace base="/admin/usage" />)
    await screen.findByTestId('usage-kpi-strip')
    await screen.findByTestId('usage-speed-table')
    const facetsCallsBefore = getSpy.mock.calls.filter(([p]) => p.includes('/facets?')).length

    // Status change must NOT trigger a redundant /facets refetch
    fireEvent.click(screen.getByRole('radio', { name: '失败' }))
    await waitFor(() =>
      expect(getSpy.mock.calls.some(([p]) => p.includes('/overview?') && p.includes('status=failed'))).toBe(
        true,
      ),
    )
    expect(getSpy.mock.calls.filter(([p]) => p.includes('/facets?')).length).toBe(facetsCallsBefore)

    // Preset change keeps previous overview mounted with single-layer stale dim (no double-dim on child KPI strip)
    fireEvent.click(screen.getByRole('radio', { name: '7 天' }))
    await waitFor(() => expect(screen.getByTestId('usage-overview-tab').className).toContain('usage-stale'))
    expect(screen.getByTestId('usage-kpi-strip').className).not.toContain('usage-stale')
    resolveNext(f.overview)
    await waitFor(() =>
      expect(screen.getByTestId('usage-overview-tab').className).not.toContain('usage-stale'),
    )
  })
})
