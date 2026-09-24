import type { ReactionDto, ReactionEmoji } from '@aiws/protocol'
import { asc, eq, inArray } from 'drizzle-orm'
import type { Ctx } from '../../context.js'
import { messageReactions, users } from '../../db/schema.js'

type Row = { messageId: string; userId: string; emoji: string; name: string }

async function rowsFor(ctx: Ctx, messageIds: string[]): Promise<Row[]> {
  if (!messageIds.length) return []
  return ctx.db
    .select({
      messageId: messageReactions.messageId,
      userId: messageReactions.userId,
      emoji: messageReactions.emoji,
      name: users.name,
    })
    .from(messageReactions)
    .innerJoin(users, eq(users.id, messageReactions.userId))
    .where(inArray(messageReactions.messageId, messageIds))
    .orderBy(asc(messageReactions.createdAt))
}

/** Rows of one message (oldest first) → per-emoji aggregate ordered by first reaction. */
function aggregate(rows: Row[], viewerId: string): ReactionDto[] {
  const byEmoji = new Map<string, ReactionDto>()
  for (const r of rows) {
    const agg = byEmoji.get(r.emoji) ?? { emoji: r.emoji as ReactionEmoji, count: 0, mine: false, users: [] }
    agg.count += 1
    agg.mine ||= r.userId === viewerId
    agg.users.push({ id: r.userId, name: r.name })
    byEmoji.set(r.emoji, agg)
  }
  return [...byEmoji.values()]
}

/** Reactions of each message as seen by `viewerId`; messages without any are absent. */
export async function reactionsFor(ctx: Ctx, messageIds: string[], viewerId: string) {
  const byMessage = new Map<string, Row[]>()
  for (const r of await rowsFor(ctx, messageIds))
    byMessage.set(r.messageId, [...(byMessage.get(r.messageId) ?? []), r])
  return new Map([...byMessage].map(([id, rows]) => [id, aggregate(rows, viewerId)]))
}

/** One message's reactions, aggregated per viewer (`mine` differs per viewer). */
export async function reactionsOf(ctx: Ctx, messageId: string) {
  const rows = await rowsFor(ctx, [messageId])
  return (viewerId: string) => aggregate(rows, viewerId)
}
