import { randomUUID } from 'node:crypto'
import { and, eq, sql } from 'drizzle-orm'
import type { Ctx } from '../../context.js'
import { messages } from '../../db/schema.js'
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
