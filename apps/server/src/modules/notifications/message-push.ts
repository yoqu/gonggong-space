import { and, eq, ne, sql } from 'drizzle-orm'
import type { Ctx } from '../../context.js'
import { groupMembers, threadFollows } from '../../db/schema.js'
import { groupTitles } from '../groups/title.js'
import { botReplyAddressee } from '../messages/mentions.js'
import type { MessageMeta, MessageRow } from '../messages/service.js'
import { sendMessagePush } from './push.js'

/**
 * 通知「全部」: a new main-timeline message is pushed to the members who want everything; nothing is stored. Members it
 * @s already got their 被 @ notification. A thread reply not also sent to the group goes to the thread's followers.
 */
export async function pushToAll(ctx: Ctx, m: MessageRow, byName: string) {
  const meta = m.meta as MessageMeta
  if (m.kind === 'event') return
  const inThread = m.threadRootId && !meta.alsoSent
  const asker = await botReplyAddressee(ctx, m)
  const mentioned = new Set([...(meta.userMentions ?? []), ...(asker ? [asker] : [])])
  const rows = await ctx.db
    .select({ id: groupMembers.userId })
    .from(groupMembers)
    .where(
      and(
        eq(groupMembers.groupId, m.groupId),
        eq(groupMembers.notifyLevel, 'all'),
        inThread
          ? sql`exists (select 1 from ${threadFollows} f where f.root_message_id = ${m.threadRootId} and f.user_id = ${groupMembers.userId} and f.following)`
          : undefined,
        m.authorUserId ? ne(groupMembers.userId, m.authorUserId) : undefined,
      ),
    )
  const to = rows.map((r) => r.id).filter((id) => !mentioned.has(id))
  if (!to.length) return
  const title = (await groupTitles(ctx, [m.groupId])).get(m.groupId) ?? ''
  const text = m.body.replace(/\s+/g, ' ').trim().slice(0, 120)
  const push = {
    title,
    body: `${byName}：${text}`,
    url: inThread ? `/g/${m.groupId}?thread=${m.threadRootId}` : `/g/${m.groupId}`,
    tag: `message:${m.id}`,
  }
  for (const id of to)
    void sendMessagePush(ctx, id, m.groupId, push).catch((e) => console.warn('web push failed:', e))
}
