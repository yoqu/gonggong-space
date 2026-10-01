import { type NotificationDto, PUSHED_NOTIFICATION_TYPES } from '@gonggong/protocol'
import { and, count, eq, inArray, isNull, sql } from 'drizzle-orm'
import type { Ctx } from '../../context.js'
import { notifications } from '../../db/schema.js'
import { groupTitles } from '../groups/title.js'
import { teamOfBot, teamOfGroup } from '../teams/service.js'
import { sendPush } from './push.js'

type Row = typeof notifications.$inferSelect

export const notificationDto = (n: Row): NotificationDto => ({
  id: n.id,
  teamId: n.teamId,
  type: n.type as NotificationDto['type'],
  payload: n.payload as NotificationDto['payload'],
  readAt: n.readAt?.toISOString() ?? null,
  resolvedAt: n.resolvedAt?.toISOString() ?? null,
  createdAt: n.createdAt.toISOString(),
})

/** Payloads name the group as it is titled now (a DM follows its Bot's current name). */
export async function withGroupTitles(ctx: Ctx, payloads: NotificationDto['payload'][]) {
  const titles = await groupTitles(
    ctx,
    payloads.map((p) => String(p.groupId ?? '')),
  )
  return payloads.map((p) => {
    const title = titles.get(String(p.groupId ?? ''))
    return title === undefined ? p : { ...p, groupName: title }
  })
}

/** Stores an in-app notification for one user, pushes it live and, for actionable types, to their browsers. */
export async function notify(
  ctx: Ctx,
  userId: string,
  type: NotificationDto['type'],
  payload: NotificationDto['payload'],
) {
  const [titled] = await withGroupTitles(ctx, [payload])
  const teamId = payload.groupId
    ? await teamOfGroup(ctx, String(payload.groupId))
    : payload.botId
      ? await teamOfBot(ctx, String(payload.botId))
      : null
  const [row] = (await ctx.db
    .insert(notifications)
    .values({ userId, teamId, type, payload: titled })
    .returning()) as [Row]
  const dto = notificationDto(row)
  ctx.bus.publish([userId], { t: 'notification.new', notification: dto })
  // Push delivery can be slow; it must not hold up the flow that raised the notification.
  if (PUSHED_NOTIFICATION_TYPES.includes(type))
    void sendPush(ctx, userId, dto).catch((e) => console.warn('web push failed:', e))
}

/** The requests these notifications asked about were settled: mark them handled (and read) for every recipient. */
export async function resolveNotifications(
  ctx: Ctx,
  type: 'approval' | 'question',
  key: 'approvalId' | 'questionSetId',
  ids: string[],
) {
  if (!ids.length) return
  const now = ctx.now()
  const rows = (await ctx.db
    .update(notifications)
    .set({
      resolvedAt: now,
      readAt: sql`coalesce(${notifications.readAt}, ${now.toISOString()}::timestamptz)`,
    })
    .where(
      and(
        eq(notifications.type, type),
        isNull(notifications.resolvedAt),
        inArray(sql`${notifications.payload}->>${key}`, ids),
      ),
    )
    .returning()) as Row[]
  for (const userId of new Set(rows.map((r) => r.userId))) {
    const [unread] = await ctx.db
      .select({ n: count() })
      .from(notifications)
      .where(and(eq(notifications.userId, userId), isNull(notifications.readAt)))
    ctx.bus.publish([userId], {
      t: 'notification.resolved',
      notifications: rows.filter((r) => r.userId === userId).map(notificationDto),
      unread: unread?.n ?? 0,
    })
  }
}
