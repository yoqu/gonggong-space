import { RECALL_WINDOW_MS, RECALLED_QUOTE } from '@gonggong/protocol'
import { and, eq, inArray, isNull, notExists, sql } from 'drizzle-orm'
import type { Ctx } from '../../context.js'
import { messageHides, messages, runs } from '../../db/schema.js'
import { fail } from '../../lib/errors.js'
import { idParam } from '../../lib/ids.js'
import { mirrorRecall } from '../feishu/mirror.js'
import { requireMember } from '../groups/service.js'
import { publishRun } from '../runs/dto.js'
import { runStep } from '../runs/step.js'
import { notifyChainDone } from '../runs/stop.js'
import { type MessageRow, memberIds, messageDto } from './service.js'

/** Only the author may recall or delete, and only their own user messages (not bot replies or events). */
export async function ownMessage(ctx: Ctx, userId: string, id: string) {
  const [m] = await ctx.db
    .select()
    .from(messages)
    .where(eq(messages.id, idParam(id, '消息不存在')))
  if (!m) return fail('not_found', '消息不存在')
  await requireMember(ctx, m.groupId, userId)
  if (m.kind !== 'user' || m.authorUserId !== userId) return fail('forbidden', '只能操作自己发送的消息')
  return m
}

/**
 * 撤回: the content is erased for good (also from quotes of it) so no client or agent can read it again. Runs it
 * triggered that have not started are voided (they would start with an empty prompt); started ones carry on.
 */
export async function recallMessage(ctx: Ctx, user: { id: string; name: string }, id: string) {
  const m = await ownMessage(ctx, user.id, id)
  if (m.recalledAt) return messageDto(m, user.name)
  if (ctx.now().getTime() - m.createdAt.getTime() > RECALL_WINDOW_MS)
    return fail('recall_expired', '超过 24 小时，无法撤回')
  const row = await ctx.db.transaction(async (tx) => {
    const [row] = (await tx
      .update(messages)
      .set({ recalledAt: ctx.now(), body: '', meta: sql`${messages.meta} - 'attachments' - 'quote'` })
      .where(and(eq(messages.id, m.id), isNull(messages.recalledAt)))
      .returning()) as MessageRow[]
    if (!row) return fail('conflict', '该消息已撤回')
    await tx
      .update(messages)
      .set({ meta: sql`jsonb_set(${messages.meta}, '{quote,text}', to_jsonb(${RECALLED_QUOTE}::text))` })
      .where(
        and(
          eq(messages.groupId, m.groupId),
          sql`${messages.meta}->'quote'->>'kind' = 'message'`,
          sql`${messages.meta}->'quote'->>'id' = ${m.id}`,
        ),
      )
    return row
  })
  const voided = await ctx.db
    .update(runs)
    .set({ status: 'expired', ...runStep('触发消息已撤回，已作废'), endedAt: ctx.now() })
    .where(and(eq(runs.triggerMessageId, m.id), inArray(runs.status, ['queued', 'offline_wait'])))
    .returning()
  for (const run of voided) {
    await publishRun(ctx, run)
    await notifyChainDone(ctx, run)
  }
  await mirrorRecall(ctx, m.id, m.groupId)
  ctx.bus.publish(await memberIds(ctx, m.groupId), {
    t: 'message.recalled',
    groupId: m.groupId,
    messageId: m.id,
  })
  return messageDto(row, user.name)
}

/** 删除: hidden from the author's own timeline and search only; no time limit, others are unaffected. */
export async function hideMessage(ctx: Ctx, userId: string, id: string) {
  const m = await ownMessage(ctx, userId, id)
  const added = await ctx.db
    .insert(messageHides)
    .values({ messageId: m.id, userId })
    .onConflictDoNothing()
    .returning()
  if (added.length) ctx.bus.publish([userId], { t: 'message.hidden', groupId: m.groupId, messageId: m.id })
}

/** Filter for queries over `messages`: not hidden by `userId`. */
export const notHiddenBy = (ctx: Ctx, userId: string) =>
  notExists(
    ctx.db
      .select({ one: sql`1` })
      .from(messageHides)
      .where(and(eq(messageHides.messageId, messages.id), eq(messageHides.userId, userId))),
  )
