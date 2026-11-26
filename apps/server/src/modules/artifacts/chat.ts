import { randomUUID } from 'node:crypto'
import { ARTIFACT_BOT_NAMES } from '@gonggong/protocol'
import { and, eq, inArray, isNull, sql } from 'drizzle-orm'
import type { Ctx } from '../../context.js'
import { bots, groupBots, messages } from '../../db/schema.js'
import type { MessageMeta, MessageRow } from '../messages/service.js'
import type { Artifact } from './service.js'

/**
 * The root of the artifact's 画布 AI 对话 (ArtifactChatDto), made on first use: an event that is its own thread reply,
 * so every filter that keeps thread replies out of the group (timeline, unread, Feishu, group context) keeps it out too.
 */
export async function artifactChatRoot(ctx: Ctx, a: Pick<Artifact, 'id' | 'groupId' | 'title'>) {
  return ctx.db.transaction(async (tx) => {
    await tx.execute(sql`select pg_advisory_xact_lock(hashtext(${`artifact-chat:${a.id}`}))`)
    const [found] = await tx
      .select()
      .from(messages)
      .where(
        and(
          eq(messages.groupId, a.groupId),
          eq(messages.kind, 'event'),
          sql`${messages.meta}->>'artifactChat' = ${a.id}`,
        ),
      )
      .limit(1)
    if (found) return found as MessageRow
    const id = randomUUID()
    const [row] = await tx
      .insert(messages)
      .values({
        id,
        groupId: a.groupId,
        kind: 'event',
        // Read by the agent as the start of the conversation.
        body: `画布 AI 对话：产物「${a.title}」`,
        meta: { mentions: [], artifactChat: a.id } satisfies MessageMeta,
        threadRootId: id,
      })
      .returning()
    return row as MessageRow
  })
}

/**
 * `botId` when it is one of the AIs open for works (ARTIFACT_BOT_NAMES) in `group`'s team, made a guest of `group` so it
 * can run in its 画布 AI 对话 without joining it; null for any other bot.
 */
export async function artifactGuestBot(ctx: Ctx, group: { id: string; teamId: string }, botId: string) {
  const [bot] = await ctx.db
    .select({ id: bots.id, name: bots.name, machineId: bots.machineId })
    .from(bots)
    .where(
      and(
        eq(bots.id, botId),
        eq(bots.teamId, group.teamId),
        inArray(bots.name, ARTIFACT_BOT_NAMES),
        isNull(bots.deletedAt),
      ),
    )
  if (!bot) return null
  const [row] = await ctx.db
    .select({ guest: groupBots.guest, removedAt: groupBots.removedAt })
    .from(groupBots)
    .where(and(eq(groupBots.groupId, group.id), eq(groupBots.botId, bot.id)))
  if (row && !row.removedAt) return row.guest ? bot : null
  // 'unbound': its first run takes a managed workspace and says so in the conversation, not in the group.
  const fresh = { guest: true, workspaceState: 'unbound', removedAt: null, addedAt: ctx.now() }
  await ctx.db
    .insert(groupBots)
    .values({ groupId: group.id, botId: bot.id, ...fresh })
    .onConflictDoUpdate({ target: [groupBots.groupId, groupBots.botId], set: fresh })
  return bot
}
