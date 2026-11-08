import { and, eq, ne } from 'drizzle-orm'
import type { Ctx } from '../../context.js'
import { groupMembers } from '../../db/schema.js'
import { groupTitles } from '../groups/title.js'
import type { MessageMeta, MessageRow } from '../messages/service.js'
import { sendMessagePush } from './push.js'

/**
 * 通知「全部」: a new main-timeline message is pushed to the members who want everything; nothing is stored. Members it
 * @s already got their 被 @ notification.
 */
export async function pushToAll(ctx: Ctx, m: MessageRow, byName: string) {
  const meta = m.meta as MessageMeta
  if (m.kind === 'event' || (m.threadRootId && !meta.alsoSent)) return
  const mentioned = new Set(meta.userMentions ?? [])
  const rows = await ctx.db
    .select({ id: groupMembers.userId })
    .from(groupMembers)
    .where(
      and(
        eq(groupMembers.groupId, m.groupId),
        eq(groupMembers.notifyLevel, 'all'),
        m.authorUserId ? ne(groupMembers.userId, m.authorUserId) : undefined,
      ),
    )
  const to = rows.map((r) => r.id).filter((id) => !mentioned.has(id))
  if (!to.length) return
  const title = (await groupTitles(ctx, [m.groupId])).get(m.groupId) ?? ''
  const text = m.body.replace(/\s+/g, ' ').trim().slice(0, 120)
  const push = { title, body: `${byName}：${text}`, url: `/g/${m.groupId}`, tag: `message:${m.id}` }
  for (const id of to)
    void sendMessagePush(ctx, id, m.groupId, push).catch((e) => console.warn('web push failed:', e))
}
