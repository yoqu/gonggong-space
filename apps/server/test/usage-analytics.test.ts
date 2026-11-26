import {
  USAGE_DEFAULT_SENTINEL,
  type UsageBreakdownDto,
  type UsageFacetsDto,
  type UsageHeatmapDto,
  type UsageInsightsDto,
  type UsageOverviewDto,
  type UsageRunItemDto,
  type UsageRunsDto,
  type UsageTimeseriesDto,
} from '@gonggong/protocol'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { feishuMessageLinks, messages, runEvents, runs } from '../src/db/schema.js'
import { escapeCsvCell } from '../src/modules/usage/export.js'
import { createTestApp, type TestApp } from './support/app.js'
import { client } from './support/http.js'

let t: TestApp
beforeEach(async () => {
  t = await createTestApp()
})
afterEach(() => t.close())

const HOUR = 3_600_000
const DAY = 86_400_000

async function seedRichWorld() {
  const admin = await t.seed.user({ name: '管理员', role: 'sysadmin' })
  const alice = await t.seed.user({ name: '王磊' })
  const bob = await t.seed.user({ name: '陈晨' })

  const claude = await t.seed.bot({ ownerId: alice.id, name: 'Claude 助手', agentKind: 'claude' })
  const codex = await t.seed.bot({ ownerId: bob.id, name: 'Codex 助手', agentKind: 'codex' })
  const gemini = await t.seed.bot({ ownerId: alice.id, name: 'Gemini 助手', agentKind: 'gemini' })

  const gWork = await t.seed.group({
    createdBy: alice.id,
    name: '支付重构',
    kind: 'group',
    memberIds: [bob.id],
  })
  const gDm = await t.seed.group({ createdBy: bob.id, name: '=FORMULA_DM', kind: 'dm' })

  const [mWebGroup] = await t.db
    .insert(messages)
    .values({ groupId: gWork.id, kind: 'user', body: 'hi' })
    .returning()
  const [mWebDm] = await t.db
    .insert(messages)
    .values({ groupId: gDm.id, kind: 'user', body: 'dm' })
    .returning()
  const [mFeishu] = await t.db
    .insert(messages)
    .values({ groupId: gWork.id, kind: 'user', body: 'fs' })
    .returning()
  const [mSched] = await t.db
    .insert(messages)
    .values({ groupId: gWork.id, kind: 'user', body: 'cron', meta: { scheduleOf: 'sched-1' } })
    .returning()
  const [mHook] = await t.db
    .insert(messages)
    .values({ groupId: gWork.id, kind: 'user', body: 'hook', meta: { webhookOf: 'hook-1' } })
    .returning()

  await t.db.insert(feishuMessageLinks).values({
    feishuMessageId: 'om_in_1',
    chatId: 'oc_chat_1',
    appId: 'cli_app',
    direction: 'in',
    kind: 'message',
    messageId: mFeishu!.id,
  })

  const now = Date.now()

  // Run 1: Completed Claude run in session S1 (today, 2h ago), rich usage, cost, cache, tools, plugins
  const [r1] = await t.db
    .insert(runs)
    .values({
      groupId: gWork.id,
      botId: claude.id,
      triggerMessageId: mWebGroup!.id,
      originUserId: alice.id,
      triggerUserId: alice.id,
      status: 'completed',
      model: 'claude-sonnet-4-6',
      effort: 'high',
      settings: {
        provider: 'Anthropic',
        contextWindow: 200_000,
        autoCompactWindow: 160_000,
        inheritCli: false,
        fromCli: [],
        fromBot: [],
      },
      usage: { inputTokens: 800, outputTokens: 200, totalTokens: 1000, costUsd: 0.05 },
      sessionAfter: 'sess-1',
      queuedAt: new Date(now - 2 * HOUR),
      startedAt: new Date(now - 2 * HOUR),
      endedAt: new Date(now - 2 * HOUR + 10_000), // 10s -> 20 tok/s
      plugins: [{ name: 'code-review', versionId: 'v1', digest: 'd1' }],
      personalSkills: 2,
      filesChanged: 3,
      summary: 'Refactored payment service',
    })
    .returning()

  // Run 2: Second turn in session S1 (today, 1h ago) by a different user (bob), slow run (80s), feishu trigger
  const [r2] = await t.db
    .insert(runs)
    .values({
      groupId: gWork.id,
      botId: claude.id,
      triggerMessageId: mFeishu!.id,
      originUserId: bob.id,
      triggerUserId: bob.id,
      status: 'completed',
      model: 'claude-opus-4-6',
      effort: 'high',
      settings: {
        provider: 'OpenRouter',
        contextWindow: 200_000,
        autoCompactWindow: null,
        inheritCli: false,
        fromCli: [],
        fromBot: [],
      },
      usage: { inputTokens: 2000, outputTokens: 800, totalTokens: 2800, costUsd: 0.25 },
      sessionAfter: 'sess-1',
      queuedAt: new Date(now - 1 * HOUR),
      startedAt: new Date(now - 1 * HOUR),
      endedAt: new Date(now - 1 * HOUR + 80_000), // 80s -> 10 tok/s, slow (>=60s)
      plugins: [
        { name: 'code-review', versionId: 'v1', digest: 'd1' },
        { name: 'deploy-helper', versionId: 'v2', digest: 'd2' },
      ],
      step: '+danger_step',
    })
    .returning()

  // Run 3: Codex DM run (3 days ago), null model, null provider, unreported usage, cancelled by user
  const [r3] = await t.db
    .insert(runs)
    .values({
      groupId: gDm.id,
      botId: codex.id,
      triggerMessageId: mWebDm!.id,
      originUserId: bob.id,
      triggerUserId: bob.id,
      status: 'interrupted',
      stoppedBy: bob.id,
      model: null,
      settings: null,
      usage: null,
      sessionAfter: 'sess-dm',
      queuedAt: new Date(now - 3 * DAY),
      startedAt: new Date(now - 3 * DAY),
      endedAt: new Date(now - 3 * DAY + 5_000),
      step: '已手动停止',
    })
    .returning()

  // Run 4: Failed Gemini scheduled run (5 days ago), error status (stoppedBy null)
  const [r4] = await t.db
    .insert(runs)
    .values({
      groupId: gWork.id,
      botId: gemini.id,
      triggerMessageId: mSched!.id,
      originUserId: alice.id,
      triggerUserId: alice.id,
      status: 'interrupted',
      stoppedBy: null,
      model: 'gemini-2.5-pro',
      settings: null,
      usage: { inputTokens: 300, outputTokens: 50, totalTokens: 350 },
      queuedAt: new Date(now - 5 * DAY),
      startedAt: new Date(now - 5 * DAY),
      endedAt: new Date(now - 5 * DAY + 15_000),
      step: '运行出错：rate limit',
    })
    .returning()

  // Run 5: Forbidden webhook run (never started: startedAt is null, 2 days ago)
  const [r5] = await t.db
    .insert(runs)
    .values({
      groupId: gWork.id,
      botId: codex.id,
      triggerMessageId: mHook!.id,
      originUserId: bob.id,
      triggerUserId: bob.id,
      status: 'forbidden',
      model: null,
      usage: null,
      queuedAt: new Date(now - 2 * DAY),
      startedAt: null,
      endedAt: new Date(now - 2 * DAY),
      step: '无权限触发',
    })
    .returning()

  // Run 6: Relay hop run (completed, purged run_events -> purgedAt set)
  const [r6] = await t.db
    .insert(runs)
    .values({
      groupId: gWork.id,
      botId: claude.id,
      triggerMessageId: mWebGroup!.id,
      originUserId: alice.id,
      parentRunId: r1!.id,
      hop: 2,
      status: 'completed',
      model: 'claude-sonnet-4-6',
      settings: {
        provider: 'Anthropic',
        contextWindow: 200_000,
        autoCompactWindow: null,
        inheritCli: false,
        fromCli: [],
        fromBot: [],
      },
      usage: { inputTokens: 400, outputTokens: 100, totalTokens: 500, costUsd: 0.02 },
      queuedAt: new Date(now - 4 * DAY),
      startedAt: new Date(now - 4 * DAY),
      endedAt: new Date(now - 4 * DAY + 5_000), // 5s -> 20 tok/s
      purgedAt: new Date(now - 1 * DAY),
    })
    .returning()

  // Run 7: Previous 30d window run (40 days ago) for delta comparison
  await t.db.insert(runs).values({
    groupId: gWork.id,
    botId: claude.id,
    triggerMessageId: mWebGroup!.id,
    originUserId: alice.id,
    status: 'completed',
    model: 'claude-sonnet-4-6',
    usage: { inputTokens: 1500, outputTokens: 500, totalTokens: 2000, costUsd: 0.1 },
    queuedAt: new Date(now - 40 * DAY),
    startedAt: new Date(now - 40 * DAY),
    endedAt: new Date(now - 40 * DAY + 20_000),
  })

  // run_events for r1 (2 usage events to verify DISTINCT ON latest, plus deduped tool calls)
  await t.db.insert(runEvents).values([
    {
      runId: r1!.id,
      kind: 'usage',
      payload: {
        kind: 'usage',
        usage: { totalTokens: 500 },
        breakdown: { tools: [], turns: [200], cache: { read: 100, total: 200 } },
      },
      createdAt: new Date(now - 2 * HOUR + 3_000),
    },
    {
      runId: r1!.id,
      kind: 'usage',
      payload: {
        kind: 'usage',
        usage: { totalTokens: 1000 },
        breakdown: {
          tools: [
            { name: 'Read', kind: 'read', count: 3, tokens: 420 },
            { name: 'github_search', kind: 'search', count: 1, tokens: 180 },
          ],
          turns: [500],
          cache: { read: 750, total: 1000 },
        },
      },
      createdAt: new Date(now - 2 * HOUR + 9_000),
    },
    // Same toolCallId 'tc-1' updated twice (in_progress -> completed): must count as 1 call!
    {
      runId: r1!.id,
      kind: 'tool',
      payload: {
        kind: 'tool',
        toolCallId: 'tc-1',
        title: 'Read file',
        toolKind: 'read',
        status: 'in_progress',
      },
      createdAt: new Date(now - 2 * HOUR + 1_000),
    },
    {
      runId: r1!.id,
      kind: 'tool',
      payload: {
        kind: 'tool',
        toolCallId: 'tc-1',
        title: 'Read file',
        toolKind: 'read',
        status: 'completed',
      },
      createdAt: new Date(now - 2 * HOUR + 2_000),
    },
    // MCP tool call that failed
    {
      runId: r1!.id,
      kind: 'tool',
      payload: {
        kind: 'tool',
        toolCallId: 'tc-2',
        title: 'MCP search',
        toolKind: 'search',
        status: 'failed',
        mcp: { server: 'github', tool: 'search_code' },
      },
      createdAt: new Date(now - 2 * HOUR + 4_000),
    },
    // Purged run r6 event should be excluded because r6.purgedAt is not null
    {
      runId: r6!.id,
      kind: 'usage',
      payload: {
        kind: 'usage',
        usage: { totalTokens: 500 },
        breakdown: { tools: [], turns: [], cache: { read: 9999, total: 9999 } },
      },
      createdAt: new Date(now - 4 * DAY),
    },
  ])

  return {
    admin,
    alice,
    bob,
    claude,
    codex,
    gemini,
    gWork,
    gDm,
    r1: r1!,
    r2: r2!,
    r3: r3!,
    r4: r4!,
    r5: r5!,
    r6: r6!,
  }
}

describe('usage analytics API', () => {
  it('computes facets and accurate capability flags (progressive disclosure)', async () => {
    const w = await seedRichWorld()
    const adminApi = client(t, await t.seed.cookie(w.admin.id))

    const res = await adminApi.get<UsageFacetsDto>('/api/admin/usage/facets?preset=30d&tz=Asia/Shanghai')
    expect(res.status).toBe(200)
    expect(res.body.capabilities).toEqual({
      hasInputOutput: true,
      hasCost: true,
      hasCache: true,
      hasProvider: true,
      hasModels: true,
      hasTools: true,
      hasPlugins: true,
      retentionDays: 30,
    })
    expect(res.body.models.map((m) => m.value)).toEqual(
      expect.arrayContaining([
        'claude-sonnet-4-6',
        'claude-opus-4-6',
        'gemini-2.5-pro',
        USAGE_DEFAULT_SENTINEL,
      ]),
    )
    expect(res.body.providers.map((p) => p.value)).toEqual(
      expect.arrayContaining(['Anthropic', 'OpenRouter', USAGE_DEFAULT_SENTINEL]),
    )
    expect(res.body.agentKinds.map((a) => a.value)).toEqual(
      expect.arrayContaining(['claude', 'codex', 'gemini']),
    )

    // Passing botId to /facets must NOT lock out other bots in the dropdown
    const botFilteredFacets = await adminApi.get<UsageFacetsDto>(
      `/api/admin/usage/facets?preset=30d&botId=${w.claude.id}`,
    )
    expect(botFilteredFacets.status).toBe(200)
    expect(botFilteredFacets.body.bots).toHaveLength(3)

    // Member bob only owns codex (no cost, no cache, no provider, no model, no tools, no plugins)
    const bobApi = client(t, await t.seed.cookie(w.bob.id))
    const bobFacets = await bobApi.get<UsageFacetsDto>('/api/usage/facets?preset=30d')
    expect(bobFacets.status).toBe(200)
    expect(bobFacets.body.capabilities).toMatchObject({
      hasInputOutput: false,
      hasCost: false,
      hasCache: false,
      hasProvider: false,
      hasModels: false,
      hasTools: false,
      hasPlugins: false,
    })
  })

  it('computes overview KPIs, percentiles, cache hit rate (latest unpurged), and previous period', async () => {
    const w = await seedRichWorld()
    const api = client(t, await t.seed.cookie(w.admin.id))

    const res = await api.get<UsageOverviewDto>('/api/admin/usage/overview?preset=30d&tz=Asia/Shanghai')
    expect(res.status).toBe(200)
    const { kpi, previous } = res.body

    // In 30d window: r1(1000) + r2(2800) + r3(unreported) + r4(350) + r5(unreported) + r6(500) = 4650
    expect(kpi.totalRuns).toBe(6)
    expect(kpi.endedRuns).toBe(6)
    expect(kpi.completedRuns).toBe(3) // r1, r2, r6
    expect(kpi.failedRuns).toBe(2) // r4 (interrupted, stoppedBy null) + r5 (forbidden)
    expect(kpi.cancelledRuns).toBe(1) // r3 (interrupted, stoppedBy bob)
    expect(kpi.liveRuns).toBe(0)
    expect(kpi.successRate).toBe(0.5)
    expect(kpi.totalTokens).toBe(4650)
    expect(kpi.inputTokens).toBe(3500)
    expect(kpi.outputTokens).toBe(1150)
    expect(kpi.tokenReportedRuns).toBe(4)
    expect(kpi.unreportedRuns).toBe(2)
    expect(kpi.totalCostUsd).toBe(0.32)
    expect(kpi.costReportedRuns).toBe(3)
    // Cache: only r1 latest event (750 / 1000), purged r6 excluded!
    expect(kpi.cacheReportedRuns).toBe(1)
    expect(kpi.cacheReadTokens).toBe(750)
    expect(kpi.cacheInputTokens).toBe(1000)
    expect(kpi.cacheHitRate).toBe(0.75)
    // Completed durations: 5000ms (r6), 10000ms (r1), 80000ms (r2) -> avg 31667, p50 10000
    expect(kpi.avgDurationMs).toBe(31667)
    expect(kpi.p50DurationMs).toBe(10000)
    expect(kpi.p95DurationMs).toBeGreaterThanOrEqual(70000)
    // Effective output TPS over completed runs: (200 + 800 + 100) / (10 + 80 + 5) = 1100 / 95 = 11.6
    expect(kpi.avgOutputTps).toBe(11.6)
    expect(kpi.activeUsers).toBe(2)
    expect(kpi.activeBots).toBe(3)
    expect(kpi.activeGroups).toBe(2)

    // Previous 30d window contains Run 7 (40 days ago): 2000 tokens, 1 run, $0.10
    expect(previous).not.toBeNull()
    expect(previous!.totalRuns).toBe(1)
    expect(previous!.totalTokens).toBe(2000)
    expect(previous!.totalCostUsd).toBe(0.1)

    // preset=all has null previous and includes Run 7
    const allRes = await api.get<UsageOverviewDto>('/api/admin/usage/overview?preset=all')
    expect(allRes.body.previous).toBeNull()
    expect(allRes.body.kpi.totalRuns).toBe(7)
    expect(allRes.body.kpi.totalTokens).toBe(6650)
  })

  it('supports multi-dim filters including __default__ sentinel, status, search, and custom ranges', async () => {
    const w = await seedRichWorld()
    const api = client(t, await t.seed.cookie(w.admin.id))

    const defaultModel = await api.get<UsageOverviewDto>(
      `/api/admin/usage/overview?preset=30d&model=${USAGE_DEFAULT_SENTINEL}`,
    )
    expect(defaultModel.body.kpi.totalRuns).toBe(2) // r3, r5

    const defaultProvider = await api.get<UsageOverviewDto>(
      `/api/admin/usage/overview?preset=30d&provider=${USAGE_DEFAULT_SENTINEL}`,
    )
    expect(defaultProvider.body.kpi.totalRuns).toBe(3) // r3, r4, r5

    const openRouter = await api.get<UsageOverviewDto>(
      '/api/admin/usage/overview?preset=30d&provider=OpenRouter',
    )
    expect(openRouter.body.kpi.totalRuns).toBe(1)
    expect(openRouter.body.kpi.totalTokens).toBe(2800)

    const failedOnly = await api.get<UsageOverviewDto>('/api/admin/usage/overview?preset=30d&status=failed')
    expect(failedOnly.body.kpi.totalRuns).toBe(2)

    const cancelledOnly = await api.get<UsageOverviewDto>(
      '/api/admin/usage/overview?preset=30d&status=cancelled',
    )
    expect(cancelledOnly.body.kpi.totalRuns).toBe(1)

    const searchRate = await api.get<UsageOverviewDto>('/api/admin/usage/overview?preset=30d&q=rate%20limit')
    expect(searchRate.body.kpi.totalRuns).toBe(1)
    expect(searchRate.body.kpi.totalTokens).toBe(350)

    // Invalid custom ranges rejected with 400
    expect((await api.get('/api/admin/usage/overview?preset=custom')).status).toBe(400)
    expect(
      (await api.get('/api/admin/usage/overview?preset=custom&from=2026-11-10&to=2026-11-01')).status,
    ).toBe(400)
    expect((await api.get('/api/admin/usage/overview?preset=30d&tz=Not/A_Zone')).status).toBe(400)

    // Valid custom range covering last 24h via ISO bounds
    const fromIso = new Date(Date.now() - 3 * HOUR).toISOString()
    const toIso = new Date(Date.now() + HOUR).toISOString()
    const customRes = await api.get<UsageOverviewDto>(
      `/api/admin/usage/overview?preset=custom&from=${encodeURIComponent(fromIso)}&to=${encodeURIComponent(toIso)}`,
    )
    expect(customRes.status).toBe(200)
    expect(customRes.body.range.granularity).toBe('hour')
    expect(customRes.body.kpi.totalRuns).toBe(2) // r1, r2
  })

  it('builds zero-filled hourly/daily timeseries with breakdown series and __other__ folding', async () => {
    const w = await seedRichWorld()
    const api = client(t, await t.seed.cookie(w.admin.id))

    const hourly = await api.get<UsageTimeseriesDto>(
      '/api/admin/usage/timeseries?preset=24h&metric=tokens&breakdown=model&topN=1&tz=Asia/Shanghai',
    )
    expect(hourly.status).toBe(200)
    expect(hourly.body.granularity).toBe('hour')
    expect(hourly.body.buckets.length).toBeGreaterThanOrEqual(24)
    expect(hourly.body.series.map((s) => s.key)).toEqual(['claude-opus-4-6', '__other__'])
    expect(hourly.body.series[0]!.total).toBe(2800)
    expect(hourly.body.series[1]!.total).toBe(1000)
    const bucketSum = hourly.body.buckets.reduce((n, b) => n + b.total, 0)
    expect(bucketSum).toBe(3800)

    const dailyCost = await api.get<UsageTimeseriesDto>(
      '/api/admin/usage/timeseries?preset=7d&metric=cost&breakdown=provider&tz=UTC',
    )
    expect(dailyCost.status).toBe(200)
    expect(dailyCost.body.granularity).toBe('day')
    expect(dailyCost.body.series[0]!.key).toBe('OpenRouter')
    expect(dailyCost.body.series[0]!.costUsd).toBe(0.25)

    // Non-additive metrics (duration / throughput) use run-share so legend shares sum cleanly to 1
    const durSeries = await api.get<UsageTimeseriesDto>(
      '/api/admin/usage/timeseries?preset=30d&metric=duration&breakdown=model&tz=UTC',
    )
    expect(durSeries.status).toBe(200)
    const durShareSum = durSeries.body.series.reduce((n, s) => n + s.share, 0)
    expect(durShareSum).toBeCloseTo(1, 2)
    const tpsSeries = await api.get<UsageTimeseriesDto>(
      '/api/admin/usage/timeseries?preset=30d&metric=throughput&breakdown=model&tz=UTC',
    )
    expect(tpsSeries.status).toBe(200)
    const tpsShareSum = tpsSeries.body.series.reduce((n, s) => n + s.share, 0)
    expect(tpsShareSum).toBeCloseTo(1, 2)

    // Exact-hour custom window [00:00, 03:00) must produce 3 buckets, no phantom trailing 03:00 hour
    const exactHours = await api.get<UsageTimeseriesDto>(
      '/api/admin/usage/timeseries?preset=custom&from=2026-11-01T00:00:00Z&to=2026-11-01T03:00:00Z&tz=UTC',
    )
    expect(exactHours.status).toBe(200)
    expect(exactHours.body.granularity).toBe('hour')
    expect(exactHours.body.buckets.map((b) => b.ts)).toEqual([
      '2026-11-01T00:00',
      '2026-11-01T01:00',
      '2026-11-01T02:00',
    ])
  })

  it('computes breakdown rankings and model speed/efficiency table', async () => {
    const w = await seedRichWorld()
    const api = client(t, await t.seed.cookie(w.admin.id))

    const byModel = await api.get<UsageBreakdownDto>('/api/admin/usage/breakdown?preset=30d&by=model')
    expect(byModel.status).toBe(200)
    expect(byModel.body.by).toBe('model')
    expect(byModel.body.items[0]).toMatchObject({
      key: 'claude-opus-4-6',
      runs: 1,
      totalTokens: 2800,
      avgDurationMs: 80000,
      avgOutputTps: 10,
      costUsd: 0.25,
    })
    const sonnet = byModel.body.items.find((i) => i.key === 'claude-sonnet-4-6')!
    expect(sonnet.runs).toBe(2)
    expect(sonnet.totalTokens).toBe(1500)
    expect(sonnet.avgOutputTps).toBe(20)
    expect(sonnet.successRate).toBe(1)

    const byGroupKind = await api.get<UsageBreakdownDto>('/api/admin/usage/breakdown?preset=30d&by=groupKind')
    expect(byGroupKind.body.items.map((i) => i.key)).toEqual(['group', 'dm'])
    expect(byGroupKind.body.items.map((i) => i.name)).toEqual(['群聊', '私聊'])

    // English Accept-Language localizes server-generated dimension labels via t()
    const enRes = await t.app.inject({
      method: 'GET',
      url: '/api/admin/usage/breakdown?preset=30d&by=groupKind',
      headers: { cookie: await t.seed.cookie(w.admin.id), 'accept-language': 'en' },
    })
    expect(enRes.statusCode).toBe(200)
    expect((enRes.json() as UsageBreakdownDto).items.map((i) => i.name)).toEqual(['Group', 'DM'])
  })

  it('computes week×hour (168 cells) and 53-week calendar (371 cells) heatmaps', async () => {
    const w = await seedRichWorld()
    const api = client(t, await t.seed.cookie(w.admin.id))

    const wh = await api.get<UsageHeatmapDto>(
      '/api/admin/usage/heatmap?preset=30d&mode=week_hour&metric=runs&tz=Asia/Shanghai',
    )
    expect(wh.status).toBe(200)
    expect(wh.body.weekHour).toHaveLength(168)
    expect(wh.body.weekHour!.reduce((n, c) => n + c.runs, 0)).toBe(6)
    expect(wh.body.maxValue).toBeGreaterThanOrEqual(1)

    const cal = await api.get<UsageHeatmapDto>(
      '/api/admin/usage/heatmap?preset=30d&mode=calendar&metric=tokens&tz=Asia/Shanghai',
    )
    expect(cal.status).toBe(200)
    expect(cal.body.calendar).toHaveLength(371)
    // Includes Run 7 (40d ago) because 53w calendar always covers 371 days
    expect(cal.body.calendar!.reduce((n, c) => n + c.totalTokens, 0)).toBe(6650)
  })

  it('computes session shape, top/recent sessions, deduped tool usage, and plugin usage', async () => {
    const w = await seedRichWorld()
    const api = client(t, await t.seed.cookie(w.admin.id))

    const res = await api.get<UsageInsightsDto>('/api/admin/usage/insights?preset=30d&tz=Asia/Shanghai')
    expect(res.status).toBe(200)
    const { sessionShape, topSessions, recentSessions, toolUsage, pluginUsage } = res.body

    // Sessions: sess-1 (r1+r2 = 2 turns), sess-dm (r3), r4, r5, r6 => 5 distinct sessions
    expect(sessionShape.totalSessions).toBe(5)
    expect(sessionShape.groupCount).toBe(4)
    expect(sessionShape.dmCount).toBe(1)
    expect(sessionShape.turnBuckets.find((b) => b.bucket === '2-3')?.sessions).toBe(1)
    expect(sessionShape.turnBuckets.find((b) => b.bucket === '1')?.sessions).toBe(4)
    expect(sessionShape.triggerSources.map((s) => s.source)).toEqual(
      expect.arrayContaining(['web_group', 'web_dm', 'feishu', 'schedule', 'webhook', 'relay']),
    )

    expect(topSessions[0]).toMatchObject({
      sessionKey: 'sess-1',
      userId: w.bob.id,
      userName: '陈晨',
      turns: 2,
      totalTokens: 3800,
      costUsd: 0.3,
    })
    // Multi-user turns in sess-1 must not split into duplicate sessionKey rows
    expect(new Set(recentSessions.map((s) => s.sessionKey)).size).toBe(recentSessions.length)
    expect(recentSessions.length).toBe(5)

    // Tool usage: r6 is purged, 5 runs are unpurged; tc-1 deduped to 1 read call, tc-2 is 1 failed MCP search call
    expect(toolUsage.coveredRuns).toBe(5)
    expect(toolUsage.purgedRuns).toBe(1)
    expect(toolUsage.retentionDays).toBe(30)
    expect(toolUsage.byToolKind).toEqual(
      expect.arrayContaining([
        { toolKind: 'read', calls: 1, failedCalls: 0, runs: 1 },
        { toolKind: 'search', calls: 1, failedCalls: 1, runs: 1 },
      ]),
    )
    expect(toolUsage.byMcpTool).toEqual([
      { server: 'github', tool: 'search_code', calls: 1, failedCalls: 1, runs: 1 },
    ])
    expect(toolUsage.byToolName).toEqual(
      expect.arrayContaining([
        { name: 'Read', kind: 'read', calls: 3, estTokens: 420, runs: 1 },
        { name: 'github_search', kind: 'search', calls: 1, estTokens: 180, runs: 1 },
      ]),
    )
    expect(toolUsage.weeklyByKind.length).toBeGreaterThanOrEqual(1)

    // Plugins & personalSkills
    expect(pluginUsage.runsWithPersonalSkills).toBe(1)
    expect(pluginUsage.items).toEqual([
      { name: 'code-review', runs: 2, totalTokens: 3800 },
      { name: 'deploy-helper', runs: 1, totalTokens: 2800 },
    ])
  })

  it('paginates, sorts, filters slow/error runs, and exports formula-safe CSV and JSON', async () => {
    const w = await seedRichWorld()
    const api = client(t, await t.seed.cookie(w.admin.id))

    const page1 = await api.get<UsageRunsDto>(
      '/api/admin/usage/runs?preset=30d&page=1&pageSize=2&sortBy=totalTokens&sortDir=desc',
    )
    expect(page1.status).toBe(200)
    expect(page1.body.total).toBe(6)
    expect(page1.body.items).toHaveLength(2)
    expect(page1.body.items[0]!.id).toBe(w.r2.id)
    expect(page1.body.items[0]!.isSlow).toBe(true)
    expect(page1.body.items[1]!.id).toBe(w.r1.id)
    expect(page1.body.summary.slowRuns).toBe(1)
    expect(page1.body.summary.failedRuns).toBe(2)

    const slowOnly = await api.get<UsageRunsDto>(
      '/api/admin/usage/runs?preset=30d&onlySlow=true&slowMs=60000',
    )
    expect(slowOnly.body.total).toBe(1)
    expect(slowOnly.body.items[0]!.id).toBe(w.r2.id)

    const errorOnly = await api.get<UsageRunsDto>('/api/admin/usage/runs?preset=30d&onlyError=true')
    expect(errorOnly.body.total).toBe(2)

    // CSV export: UTF-8 BOM + formula-injection neutralization
    const csvRes = await t.app.inject({
      method: 'GET',
      url: '/api/admin/usage/export?preset=30d&format=csv',
      headers: { cookie: await t.seed.cookie(w.admin.id) },
    })
    expect(csvRes.statusCode).toBe(200)
    expect(csvRes.body.startsWith('\uFEFFid,queuedAt,')).toBe(true)
    expect(csvRes.body).toContain("'=FORMULA_DM")
    expect(csvRes.body).toContain("'+danger_step")

    // Unit check for escapeCsvCell
    expect(escapeCsvCell('=1+1')).toBe("'=1+1")
    expect(escapeCsvCell('@SUM(A1)')).toBe("'@SUM(A1)")
    expect(escapeCsvCell('-12.5')).toBe('-12.5')
    expect(escapeCsvCell('-cmd|x')).toBe("'-cmd|x")
    expect(escapeCsvCell('hello, "world"')).toBe('"hello, ""world"""')

    // JSON export
    const jsonRes = await api.get<UsageRunItemDto[]>('/api/admin/usage/export?preset=30d&format=json')
    expect(jsonRes.status).toBe(200)
    expect(jsonRes.body).toHaveLength(6)
  })

  it('enforces sysadmin vs member auth boundaries on new analytics endpoints', async () => {
    const w = await seedRichWorld()
    const bobApi = client(t, await t.seed.cookie(w.bob.id))

    expect((await bobApi.get('/api/admin/usage/overview')).status).toBe(403)
    expect((await bobApi.get('/api/admin/usage/runs')).status).toBe(403)
    expect((await bobApi.get('/api/admin/usage/export')).status).toBe(403)

    // Bob on /api/usage/overview only sees his own Codex bot's runs (r3, r5)
    const bobOv = await bobApi.get<UsageOverviewDto>('/api/usage/overview?preset=30d')
    expect(bobOv.status).toBe(200)
    expect(bobOv.body.kpi.totalRuns).toBe(2)
    expect(bobOv.body.kpi.activeBots).toBe(1)
  })
})
