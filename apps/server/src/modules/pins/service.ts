import { type GroupPinsDto, type HtmlRenderRef, MAX_PINS, type PinnedMessageDto } from '@gonggong/protocol'
import { and, desc, eq, sql } from 'drizzle-orm'
import { alias } from 'drizzle-orm/pg-core'
import type { Ctx } from '../../context.js'
import { bots, groupPinnedMessages, messages, users } from '../../db/schema.js'
import { fail } from '../../lib/errors.js'
import { summarizeBlocks } from '../../lib/text.js'
import { type MessageMeta, memberIds, postEvent, userAuthorName } from '../messages/service.js'

const SNIPPET = 120
const pinner = alias(users, 'pinner')
const snippet = (body: string, pages?: HtmlRenderRef[]) =>
  summarizeBlocks(body, pages).replace(/\s+/g, ' ').trim().slice(0, SNIPPET)

/** The group's pins, newest first. */
export async function groupPins(ctx: Ctx, groupId: string): Promise<GroupPinsDto> {
  const rows = await ctx.db
    .select({ pin: groupPinnedMessages, m: messages, user: userAuthorName, bot: bots.name, by: pinner.name })
    .from(groupPinnedMessages)
    .innerJoin(messages, eq(messages.id, groupPinnedMessages.messageId))
    .innerJoin(pinner, eq(pinner.id, groupPinnedMessages.pinnedBy))
    .leftJoin(users, eq(users.id, messages.authorUserId))
    .leftJoin(bots, eq(bots.id, messages.authorBotId))
    .where(eq(groupPinnedMessages.groupId, groupId))
    .orderBy(desc(groupPinnedMessages.pinnedAt))
  return {
    pins: rows.map(
      ({ pin, m, user, bot, by }): PinnedMessageDto => ({
        messageId: m.id,
        seq: m.seq,
        authorName: user ?? bot ?? '',
        text: snippet(m.body, (m.meta as MessageMeta).htmlRenders),
        attachments: (m.meta as MessageMeta).attachments?.length ?? 0,
        pinnedBy: { id: pin.pinnedBy, name: by },
        pinnedAt: pin.pinnedAt.toISOString(),
      }),
    ),
  }
}

export async function publishPins(ctx: Ctx, groupId: string) {
  const dto = await groupPins(ctx, groupId)
  ctx.bus.publish(await memberIds(ctx, groupId), { t: 'group.pins', groupId, ...dto })
}

const eventText = (m: { body: string }) => snippet(m.body) || '[附件]'

export async function pinMessage(
  ctx: Ctx,
  groupId: string,
  messageId: string,
  by: { id: string; name: string },
) {
  const [m] = await ctx.db
    .select()
    .from(messages)
    .where(and(eq(messages.id, messageId), eq(messages.groupId, groupId)))
  if (!m) return fail('not_found', '消息不存在')
  if (m.recalledAt) return fail('conflict', '已撤回的消息不能置顶')
  if (m.kind === 'event') return fail('conflict', '系统事件不能置顶')
  const added = await ctx.db.transaction(async (tx) => {
    // One pin at a time per group, so two members never both take the last slot.
    await tx.execute(sql`select pg_advisory_xact_lock(hashtext(${`pins:${groupId}`}))`)
    const pinned = await tx
      .select({ id: groupPinnedMessages.messageId })
      .from(groupPinnedMessages)
      .where(eq(groupPinnedMessages.groupId, groupId))
    if (pinned.some((p) => p.id === m.id)) return false
    if (pinned.length >= MAX_PINS)
      return fail('conflict', '本群最多置顶 {n} 条消息，请先取消一条', { n: MAX_PINS })
    await tx
      .insert(groupPinnedMessages)
      .values({ groupId, messageId: m.id, pinnedBy: by.id, pinnedAt: ctx.now() })
    return true
  })
  if (!added) return
  await postEvent(ctx, groupId, '{user} 置顶了一条消息：{text}', { user: by.name, text: eventText(m) })
  await publishPins(ctx, groupId)
}

export async function unpinMessage(ctx: Ctx, groupId: string, messageId: string, by: { name: string }) {
  const [gone] = await ctx.db
    .delete(groupPinnedMessages)
    .where(and(eq(groupPinnedMessages.groupId, groupId), eq(groupPinnedMessages.messageId, messageId)))
    .returning()
  if (!gone) return
  const [m] = await ctx.db.select({ body: messages.body }).from(messages).where(eq(messages.id, messageId))
  await postEvent(ctx, groupId, '{user} 取消置顶了一条消息：{text}', {
    user: by.name,
    text: eventText(m ?? { body: '' }),
  })
  await publishPins(ctx, groupId)
}

/** A recalled message is unpinned silently: the recall itself is already in the timeline. */
export async function dropPin(ctx: Ctx, groupId: string, messageId: string) {
  const gone = await ctx.db
    .delete(groupPinnedMessages)
    .where(and(eq(groupPinnedMessages.groupId, groupId), eq(groupPinnedMessages.messageId, messageId)))
    .returning()
  if (gone.length) await publishPins(ctx, groupId)
}
