import { type NotificationDto, NotificationType, PUSHED_NOTIFICATION_TYPES } from '@gonggong/protocol'
import { and, count, eq, inArray, isNull, sql } from 'drizzle-orm'
import type { Ctx } from '../../context.js'
import { messages, notifications } from '../../db/schema.js'
import { groupTitles } from '../groups/title.js'
import { teamOfBot, teamOfGroup } from '../teams/service.js'
import { sendFeishuNotice } from './feishu.js'
import { sendPush } from './push.js'

type Row = typeof notifications.$inferSelect

/** Rows of retired types (the lock era's 'lock') stay stored but are neither listed nor counted. */
export const knownNotification = inArray(notifications.type, NotificationType.options)

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

/** Stores an in-app notification for one user, pushes it live and, for actionable types, to their browsers and Feishu. */
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
  if (!PUSHED_NOTIFICATION_TYPES.includes(type)) return
  void sendPush(ctx, userId, dto).catch((e) => console.warn('web push failed:', e))
  void sendFeishuNotice(ctx, userId, dto).catch((e) => console.warn('feishu notice failed:', e))
}

/**
 * The requests these notifications asked about were settled: mark them handled (and read) for every recipient.
 * `groupId` narrows payloads keyed by something not unique across groups (a bot).
 */
export async function resolveNotifications(
  ctx: Ctx,
  type:
    | 'approval'
    | 'question'
    | 'sync_conflict'
    | 'sync_drift'
    | 'bot_share_request'
    | 'git_operation_request'
    | 'install_request'
    | 'listing_submitted',
  key: 'approvalId' | 'questionSetId' | 'conflictId' | 'botId' | 'requestId' | 'operationId' | 'versionId',
  ids: string[],
  groupId?: string,
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
        groupId === undefined ? undefined : sql`${notifications.payload}->>'groupId' = ${groupId}`,
      ),
    )
    .returning()) as Row[]
  for (const userId of new Set(rows.map((r) => r.userId))) {
    await publishResolved(
      ctx,
      userId,
      rows.filter((r) => r.userId === userId),
    )
  }
}

/** Reading a group up to `seq` also reads the @ notifications of the messages it covered. */
export async function readMentions(ctx: Ctx, userId: string, groupId: string, seq: number) {
  const rows = (await ctx.db
    .update(notifications)
    .set({ readAt: ctx.now() })
    .where(
      and(
        eq(notifications.userId, userId),
        eq(notifications.type, 'mention'),
        isNull(notifications.readAt),
        sql`${notifications.payload}->>'groupId' = ${groupId}`,
        sql`exists (select 1 from ${messages} where ${messages.id}::text = ${notifications.payload}->>'messageId' and ${messages.groupId} = ${groupId} and ${messages.seq} <= ${seq})`,
      ),
    )
    .returning()) as Row[]
  if (rows.length) await publishResolved(ctx, userId, rows)
}

async function publishResolved(ctx: Ctx, userId: string, rows: Row[]) {
  const [unread] = await ctx.db
    .select({ n: count() })
    .from(notifications)
    .where(and(eq(notifications.userId, userId), isNull(notifications.readAt), knownNotification))
  ctx.bus.publish([userId], {
    t: 'notification.resolved',
    notifications: rows.map(notificationDto),
    unread: unread?.n ?? 0,
  })
}
