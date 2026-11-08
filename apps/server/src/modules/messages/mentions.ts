import { mentionedMembers } from '@gonggong/protocol'
import { eq } from 'drizzle-orm'
import type { Ctx } from '../../context.js'
import { groupMembers, users } from '../../db/schema.js'
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

/** 被 @: a notification per mentioned member other than the author. */
export async function notifyMentions(ctx: Ctx, m: MessageRow, byName: string) {
  const text = m.body.replace(/\s+/g, ' ').trim().slice(0, 80)
  for (const userId of (m.meta as MessageMeta).userMentions ?? [])
    if (userId !== m.authorUserId)
      await notify(ctx, userId, 'mention', {
        groupId: m.groupId,
        messageId: m.id,
        ...(m.threadRootId && { threadRootId: m.threadRootId }),
        byName,
        text,
      })
}
