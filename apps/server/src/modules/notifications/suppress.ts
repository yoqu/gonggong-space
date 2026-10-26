import type { NotificationDto } from '@gonggong/protocol'

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
