import { ARTIFACT_HISTORY_MAX, type ArtifactHistoryItem, type RunStatus } from '@gonggong/protocol'
import { and, asc, desc, eq, inArray, isNull, ne, or, type SQL, sql } from 'drizzle-orm'
import type { Ctx } from '../../context.js'
import { artifactVersions, bots, messages, runs, users } from '../../db/schema.js'
import type { MessageMeta } from '../messages/service.js'
import type { Artifact } from './service.js'

/**
 * The canvas's 命令记录 (ArtifactHistoryItem): messages that point at the artifact (artifactRefs, quoting its card)
 * or started a run that made a version of it, with those runs and their versions of it.
 */
export async function artifactHistory(ctx: Ctx, a: Artifact): Promise<ArtifactHistoryItem[]> {
  const madeIt = ctx.db
    .select({ id: runs.triggerMessageId })
    .from(artifactVersions)
    .innerJoin(runs, eq(runs.id, artifactVersions.runId))
    .where(eq(artifactVersions.artifactId, a.id))
  const points = [
    sql`${messages.meta} -> 'artifactRefs' @> ${JSON.stringify([a.id])}::jsonb`,
    inArray(messages.id, madeIt),
    a.messageId ? sql`${messages.meta} -> 'quote' ->> 'id' = ${a.messageId}` : undefined,
  ].filter(Boolean) as SQL[]
  const rows = await ctx.db
    .select({
      id: messages.id,
      body: messages.body,
      meta: messages.meta,
      createdAt: messages.createdAt,
      userName: users.name,
      botName: bots.name,
    })
    .from(messages)
    .leftJoin(users, eq(users.id, messages.authorUserId))
    .leftJoin(bots, eq(bots.id, messages.authorBotId))
    .where(
      and(
        eq(messages.groupId, a.groupId),
        ne(messages.kind, 'event'),
        isNull(messages.recalledAt),
        or(...points),
      ),
    )
    .orderBy(desc(messages.seq))
    .limit(ARTIFACT_HISTORY_MAX)
  if (!rows.length) return []

  const runRows = await ctx.db
    .select({
      id: runs.id,
      triggerMessageId: runs.triggerMessageId,
      botName: bots.name,
      status: runs.status,
      summary: runs.summary,
      startedAt: runs.startedAt,
      endedAt: runs.endedAt,
    })
    .from(runs)
    .innerJoin(bots, eq(bots.id, runs.botId))
    .where(
      inArray(
        runs.triggerMessageId,
        rows.map((r) => r.id),
      ),
    )
    .orderBy(asc(runs.queuedAt))
  const versions = runRows.length
    ? await ctx.db
        .select({
          id: artifactVersions.id,
          n: artifactVersions.n,
          stale: artifactVersions.stale,
          runId: artifactVersions.runId,
        })
        .from(artifactVersions)
        .where(
          and(
            eq(artifactVersions.artifactId, a.id),
            inArray(
              artifactVersions.runId,
              runRows.map((r) => r.id),
            ),
          ),
        )
        .orderBy(asc(artifactVersions.n))
    : []

  return rows.map((m) => ({
    messageId: m.id,
    authorName: m.userName ?? m.botName ?? '',
    body: m.body,
    createdAt: m.createdAt.toISOString(),
    screens: ((m.meta as MessageMeta).canvas?.screens ?? []).map(({ id, title }) => ({ id, title })),
    runs: runRows
      .filter((r) => r.triggerMessageId === m.id)
      .map((r) => ({
        id: r.id,
        botName: r.botName,
        status: r.status as RunStatus,
        summary: r.summary,
        startedAt: r.startedAt?.toISOString() ?? null,
        endedAt: r.endedAt?.toISOString() ?? null,
        versions: versions
          .filter((v) => v.runId === r.id)
          .map((v) => ({ id: v.id, n: v.n, candidate: v.stale })),
      })),
  }))
}
