import { z } from 'zod'
import { RunStatus } from '../common.js'
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
