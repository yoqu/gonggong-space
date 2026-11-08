import type { NotificationDto, NotifyPrefs } from '@gonggong/protocol'
import { eq } from 'drizzle-orm'
import type { Ctx } from '../../context.js'
import { users } from '../../db/schema.js'

type IsReading = (userId: string, groupId: string) => boolean

/** Whether the recipient is already looking at this notification's group on a visible, focused page. */
export function isNotificationSuppressed(
  isReading: IsReading,
  userId: string,
  notification: Pick<NotificationDto, 'payload'>,
) {
  const groupId = notification.payload.groupId
  return typeof groupId === 'string' && isReading(userId, groupId)
}

const minutes = (hhmm: string) => {
  const [h, m] = hhmm.split(':').map(Number)
  return (h ?? 0) * 60 + (m ?? 0)
}

/** 勿扰: paused until later, or inside the daily quiet hours (which may cross midnight) in their time zone. */
export function inQuietTime(prefs: NotifyPrefs, now: Date) {
  if (prefs.pausedUntil && new Date(prefs.pausedUntil) > now) return true
  const q = prefs.quietHours
  if (!q) return false
  const parts = new Intl.DateTimeFormat('en-GB', {
    timeZone: q.timezone,
    hour: '2-digit',
    minute: '2-digit',
    hourCycle: 'h23',
  }).formatToParts(now)
  const part = (type: string) => Number(parts.find((p) => p.type === type)?.value ?? 0)
  const at = part('hour') * 60 + part('minute')
  const start = minutes(q.start)
  const end = minutes(q.end)
  return start <= end ? at >= start && at < end : at >= start || at < end
}

/** Push (browser and Feishu) is held back while the user reads the group or is in 勿扰; in-app rows are not. */
export async function pushSuppressed(
  ctx: Ctx,
  userId: string,
  notification: Pick<NotificationDto, 'payload'>,
) {
  if (isNotificationSuppressed((id, groupId) => ctx.bus.isReading(id, groupId), userId, notification))
    return true
  const [user] = await ctx.db.select({ prefs: users.notifyPrefs }).from(users).where(eq(users.id, userId))
  return !!user && inQuietTime(user.prefs, ctx.now())
}
