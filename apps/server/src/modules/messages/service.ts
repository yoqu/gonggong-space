import type { Attachment, MessageDto } from '@aiws/protocol'
import { eq } from 'drizzle-orm'
import type { Ctx } from '../../context.js'
import { bots, groupMembers, messages, users } from '../../db/schema.js'

export type MessageRow = typeof messages.$inferSelect
/** `command`: the system command this message invoked (never replayed to agents as context). */
export type MessageMeta = {
  mentions?: string[]
  clientId?: string
  command?: string
  attachments?: Attachment[]
  quote?: MessageDto['quote']
}

export const messageDto = (m: MessageRow, authorName: string): MessageDto => ({
  id: m.id,
  seq: m.seq,
  groupId: m.groupId,
  kind: m.kind as MessageDto['kind'],
  authorId: m.authorUserId ?? m.authorBotId,
  authorName,
  body: m.body,
  mentions: (m.meta as MessageMeta).mentions ?? [],
  runId: m.runId,
  createdAt: m.createdAt.toISOString(),
  attachments: (m.meta as MessageMeta).attachments ?? [],
  quote: (m.meta as MessageMeta).quote ?? null,
})

export async function authorName(ctx: Ctx, m: Pick<MessageRow, 'authorUserId' | 'authorBotId'>) {
  if (m.authorUserId) {
    const [u] = await ctx.db.select({ name: users.name }).from(users).where(eq(users.id, m.authorUserId))
    return u?.name ?? ''
  }
  if (m.authorBotId) {
    const [b] = await ctx.db.select({ name: bots.name }).from(bots).where(eq(bots.id, m.authorBotId))
    return b?.name ?? ''
  }
  return ''
}

export async function memberIds(ctx: Ctx, groupId: string) {
  const rows = await ctx.db
    .select({ userId: groupMembers.userId })
    .from(groupMembers)
    .where(eq(groupMembers.groupId, groupId))
  return rows.map((r) => r.userId)
}

export async function publishMessage(ctx: Ctx, dto: MessageDto) {
  ctx.bus.publish(await memberIds(ctx, dto.groupId), { t: 'message.new', message: dto })
}

/** Stores a message and pushes it to every member. Used for events and bot replies. */
export async function postMessage(ctx: Ctx, values: typeof messages.$inferInsert) {
  const row = (await ctx.db.insert(messages).values(values).returning())[0] as MessageRow
  const dto = messageDto(row, await authorName(ctx, row))
  await publishMessage(ctx, dto)
  return dto
}

export const postEvent = (ctx: Ctx, groupId: string, body: string) =>
  postMessage(ctx, { groupId, kind: 'event', body })
