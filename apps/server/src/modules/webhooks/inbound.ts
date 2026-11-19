import { randomUUID } from 'node:crypto'
import { createWriteStream } from 'node:fs'
import { mkdir, unlink } from 'node:fs/promises'
import { join } from 'node:path'
import { Readable } from 'node:stream'
import { pipeline } from 'node:stream/promises'
import {
  type Attachment,
  WEBHOOK_ATTACHMENT_MAX,
  WEBHOOK_DEDUPE_MS,
  WEBHOOK_TEXT_MAX,
  type WebhookCallDto,
  type WebhookCallReq,
} from '@gonggong/protocol'
import { and, desc, eq, gt, isNull, sql } from 'drizzle-orm'
import type { Ctx } from '../../context.js'
import { attachments, groupMembers, groups, messages, runs, users, webhooks } from '../../db/schema.js'
import { audit } from '../../lib/audit.js'
import { sha256 } from '../../lib/crypto.js'
import { fail } from '../../lib/errors.js'
import { sealStream } from '../../lib/seal.js'
import type { Throttle } from '../../lib/throttle.js'
import { dataDir, safeName } from '../attachments/service.js'
import { mirrorUserMessage } from '../feishu/outbound.js'
import { activeBots } from '../groups/service.js'
import { type MessageMeta, type MessageRow, messageDto, publishMessage } from '../messages/service.js'
import { pickAvailableBot, resolveBotRunOptions, UNFINISHED } from '../runs/pick.js'
import { triggerRuns } from '../runs/trigger.js'
import { groupRedactor } from '../secrets/resolve.js'
import { DEFAULT_WEBHOOK_PROMPT, publishWebhooks } from './service.js'

async function storeTextAttachment(o: {
  groupId: string
  uploaderId: string
  messageId: string
  name: string
  content: string
  redact: (s: string) => string
}): Promise<{ attachment: Attachment; path: string; row: typeof attachments.$inferInsert }> {
  const id = randomUUID()
  const storageKey = `attachments/${id}`
  const path = join(dataDir(), storageKey)
  await mkdir(join(dataDir(), 'attachments'), { recursive: true })
  const buf = Buffer.from(o.redact(o.content), 'utf8')
  try {
    await pipeline(Readable.from([buf]), sealStream(), createWriteStream(path))
  } catch (e) {
    await unlink(path).catch(() => {})
    throw e
  }
  const name = safeName(o.name, o.redact)
  const mime = 'text/plain; charset=utf-8'
  const size = buf.byteLength
  return {
    path,
    row: {
      id,
      uploaderId: o.uploaderId,
      groupId: o.groupId,
      messageId: o.messageId,
      name,
      size,
      mime,
      storageKey,
    },
    attachment: { id, name, size, mime, messageId: o.messageId },
  }
}

/** Handles POST /api/hooks/:token (or /api/hooks with Bearer token). */
export async function handleWebhookCall(
  ctx: Ctx,
  token: string,
  req: WebhookCallReq,
  throttle: Throttle,
): Promise<WebhookCallDto> {
  const hash = sha256(token)
  const [found] = await ctx.db
    .select({ w: webhooks })
    .from(webhooks)
    .innerJoin(groups, eq(groups.id, webhooks.groupId))
    .where(
      and(
        eq(webhooks.tokenHash, hash),
        isNull(webhooks.deletedAt),
        eq(webhooks.enabled, true),
        isNull(groups.archivedAt),
      ),
    )
  if (!found) return fail('unauthorized', 'Webhook 无效或已停用')
  const { w } = found

  if (throttle.blocked(w.id)) return fail('rate_limited', 'Webhook 调用过于频繁，请稍后再试')
  throttle.fail(w.id)

  if (Buffer.byteLength(req.text, 'utf8') > WEBHOOK_TEXT_MAX)
    return fail('payload_too_large', '正文不能超过 {kb} KB', { kb: WEBHOOK_TEXT_MAX / 1024 })
  if (req.attachment && Buffer.byteLength(req.attachment.content, 'utf8') > WEBHOOK_ATTACHMENT_MAX)
    return fail('payload_too_large', '附件不能超过 {kb} KB', { kb: WEBHOOK_ATTACHMENT_MAX / 1024 })

  const [owner] = await ctx.db
    .select({ id: users.id, name: users.name })
    .from(groupMembers)
    .innerJoin(users, eq(users.id, groupMembers.userId))
    .where(and(eq(groupMembers.groupId, w.groupId), eq(groupMembers.userId, w.ownerId)))
  if (!owner) {
    await ctx.db.update(webhooks).set({ enabled: false }).where(eq(webhooks.id, w.id))
    await audit(ctx, {
      category: 'webhook',
      action: 'webhook.auto_disable',
      groupId: w.groupId,
      detail: { webhookId: w.id, name: w.name, reason: 'owner_left' },
    })
    await publishWebhooks(ctx, w.groupId)
    return fail('unauthorized', 'Webhook 无效或已停用')
  }

  const now = ctx.now()
  if (req.dedupeKey) {
    const since = new Date(now.getTime() - WEBHOOK_DEDUPE_MS)
    const [dup] = await ctx.db
      .select({ id: messages.id })
      .from(messages)
      .where(
        and(
          eq(messages.groupId, w.groupId),
          sql`${messages.meta}->>'webhookOf' = ${w.id}`,
          sql`${messages.meta}->>'webhookDedupe' = ${req.dedupeKey}`,
          gt(messages.createdAt, since),
        ),
      )
      .orderBy(desc(messages.createdAt))
      .limit(1)
    if (dup) {
      const [dupRun] = await ctx.db
        .select({ id: runs.id })
        .from(runs)
        .where(eq(runs.triggerMessageId, dup.id))
      return { messageId: dup.id, runId: dupRun?.id ?? null, duplicate: true }
    }
  }

  const redact = await groupRedactor(ctx, w.groupId)
  let body = redact(req.text)
  let mentions: string[] = []
  let skipped: WebhookCallDto['skipped']
  let webhookPrompt: string | undefined
  let runOptionsMeta: Pick<MessageMeta, 'runOptions'> = {}

  const wantsMention = req.mention === true || (Array.isArray(req.mention) && req.mention.length > 0)
  if (wantsMention) {
    const [last] = w.lastRunId
      ? await ctx.db.select({ status: runs.status }).from(runs).where(eq(runs.id, w.lastRunId))
      : []
    if (last && UNFINISHED.includes(last.status)) {
      skipped = 'busy'
      body = `${body}\n\n_上次排查尚未结束，本次不触发 Bot。_`
    } else {
      const inGroup = await activeBots(ctx, w.groupId)
      const allowed = w.botIds.flatMap((id) => inGroup.filter((b) => b.id === id))
      const requested = Array.isArray(req.mention)
        ? req.mention.flatMap((raw) => {
            const key = raw.trim().replace(/^@/, '')
            return allowed.filter((b) => b.id === key || b.name === key)
          })
        : allowed
      const seen = new Set<string>()
      const candidates = requested.filter((b) => {
        if (seen.has(b.id)) return false
        seen.add(b.id)
        return true
      })
      const bot = await pickAvailableBot(ctx, w.groupId, candidates)
      if (!bot) {
        skipped = 'unavailable'
      } else {
        mentions = [bot.id]
        webhookPrompt = req.prompt ?? w.promptTemplate ?? DEFAULT_WEBHOOK_PROMPT
        runOptionsMeta = await resolveBotRunOptions(ctx, {
          groupId: w.groupId,
          name: w.name,
          runOptions: w.runOptions,
          botId: bot.id,
          botName: bot.name,
          fallbackKey: 'Webhook「{name}」为 {bot} 设置的模型已不可用（{pick}），本次按默认运行',
        })
        if (!body.startsWith(`@${bot.name}`)) body = `@${bot.name} ${body}`
      }
    }
  }

  const messageId = randomUUID()
  const stored = req.attachment
    ? await storeTextAttachment({
        groupId: w.groupId,
        uploaderId: owner.id,
        messageId,
        name: req.attachment.name,
        content: req.attachment.content,
        redact,
      })
    : null

  const meta: MessageMeta = {
    mentions,
    ...runOptionsMeta,
    webhookOf: w.id,
    webhook: { id: w.id, name: w.name },
    ...(req.dedupeKey && { webhookDedupe: req.dedupeKey }),
    ...(webhookPrompt && { webhookPrompt }),
    ...(stored && { attachments: [stored.attachment] }),
  }

  let message: MessageRow
  try {
    message = await ctx.db.transaction(async (tx) => {
      const [m] = (await tx
        .insert(messages)
        .values({
          id: messageId,
          groupId: w.groupId,
          kind: 'user',
          authorUserId: owner.id,
          body,
          meta,
          createdAt: now,
        })
        .returning()) as [MessageRow]
      if (stored) await tx.insert(attachments).values(stored.row)
      return m
    })
  } catch (e) {
    if (stored) await unlink(stored.path).catch(() => {})
    throw e
  }

  await publishMessage(ctx, messageDto(message, w.name))
  await mirrorUserMessage(ctx, message, owner)
  let runId: string | null = null
  if (mentions.length) {
    await triggerRuns(ctx, message)
    const [run] = await ctx.db.select({ id: runs.id }).from(runs).where(eq(runs.triggerMessageId, message.id))
    runId = run?.id ?? null
  }
  await ctx.db
    .update(webhooks)
    .set({ lastCalledAt: now, ...(runId && { lastRunId: runId }) })
    .where(eq(webhooks.id, w.id))
  await audit(ctx, {
    category: 'webhook',
    action: 'webhook.call',
    groupId: w.groupId,
    detail: {
      webhookId: w.id,
      name: w.name,
      messageId: message.id,
      runId,
      ...(skipped && { skipped }),
      hasAttachment: !!stored,
    },
  })
  await publishWebhooks(ctx, w.groupId)
  return { messageId: message.id, runId, ...(skipped && { skipped }) }
}
