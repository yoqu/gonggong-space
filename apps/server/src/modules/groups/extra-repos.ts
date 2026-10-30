import { publicRepoUrl, RepoBranchReq, RepoReq, repoKey } from '@gonggong/protocol'
import { and, eq, isNull } from 'drizzle-orm'
import type { FastifyInstance } from 'fastify'
import type { Ctx } from '../../context.js'
import { groupBots, groupRepos } from '../../db/schema.js'
import { audit } from '../../lib/audit.js'
import { fail } from '../../lib/errors.js'
import { idParam } from '../../lib/ids.js'
import { requireUser } from '../auth/session.js'
import { postEvent } from '../messages/service.js'
import { recordRepo } from '../repos/service.js'
import { ensureWorkspace } from '../workspaces/provision.js'
import { RESET_SESSION } from '../workspaces/state.js'
import { assertBindable } from './create.js'
import { activeBots, groupDto, publishGroup, requireAdmin } from './service.js'

/**
 * Extra repos of a partition group (spec: 一群多仓库 phase 1): cloned beside the main repo and added to every bot's
 * session. A change starts new sessions and clones what is missing; a branch change replaces the repo (a new id is a
 * new clone, as with the main repo).
 */
export function extraRepoRoutes(ctx: Ctx) {
  const reposOf = (groupId: string) => ctx.db.select().from(groupRepos).where(eq(groupRepos.groupId, groupId))

  /** Everything the bots work with changed: new sessions, and managed workspaces clone the new repos. */
  async function changed(groupId: string) {
    const rows = await ctx.db
      .update(groupBots)
      .set({ ...RESET_SESSION, newSessionReason: 'config_changed' })
      .where(and(eq(groupBots.groupId, groupId), isNull(groupBots.removedAt)))
      .returning({ botId: groupBots.botId, kind: groupBots.workspaceKind, state: groupBots.workspaceState })
    const managed = new Set(
      rows
        .filter((r) => r.kind === 'managed' && !['unbound', 'confirm'].includes(r.state))
        .map((r) => r.botId),
    )
    for (const bot of await activeBots(ctx, groupId))
      if (managed.has(bot.id)) await ensureWorkspace(ctx, groupId, bot)
    await publishGroup(ctx, groupId)
  }

  /** An admin of a partition group with a main repo, adding `url` that is not in the group yet. */
  async function checkAdd(groupId: string, userId: string, url: string, branch: string, replacing?: string) {
    const { group } = await requireAdmin(ctx, groupId, userId)
    if (group.mode === 'force') fail('conflict', '强制同步群不支持附加仓库，请先切回分区模式')
    const rows = await reposOf(group.id)
    if (!rows.some((r) => r.isPrimary)) fail('conflict', '请先绑定主仓库')
    assertBindable(ctx, url, branch)
    const key = repoKey(url)
    if (rows.some((r) => r.id !== replacing && repoKey(r.url) === key)) fail('conflict', '该仓库已在本群')
    return group
  }

  return async (app: FastifyInstance) => {
    app.post<{ Params: { id: string } }>('/api/groups/:id/repos', async (req) => {
      const me = await requireUser(ctx, req)
      const body = RepoReq.parse(req.body)
      const [url, branch] = [body.url.trim(), body.branch.trim()]
      const group = await checkAdd(req.params.id, me.id, url, branch)
      await ctx.db.insert(groupRepos).values({ groupId: group.id, url, baseBranch: branch, isPrimary: false })
      await recordRepo(ctx, { url, branch, teamId: group.teamId, userId: me.id })
      await postEvent(ctx, group.id, '{user} 添加了附加仓库 {url} · 默认分支 {branch}', {
        user: me.name,
        url: publicRepoUrl(url),
        branch,
      })
      await audit(ctx, {
        category: 'admin',
        actorUserId: me.id,
        groupId: group.id,
        action: 'group.repo.extra.add',
        detail: { url: publicRepoUrl(url), branch },
      })
      await changed(group.id)
      return groupDto(ctx, me.id, group.id)
    })

    app.patch<{ Params: { id: string; repoId: string } }>('/api/groups/:id/repos/:repoId', async (req) => {
      const me = await requireUser(ctx, req)
      const { branch } = RepoBranchReq.parse(req.body)
      const repoId = idParam(req.params.repoId, '附加仓库不存在')
      const { group: g } = await requireAdmin(ctx, req.params.id, me.id)
      const [old] = (await reposOf(g.id)).filter((r) => r.id === repoId && !r.isPrimary)
      if (!old) return fail('not_found', '附加仓库不存在')
      const group = await checkAdd(g.id, me.id, old.url, branch.trim(), old.id)
      if (old.baseBranch === branch.trim()) return groupDto(ctx, me.id, group.id)
      await ctx.db.transaction(async (tx) => {
        await tx.delete(groupRepos).where(eq(groupRepos.id, old.id))
        await tx
          .insert(groupRepos)
          .values({ groupId: group.id, url: old.url, baseBranch: branch.trim(), isPrimary: false })
      })
      await postEvent(ctx, group.id, '{user} 将附加仓库 {url} 的默认分支改为 {branch}', {
        user: me.name,
        url: publicRepoUrl(old.url),
        branch: branch.trim(),
      })
      await changed(group.id)
      return groupDto(ctx, me.id, group.id)
    })

    // Its clones stay on the machines, like a main repo's after a change.
    app.delete<{ Params: { id: string; repoId: string } }>('/api/groups/:id/repos/:repoId', async (req) => {
      const me = await requireUser(ctx, req)
      const { group } = await requireAdmin(ctx, req.params.id, me.id)
      const [old] = await ctx.db
        .delete(groupRepos)
        .where(
          and(
            eq(groupRepos.groupId, group.id),
            eq(groupRepos.id, idParam(req.params.repoId, '附加仓库不存在')),
            eq(groupRepos.isPrimary, false),
          ),
        )
        .returning()
      if (!old) return fail('not_found', '附加仓库不存在')
      await postEvent(ctx, group.id, '{user} 移除了附加仓库 {url}', {
        user: me.name,
        url: publicRepoUrl(old.url),
      })
      await audit(ctx, {
        category: 'admin',
        actorUserId: me.id,
        groupId: group.id,
        action: 'group.repo.extra.remove',
        detail: { url: publicRepoUrl(old.url) },
      })
      await changed(group.id)
      return groupDto(ctx, me.id, group.id)
    })
  }
}
