import { type NotificationDto, notificationView } from '@aiws/protocol'
import { eq, inArray } from 'drizzle-orm'
import webpush from 'web-push'
import type { Ctx } from '../../context.js'
import { pushSubscriptions, systemParams } from '../../db/schema.js'

interface VapidKeys {
  publicKey: string
  privateKey: string
}

const KEY = 'vapidKeys'
const SUBJECT = process.env.AIWS_PUSH_SUBJECT ?? 'mailto:aiws@example.com'
/** The push service no longer knows the subscription (browser unsubscribed or expired). */
const GONE = [404, 410]

/** The server's VAPID key pair, generated on first use and kept in system params. */
export async function vapidKeys(ctx: Ctx): Promise<VapidKeys> {
  const read = async () =>
    (await ctx.db.select().from(systemParams).where(eq(systemParams.key, KEY)))[0]?.value as
      | VapidKeys
      | undefined
  const found = await read()
  if (found) return found
  await ctx.db
    .insert(systemParams)
    .values({ key: KEY, value: webpush.generateVAPIDKeys() })
    .onConflictDoNothing()
  return (await read()) as VapidKeys
}

/** Sends a notification to every browser the user subscribed; failures never affect the caller. */
export async function sendPush(ctx: Ctx, userId: string, n: NotificationDto) {
  const subs = await ctx.db.select().from(pushSubscriptions).where(eq(pushSubscriptions.userId, userId))
  if (!subs.length) return
  const keys = await vapidKeys(ctx)
  const view = notificationView(n)
  const body = JSON.stringify({
    title: view.group ? `${view.label} · ${view.group}` : view.label,
    body: view.text,
    url: view.href,
  })
  const gone: string[] = []
  await Promise.all(
    subs.map((s) =>
      webpush
        .sendNotification({ endpoint: s.endpoint, keys: s.keys as { p256dh: string; auth: string } }, body, {
          vapidDetails: { subject: SUBJECT, ...keys },
          TTL: 24 * 3600,
        })
        .catch((e: { statusCode?: number }) => {
          if (GONE.includes(e.statusCode ?? 0)) gone.push(s.id)
          else console.warn(`web push to user ${userId} failed:`, e)
        }),
    ),
  )
  if (gone.length) await ctx.db.delete(pushSubscriptions).where(inArray(pushSubscriptions.id, gone))
}
