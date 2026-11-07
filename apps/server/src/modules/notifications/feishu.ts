import { type NotificationDto, notificationView } from '@gonggong/protocol'
import { and, eq, sql } from 'drizzle-orm'
import type { Ctx } from '../../context.js'
import { feishuIdentities, notifications } from '../../db/schema.js'
import { translator } from '../../i18n/index.js'
import { mainApp } from '../feishu/apps.js'
import { notificationCard, shareRequestCard } from '../feishu/cards.js'
import { credsOf } from '../feishu/gateway.js'
import { publicUrl } from '../feishu/identity.js'
import { notificationDto } from './notify.js'
import { isNotificationSuppressed } from './suppress.js'

async function viewOf(ctx: Ctx, n: NotificationDto) {
  const view = notificationView(n, translator('zh').text)
  const base = await publicUrl(ctx)
  return { ...view, url: base && `${base}${view.href}` }
}

/**
 * 飞书通知: the notification as a card in the user's DM with the main app (whose open_id we store). Skipped while the
 * user is reading its group in the app: they already see it there.
 */
export async function sendFeishuNotice(ctx: Ctx, userId: string, n: NotificationDto) {
  if (isNotificationSuppressed((id, groupId) => ctx.bus.isReading(id, groupId), userId, n)) return
  const [identity] = await ctx.db
    .select({ openId: feishuIdentities.openId })
    .from(feishuIdentities)
    .where(and(eq(feishuIdentities.userId, userId), eq(feishuIdentities.notify, true)))
  const app = identity && (await mainApp(ctx))
  if (!app) return
  const view = await viewOf(ctx, n)
  const card =
    n.type === 'bot_share_request' && !n.resolvedAt
      ? shareRequestCard({ ...view, requestId: String(n.payload.requestId) })
      : notificationCard(view)
  await ctx.feishu.api.send(
    credsOf(app),
    identity.openId,
    { msgType: 'interactive', content: JSON.stringify(card) },
    { receiveIdType: 'open_id' },
  )
}

/** The share request's Feishu card once decided there, as the answer to the click. */
export async function decidedShareCard(
  ctx: Ctx,
  requestId: string,
  decided: { approved: boolean; by: string },
) {
  const [row] = await ctx.db
    .select()
    .from(notifications)
    .where(
      and(
        eq(notifications.type, 'bot_share_request'),
        sql`${notifications.payload}->>'requestId' = ${requestId}`,
      ),
    )
    .limit(1)
  return row && shareRequestCard({ ...(await viewOf(ctx, notificationDto(row))), requestId, decided })
}
