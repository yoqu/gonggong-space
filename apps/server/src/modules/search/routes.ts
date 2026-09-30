import { SearchQuery, type SearchResultDto } from '@gonggong/protocol'
import { and, desc, eq, exists, ilike, inArray, isNotNull, isNull, or, sql } from 'drizzle-orm'
import { alias } from 'drizzle-orm/pg-core'
import type { FastifyInstance } from 'fastify'
import type { Ctx } from '../../context.js'
import { bots, groupMembers, groupRepos, groups, messages, runEvents, runs, users } from '../../db/schema.js'
import { open } from '../../lib/seal.js'
import { likePattern, patchPaths, snippet } from '../../lib/text.js'
import { requireUser } from '../auth/session.js'
import { pick } from '../candidates/match.js'
import type { Mirrors } from '../candidates/mirror.js'
import { groupTitle } from '../groups/title.js'
import { notHiddenBy } from '../messages/recall.js'

const LIMIT = 20
/** Recent patches scanned for file paths (decrypted in memory; they are sealed at rest). */
const PATCH_SCAN = 100
const EXPIRED = '运行过程已过期，仅保留卡片摘要'
/** Runs whose changed paths are kept in memory. */
const PATHS_CACHED = 5000

export function searchRoutes(ctx: Ctx, mirrors: Mirrors) {
  // A run's patch is fixed once it ended: its sealed patch is opened for paths once, not on every search.
  const paths = new Map<string, string[]>()
  const pathsOf = (runId: string, patch: string) => {
    let hit = paths.get(runId)
    if (!hit) {
      hit = patchPaths(open(patch))
      if (paths.size >= PATHS_CACHED) paths.delete(paths.keys().next().value as string)
      paths.set(runId, hit)
    }
    return hit
  }

  const myGroups = (userId: string) =>
    ctx.db
      .select({ id: groupMembers.groupId })
      .from(groupMembers)
      .innerJoin(groups, eq(groups.id, groupMembers.groupId))
      .where(and(eq(groupMembers.userId, userId), isNull(groups.archivedAt)))

  async function searchMessages(userId: string, q: string): Promise<SearchResultDto[]> {
    const rows = await ctx.db
      .select({ m: messages, author: users.name, bot: bots.name, group: groupTitle })
      .from(messages)
      .innerJoin(groups, eq(groups.id, messages.groupId))
      .leftJoin(users, eq(users.id, messages.authorUserId))
      .leftJoin(bots, eq(bots.id, messages.authorBotId))
      .where(
        and(
          inArray(messages.groupId, myGroups(userId)),
          inArray(messages.kind, ['user', 'bot']),
          ilike(messages.body, likePattern(q)),
          notHiddenBy(ctx, userId),
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
      at: m.createdAt.toISOString(),
    }))
  }

  /** Files changed by recent turns (from their patch headers), then base-branch files from the group mirrors. */
  async function searchFiles(userId: string, q: string): Promise<SearchResultDto[]> {
    const out = new Map<string, SearchResultDto>()
    const add = (r: SearchResultDto) => {
      const key = `${r.groupId}\n${r.title}`
      if (!out.has(key)) out.set(key, r)
    }
    const changed = await ctx.db
      .select({
        id: runs.id,
        groupId: runs.groupId,
        patch: runs.patch,
        queuedAt: runs.queuedAt,
        bot: bots.name,
        group: groupTitle,
      })
      .from(runs)
      .innerJoin(bots, eq(bots.id, runs.botId))
      .innerJoin(groups, eq(groups.id, runs.groupId))
      .where(and(inArray(runs.groupId, myGroups(userId)), isNotNull(runs.patch)))
      .orderBy(desc(runs.queuedAt))
      .limit(PATCH_SCAN)
    const needle = q.toLowerCase()
    for (const r of changed)
      for (const path of pathsOf(r.id, r.patch ?? ''))
        if (path.toLowerCase().includes(needle))
          add({
            kind: 'file',
            title: path,
            sub: `${r.bot} 工作区 · ${r.group}`,
            groupId: r.groupId,
            messageId: null,
            runId: r.id,
            at: r.queuedAt.toISOString(),
          })

    const repos = await ctx.db
      .select({
        id: groupRepos.id,
        url: groupRepos.url,
        branch: groupRepos.baseBranch,
        groupId: groupRepos.groupId,
        group: groupTitle,
      })
      .from(groupRepos)
      .innerJoin(groups, eq(groups.id, groupRepos.groupId))
      .where(inArray(groupRepos.groupId, myGroups(userId)))
    for (const repo of repos)
      for (const e of pick(
        mirrors.peek(repo).filter((f) => !f.dir && f.path.toLowerCase().includes(needle)),
        q,
        LIMIT,
      ))
        add({
          kind: 'file',
          title: e.path,
          sub: `${repo.branch} 镜像 · ${repo.group}`,
          groupId: repo.groupId,
          messageId: null,
          runId: null,
          at: null,
        })
    return [...out.values()].slice(0, LIMIT)
  }

  /** Runs by their card (bot, step, summary, reply); the process (tool titles and steps; its free text is sealed)
   * only while it is retained (plan D9). */
  async function searchRuns(userId: string, q: string): Promise<SearchResultDto[]> {
    const p = likePattern(q)
    const trigger = alias(messages, 'trigger')
    const reply = alias(messages, 'reply')
    const rows = await ctx.db
      .select({ r: runs, bot: bots.name, group: groupTitle, task: trigger.body })
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
                  .where(
                    and(
                      eq(runEvents.runId, runs.id),
                      or(
                        sql`${runEvents.payload}->>'title' ilike ${p}`,
                        sql`${runEvents.payload}->>'step' ilike ${p}`,
                      ),
                    ),
                  ),
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
      at: r.queuedAt.toISOString(),
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
