import type {
  InstallDto,
  InstallReq,
  ListingStatus,
  ListingSummary,
  ListingType,
  PluginManifest,
  SkillFile,
  SkillListingManifest,
} from '@gonggong/protocol'
import { and, asc, eq, inArray, isNull, ne, notInArray, or, type SQL } from 'drizzle-orm'
import { alias } from 'drizzle-orm/pg-core'
import type { Ctx } from '../../context.js'
import type { Db } from '../../db/client.js'
import {
  bots,
  groupBots,
  groups,
  installs,
  plugins,
  pluginVersions,
  repos,
  skills,
  users,
} from '../../db/schema.js'
import { audit } from '../../lib/audit.js'
import { fail } from '../../lib/errors.js'
import { idParam } from '../../lib/ids.js'
import type { Layer } from '../mcp/service.js'
import { groupRepoIds } from '../repos/service.js'

type Read = Pick<Db, 'select'>
type ListingRow = typeof plugins.$inferSelect
type Version = { id: string; revision: number; manifest: PluginManifest | SkillListingManifest }
type GroupInstall = {
  layer: string
  scopeId: string
  listingId: string
  name: string
  enabled: boolean
  version: { id: string; revision: number; manifest: PluginManifest; digest: string; size: number }
}

/** Where installs go; `teamId` / `groupId` decide which listings it may install. */
export type Target = {
  scope: 'group' | 'repo' | 'team'
  scopeId: string
  teamId: string
  groupId: string | null
}

const current = alias(pluginVersions, 'current')
const resolved = alias(pluginVersions, 'resolved')
const versionOf = (v: typeof current | typeof resolved) => ({
  id: v.id,
  revision: v.revision,
  manifest: v.manifest,
  digest: v.digest,
  size: v.size,
})

export const listingSummary = (listing: ListingRow, v: Version): ListingSummary => ({
  id: listing.id,
  type: listing.type as ListingType,
  name: listing.name,
  title: 'title' in v.manifest ? v.manifest.title : listing.name,
  description: v.manifest.description,
  layer: listing.scope as ListingSummary['layer'],
  status: listing.status as ListingStatus,
  versionId: v.id,
  revision: v.revision,
})

const inScope = (t: Pick<Target, 'scope' | 'scopeId'>) =>
  and(eq(installs.scope, t.scope), eq(installs.scopeId, t.scopeId))

/** Platform listings, the target's team's, other teams' public ones and, for a group, the group's own. */
const visibleTo = (t: Target) =>
  or(
    eq(plugins.scope, 'platform'),
    and(eq(plugins.scope, 'team'), or(eq(plugins.teamId, t.teamId), eq(plugins.visibility, 'public'))),
    t.groupId ? and(eq(plugins.scope, 'group'), eq(plugins.groupId, t.groupId)) : undefined,
  )

/** Moves the listing's latest approved version to `versionId`, and the installs following it along. */
export async function listVersion(tx: Pick<Db, 'update'>, listingId: string, versionId: string) {
  await tx.update(plugins).set({ listedVersionId: versionId }).where(eq(plugins.id, listingId))
  await tx
    .update(installs)
    .set({ resolvedVersionId: versionId })
    .where(and(eq(installs.listingId, listingId), isNull(installs.pinVersionId)))
}

export async function listInstalls(db: Read, t: Target, where?: SQL) {
  const rows = await db
    .select({
      install: installs,
      listing: plugins,
      current: versionOf(current),
      resolvedRevision: resolved.revision,
      updatedBy: users.name,
    })
    .from(installs)
    .innerJoin(plugins, eq(plugins.id, installs.listingId))
    .innerJoin(current, eq(current.id, plugins.listedVersionId))
    .innerJoin(resolved, eq(resolved.id, installs.resolvedVersionId))
    .leftJoin(users, eq(users.id, installs.updatedBy))
    .where(and(inScope(t), where))
    .orderBy(asc(plugins.name))
  return rows.map(
    (r): InstallDto => ({
      listing: listingSummary(r.listing, r.current),
      scope: t.scope,
      enabled: r.install.enabled,
      pinVersionId: r.install.pinVersionId,
      resolvedVersionId: r.install.resolvedVersionId,
      resolvedRevision: r.resolvedRevision,
      updatedBy: r.updatedBy,
      updatedAt: r.install.updatedAt.toISOString(),
    }),
  )
}

export async function installable(db: Read, t: Target) {
  const rows = await db
    .select({ listing: plugins, current: versionOf(current) })
    .from(plugins)
    .innerJoin(current, eq(current.id, plugins.listedVersionId))
    .where(
      and(
        visibleTo(t),
        eq(plugins.status, 'listed'),
        notInArray(plugins.id, db.select({ id: installs.listingId }).from(installs).where(inScope(t))),
      ),
    )
    .orderBy(asc(plugins.name))
  return rows.map((r) => listingSummary(r.listing, r.current))
}

/** Same-layer names must be unique: another skill install of the scope, or the layer's own skill. */
async function skillNameFree(db: Read, t: Target, name: string, listingId: string) {
  const [installed] = await db
    .select({ id: installs.id })
    .from(installs)
    .innerJoin(plugins, eq(plugins.id, installs.listingId))
    .where(and(inScope(t), eq(plugins.type, 'skill'), eq(plugins.name, name), ne(plugins.id, listingId)))
  const [own] =
    t.scope === 'repo'
      ? []
      : await db
          .select({ id: skills.id })
          .from(skills)
          .where(
            and(
              eq(skills.scope, t.scope),
              eq(skills.teamId, t.teamId),
              t.scope === 'group' ? eq(skills.groupId, t.groupId!) : isNull(skills.groupId),
              eq(skills.name, name),
            ),
          )
  if (installed || own) fail('conflict', '同名 Skill 已存在')
}

/** Whether a group or team layer has a skill listing called `name` installed (its own skills may not take it). */
export async function skillInstalled(db: Read, l: Layer, name: string) {
  if (l.scope === 'platform') return false
  const scopeId = l.scope === 'group' ? l.groupId! : l.teamId!
  const [row] = await db
    .select({ id: installs.id })
    .from(installs)
    .innerJoin(plugins, eq(plugins.id, installs.listingId))
    .where(and(inScope({ scope: l.scope, scopeId }), eq(plugins.type, 'skill'), eq(plugins.name, name)))
  return !!row
}

const log = (ctx: Ctx, actorId: string, t: Target, action: string, detail: Record<string, unknown>) =>
  audit(ctx, {
    category: 'admin',
    actorUserId: actorId,
    teamId: t.teamId,
    groupId: t.groupId,
    action,
    detail: { scope: t.scope, scopeId: t.scopeId, ...detail },
  })

/** Installs or updates; only listed listings can be newly installed. Null pin = follow the latest approved version. */
export async function putInstall(ctx: Ctx, t: Target, listingId: string, req: InstallReq, actorId: string) {
  const [listing] = await ctx.db
    .select()
    .from(plugins)
    .where(and(eq(plugins.id, idParam(listingId, '条目不存在')), visibleTo(t)))
  if (!listing?.listedVersionId) return fail('not_found', '条目不存在')
  const [existing] = await ctx.db
    .select({ id: installs.id })
    .from(installs)
    .where(and(eq(installs.listingId, listing.id), inScope(t)))
  if (!existing && listing.status !== 'listed') fail('conflict', '条目已下架，不能引入')
  const pin = req.pinVersionId && idParam(req.pinVersionId, '版本不存在')
  if (pin) {
    const [v] = await ctx.db
      .select({ id: pluginVersions.id })
      .from(pluginVersions)
      .where(
        and(
          eq(pluginVersions.id, pin),
          eq(pluginVersions.pluginId, listing.id),
          eq(pluginVersions.reviewStatus, 'approved'),
        ),
      )
    if (!v) fail('not_found', '版本不存在')
  }
  if (listing.type === 'skill') await skillNameFree(ctx.db, t, listing.name, listing.id)
  const set = {
    enabled: req.enabled,
    pinVersionId: pin || null,
    resolvedVersionId: pin || listing.listedVersionId,
    updatedBy: actorId,
    updatedAt: ctx.now(),
  }
  await ctx.db
    .insert(installs)
    .values({ listingId: listing.id, scope: t.scope, scopeId: t.scopeId, ...set })
    .onConflictDoUpdate({ target: [installs.listingId, installs.scope, installs.scopeId], set })
  await log(ctx, actorId, t, 'install.put', {
    listingId: listing.id,
    name: listing.name,
    enabled: set.enabled,
    pinVersionId: set.pinVersionId,
  })
  return (await listInstalls(ctx.db, t, eq(installs.listingId, listing.id)))[0]!
}

export async function deleteInstall(ctx: Ctx, t: Target, listingId: string, actorId: string) {
  const [gone] = await ctx.db
    .delete(installs)
    .where(and(eq(installs.listingId, idParam(listingId, '条目不存在')), inScope(t)))
    .returning({ listingId: installs.listingId })
  if (!gone) return fail('not_found', '条目不存在')
  await log(ctx, actorId, t, 'install.delete', { listingId: gone.listingId })
}

/**
 * Installs of `type` listings applying in each group (its own, its primary repo's, its team's), banned ones left out,
 * by group id.
 */
export async function groupsInstalls(
  db: Read,
  groupIds: string[],
  type: ListingType,
): Promise<Map<string, GroupInstall[]>> {
  if (!groupIds.length) return new Map()
  const [found, repoIds] = await Promise.all([
    db.select({ id: groups.id, teamId: groups.teamId }).from(groups).where(inArray(groups.id, groupIds)),
    groupRepoIds(db, groupIds),
  ])
  if (!found.length) return new Map()
  const rows = await db
    .select({
      layer: installs.scope,
      scopeId: installs.scopeId,
      listingId: installs.listingId,
      name: plugins.name,
      enabled: installs.enabled,
      version: versionOf(resolved),
    })
    .from(installs)
    .innerJoin(plugins, eq(plugins.id, installs.listingId))
    .innerJoin(resolved, eq(resolved.id, installs.resolvedVersionId))
    .where(
      and(
        eq(plugins.type, type),
        ne(plugins.status, 'banned'),
        or(
          and(eq(installs.scope, 'group'), inArray(installs.scopeId, groupIds)),
          and(
            eq(installs.scope, 'team'),
            inArray(
              installs.scopeId,
              found.map((g) => g.teamId),
            ),
          ),
          repoIds.size
            ? and(eq(installs.scope, 'repo'), inArray(installs.scopeId, [...repoIds.values()]))
            : undefined,
        ),
      ),
    )
  return new Map(
    found.map((g) => {
      const ids: Record<string, string | undefined> = { group: g.id, team: g.teamId, repo: repoIds.get(g.id) }
      return [g.id, rows.filter((r) => ids[r.layer] === r.scopeId)]
    }),
  )
}

export const groupInstalls = async (db: Read, groupId: string, type: ListingType) =>
  (await groupsInstalls(db, [groupId], type)).get(groupId) ?? []

/** A skill listing version, for a machine hosting a bot in a group one of its enabled installs applies to. */
export async function hostedListingFiles(db: Read, machineId: string, versionId: string) {
  const [v] = await db
    .select({ files: pluginVersions.files, type: plugins.type, status: plugins.status })
    .from(pluginVersions)
    .innerJoin(plugins, eq(plugins.id, pluginVersions.pluginId))
    .where(eq(pluginVersions.id, versionId))
  if (v?.type !== 'skill') return fail('not_found', '版本不存在')
  const [hosted] = await db
    .select({ id: installs.id })
    .from(installs)
    .leftJoin(repos, and(eq(installs.scope, 'repo'), eq(repos.id, installs.scopeId)))
    .innerJoin(
      groups,
      or(
        and(eq(installs.scope, 'group'), eq(groups.id, installs.scopeId)),
        and(eq(installs.scope, 'team'), eq(groups.teamId, installs.scopeId)),
        eq(groups.teamId, repos.teamId),
      ),
    )
    .innerJoin(groupBots, and(eq(groupBots.groupId, groups.id), isNull(groupBots.removedAt)))
    .innerJoin(bots, and(eq(bots.id, groupBots.botId), eq(bots.machineId, machineId)))
    .where(and(eq(installs.resolvedVersionId, versionId), eq(installs.enabled, true)))
    .limit(1)
  if (!hosted || v.status === 'banned') return fail('forbidden', '该机器上没有可使用这个 skill 的 Bot')
  return v.files as SkillFile[]
}
