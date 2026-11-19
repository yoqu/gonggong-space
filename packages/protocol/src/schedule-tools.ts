import { z } from 'zod'
import { GONGGONG_TOOL_TITLES } from './tool-titles.js'

// ── Scheduled task tools (agent-facing, not translated) ──────────────────────
// Undescribed: schedule_update reuses them and points at schedule_create for their meaning.
const scheduleCron = z.string().min(9).max(100)
const scheduleAt = z.iso.datetime({ offset: true })
const scheduleBots = z.array(z.string().min(1).max(64)).min(1).max(10)
const scheduleRunOptions = z
  .array(
    z.object({
      bot: z.string().min(1).max(64),
      model: z.string().max(100).optional().describe('e.g. opus, sonnet; default if omitted'),
      effort: z.string().max(40).optional().describe('e.g. low, medium, high; default if omitted'),
    }),
  )
  .max(10)
const scheduleTz = z.string()
const atMostOneTiming = (a: { cron?: unknown; at?: unknown }) => !(a.cron !== undefined && a.at !== undefined)

export const ScheduleCreateArgs = z
  .object({
    name: z.string().min(1).max(60).describe('Short name of what it does'),
    prompt: z
      .string()
      .min(1)
      .max(4000)
      .describe(
        'Full instruction sent to the bot when due; it does not see this conversation, so state the task, scope and output',
      ),
    cron: scheduleCron
      .describe(
        '5-field cron: min hour day month weekday (0=Sunday), in timezone; e.g. 0 9 * * 1-5 = weekdays 9:00. At least 5 minutes apart',
      )
      .optional(),
    at: scheduleAt.describe('One-off time with offset, e.g. 2026-10-05T09:00:00+08:00').optional(),
    timezone: scheduleTz.describe('IANA time zone, default Asia/Shanghai').optional(),
    bots: scheduleBots
      .describe(
        'Candidate bots of this group, best first; the first online and idle one runs it. Default: only you',
      )
      .optional(),
    run_options: scheduleRunOptions
      .describe(
        'Model and effort per candidate, only when the user asks; give the full list when changing, [] = all default',
      )
      .optional(),
  })
  .refine((a) => atMostOneTiming(a) && (a.cron !== undefined || a.at !== undefined), {
    message: 'cron 与 at 需要且只能给一个',
  })
export const ScheduleListArgs = z.object({})
export const ScheduleUpdateArgs = z
  .object({
    id: z.string().describe('Task id from schedule_list'),
    name: z.string().min(1).max(60).optional(),
    prompt: z.string().min(1).max(4000).optional(),
    cron: scheduleCron.optional(),
    at: scheduleAt.optional(),
    timezone: scheduleTz.optional(),
    bots: scheduleBots.optional(),
    run_options: scheduleRunOptions.optional(),
    enabled: z.boolean().describe('false = pause, true = resume').optional(),
  })
  .refine(atMostOneTiming, { message: 'cron 与 at 最多给一个' })
export const ScheduleDeleteArgs = z.object({ id: z.string().describe('Task id from schedule_list') })

export const SCHEDULE_TOOLS = {
  schedule_create: {
    title: GONGGONG_TOOL_TITLES.schedule_create,
    description:
      'Schedule a task here: when due, a bot is @-mentioned with prompt on behalf of the turn initiator. Use it for recurring or later work ' +
      'instead of sleeping. Returns the next run times: report them for the user to check.',
    input: ScheduleCreateArgs,
  },
  schedule_list: {
    title: GONGGONG_TOOL_TITLES.schedule_list,
    description: "This group's scheduled tasks: id, name, bots, timing, enabled, next run and last result.",
    input: ScheduleListArgs,
  },
  schedule_update: {
    title: GONGGONG_TOOL_TITLES.schedule_update,
    description:
      'Change a scheduled task, only the fields to change (as in schedule_create). Only tasks you created or are a candidate of.',
    input: ScheduleUpdateArgs,
  },
  schedule_delete: {
    title: GONGGONG_TOOL_TITLES.schedule_delete,
    description:
      'Delete a scheduled task. A scheduled turn may delete its own task once it is no longer needed (e.g. the awaited condition is met).',
    input: ScheduleDeleteArgs,
  },
} as const
