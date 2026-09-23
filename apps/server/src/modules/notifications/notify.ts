import type { NotificationDto } from '@aiws/protocol'
import type { Ctx } from '../../context.js'
import { notifications } from '../../db/schema.js'

type Row = typeof notifications.$inferSelect

export const notificationDto = (n: Row): NotificationDto => ({
  id: n.id,
  type: n.type as NotificationDto['type'],
  payload: n.payload as NotificationDto['payload'],
  readAt: n.readAt?.toISOString() ?? null,
  createdAt: n.createdAt.toISOString(),
})

/** Stores an in-app notification for one user and pushes it live. */
export async function notify(
  ctx: Ctx,
  userId: string,
  type: NotificationDto['type'],
  payload: NotificationDto['payload'],
) {
  const [row] = (await ctx.db.insert(notifications).values({ userId, type, payload }).returning()) as [Row]
  ctx.bus.publish([userId], { t: 'notification.new', notification: notificationDto(row) })
}
