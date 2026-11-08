import { type NotificationDto, notificationView } from '@gonggong/protocol'
import { and, eq, sql } from 'drizzle-orm'
import type { Ctx } from '../../context.js'
import { feishuApps, feishuIdentities, feishuMessageLinks, notifications } from '../../db/schema.js'
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
  const kind = REQUEST_KIND[n.type]
  const requestId = kind && !n.resolvedAt ? String(n.payload.requestId) : null
  const card = kind && requestId ? shareRequestCard({ ...view, requestId, kind }) : notificationCard(view)
  const sent = await ctx.feishu.api.send(
    credsOf(app),
    identity.openId,
    { msgType: 'interactive', content: JSON.stringify(card) },
    { receiveIdType: 'open_id' },
  )
  // Kept so a decision made on the web settles this card too.
  if (requestId)
    await ctx.db.insert(feishuMessageLinks).values({
      feishuMessageId: sent.messageId,
      chatId: identity.openId,
      appId: app.appId,
      direction: 'out',
      kind: `${kind}_request`,
      refId: requestId,
    })
}

/** Notifications whose Feishu card carries 同意 / 拒绝, by the card's kind. */
const REQUEST_KIND: Partial<Record<NotificationDto['type'], 'share' | 'join'>> = {
  bot_share_request: 'share',
  join_request: 'join',
}
const TYPE_OF = { share: 'bot_share_request', join: 'join_request' } as const

/** A share or join request decided on the web: its Feishu cards show who decided. Best effort, like every Feishu call. */
export async function mirrorShareDecision(
  ctx: Ctx,
  requestId: string,
  decided: { approved: boolean; by: string },
  kind: 'share' | 'join' = 'share',
) {
  const links = await ctx.db
    .select({ messageId: feishuMessageLinks.feishuMessageId, app: feishuApps })
    .from(feishuMessageLinks)
    .innerJoin(feishuApps, eq(feishuApps.appId, feishuMessageLinks.appId))
    .where(and(eq(feishuMessageLinks.kind, `${kind}_request`), eq(feishuMessageLinks.refId, requestId)))
  if (!links.length) return
  const card = await decidedShareCard(ctx, requestId, decided, kind)
  if (!card) return
  for (const l of links)
    await ctx.feishu.api
      .updateCard(credsOf(l.app), l.messageId, JSON.stringify(card))
      .catch((err) => console.warn('feishu share card:', err))
}

/** The share or join request's Feishu card once decided there, as the answer to the click. */
export async function decidedShareCard(
  ctx: Ctx,
  requestId: string,
  decided: { approved: boolean; by: string },
  kind: 'share' | 'join' = 'share',
) {
  const [row] = await ctx.db
    .select()
    .from(notifications)
    .where(
      and(eq(notifications.type, TYPE_OF[kind]), sql`${notifications.payload}->>'requestId' = ${requestId}`),
    )
    .limit(1)
  return row && shareRequestCard({ ...(await viewOf(ctx, notificationDto(row))), requestId, kind, decided })
}
