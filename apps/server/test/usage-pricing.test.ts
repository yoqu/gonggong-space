import { mkdtempSync, rmSync } from 'node:fs'
import { createServer } from 'node:http'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import {
  USAGE_DEFAULT_SENTINEL,
  type UsageBreakdownDto,
  type UsageFacetsDto,
  type UsageOverviewDto,
  type UsagePricingStatusDto,
  type UsageRunsDto,
} from '@gonggong/protocol'
import { eq } from 'drizzle-orm'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { machines, messages, runs } from '../src/db/schema.js'
import {
  applyAnthropicOneHour,
  computeCostUsd,
  matchModelPrice,
  type PricingSnapshot,
  setPricingSnapshotForTest,
} from '../src/modules/usage/pricing.js'
import { resetPricingSyncStateForTest, setSyncUrlsForTest } from '../src/modules/usage/pricing-sync.js'
import { createTestApp, type TestApp } from './support/app.js'
import { client } from './support/http.js'

const MINI_SNAPSHOT: PricingSnapshot = {
  source: 'https://models.dev/api.json',
  syncedAt: '2026-11-26T12:00:00.000Z',
  providerCount: 5,
  modelCount: 10,
  fx: {
    usdToCny: 7.0,
    syncedAt: '2026-11-26T12:00:00.000Z',
    source: 'https://open.er-api.com/v6/latest/USD',
  },
  providers: {
    // Membership $0 catalog must be ignored even if present
    'kimi-code-plan-cn': {
      name: 'Kimi Code Plan',
      models: {
        'kimi-k3': { name: 'Kimi K3 Plan', cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 } },
      },
    },
    anthropic: {
      name: 'Anthropic',
      models: {
        'claude-sonnet-4-6': {
          name: 'Claude Sonnet 4.6',
          released: '2026-02-17',
          cost: {
            input: 3,
            output: 15,
            cacheRead: 0.3,
            cacheWrite: 3.75,
            tiers: [{ above: 200_000, input: 6, output: 22.5, cacheRead: 0.6, cacheWrite: 7.5 }],
          },
        },
        'claude-opus-4-6': {
          name: 'Claude Opus 4.6',
          released: '2026-02-05',
          cost: { input: 5, output: 25, cacheRead: 0.5, cacheWrite: 6.25 },
        },
        'claude-sonnet-4-5': {
          name: 'Claude Sonnet 4.5',
          released: '2025-09-29',
          cost: { input: 3, output: 15, cacheRead: 0.3, cacheWrite: 3.75 },
        },
      },
    },
    openai: {
      name: 'OpenAI',
      models: {
        'gpt-5.4': {
          name: 'GPT-5.4',
          released: '2026-03-01',
          cost: {
            input: 2.5,
            output: 15,
            cacheRead: 0.25,
            cacheWrite: 0,
            tiers: [{ above: 272_000, input: 5, output: 22.5, cacheRead: 0.5, cacheWrite: 0 }],
          },
        },
        'gpt-5.6-luna': {
          name: 'GPT-5.6 Luna',
          released: '2026-09-01',
          cost: { input: 1.5, output: 6, cacheRead: 0.15, cacheWrite: 0 },
        },
      },
    },
    deepseek: {
      name: 'DeepSeek',
      models: {
        'deepseek-flash': {
          name: 'DeepSeek V4.1 Flash',
          canonical: 'deepseek/deepseek-v4.1-flash',
          released: '2026-09-10',
          cost: { input: 0.27, output: 1.08, cacheRead: 0.027, cacheWrite: 0 },
        },
      },
    },
    moonshotai: {
      name: 'Moonshot AI',
      models: {
        'kimi-k3': {
          name: 'Kimi K3',
          released: '2026-10-01',
          cost: { input: 3, output: 15, cacheRead: 0.3, cacheWrite: 0 },
        },
      },
    },
    xai: {
      name: 'xAI',
      models: {
        'grok-4.7': {
          name: 'Grok 4.7',
          released: '2026-10-10',
          cost: { input: 2, output: 6, cacheRead: 0.5, cacheWrite: 0 },
        },
      },
    },
    openrouter: {
      name: 'OpenRouter',
      models: {
        'anthropic/claude-sonnet-4-6': {
          name: 'Claude Sonnet 4.6 (OR)',
          cost: { input: 3.3, output: 16.5, cacheRead: 0.33, cacheWrite: 4.125 },
        },
      },
    },
  },
}

describe('pricing matcher & cost math (Magpie parity)', () => {
  afterEach(() => {
    setPricingSnapshotForTest(null)
  })

  it('loads the real bundled models.dev snapshot with live FX rate', () => {
    const hit = matchModelPrice('claude-sonnet-4-6')
    expect(hit).not.toBeNull()
    expect(hit!.provider).toBe('anthropic')
    expect(hit!.price.input).toBeGreaterThan(0)
    expect(hit!.price.output).toBeGreaterThan(0)
  })

  it('matches maker priority, normalizations, canonical IDs, relays, aliases, and tiers', () => {
    setPricingSnapshotForTest(MINI_SNAPSHOT)

    // Maker beats reseller when provider is omitted
    expect(matchModelPrice('claude-sonnet-4-6')).toMatchObject({
      provider: 'anthropic',
      matchedId: 'claude-sonnet-4-6',
    })
    // Explicit OpenRouter provider hint prefers OpenRouter
    expect(matchModelPrice('claude-sonnet-4-6', 'OpenRouter')).toMatchObject({
      provider: 'openrouter',
      price: { input: 3.3 },
    })
    // Dot <-> dash normalization + [1m] window marker + Bedrock geo prefix
    expect(matchModelPrice('claude-opus-4.6[1m]')).toMatchObject({
      provider: 'anthropic',
      matchedId: 'claude-opus-4-6',
    })
    expect(matchModelPrice('apac.anthropic.claude-sonnet-4-5')).toMatchObject({
      provider: 'anthropic',
      matchedId: 'claude-sonnet-4-5',
    })
    // Effort / tag stripping & Grok window/effort
    expect(matchModelPrice('openai/gpt-5.4(high)')).toMatchObject({
      provider: 'openai',
      matchedId: 'gpt-5.4',
    })
    expect(matchModelPrice('grok-4.7@500k')).toMatchObject({ provider: 'xai', matchedId: 'grok-4.7' })
    expect(matchModelPrice('grok-4.7-high')).toMatchObject({ provider: 'xai', matchedId: 'grok-4.7' })
    // Canonical model ID & relay/channel prefix
    expect(matchModelPrice('deepseek-v4.1-flash')).toMatchObject({
      provider: 'deepseek',
      matchedId: 'deepseek-flash',
    })
    expect(matchModelPrice('claude-deepseek-v4.1-flash[1m]')).toMatchObject({
      provider: 'deepseek',
      matchedId: 'deepseek-flash',
    })
    expect(matchModelPrice('nyro-gpt-5.4')).toMatchObject({ provider: 'openai', matchedId: 'gpt-5.4' })
    // Kimi Code aliases (membership $0 catalog skipped -> maker moonshotai used!)
    expect(matchModelPrice('k3-256k')).toMatchObject({
      provider: 'moonshotai',
      matchedId: 'kimi-k3',
      aliasMatched: true,
      price: { input: 3 },
    })
    // Codex auto review & dated suffix & Claude short alias
    expect(matchModelPrice('codex-auto-review')).toMatchObject({
      provider: 'openai',
      matchedId: 'gpt-5.6-luna',
      aliasMatched: true,
    })
    expect(matchModelPrice('claude-sonnet-4-5-20250929')).toMatchObject({
      provider: 'anthropic',
      matchedId: 'claude-sonnet-4-5',
      aliasMatched: true,
    })
    expect(matchModelPrice('sonnet')).toMatchObject({
      provider: 'anthropic',
      matchedId: 'claude-sonnet-4-6',
      aliasMatched: true,
    })
    // Unknown / sentinel returns null
    expect(matchModelPrice('default')).toBeNull()
    expect(matchModelPrice('<synthetic>')).toBeNull()
    expect(matchModelPrice('__default__:codex')).toBeNull()
    expect(matchModelPrice('totally-unknown-model-xyz')).toBeNull()

    // Context-tier math + Anthropic 1h cache write (2x input)
    const sonnet = matchModelPrice('claude-sonnet-4-6')!
    expect(sonnet.price.cacheWrite1h).toBe(6)
    expect(
      applyAnthropicOneHour('gpt-5.4', { input: 2.5, output: 15, cacheRead: 0.25, cacheWrite: 1 })
        .cacheWrite1h,
    ).toBeUndefined()
    // Below 200k prompt -> base rates ($3 in, $15 out, $0.30 cr, $3.75 cw)
    expect(computeCostUsd(sonnet.price, 100_000, 10_000, 50_000, 10_000)).toBeCloseTo(
      (100_000 * 3 + 10_000 * 15 + 50_000 * 0.3 + 10_000 * 3.75) / 1e6,
      6,
    )
    // Above 200k prompt (150k + 60k = 210k) -> tier rates ($6 in, $22.5 out, $0.6 cr, $7.5 cw, 1h = $12)
    expect(computeCostUsd(sonnet.price, 150_000, 10_000, 60_000, 10_000, 10_000)).toBeCloseTo(
      (150_000 * 6 + 10_000 * 22.5 + 60_000 * 0.6 + 10_000 * 12) / 1e6,
      6,
    )
  })
})

describe('usage pricing policy, model resolution, FX sync & engine persistence', () => {
  let t: TestApp
  let tmpDataDir: string
  const prevDataDir = process.env.GONGGONG_DATA_DIR

  beforeEach(async () => {
    tmpDataDir = mkdtempSync(join(tmpdir(), 'gg-pricing-test-'))
    process.env.GONGGONG_DATA_DIR = tmpDataDir
    resetPricingSyncStateForTest()
    setPricingSnapshotForTest(MINI_SNAPSHOT)
    t = await createTestApp()
  })

  afterEach(async () => {
    await t.close()
    setPricingSnapshotForTest(null)
    resetPricingSyncStateForTest()
    if (prevDataDir === undefined) delete process.env.GONGGONG_DATA_DIR
    else process.env.GONGGONG_DATA_DIR = prevDataDir
    rmSync(tmpDataDir, { recursive: true, force: true })
  })

  it('enforces cost override policy, resolves historical models, and exports costCny', async () => {
    const admin = await t.seed.user({ name: '管理员', role: 'sysadmin' })
    const alice = await t.seed.user({ name: '王磊' })

    const { machine } = await t.seed.machine(alice.id, { name: 'mac-pro' })
    await t.db
      .update(machines)
      .set({
        agents: [
          {
            kind: 'codex',
            available: true,
            version: '1.0',
            path: '/usr/bin/codex',
            catalog: { current: 'gpt-5.4', models: [], efforts: [], effort: null },
          },
        ],
      })
      .where(eq(machines.id, machine.id))

    const claudeBot = await t.seed.bot({
      ownerId: alice.id,
      name: 'Claude Bot',
      agentKind: 'claude',
      model: 'claude-opus-4-6',
    })
    const codexBot = await t.seed.bot({
      ownerId: alice.id,
      name: 'Codex Bot',
      agentKind: 'codex',
      machineId: machine.id,
      model: null,
    })
    const geminiBot = await t.seed.bot({
      ownerId: alice.id,
      name: 'Gemini Bot',
      agentKind: 'gemini',
      model: null,
    })
    const g = await t.seed.group({ createdBy: alice.id, name: '研发群' })
    const [m] = await t.db.insert(messages).values({ groupId: g.id, kind: 'user', body: 'test' }).returning()
    const now = Date.now()

    // 1. Official Anthropic Claude (provider null, reported costUsd 0.123) -> keeps reported cost
    const [rOfficial] = await t.db
      .insert(runs)
      .values({
        groupId: g.id,
        botId: claudeBot.id,
        triggerMessageId: m!.id,
        originUserId: alice.id,
        status: 'completed',
        model: 'claude-sonnet-4-6',
        settings: null,
        usage: { inputTokens: 10_000, outputTokens: 2_000, totalTokens: 12_000, costUsd: 0.123 },
        queuedAt: new Date(now - 60_000),
        startedAt: new Date(now - 60_000),
        endedAt: new Date(now - 50_000),
      })
      .returning()

    // 2. Third-party provider running DeepSeek under Claude Code with bogus costUsd=9.99 -> overridden by DeepSeek catalog!
    // Cost = (1_000_000 * 0.27 + 500_000 * 1.08 + 1_000_000 * 0.027) / 1e6 = 0.27 + 0.54 + 0.027 = 0.837
    const [rThirdParty] = await t.db
      .insert(runs)
      .values({
        groupId: g.id,
        botId: claudeBot.id,
        triggerMessageId: m!.id,
        originUserId: alice.id,
        status: 'completed',
        model: 'claude-deepseek-v4.1-flash[1m]',
        settings: {
          provider: 'DeepSeekRelay',
          contextWindow: 1_000_000,
          autoCompactWindow: null,
          inheritCli: false,
          fromCli: [],
          fromBot: [],
        },
        usage: {
          inputTokens: 1_000_000,
          outputTokens: 500_000,
          cachedReadTokens: 1_000_000,
          totalTokens: 2_500_000,
          costUsd: 9.99,
        },
        purgedAt: new Date(now - 1_000), // even when purged, usage.cachedReadTokens is still counted!
        queuedAt: new Date(now - 50_000),
        startedAt: new Date(now - 50_000),
        endedAt: new Date(now - 40_000),
      })
      .returning()

    // 3. Codex run with null runs.model & null bots.model -> resolved via machine catalog ('gpt-5.4', modelSource: 'machine_default')
    // Cost = (100_000 * 2.5 + 10_000 * 15) / 1e6 = 0.25 + 0.15 = 0.40
    const [rMachineDefault] = await t.db
      .insert(runs)
      .values({
        groupId: g.id,
        botId: codexBot.id,
        triggerMessageId: m!.id,
        originUserId: alice.id,
        status: 'completed',
        model: null,
        usage: { inputTokens: 100_000, outputTokens: 10_000, totalTokens: 110_000 },
        queuedAt: new Date(now - 40_000),
        startedAt: new Date(now - 40_000),
        endedAt: new Date(now - 30_000),
      })
      .returning()

    // 4. Claude run with 'default' runs.model -> resolved via bots.model ('claude-opus-4-6', modelSource: 'bot_default')
    // Cost = (100_000 * 5 + 10_000 * 25) / 1e6 = 0.50 + 0.25 = 0.75
    const [rBotDefault] = await t.db
      .insert(runs)
      .values({
        groupId: g.id,
        botId: claudeBot.id,
        triggerMessageId: m!.id,
        originUserId: alice.id,
        status: 'completed',
        model: 'default',
        usage: { inputTokens: 100_000, outputTokens: 10_000, totalTokens: 110_000 },
        queuedAt: new Date(now - 30_000),
        startedAt: new Date(now - 30_000),
        endedAt: new Date(now - 20_000),
      })
      .returning()

    // 5. Gemini run with genuinely unknown model & no cost -> grouped as __default__:gemini, costSource: 'unpriced'
    const [rUnknown] = await t.db
      .insert(runs)
      .values({
        groupId: g.id,
        botId: geminiBot.id,
        triggerMessageId: m!.id,
        originUserId: alice.id,
        status: 'completed',
        model: null,
        usage: { inputTokens: 1_000, outputTokens: 500, totalTokens: 1_500 },
        queuedAt: new Date(now - 20_000),
        startedAt: new Date(now - 20_000),
        endedAt: new Date(now - 10_000),
      })
      .returning()

    const cookie = await t.seed.cookie(admin.id)
    const api = client(t, cookie)

    // Overview KPI: 0.123 (reported) + 0.837 (catalog) + 0.40 (catalog) + 0.75 (catalog) = 2.11
    const ov = await api.get<UsageOverviewDto>('/api/admin/usage/overview?preset=30d')
    expect(ov.status).toBe(200)
    expect(ov.body.kpi.totalCostUsd).toBeCloseTo(2.11, 5)
    expect(ov.body.kpi.costReportedRuns).toBe(4)
    expect(ov.body.reportedCostRuns).toBe(1)
    expect(ov.body.estimatedCostRuns).toBe(3)
    expect(ov.body.kpi.cacheReportedRuns).toBe(1) // rThirdParty direct usage.cachedReadTokens
    expect(ov.body.kpi.cacheReadTokens).toBe(1_000_000)
    expect(ov.body.pricing?.fx.usdToCny).toBe(7.0)

    // Runs detail exposes modelSource, costSource, unitPrice, modelDisplayName
    const runsRes = await api.get<UsageRunsDto>('/api/admin/usage/runs?preset=30d&pageSize=20')
    expect(runsRes.status).toBe(200)
    const byId = new Map(runsRes.body.items.map((i) => [i.id, i]))
    expect(byId.get(rOfficial!.id)).toMatchObject({
      model: 'claude-sonnet-4-6',
      modelSource: 'recorded',
      costUsd: 0.123,
      costSource: 'reported',
      modelDisplayName: 'Claude Sonnet 4.6',
    })
    expect(byId.get(rThirdParty!.id)).toMatchObject({
      model: 'claude-deepseek-v4.1-flash[1m]',
      costUsd: 0.837,
      costSource: 'catalog',
      modelDisplayName: 'DeepSeek V4.1 Flash',
      unitPrice: { input: 0.27, output: 1.08, provider: 'deepseek' },
    })
    expect(byId.get(rMachineDefault!.id)).toMatchObject({
      model: 'gpt-5.4',
      modelSource: 'machine_default',
      costUsd: 0.4,
      costSource: 'catalog',
    })
    expect(byId.get(rBotDefault!.id)).toMatchObject({
      model: 'claude-opus-4-6',
      modelSource: 'bot_default',
      costUsd: 0.75,
      costSource: 'catalog',
    })
    expect(byId.get(rUnknown!.id)).toMatchObject({
      model: null,
      modelSource: 'unknown',
      costUsd: null,
      costSource: 'unpriced',
    })

    // Breakdown splits unknown models by agentKind (__default__:gemini -> '默认模型 · Gemini') & attaches unitPrice
    const bd = await api.get<UsageBreakdownDto>('/api/admin/usage/breakdown?preset=30d&by=model')
    expect(bd.status).toBe(200)
    const unknownRow = bd.body.items.find((i) => i.key === `${USAGE_DEFAULT_SENTINEL}:gemini`)
    expect(unknownRow).toMatchObject({ name: '默认模型 · Gemini', runs: 1, unitPrice: null })
    const gptRow = bd.body.items.find((i) => i.key === 'gpt-5.4')
    expect(gptRow).toMatchObject({
      modelDisplayName: 'GPT-5.4',
      costUsd: 0.4,
      unitPrice: { input: 2.5, output: 15, provider: 'openai' },
    })

    // Filtering by __default__:gemini narrows cleanly
    const facetRes = await api.get<UsageFacetsDto>('/api/admin/usage/facets?preset=30d')
    expect(facetRes.body.models.map((x) => x.value)).toContain(`${USAGE_DEFAULT_SENTINEL}:gemini`)
    const filteredUnknown = await api.get<UsageRunsDto>(
      `/api/admin/usage/runs?preset=30d&model=${encodeURIComponent(`${USAGE_DEFAULT_SENTINEL}:gemini`)}`,
    )
    expect(filteredUnknown.body.total).toBe(1)
    expect(filteredUnknown.body.items[0]!.id).toBe(rUnknown!.id)

    // CSV export includes costCny (0.40 * 7.0 = 2.8)
    const csv = await t.app.inject({
      method: 'GET',
      url: '/api/admin/usage/export?preset=30d&format=csv',
      headers: { cookie },
    })
    expect(csv.statusCode).toBe(200)
    expect(csv.body).toContain(',costUsd,costCny,costSource,')
    expect(csv.body).toContain(',0.4,2.8,catalog,')
  })

  it('exposes GET /pricing and sysadmin-only POST /pricing/sync refreshing models.dev + FX in parallel', async () => {
    const admin = await t.seed.user({ name: '管理员', role: 'sysadmin' })
    const member = await t.seed.user({ name: '成员' })
    const adminApi = client(t, await t.seed.cookie(admin.id))
    const memberApi = client(t, await t.seed.cookie(member.id))

    expect((await memberApi.post('/api/admin/usage/pricing/sync', {})).status).toBe(403)
    const statusRes = await adminApi.get<UsagePricingStatusDto>('/api/admin/usage/pricing')
    expect(statusRes.status).toBe(200)
    expect(statusRes.body.fx.usdToCny).toBe(7.0)

    // Spin up a local mock HTTP server for models.dev + open.er-api.com
    const mock = createServer((req, res) => {
      res.setHeader('content-type', 'application/json')
      if (req.url === '/models') {
        res.end(
          JSON.stringify({
            anthropic: {
              name: 'Anthropic',
              models: {
                'claude-sonnet-5': {
                  name: 'Claude Sonnet 5',
                  release_date: '2026-11-20',
                  modalities: { output: ['text'] },
                  cost: { input: 4, output: 20, cache_read: 0.4, cache_write: 5 },
                },
              },
            },
          }),
        )
        return
      }
      if (req.url === '/fx') {
        res.end(JSON.stringify({ result: 'success', rates: { CNY: 7.35 } }))
        return
      }
      res.statusCode = 404
      res.end('{}')
    })
    await new Promise<void>((resolve) => mock.listen(0, '127.0.0.1', resolve))
    const addr = mock.address() as { port: number }
    setPricingSnapshotForTest(null)
    setSyncUrlsForTest({
      modelsDev: `http://127.0.0.1:${addr.port}/models`,
      fx: `http://127.0.0.1:${addr.port}/fx`,
    })

    try {
      const synced = await adminApi.post<UsagePricingStatusDto>('/api/admin/usage/pricing/sync', {})
      expect(synced.status).toBe(200)
      expect(synced.body.modelCount).toBe(1)
      expect(synced.body.providerCount).toBe(1)
      expect(synced.body.stale).toBe(false)
      expect(synced.body.fx.usdToCny).toBe(7.35)
      expect(synced.body.fx.stale).toBe(false)
      expect(matchModelPrice('claude-sonnet-5')).toMatchObject({ provider: 'anthropic', price: { input: 4 } })
    } finally {
      await new Promise<void>((resolve) => mock.close(() => resolve()))
    }
  })

  it('reports a failed models.dev sync instead of answering with the old catalog', async () => {
    const admin = await t.seed.user({ name: '管理员', role: 'sysadmin' })
    const adminApi = client(t, await t.seed.cookie(admin.id))
    const mock = createServer((_req, res) => {
      res.statusCode = 502
      res.end('{}')
    })
    await new Promise<void>((resolve) => mock.listen(0, '127.0.0.1', resolve))
    const addr = mock.address() as { port: number }
    setSyncUrlsForTest({
      modelsDev: `http://127.0.0.1:${addr.port}/models`,
      fx: `http://127.0.0.1:${addr.port}/fx`,
    })
    try {
      const res = await adminApi.post<{ message: string }>('/api/admin/usage/pricing/sync', {})
      expect([res.status, res.body.message]).toEqual([503, '无法连接 models.dev，价格未更新，请稍后再试'])
    } finally {
      await new Promise<void>((resolve) => mock.close(() => resolve()))
    }
  })

  it('preserves concrete runs.model on null/default session.config and persists RunDone.model', async () => {
    const alice = await t.seed.user({ name: '王磊' })
    const { machine } = await t.seed.machine(alice.id, { name: 'dev-box' })
    const bot = await t.seed.bot({
      ownerId: alice.id,
      name: 'Bot',
      agentKind: 'claude',
      machineId: machine.id,
    })
    const g = await t.seed.group({ createdBy: alice.id, name: 'G' })
    const [m] = await t.db.insert(messages).values({ groupId: g.id, kind: 'user', body: 'hi' }).returning()

    const [run] = await t.db
      .insert(runs)
      .values({
        groupId: g.id,
        botId: bot.id,
        triggerMessageId: m!.id,
        originUserId: alice.id,
        status: 'running',
        model: 'claude-sonnet-4-6',
        startedAt: new Date(),
      })
      .returning()

    // Daemon sends session.config with model: 'default' -> must NOT overwrite concrete 'claude-sonnet-4-6'
    t.ctx.hub.emit('message', machine.id, {
      t: 'session.config',
      runId: run!.id,
      model: 'default',
      effort: 'high',
    })
    await vi.waitFor(async () => {
      const [afterCfg] = await t.db.select().from(runs).where(eq(runs.id, run!.id))
      expect(afterCfg!.effort).toBe('high')
      expect(afterCfg!.model).toBe('claude-sonnet-4-6')
    })

    // Daemon sends run.done with served concrete model + cachedReadTokens/cachedWriteTokens -> persisted atomically
    t.ctx.hub.emit('message', machine.id, {
      t: 'run.done',
      runId: run!.id,
      outcome: 'completed',
      reply: 'all set',
      filesChanged: 0,
      usage: {
        inputTokens: 500,
        outputTokens: 150,
        totalTokens: 650,
        cachedReadTokens: 400,
        cachedWriteTokens: 50,
      },
      sessionId: 'sess-x',
      newSessionReason: null,
      error: null,
      git: null,
      patch: null,
      repos: [],
      appendsApplied: 0,
      sync: null,
      model: 'claude-opus-4-6',
    })
    await vi.waitFor(async () => {
      const [afterDone] = await t.db.select().from(runs).where(eq(runs.id, run!.id))
      expect(afterDone!.status).toBe('completed')
      expect(afterDone!.model).toBe('claude-opus-4-6')
      expect(afterDone!.usage).toMatchObject({ cachedReadTokens: 400, cachedWriteTokens: 50 })
    })
  })
})
