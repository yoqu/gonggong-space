import { SearchQuery, type SearchResultDto } from '@aiws/protocol'
import { and, desc, eq, exists, ilike, inArray, isNull, or, sql } from 'drizzle-orm'
import { alias } from 'drizzle-orm/pg-core'
import type { FastifyInstance } from 'fastify'
import type { Ctx } from '../../context.js'
import { bots, groupMembers, groups, messages, runEvents, runs, users } from '../../db/schema.js'
import { requireUser } from '../auth/session.js'

const LIMIT = 20
/** Recent patches scanned for file paths; enough to fill a page of distinct files. */
const PATCH_SCAN = 100
const EXPIRED = '运行过程已过期，仅保留卡片摘要'

const likePattern = (q: string) => `%${q.replace(/[\\%_]/g, '\\$&')}%`

/** One line around the first match, so long messages still show why they matched. */
function snippet(body: string, q: string) {
  const line = body.replace(/\s+/g, ' ').trim()
  const at = line.toLowerCase().indexOf(q.toLowerCase())
  return at > 40 ? `…${line.slice(at - 20, at + 100)}` : line.slice(0, 120)
}

const patchPaths = (patch: string) =>
  [...patch.matchAll(/^diff --git a\/.+? b\/(?<path>.+)$/gm)].map((m) => m.groups?.path ?? '')

export function searchRoutes(ctx: Ctx) {
  const myGroups = (userId: string) =>
    ctx.db
      .select({ id: groupMembers.groupId })
      .from(groupMembers)
      .innerJoin(groups, eq(groups.id, groupMembers.groupId))
      .where(and(eq(groupMembers.userId, userId), isNull(groups.archivedAt)))

  async function searchMessages(userId: string, q: string): Promise<SearchResultDto[]> {
    const rows = await ctx.db
      .select({ m: messages, author: users.name, bot: bots.name, group: groups.name })
      .from(messages)
      .innerJoin(groups, eq(groups.id, messages.groupId))
      .leftJoin(users, eq(users.id, messages.authorUserId))
      .leftJoin(bots, eq(bots.id, messages.authorBotId))
      .where(
        and(
          inArray(messages.groupId, myGroups(userId)),
          inArray(messages.kind, ['user', 'bot']),
          ilike(messages.body, likePattern(q)),
        ),
      )
      .orderBy(desc(messages.seq))
      .limit(LIMIT)
    return rows.map(({ m, author, bot, group }) => ({
      kind: 'msg',
      title: snippet(m.body, q),
      sub: `${bot ? `${bot} 最终回复` : (author ?? '')} · ${group}`,
      groupId: m.groupId,
      messageId: m.id,
      runId: m.runId,
    }))
  }

  /** Files touched by recent turns, read from their patch headers (purged with the run process). */
  async function searchFiles(userId: string, q: string): Promise<SearchResultDto[]> {
    const rows = await ctx.db
      .select({ id: runs.id, groupId: runs.groupId, patch: runs.patch, bot: bots.name, group: groups.name })
      .from(runs)
      .innerJoin(bots, eq(bots.id, runs.botId))
      .innerJoin(groups, eq(groups.id, runs.groupId))
      .where(and(inArray(runs.groupId, myGroups(userId)), ilike(runs.patch, likePattern(q))))
      .orderBy(desc(runs.queuedAt))
      .limit(PATCH_SCAN)
    const out = new Map<string, SearchResultDto>()
    const needle = q.toLowerCase()
    for (const r of rows)
      for (const path of patchPaths(r.patch ?? ''))
        if (path.toLowerCase().includes(needle) && !out.has(`${r.groupId}\n${path}`))
          out.set(`${r.groupId}\n${path}`, {
            kind: 'file',
            title: path,
            sub: `${r.bot} 工作区 · ${r.group}`,
            groupId: r.groupId,
            messageId: null,
            runId: r.id,
          })
    return [...out.values()].slice(0, LIMIT)
  }

  /** Runs by their card (bot, step, summary, reply); the process only while it is retained (plan D9). */
  async function searchRuns(userId: string, q: string): Promise<SearchResultDto[]> {
    const p = likePattern(q)
    const trigger = alias(messages, 'trigger')
    const reply = alias(messages, 'reply')
    const rows = await ctx.db
      .select({ r: runs, bot: bots.name, group: groups.name, task: trigger.body })
      .from(runs)
      .innerJoin(bots, eq(bots.id, runs.botId))
      .innerJoin(groups, eq(groups.id, runs.groupId))
      .innerJoin(trigger, eq(trigger.id, runs.triggerMessageId))
      .where(
        and(
          inArray(runs.groupId, myGroups(userId)),
          or(
            ilike(bots.name, p),
            ilike(runs.step, p),
            ilike(runs.summary, p),
            exists(
              ctx.db
                .select({ one: sql`1` })
                .from(reply)
                .where(and(eq(reply.runId, runs.id), eq(reply.kind, 'bot'), ilike(reply.body, p))),
            ),
            and(
              isNull(runs.purgedAt),
              exists(
                ctx.db
                  .select({ one: sql`1` })
                  .from(runEvents)
                  .where(and(eq(runEvents.runId, runs.id), sql`${runEvents.payload}::text ilike ${p}`)),
              ),
            ),
          ),
        ),
      )
      .orderBy(desc(runs.queuedAt))
      .limit(LIMIT)
    return rows.map(({ r, bot, group, task }) => ({
      kind: 'run',
      title: `${bot} · ${snippet(task.replaceAll(`@${bot}`, ''), '')}`,
      sub: [
        group,
        r.step || null,
        r.filesChanged ? `改动 ${r.filesChanged} 文件` : null,
        r.purgedAt ? EXPIRED : null,
      ]
        .filter(Boolean)
        .join(' · '),
      groupId: r.groupId,
      messageId: null,
      runId: r.id,
    }))
  }

  const SEARCH = { msg: searchMessages, file: searchFiles, run: searchRuns }

  return async (app: FastifyInstance) => {
    app.get('/api/search', async (req): Promise<SearchResultDto[]> => {
      const user = await requireUser(ctx, req)
      const { q, tab } = SearchQuery.parse(req.query)
      return q.trim() ? SEARCH[tab](user.id, q.trim()) : []
    })
  }
}
