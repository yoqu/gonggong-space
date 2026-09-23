import { type NotificationDto, PUSHED_NOTIFICATION_TYPES } from '@aiws/protocol'
import type { Ctx } from '../../context.js'
import { notifications } from '../../db/schema.js'
import { sendPush } from './push.js'

type Row = typeof notifications.$inferSelect

export const notificationDto = (n: Row): NotificationDto => ({
  id: n.id,
  type: n.type as NotificationDto['type'],
  payload: n.payload as NotificationDto['payload'],
  readAt: n.readAt?.toISOString() ?? null,
  createdAt: n.createdAt.toISOString(),
})

/** Stores an in-app notification for one user, pushes it live and, for actionable types, to their browsers. */
export async function notify(
  ctx: Ctx,
  userId: string,
  type: NotificationDto['type'],
  payload: NotificationDto['payload'],
) {
  const [row] = (await ctx.db.insert(notifications).values({ userId, type, payload }).returning()) as [Row]
  const dto = notificationDto(row)
  ctx.bus.publish([userId], { t: 'notification.new', notification: dto })
  // Push delivery can be slow; it must not hold up the flow that raised the notification.
  if (PUSHED_NOTIFICATION_TYPES.includes(type))
    void sendPush(ctx, userId, dto).catch((e) => console.warn('web push failed:', e))
}
