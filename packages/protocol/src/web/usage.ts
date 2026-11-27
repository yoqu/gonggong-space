import { z } from 'zod'
import { AgentKind, RunStatus } from '../common.js'
import { I18nText } from '../i18n.js'
import { GroupKind } from './groups.js'

// ── Usage (spec §3.7) ───────────────────────────────────────────────────────
/** GET /api/bots/:id/activity — each group the bot is in, where it works there and its turn in flight (owner or sysadmin). */
export const BotPlaceDto = z.object({
  groupId: z.string(),
  groupName: z.string(),
  groupKind: GroupKind,
  workspacePath: z.string().nullable(),
  /** The bot's other directories there: its own and its local clones of extra repos. */
  dirs: z.array(z.string()),
  /** Not yet finished: queued, running or waiting on approval / an answer; the newest if several. */
  run: z
    .object({
      id: z.string(),
      status: RunStatus,
      step: z.string(),
      stepI18n: I18nText.optional(),
      startedAt: z.string().nullable(),
    })
    .nullable(),
  lastRunAt: z.string().nullable(),
})
export type BotPlaceDto = z.infer<typeof BotPlaceDto>

/** GET /api/bots/recent — my bots in the current team that have run, the most recently used first. */
export const BotRecentDto = z.object({ botId: z.string(), lastUsedAt: z.string() })
export type BotRecentDto = z.infer<typeof BotRecentDto>

export const UsageQuery = z.object({
  by: z.enum(['bot', 'user', 'group']),
  days: z.coerce.number().int().min(1).max(365).default(30),
  /** Restrict to one bot (its owner sees who used it). */
  botId: z.string().optional(),
  /** The whole team (its admins, or sysadmins on /api/admin/usage). */
  teamId: z.string().optional(),
})
export const UsageRowDto = z.object({
  key: z.string(),
  name: z.string(),
  runs: z.number().int(),
  /** Sum over runs that reported usage. */
  totalTokens: z.number().int(),
  /** Runs whose adapter did not report usage (shown as 未上报). */
  unreported: z.number().int(),
})
export type UsageRowDto = z.infer<typeof UsageRowDto>
const isTimeZone = (tz: string) => {
  try {
    new Intl.DateTimeFormat('en', { timeZone: tz })
    return true
  } catch {
    return false
  }
}
/** GET /api/usage/daily: same scope as /api/usage, bucketed by calendar day in `tz` (IANA). */
export const UsageDailyQuery = UsageQuery.omit({ by: true }).extend({
  tz: z.string().refine(isTimeZone).default('UTC'),
})
/** One per day, oldest first, zero-filled; `day` is YYYY-MM-DD in the requested time zone. */
export const UsageDayDto = UsageRowDto.omit({ key: true, name: true }).extend({ day: z.string() })
export type UsageDayDto = z.infer<typeof UsageDayDto>

/**
 * 会话统计: /api/admin/conversation-stats (every team, or `teamId`) and /api/teams/:id/conversation-stats (its admins).
 * Counts only, never message content. Messages are kind user/bot; runs are counted by when they were queued.
 */
export const ConversationStatsQuery = z.object({
  days: z.coerce.number().int().min(1).max(365).default(30),
  tz: z.string().refine(isTimeZone).default('UTC'),
  teamId: z.string().optional(),
})
export const ConversationMetricsDto = z.object({
  /** Conversations with a user or bot message in the window. */
  activeConversations: z.number().int(),
  newConversations: z.number().int(),
  userMessages: z.number().int(),
  botMessages: z.number().int(),
  /** People who sent a message. */
  activeUsers: z.number().int(),
  runs: z.number().int(),
  /** Runs in a terminal state; 成功率 = completedRuns / endedRuns. */
  endedRuns: z.number().int(),
  completedRuns: z.number().int(),
  /** Mean started→ended of completed runs. */
  avgRunMs: z.number().nullable(),
})
export type ConversationMetricsDto = z.infer<typeof ConversationMetricsDto>
export const ConversationDayDto = ConversationMetricsDto.pick({
  activeConversations: true,
  userMessages: true,
  botMessages: true,
  activeUsers: true,
  runs: true,
}).extend({ day: z.string() })
export type ConversationDayDto = z.infer<typeof ConversationDayDto>
export const ConversationOverviewDto = z.object({
  /** Unarchived conversations now. */
  groups: z.number().int(),
  dms: z.number().int(),
  /** The last `days` days, and the `days` before them. */
  current: ConversationMetricsDto,
  previous: ConversationMetricsDto,
  /** One per calendar day in `tz`, oldest first, zero-filled. */
  daily: z.array(ConversationDayDto),
  statuses: z.array(z.object({ status: RunStatus, count: z.number().int() })),
})
export type ConversationOverviewDto = z.infer<typeof ConversationOverviewDto>
/** 运营: GET <base>/ops?days=&teamId=, whether onboarding brings people beyond the builders. */
export const ConversationOpsDto = z.object({
  /** People who sent a user message in the previous `days`, and how many of them did again in the last `days`. */
  retention: z.object({ previous: z.number().int(), retained: z.number().int() }),
  /**
   * Team memberships that began in the window (a person joining two teams counts twice); activated = triggered a
   * run in that team since joining; medianHours = joined → first such run, over the activated.
   */
  activation: z.object({
    joined: z.number().int(),
    activated: z.number().int(),
    medianHours: z.number().nullable(),
  }),
  /**
   * Runs ended in the window: all terminal ones, and interrupted/expired/forbidden not stopped by a person, the most
   * frequent status + step first (at most 10).
   */
  failures: z.object({
    endedRuns: z.number().int(),
    failedRuns: z.number().int(),
    reasons: z.array(z.object({ status: RunStatus, step: z.string(), count: z.number().int() })),
  }),
  /**
   * Runs queued in the window by origin: builders (sysadmin, owner/admin of any team, owner of a live machine or bot,
   * admin of an unarchived group; DMs don't count) vs everyone else (使用者); runs and distinct people.
   */
  audience: z.object({
    userRuns: z.number().int(),
    builderRuns: z.number().int(),
    users: z.number().int(),
    builders: z.number().int(),
  }),
})
export type ConversationOpsDto = z.infer<typeof ConversationOpsDto>
export const ConversationStatsBy = z.enum(['conversation', 'user', 'bot', 'team'])
export type ConversationStatsBy = z.infer<typeof ConversationStatsBy>
export const ConversationStatsRowsQuery = ConversationStatsQuery.omit({ tz: true }).extend({
  by: ConversationStatsBy,
})
/** One conversation / person / bot / team active in the window. */
export const ConversationStatsRowDto = z.object({
  key: z.string(),
  name: z.string(),
  /** Conversations only. */
  kind: GroupKind.nullable(),
  /** Conversations and bots. */
  teamName: z.string().nullable(),
  /** A conversation's creator, a bot's owner. */
  ownerName: z.string().nullable(),
  /** Conversations they posted in. */
  conversations: z.number().int(),
  userMessages: z.number().int(),
  botMessages: z.number().int(),
  /** People who posted; for a bot, people whose turns it ran. */
  activeUsers: z.number().int(),
  runs: z.number().int(),
  endedRuns: z.number().int(),
  completedRuns: z.number().int(),
  lastActiveAt: z.string().nullable(),
})
export type ConversationStatsRowDto = z.infer<typeof ConversationStatsRowDto>

// ── Admin / Team AI Usage Analytics ─────────────────────────────────────────
/** Filter sentinel representing NULL model or provider on runs. */
export const USAGE_DEFAULT_SENTINEL = '__default__'

const boolQuery = z
  .union([z.boolean(), z.enum(['true', 'false', '1', '0'])])
  .transform((v) => v === true || v === 'true' || v === '1')

export const UsageTimePreset = z.enum(['today', '24h', '7d', '30d', '90d', 'all', 'custom'])
export type UsageTimePreset = z.infer<typeof UsageTimePreset>

export const UsageStatusFilter = z.enum(['all', 'completed', 'failed', 'cancelled', 'live'])
export type UsageStatusFilter = z.infer<typeof UsageStatusFilter>

export const UsageMetric = z.enum(['tokens', 'cost', 'runs', 'duration', 'throughput'])
export type UsageMetric = z.infer<typeof UsageMetric>

export const UsageBreakdownBy = z.enum([
  'model',
  'agentKind',
  'provider',
  'bot',
  'user',
  'group',
  'groupKind',
])
export type UsageBreakdownBy = z.infer<typeof UsageBreakdownBy>

export const UsageTimeseriesBreakdown = z.enum([
  'none',
  'model',
  'agentKind',
  'provider',
  'bot',
  'user',
  'group',
  'groupKind',
])
export type UsageTimeseriesBreakdown = z.infer<typeof UsageTimeseriesBreakdown>

export const UsageGranularity = z.enum(['auto', 'hour', 'day'])
export type UsageGranularity = z.infer<typeof UsageGranularity>

export const UsageResolvedGranularity = z.enum(['hour', 'day'])
export type UsageResolvedGranularity = z.infer<typeof UsageResolvedGranularity>

export const UsageHeatmapMode = z.enum(['week_hour', 'calendar'])
export type UsageHeatmapMode = z.infer<typeof UsageHeatmapMode>

export const UsageHeatmapMetric = z.enum(['tokens', 'runs', 'cost'])
export type UsageHeatmapMetric = z.infer<typeof UsageHeatmapMetric>

export const UsageSessionSort = z.enum(['tokens', 'runs', 'duration'])
export type UsageSessionSort = z.infer<typeof UsageSessionSort>

export const UsageRunsSortBy = z.enum(['startedAt', 'totalTokens', 'costUsd', 'durationMs', 'outputTps'])
export type UsageRunsSortBy = z.infer<typeof UsageRunsSortBy>

export const UsageSortDir = z.enum(['asc', 'desc'])
export type UsageSortDir = z.infer<typeof UsageSortDir>

export const UsageTriggerSource = z.enum([
  'web_group',
  'web_dm',
  'feishu',
  'schedule',
  'webhook',
  'relay',
  'continuation',
])
export type UsageTriggerSource = z.infer<typeof UsageTriggerSource>

export const UsageExportFormat = z.enum(['csv', 'json'])
export type UsageExportFormat = z.infer<typeof UsageExportFormat>

export const UsageCostSource = z.enum(['reported', 'catalog', 'unpriced'])
export type UsageCostSource = z.infer<typeof UsageCostSource>

export const UsageModelSource = z.enum(['recorded', 'bot_default', 'machine_default', 'unknown'])
export type UsageModelSource = z.infer<typeof UsageModelSource>

/** Live USD→CNY FX rate metadata for currency display and CSV export. */
export const UsageFxStatusDto = z.object({
  usdToCny: z.number().positive(),
  syncedAt: z.string().nullable(),
  source: z.string(),
  stale: z.boolean(),
})
export type UsageFxStatusDto = z.infer<typeof UsageFxStatusDto>

/** GET /api[/admin]/usage/pricing and POST /api/admin/usage/pricing/sync */
export const UsagePricingStatusDto = z.object({
  source: z.string(),
  syncedAt: z.string().nullable(),
  providerCount: z.number().int(),
  modelCount: z.number().int(),
  stale: z.boolean(),
  refreshing: z.boolean(),
  fx: UsageFxStatusDto,
})
export type UsagePricingStatusDto = z.infer<typeof UsagePricingStatusDto>

/** Per-1M-token USD unit prices from the pricing catalog. */
export const UsageModelUnitPriceDto = z.object({
  input: z.number(),
  output: z.number(),
  cacheRead: z.number(),
  cacheWrite: z.number(),
  provider: z.string().optional(),
  matchedId: z.string().optional(),
  aliasMatched: z.boolean().optional(),
})
export type UsageModelUnitPriceDto = z.infer<typeof UsageModelUnitPriceDto>

/** Shared filter query accepted by all `/api[/admin]/usage/*` analytics endpoints. */
export const UsageAnalyticsQuery = z.object({
  preset: UsageTimePreset.default('30d'),
  /** ISO timestamp or YYYY-MM-DD (in `tz`), required when `preset=custom`. */
  from: z.string().trim().min(1).optional(),
  /** ISO timestamp or YYYY-MM-DD (in `tz`), optional upper bound for `preset=custom`. */
  to: z.string().trim().min(1).optional(),
  tz: z.string().refine(isTimeZone).default('UTC'),
  teamId: z.string().optional(),
  botId: z.string().optional(),
  userId: z.string().optional(),
  groupId: z.string().optional(),
  agentKind: AgentKind.optional(),
  /** Exact model id, or `__default__` for runs with NULL model. */
  model: z.string().trim().min(1).optional(),
  /** Exact provider name, or `__default__` for runs with NULL provider. */
  provider: z.string().trim().min(1).optional(),
  groupKind: GroupKind.optional(),
  status: UsageStatusFilter.default('all'),
  q: z.string().trim().max(200).optional(),
})
export type UsageAnalyticsQuery = z.infer<typeof UsageAnalyticsQuery>

/** Real data presence flags driving progressive disclosure in the UI. */
export const UsageCapabilitiesDto = z.object({
  hasInputOutput: z.boolean(),
  hasCost: z.boolean(),
  hasCache: z.boolean(),
  hasProvider: z.boolean(),
  hasModels: z.boolean(),
  hasTools: z.boolean(),
  hasPlugins: z.boolean(),
  retentionDays: z.number().int(),
})
export type UsageCapabilitiesDto = z.infer<typeof UsageCapabilitiesDto>

export const UsageFacetOptionDto = z.object({
  value: z.string(),
  label: z.string(),
  sublabel: z.string().nullable().optional(),
  count: z.number().int(),
})
export type UsageFacetOptionDto = z.infer<typeof UsageFacetOptionDto>

/** GET /api[/admin]/usage/facets */
export const UsageFacetsDto = z.object({
  models: z.array(UsageFacetOptionDto),
  providers: z.array(UsageFacetOptionDto),
  agentKinds: z.array(UsageFacetOptionDto),
  bots: z.array(UsageFacetOptionDto),
  users: z.array(UsageFacetOptionDto),
  groups: z.array(UsageFacetOptionDto),
  capabilities: UsageCapabilitiesDto,
})
export type UsageFacetsDto = z.infer<typeof UsageFacetsDto>

export const UsageKpiDto = z.object({
  totalTokens: z.number().int(),
  inputTokens: z.number().int(),
  outputTokens: z.number().int(),
  tokenReportedRuns: z.number().int(),
  unreportedRuns: z.number().int(),
  totalRuns: z.number().int(),
  endedRuns: z.number().int(),
  completedRuns: z.number().int(),
  failedRuns: z.number().int(),
  cancelledRuns: z.number().int(),
  liveRuns: z.number().int(),
  /** completedRuns / endedRuns; null when no runs have ended. */
  successRate: z.number().nullable(),
  totalCostUsd: z.number(),
  costReportedRuns: z.number().int(),
  /** Runs priced via adapter-reported costUsd (official pricing). */
  reportedCostRuns: z.number().int().optional(),
  /** Runs priced via models.dev catalog lookup. */
  estimatedCostRuns: z.number().int().optional(),
  /** Prompt cache read tokens from runs.usage (the run end fills it from the last usage event when the agent omits it). */
  cacheReadTokens: z.number().int(),
  cacheInputTokens: z.number().int(),
  /** cacheReadTokens / cacheInputTokens; null when no runs reported cache. */
  cacheHitRate: z.number().nullable(),
  cacheReportedRuns: z.number().int(),
  /** Wall-clock turn duration (endedAt - startedAt) over completed runs. */
  avgDurationMs: z.number().nullable(),
  p50DurationMs: z.number().nullable(),
  p95DurationMs: z.number().nullable(),
  /** Effective turn output throughput: sum(outputTokens) / sum(durationSec) over completed runs with both. */
  avgOutputTps: z.number().nullable(),
  activeUsers: z.number().int(),
  activeBots: z.number().int(),
  activeGroups: z.number().int(),
})
export type UsageKpiDto = z.infer<typeof UsageKpiDto>

export const UsageRangeDto = z.object({
  from: z.string().nullable(),
  to: z.string(),
  previousFrom: z.string().nullable(),
  previousTo: z.string().nullable(),
  granularity: UsageResolvedGranularity,
})
export type UsageRangeDto = z.infer<typeof UsageRangeDto>

/** GET /api[/admin]/usage/overview */
export const UsageOverviewDto = z.object({
  range: UsageRangeDto,
  kpi: UsageKpiDto,
  previous: UsageKpiDto.nullable(),
  capabilities: UsageCapabilitiesDto,
  reportedCostRuns: z.number().int().optional(),
  estimatedCostRuns: z.number().int().optional(),
  pricing: UsagePricingStatusDto.optional(),
})
export type UsageOverviewDto = z.infer<typeof UsageOverviewDto>

/** GET /api[/admin]/usage/timeseries */
export const UsageTimeseriesQuery = UsageAnalyticsQuery.extend({
  metric: UsageMetric.default('tokens'),
  breakdown: UsageTimeseriesBreakdown.default('none'),
  topN: z.coerce.number().int().min(1).max(10).default(5),
  granularity: UsageGranularity.default('auto'),
})
export type UsageTimeseriesQuery = z.infer<typeof UsageTimeseriesQuery>

export const UsageTimeseriesBucketDto = z.object({
  /** Bucket key: YYYY-MM-DD (daily) or YYYY-MM-DDTHH:00 (hourly) in `tz`. */
  ts: z.string(),
  label: z.string(),
  /** Primary value for the selected `metric`. */
  total: z.number(),
  totalTokens: z.number().int(),
  inputTokens: z.number().int(),
  outputTokens: z.number().int(),
  costUsd: z.number(),
  runs: z.number().int(),
  completedRuns: z.number().int(),
  failedRuns: z.number().int(),
  unreportedRuns: z.number().int(),
  avgDurationMs: z.number().nullable(),
  avgOutputTps: z.number().nullable(),
  /** Series key → value for the selected `metric` (empty object when `breakdown=none`). */
  bySeries: z.record(z.string(), z.number()),
})
export type UsageTimeseriesBucketDto = z.infer<typeof UsageTimeseriesBucketDto>

export const UsageTimeseriesLegendDto = z.object({
  key: z.string(),
  name: z.string(),
  total: z.number(),
  share: z.number(),
  runs: z.number().int(),
  failedRuns: z.number().int(),
  totalTokens: z.number().int(),
  costUsd: z.number(),
  avgDurationMs: z.number().nullable(),
  avgOutputTps: z.number().nullable(),
})
export type UsageTimeseriesLegendDto = z.infer<typeof UsageTimeseriesLegendDto>

export const UsageTimeseriesDto = z.object({
  granularity: UsageResolvedGranularity,
  metric: UsageMetric,
  breakdown: UsageTimeseriesBreakdown,
  buckets: z.array(UsageTimeseriesBucketDto),
  series: z.array(UsageTimeseriesLegendDto),
})
export type UsageTimeseriesDto = z.infer<typeof UsageTimeseriesDto>

/** GET /api[/admin]/usage/breakdown */
export const UsageBreakdownQuery = UsageAnalyticsQuery.extend({
  by: UsageBreakdownBy.default('model'),
  limit: z.coerce.number().int().min(1).max(100).default(20),
})
export type UsageBreakdownQuery = z.infer<typeof UsageBreakdownQuery>

export const UsageBreakdownRowDto = z.object({
  key: z.string(),
  name: z.string(),
  sublabel: z.string().nullable(),
  runs: z.number().int(),
  completedRuns: z.number().int(),
  failedRuns: z.number().int(),
  cancelledRuns: z.number().int(),
  unreportedRuns: z.number().int(),
  successRate: z.number().nullable(),
  totalTokens: z.number().int(),
  inputTokens: z.number().int(),
  outputTokens: z.number().int(),
  costUsd: z.number(),
  costReportedRuns: z.number().int(),
  avgDurationMs: z.number().nullable(),
  p95DurationMs: z.number().nullable(),
  avgOutputTps: z.number().nullable(),
  tokenShare: z.number(),
  runShare: z.number(),
  costShare: z.number(),
  unitPrice: UsageModelUnitPriceDto.nullable().optional(),
  modelDisplayName: z.string().nullable().optional(),
})
export type UsageBreakdownRowDto = z.infer<typeof UsageBreakdownRowDto>

export const UsageBreakdownDto = z.object({
  by: UsageBreakdownBy,
  totalItems: z.number().int(),
  items: z.array(UsageBreakdownRowDto),
})
export type UsageBreakdownDto = z.infer<typeof UsageBreakdownDto>

/** GET /api[/admin]/usage/heatmap */
export const UsageHeatmapQuery = UsageAnalyticsQuery.extend({
  mode: UsageHeatmapMode.default('week_hour'),
  metric: UsageHeatmapMetric.default('tokens'),
})
export type UsageHeatmapQuery = z.infer<typeof UsageHeatmapQuery>

export const UsageWeekHourCellDto = z.object({
  /** 0 = Sunday .. 6 = Saturday (matches PostgreSQL extract(dow)). */
  dow: z.number().int().min(0).max(6),
  hour: z.number().int().min(0).max(23),
  runs: z.number().int(),
  totalTokens: z.number().int(),
  costUsd: z.number(),
  value: z.number(),
})
export type UsageWeekHourCellDto = z.infer<typeof UsageWeekHourCellDto>

export const UsageCalendarCellDto = z.object({
  day: z.string(),
  runs: z.number().int(),
  totalTokens: z.number().int(),
  costUsd: z.number(),
  value: z.number(),
})
export type UsageCalendarCellDto = z.infer<typeof UsageCalendarCellDto>

export const UsageHeatmapDto = z.object({
  mode: UsageHeatmapMode,
  metric: UsageHeatmapMetric,
  maxValue: z.number(),
  weekHour: z.array(UsageWeekHourCellDto).optional(),
  calendar: z.array(UsageCalendarCellDto).optional(),
})
export type UsageHeatmapDto = z.infer<typeof UsageHeatmapDto>

/** GET /api[/admin]/usage/insights */
export const UsageInsightsQuery = UsageAnalyticsQuery.extend({
  sessionSort: UsageSessionSort.default('tokens'),
})
export type UsageInsightsQuery = z.infer<typeof UsageInsightsQuery>

export const UsageSessionRowDto = z.object({
  sessionKey: z.string(),
  groupId: z.string(),
  groupName: z.string(),
  groupKind: GroupKind,
  botId: z.string(),
  botName: z.string(),
  agentKind: AgentKind,
  model: z.string().nullable(),
  userId: z.string(),
  userName: z.string(),
  turns: z.number().int(),
  failedTurns: z.number().int(),
  totalTokens: z.number().int(),
  inputTokens: z.number().int(),
  outputTokens: z.number().int(),
  costUsd: z.number(),
  costReportedRuns: z.number().int(),
  totalDurationMs: z.number(),
  firstAt: z.string(),
  lastAt: z.string(),
})
export type UsageSessionRowDto = z.infer<typeof UsageSessionRowDto>

export const UsageSourceCountDto = z.object({
  source: UsageTriggerSource,
  runs: z.number().int(),
  totalTokens: z.number().int(),
  costUsd: z.number(),
})
export type UsageSourceCountDto = z.infer<typeof UsageSourceCountDto>

export const UsageInsightsDto = z.object({
  sessionShape: z.object({
    totalSessions: z.number().int(),
    totalActiveDurationMs: z.number(),
    totalTokens: z.number().int(),
    avgTurnsPerSession: z.number(),
    avgTokensPerSession: z.number(),
    medianTokensPerSession: z.number().nullable(),
    p90TokensPerSession: z.number().nullable(),
    groupCount: z.number().int(),
    dmCount: z.number().int(),
    turnBuckets: z.array(
      z.object({
        bucket: z.enum(['1', '2-3', '4-10', '11+']),
        sessions: z.number().int(),
        totalTokens: z.number().int(),
        costUsd: z.number(),
      }),
    ),
    durationBuckets: z.array(
      z.object({
        bucket: z.enum(['<10s', '10-30s', '30-120s', '2-5m', '5m+']),
        runs: z.number().int(),
        totalTokens: z.number().int(),
      }),
    ),
    triggerSources: z.array(UsageSourceCountDto),
  }),
  topSessions: z.array(UsageSessionRowDto),
  recentSessions: z.array(UsageSessionRowDto),
  toolUsage: z.object({
    coveredRuns: z.number().int(),
    purgedRuns: z.number().int(),
    retentionDays: z.number().int(),
    byToolKind: z.array(
      z.object({
        toolKind: z.string(),
        calls: z.number().int(),
        failedCalls: z.number().int(),
        runs: z.number().int(),
      }),
    ),
    byMcpTool: z.array(
      z.object({
        server: z.string(),
        tool: z.string(),
        calls: z.number().int(),
        failedCalls: z.number().int(),
        runs: z.number().int(),
      }),
    ),
    byToolName: z.array(
      z.object({
        name: z.string(),
        kind: z.string(),
        calls: z.number().int(),
        estTokens: z.number().int(),
        runs: z.number().int(),
      }),
    ),
    weeklyByKind: z.array(
      z.object({
        week: z.string(),
        total: z.number().int(),
        byKind: z.record(z.string(), z.number().int()),
      }),
    ),
  }),
  pluginUsage: z.object({
    items: z.array(
      z.object({
        name: z.string(),
        runs: z.number().int(),
        totalTokens: z.number().int(),
      }),
    ),
    runsWithPersonalSkills: z.number().int(),
  }),
})
export type UsageInsightsDto = z.infer<typeof UsageInsightsDto>

/** GET /api[/admin]/usage/runs */
export const UsageRunsQuery = UsageAnalyticsQuery.extend({
  page: z.coerce.number().int().min(1).default(1),
  pageSize: z.coerce.number().int().min(1).max(100).default(25),
  sortBy: UsageRunsSortBy.default('startedAt'),
  sortDir: UsageSortDir.default('desc'),
  onlySlow: boolQuery.optional(),
  onlyError: boolQuery.optional(),
  slowMs: z.coerce.number().int().min(1000).max(3_600_000).default(60_000),
})
export type UsageRunsQuery = z.infer<typeof UsageRunsQuery>

export const UsageRunItemDto = z.object({
  id: z.string(),
  groupId: z.string(),
  groupName: z.string(),
  groupKind: GroupKind,
  botId: z.string(),
  botName: z.string(),
  agentKind: AgentKind,
  userId: z.string(),
  userName: z.string(),
  model: z.string().nullable(),
  effort: z.string().nullable(),
  provider: z.string().nullable(),
  status: RunStatus,
  isError: z.boolean(),
  isCancelled: z.boolean(),
  isSlow: z.boolean(),
  step: z.string(),
  summary: z.string(),
  queuedAt: z.string(),
  startedAt: z.string().nullable(),
  endedAt: z.string().nullable(),
  durationMs: z.number().nullable(),
  inputTokens: z.number().int().nullable(),
  outputTokens: z.number().int().nullable(),
  totalTokens: z.number().int().nullable(),
  costUsd: z.number().nullable(),
  outputTps: z.number().nullable(),
  filesChanged: z.number().int(),
  hop: z.number().int(),
  sessionId: z.string().nullable(),
  triggerSource: UsageTriggerSource,
  plugins: z.array(z.string()),
  personalSkills: z.number().int(),
  costSource: UsageCostSource.optional(),
  unitPrice: UsageModelUnitPriceDto.nullable().optional(),
  modelDisplayName: z.string().nullable().optional(),
  modelSource: UsageModelSource.optional(),
})
export type UsageRunItemDto = z.infer<typeof UsageRunItemDto>

export const UsageRunsSummaryDto = z.object({
  totalRuns: z.number().int(),
  totalTokens: z.number().int(),
  inputTokens: z.number().int(),
  outputTokens: z.number().int(),
  costUsd: z.number(),
  costReportedRuns: z.number().int(),
  failedRuns: z.number().int(),
  cancelledRuns: z.number().int(),
  unreportedRuns: z.number().int(),
  slowRuns: z.number().int(),
  bySource: z.array(UsageSourceCountDto),
})
export type UsageRunsSummaryDto = z.infer<typeof UsageRunsSummaryDto>

export const UsageRunsDto = z.object({
  total: z.number().int(),
  page: z.number().int(),
  pageSize: z.number().int(),
  slowThresholdMs: z.number().int(),
  summary: UsageRunsSummaryDto,
  items: z.array(UsageRunItemDto),
})
export type UsageRunsDto = z.infer<typeof UsageRunsDto>

/** GET /api[/admin]/usage/export */
export const UsageExportQuery = UsageAnalyticsQuery.extend({
  format: UsageExportFormat.default('csv'),
  limit: z.coerce.number().int().min(1).max(10_000).default(5000),
  onlySlow: boolQuery.optional(),
  onlyError: boolQuery.optional(),
  slowMs: z.coerce.number().int().min(1000).max(3_600_000).default(60_000),
})
export type UsageExportQuery = z.infer<typeof UsageExportQuery>
