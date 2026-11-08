import { mentionedMembers } from '@gonggong/protocol'
import { and, eq, inArray, ne } from 'drizzle-orm'
import type { Ctx } from '../../context.js'
import { groupMembers, runs, threadFollows, users } from '../../db/schema.js'
import { activeBots } from '../groups/service.js'
import { notify } from '../notifications/notify.js'
import type { MessageMeta, MessageRow } from './service.js'

/**
 * Members a message body @s; a bot reply's code is quoted text, not an address. `bots`: the group's active bots,
 * when the caller loads them anyway.
 */
export async function memberMentions(
  ctx: Ctx,
  groupId: string,
  body: string,
  { bots, ...o }: { skipCode?: boolean; bots?: Promise<{ id: string; name: string }[]> } = {},
) {
  const [members, inGroup] = await Promise.all([
    ctx.db
      .select({ id: users.id, name: users.name })
      .from(groupMembers)
      .innerJoin(users, eq(users.id, groupMembers.userId))
      .where(eq(groupMembers.groupId, groupId)),
    bots ?? activeBots(ctx, groupId),
  ])
  return mentionedMembers(body, members, inGroup, o)
}

const CODE = /```[\s\S]*?(?:```|$)|`[^`\n]*`/g

/** The body @s 所有人 outside code (an e-mail-like `a@所有人` does not count). */
export const mentionsAll = (body: string) => /(^|[^A-Za-z0-9._%+-])@所有人/.test(body.replace(CODE, ' '))

/** @所有人: every member of the group but the author. */
export async function everyoneBut(ctx: Ctx, groupId: string, authorId: string) {
  const rows = await ctx.db
    .select({ id: groupMembers.userId })
    .from(groupMembers)
    .where(and(eq(groupMembers.groupId, groupId), ne(groupMembers.userId, authorId)))
    .orderBy(groupMembers.joinedAt)
  return rows.map((r) => r.id)
}

/** A bot's reply in a thread is addressed to the follower who started its run, as if it @-ed them. */
export async function botReplyAddressee(ctx: Ctx, m: MessageRow) {
  if (m.kind !== 'bot' || !m.threadRootId || !m.runId) return undefined
  const [row] = await ctx.db
    .select({ id: threadFollows.userId })
    .from(runs)
    .innerJoin(
      threadFollows,
      and(
        eq(threadFollows.userId, runs.triggerUserId),
        eq(threadFollows.rootMessageId, m.threadRootId),
        eq(threadFollows.following, true),
      ),
    )
    .where(eq(runs.id, m.runId))
  return row?.id
}

/** 被 @: a notification per mentioned member other than the author, unless they turned the group's 通知 off. */
export async function notifyMentions(ctx: Ctx, m: MessageRow, byName: string) {
  const text = m.body.replace(/\s+/g, ' ').trim().slice(0, 80)
  const asker = await botReplyAddressee(ctx, m)
  const ids = [
    ...new Set([...((m.meta as MessageMeta).userMentions ?? []), ...(asker ? [asker] : [])]),
  ].filter((id) => id !== m.authorUserId)
  if (!ids.length) return
  const off = new Set(
    (
      await ctx.db
        .select({ id: groupMembers.userId })
        .from(groupMembers)
        .where(
          and(
            eq(groupMembers.groupId, m.groupId),
            inArray(groupMembers.userId, ids),
            eq(groupMembers.notifyLevel, 'off'),
          ),
        )
    ).map((r) => r.id),
  )
  for (const userId of ids)
    if (!off.has(userId))
      await notify(ctx, userId, 'mention', {
        groupId: m.groupId,
        messageId: m.id,
        ...(m.threadRootId && { threadRootId: m.threadRootId }),
        byName,
        text,
        ...(userId === asker &&
          !(m.meta as MessageMeta).userMentions?.includes(userId) && { botReply: true }),
      })
}
