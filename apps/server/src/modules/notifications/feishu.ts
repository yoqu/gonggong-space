import { type NotificationDto, notificationView } from '@gonggong/protocol'
import { and, eq } from 'drizzle-orm'
import type { Ctx } from '../../context.js'
import { feishuIdentities } from '../../db/schema.js'
import { translator } from '../../i18n/index.js'
import { mainApp } from '../feishu/apps.js'
import { notificationCard } from '../feishu/cards.js'
import { credsOf } from '../feishu/gateway.js'
import { publicUrl } from '../feishu/identity.js'
import { isNotificationSuppressed } from './suppress.js'

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
  const view = notificationView(n, translator('zh').text)
  const base = await publicUrl(ctx)
  const card = notificationCard({ ...view, url: base && `${base}${view.href}` })
  await ctx.feishu.api.send(
    credsOf(app),
    identity.openId,
    { msgType: 'interactive', content: JSON.stringify(card) },
    { receiveIdType: 'open_id' },
  )
}
