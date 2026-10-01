import { publicRepoUrl, type RepoDto, repoKey, repoName } from '@gonggong/protocol'
import { and, desc, eq, ilike, inArray, isNull, or, sql } from 'drizzle-orm'
import type { Ctx } from '../../context.js'
import { groupRepos, groups, machineRepos, machines, repos, repoUsers } from '../../db/schema.js'
import { fail } from '../../lib/errors.js'

const SEARCH_LIMIT = 20

/**
 * Remembers a remote repo in the team's history (un-hiding it), who used it and, for /cd directories, where it lives
 * on the machine. Addresses that are not remote git URLs (file://, local paths) are ignored.
 */
export async function recordRepo(
  ctx: Ctx,
  o: {
    url: string
    teamId: string
    branch?: string | null
    userId?: string
    machineId?: string
    path?: string
  },
) {
  const key = repoKey(o.url)
  if (!key) return
  const now = ctx.now()
  const [repo] = await ctx.db
    .insert(repos)
    .values({
      teamId: o.teamId,
      key,
      url: publicRepoUrl(o.url),
      name: repoName(o.url),
      lastBranch: o.branch ?? null,
      lastUsedAt: now,
    })
    .onConflictDoUpdate({
      target: [repos.teamId, repos.key],
      set: {
        url: publicRepoUrl(o.url),
        name: repoName(o.url),
        lastUsedAt: now,
        hiddenAt: null,
        ...(o.branch && { lastBranch: o.branch }),
      },
    })
    .returning({ id: repos.id })
  if (!repo) return
  if (o.userId)
    await ctx.db
      .insert(repoUsers)
      .values({ repoId: repo.id, userId: o.userId, usedAt: now })
      .onConflictDoUpdate({ target: [repoUsers.repoId, repoUsers.userId], set: { usedAt: now } })
  if (o.machineId && o.path)
    await ctx.db
      .insert(machineRepos)
      .values({ machineId: o.machineId, path: o.path, repoId: repo.id, seenAt: now })
      .onConflictDoUpdate({
        target: [machineRepos.machineId, machineRepos.path],
        set: { repoId: repo.id, seenAt: now },
      })
}

/** Group repos bound before the history existed; idempotent, run at startup. */
export async function backfillRepos(ctx: Ctx) {
  const at = (teamId: string, key: string) => `${teamId}\n${key}`
  const known = new Set(
    (await ctx.db.select({ teamId: repos.teamId, key: repos.key }).from(repos)).map((r) =>
      at(r.teamId, r.key),
    ),
  )
  const bound = await ctx.db
    .select({ url: groupRepos.url, branch: groupRepos.baseBranch, teamId: groups.teamId })
    .from(groupRepos)
    .innerJoin(groups, eq(groups.id, groupRepos.groupId))
  for (const r of bound) {
    const key = repoKey(r.url)
    if (!key || known.has(at(r.teamId, key))) continue
    known.add(at(r.teamId, key))
    await ctx.db
      .insert(repos)
      .values({
        teamId: r.teamId,
        key,
        url: publicRepoUrl(r.url),
        name: repoName(r.url),
        lastBranch: r.branch,
      })
      .onConflictDoNothing()
  }
}

/** The team's live groups bound to each repo key. */
async function groupCounts(ctx: Ctx, teamId: string, keys: Set<string>) {
  const rows = await ctx.db
    .select({ url: groupRepos.url })
    .from(groupRepos)
    .innerJoin(groups, eq(groups.id, groupRepos.groupId))
    .where(and(eq(groups.teamId, teamId), isNull(groups.archivedAt)))
  const counts = new Map<string, number>()
  for (const r of rows) {
    const key = repoKey(r.url)
    if (key && keys.has(key)) counts.set(key, (counts.get(key) ?? 0) + 1)
  }
  return counts
}

/** Local directories of these repos on the user's machines. */
export async function localPaths(ctx: Ctx, userId: string, repoIds: string[]) {
  if (!repoIds.length) return []
  return ctx.db
    .select({ repoId: machineRepos.repoId, machineId: machineRepos.machineId, path: machineRepos.path })
    .from(machineRepos)
    .innerJoin(machines, eq(machines.id, machineRepos.machineId))
    .where(
      and(inArray(machineRepos.repoId, repoIds), eq(machines.ownerId, userId), isNull(machines.revokedAt)),
    )
}

/** The caller's local directories holding the group's current repo. */
export async function groupLocalPaths(ctx: Ctx, userId: string, groupId: string) {
  const [bound] = await ctx.db
    .select({ url: groupRepos.url, teamId: groups.teamId })
    .from(groupRepos)
    .innerJoin(groups, eq(groups.id, groupRepos.groupId))
    .where(eq(groupRepos.groupId, groupId))
  const key = bound && repoKey(bound.url)
  if (!key) return []
  const [repo] = await ctx.db
    .select({ id: repos.id })
    .from(repos)
    .where(and(eq(repos.teamId, bound.teamId), eq(repos.key, key)))
  if (!repo) return []
  return (await localPaths(ctx, userId, [repo.id])).map(({ machineId, path }) => ({ machineId, path }))
}

/** The picker: the team's visible repos matching `q` (name / host / path), the caller's recently used first. */
export async function searchRepos(ctx: Ctx, userId: string, teamId: string, q: string): Promise<RepoDto[]> {
  const like = `%${q.trim().replace(/[\\%_]/g, (c) => `\\${c}`)}%`
  const rows = await ctx.db
    .select({ repo: repos, mineAt: repoUsers.usedAt })
    .from(repos)
    .leftJoin(repoUsers, and(eq(repoUsers.repoId, repos.id), eq(repoUsers.userId, userId)))
    .where(
      and(
        eq(repos.teamId, teamId),
        isNull(repos.hiddenAt),
        q.trim() ? or(ilike(repos.key, like), ilike(repos.name, like)) : undefined,
      ),
    )
    .orderBy(sql`${repoUsers.usedAt} desc nulls last`, desc(repos.lastUsedAt))
    .limit(SEARCH_LIMIT)
  const counts = await groupCounts(ctx, teamId, new Set(rows.map((r) => r.repo.key)))
  const paths = await localPaths(
    ctx,
    userId,
    rows.map((r) => r.repo.id),
  )
  return rows.map(({ repo, mineAt }) => ({
    id: repo.id,
    key: repo.key,
    url: repo.url,
    name: repo.name,
    lastBranch: repo.lastBranch,
    lastUsedAt: repo.lastUsedAt.toISOString(),
    groups: counts.get(repo.key) ?? 0,
    mine: mineAt !== null,
    localPaths: paths.filter((p) => p.repoId === repo.id).map(({ machineId, path }) => ({ machineId, path })),
  }))
}

/** Hides a repo of the team from the picker: sysadmins, or the only person who ever used it. */
export async function hideRepo(ctx: Ctx, user: { id: string; role: string }, teamId: string, repoId: string) {
  const [repo] = await ctx.db
    .select({ id: repos.id })
    .from(repos)
    .where(and(eq(repos.id, repoId), eq(repos.teamId, teamId)))
  if (!repo) return fail('not_found', '仓库不存在')
  const users = await ctx.db
    .select({ userId: repoUsers.userId })
    .from(repoUsers)
    .where(eq(repoUsers.repoId, repoId))
  const allowed = user.role === 'sysadmin' || (users.length === 1 && users[0]?.userId === user.id)
  if (!allowed) return false
  await ctx.db.update(repos).set({ hiddenAt: ctx.now() }).where(eq(repos.id, repoId))
  return true
}

/** A (machine, path) turned out not to hold the repo any more. */
export async function forgetLocalPath(ctx: Ctx, machineId: string, path: string) {
  await ctx.db
    .delete(machineRepos)
    .where(and(eq(machineRepos.machineId, machineId), eq(machineRepos.path, path)))
}
