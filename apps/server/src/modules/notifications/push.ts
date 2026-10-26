import { type NotificationDto, notificationView, resolveLocale } from '@gonggong/protocol'
import { eq, inArray } from 'drizzle-orm'
import webpush from 'web-push'
import type { Ctx } from '../../context.js'
import { pushSubscriptions, runs, systemParams } from '../../db/schema.js'
import { translator } from '../../i18n/index.js'
import { isUuid } from '../../lib/ids.js'
import { isNotificationSuppressed } from './suppress.js'

interface VapidKeys {
  publicKey: string
  privateKey: string
}

const KEY = 'vapidKeys'
const SUBJECT = process.env.GONGGONG_PUSH_SUBJECT ?? 'mailto:gonggong@example.com'
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

function payloadTag(n: NotificationDto) {
  const p = n.payload
  const value = (key: string) => (typeof p[key] === 'string' && p[key] ? p[key] : undefined)
  const rootRunId = value('rootRunId')
  if (rootRunId) return `task:${rootRunId}`
  if (n.type === 'mention' && value('messageId')) return `mention:${value('messageId')}`
  if (n.type === 'bot_share_request' && value('requestId')) return `bot-share-request:${value('requestId')}`
  if (n.type === 'git_operation_request' && value('operationId'))
    return `git-operation:${value('operationId')}`
  return
}

async function taskRoot(ctx: Ctx, runId: string) {
  let current = runId
  const seen = new Set<string>()
  while (isUuid(current) && !seen.has(current)) {
    seen.add(current)
    const [run] = await ctx.db
      .select({ parentRunId: runs.parentRunId, continuationOf: runs.continuationOf })
      .from(runs)
      .where(eq(runs.id, current))
    if (!run) return
    const parent = run.continuationOf ?? run.parentRunId
    if (!parent) return current
    current = parent
  }
}

/** A stable local-notification key; absent where the payload does not identify one unambiguous object. */
export async function notificationTag(ctx: Ctx, n: NotificationDto) {
  const direct = payloadTag(n)
  if (direct) return direct
  const runId = n.payload.runId
  const rootRunId = typeof runId === 'string' ? await taskRoot(ctx, runId) : undefined
  if (rootRunId) return `task:${rootRunId}`
  const p = n.payload
  if (n.type === 'approval' && typeof p.approvalId === 'string') return `approval:${p.approvalId}`
  if (n.type === 'question' && typeof p.questionSetId === 'string') return `question:${p.questionSetId}`
}

/** Sends a notification to every browser the user subscribed; failures never affect the caller. */
export async function sendPush(ctx: Ctx, userId: string, n: NotificationDto) {
  if (isNotificationSuppressed((id, groupId) => ctx.bus.isReading(id, groupId), userId, n)) return
  const subs = await ctx.db.select().from(pushSubscriptions).where(eq(pushSubscriptions.userId, userId))
  if (!subs.length) return
  const keys = await vapidKeys(ctx)
  const tag = await notificationTag(ctx, n)
  const payload = (locale: string) => {
    const view = notificationView(n, translator(resolveLocale(locale)).text)
    return JSON.stringify({
      title: view.group ? `${view.label} · ${view.group}` : view.label,
      body: view.text,
      url: view.href,
      ...(tag && { tag }),
    })
  }
  const gone: string[] = []
  await Promise.all(
    subs.map((s) =>
      webpush
        .sendNotification(
          { endpoint: s.endpoint, keys: s.keys as { p256dh: string; auth: string } },
          payload(s.locale),
          {
            vapidDetails: { subject: SUBJECT, ...keys },
            TTL: 24 * 3600,
          },
        )
        .catch((e: { statusCode?: number }) => {
          if (GONE.includes(e.statusCode ?? 0)) gone.push(s.id)
          else console.warn(`web push to user ${userId} failed:`, e)
        }),
    ),
  )
  if (gone.length) await ctx.db.delete(pushSubscriptions).where(inArray(pushSubscriptions.id, gone))
}
