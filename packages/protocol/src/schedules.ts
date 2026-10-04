import { z } from 'zod'
import { RunStatus } from './common.js'
import { I18nText } from './i18n.js'
import type { ProtocolKey } from './i18n-en.js'

// ── Scheduled tasks (plan 定时任务) ──────────────────────────────────────────
export const SCHEDULE_MAX_PER_GROUP = 20
/** Shortest gap between two firings of a recurring schedule. */
export const SCHEDULE_MIN_INTERVAL_MIN = 5
export const SCHEDULE_MAX_BOTS = 10

export const ScheduleName = z.string().trim().min(1).max(60)
export const SchedulePrompt = z.string().trim().min(1).max(4000)
/** Five fields: minute hour day-of-month month day-of-week. */
export const CronExpr = z.string().trim().min(9).max(100)
export const ScheduleInstant = z.iso.datetime({ offset: true })
export const TimeZone = z.string().refine(
  (tz) => {
    try {
      new Intl.DateTimeFormat('en', { timeZone: tz })
      return true
    } catch {
      return false
    }
  },
  { message: '时区无效' },
)

const oneTiming = (a: { cron?: unknown; runAt?: unknown }) => !(a.cron !== undefined && a.runAt !== undefined)

/**
 * GET /api/groups/:id/schedules → GroupSchedulesDto (members); POST (CreateScheduleReq) → ScheduleDto.
 * PATCH /api/schedules/:id (UpdateScheduleReq) and DELETE → owner or group admin. Bots are tried in order at firing
 * time: the first available one runs the task.
 */
export const CreateScheduleReq = z
  .object({
    name: ScheduleName,
    prompt: SchedulePrompt,
    botIds: z.array(z.string()).min(1).max(SCHEDULE_MAX_BOTS),
    cron: CronExpr.optional(),
    runAt: ScheduleInstant.optional(),
    timezone: TimeZone,
  })
  .refine((a) => oneTiming(a) && (a.cron !== undefined || a.runAt !== undefined), {
    message: 'cron 与 runAt 需要且只能给一个',
  })
export type CreateScheduleReq = z.infer<typeof CreateScheduleReq>

export const UpdateScheduleReq = z
  .object({
    name: ScheduleName.optional(),
    prompt: SchedulePrompt.optional(),
    botIds: z.array(z.string()).min(1).max(SCHEDULE_MAX_BOTS).optional(),
    cron: CronExpr.optional(),
    runAt: ScheduleInstant.optional(),
    timezone: TimeZone.optional(),
    enabled: z.boolean().optional(),
  })
  .refine(oneTiming, { message: 'cron 与 runAt 最多给一个' })
export type UpdateScheduleReq = z.infer<typeof UpdateScheduleReq>

export const ScheduleDto = z.object({
  id: z.string(),
  groupId: z.string(),
  name: z.string(),
  prompt: z.string(),
  /** Exactly one of `cron` / `runAt` is set. */
  cron: z.string().nullable(),
  runAt: z.string().nullable(),
  timezone: z.string(),
  /** Candidates, most suitable first. */
  botIds: z.array(z.string()),
  enabled: z.boolean(),
  /** Why the server turned it off (run once, kept failing, bots gone…); null when off by hand or on. */
  pausedReason: I18nText.nullable(),
  nextRunAt: z.string().nullable(),
  lastFiredAt: z.string().nullable(),
  lastRunId: z.string().nullable(),
  /** The bot that ran the last firing and how that run went. */
  lastBotId: z.string().nullable(),
  lastStatus: RunStatus.nullable(),
  failStreak: z.number().int(),
  ownerId: z.string(),
  ownerName: z.string(),
  /** Created by this bot through the gonggong tools; null when created in the app. */
  createdByBotId: z.string().nullable(),
  /** The owner and group admins may change it. */
  canManage: z.boolean(),
  createdAt: z.string(),
})
export type ScheduleDto = z.infer<typeof ScheduleDto>
export const GroupSchedulesDto = z.object({ schedules: z.array(ScheduleDto) })
export type GroupSchedulesDto = z.infer<typeof GroupSchedulesDto>

/** POST /api/schedules/preview (members): the next firings of a timing, for the editor. */
export const SchedulePreviewReq = z.object({
  cron: CronExpr.optional(),
  runAt: ScheduleInstant.optional(),
  timezone: TimeZone,
})
export const SchedulePreviewDto = z.object({
  /** null when valid; otherwise why the timing is refused. */
  error: I18nText.nullable(),
  next: z.array(z.string()),
})
export type SchedulePreviewDto = z.infer<typeof SchedulePreviewDto>

/**
 * GET /api/admin/schedules (sysadmin): every live schedule across teams; PATCH /api/admin/schedules/:id
 * ({ enabled }) and DELETE.
 */
export const AdminScheduleDto = ScheduleDto.extend({
  groupName: z.string(),
  groupKind: z.enum(['group', 'dm']),
  teamId: z.string(),
  teamName: z.string(),
  botNames: z.array(z.string()),
})
export type AdminScheduleDto = z.infer<typeof AdminScheduleDto>
export const AdminSchedulesDto = z.object({
  schedules: z.array(AdminScheduleDto),
  stats: z.object({
    enabled: z.number().int(),
    fired24h: z.number().int(),
    failed24h: z.number().int(),
    autoPaused: z.number().int(),
  }),
})
export type AdminSchedulesDto = z.infer<typeof AdminSchedulesDto>
export const AdminUpdateScheduleReq = z.object({ enabled: z.boolean() })

/** `iso` as `YYYY-MM-DD HH:mm` in `tz`. */
export function formatInZone(iso: string, tz: string) {
  const parts = new Intl.DateTimeFormat('en-CA', {
    timeZone: tz,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    hourCycle: 'h23',
  }).formatToParts(new Date(iso))
  const p = (type: string) => parts.find((x) => x.type === type)?.value ?? ''
  return `${p('year')}-${p('month')}-${p('day')} ${p('hour')}:${p('minute')}`
}

const WEEKDAYS: ProtocolKey[] = ['周日', '周一', '周二', '周三', '周四', '周五', '周六', '周日']
const say = (key: ProtocolKey, params?: I18nText['params']): I18nText => ({ key, params })
const num = /^\d+$/
const pad = (n: string) => n.padStart(2, '0')

/** The timing in words for the common patterns; other expressions are shown as they are. */
export function describeSchedule(s: {
  cron: string | null
  runAt: string | null
  timezone: string
}): I18nText {
  if (!s.cron) return say('仅一次 · {at}', { at: s.runAt ? formatInZone(s.runAt, s.timezone) : '' })
  const f = s.cron.trim().split(/\s+/)
  const [m = '', h = '', dom = '', mon = '', dow = ''] = f
  const time = `${pad(h)}:${pad(m)}`
  const fixed = f.length === 5 && num.test(m) && num.test(h) && mon === '*'
  if (fixed && dom === '*' && dow === '*') return say('每天 {time}', { time })
  if (fixed && dom === '*' && dow === '1-5') return say('每个工作日 {time}', { time })
  if (fixed && dom === '*' && /^[0-7]$/.test(dow))
    return say('每{day} {time}', { day: { key: WEEKDAYS[Number(dow)] as ProtocolKey }, time })
  if (fixed && num.test(dom) && dow === '*') return say('每月 {d} 日 {time}', { d: Number(dom), time })
  const rest = f.slice(2).join(' ') === '* * *'
  const every = /^\*\/(\d+)$/
  if (f.length === 5 && rest && h === '*' && every.test(m))
    return say('每 {n} 分钟', { n: Number(every.exec(m)?.[1]) })
  if (f.length === 5 && rest && h === '*' && num.test(m)) return say('每小时第 {m} 分', { m: Number(m) })
  if (f.length === 5 && rest && num.test(m) && every.test(h))
    return say('每 {n} 小时', { n: Number(every.exec(h)?.[1]) })
  return say('cron {expr}', { expr: f.join(' ') })
}
