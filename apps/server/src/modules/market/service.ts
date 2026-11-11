import {
  type InstallableDto,
  type InstallDto,
  type InstallReq,
  type ListingStatus,
  type ListingSummary,
  type ListingType,
  type PluginManifest,
  pluginRunsCode,
  type SkillFile,
  type SkillListingManifest,
  type TargetRef,
  TERMINAL_RUN_STATUS,
} from '@gonggong/protocol'
import {
  and,
  asc,
  type Column,
  eq,
  exists,
  inArray,
  isNotNull,
  isNull,
  ne,
  notExists,
  notInArray,
  or,
  type SQL,
  sql,
} from 'drizzle-orm'
import { alias } from 'drizzle-orm/pg-core'
import type { Ctx } from '../../context.js'
import type { Db } from '../../db/client.js'
import {
  bots,
  groupBots,
  groupMembers,
  groups,
  installs,
  plugins,
  pluginVersions,
  repos,
  runs,
  skills,
  teamMembers,
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

/** Where installs go; `teamId` / `groupId` decide which listings it may install (a user's: what they can see). */
export type Target =
  | { scope: 'group' | 'repo' | 'team'; scopeId: string; teamId: string; groupId: string | null }
  | { scope: 'user'; scopeId: string; teamId: null; groupId: null }

export const ADMIN_ROLES = ['admin', 'owner']

const memberOf = (db: Read, userId: SQL | string, roles?: string[]) =>
  db
    .select({ one: sql`1` })
    .from(teamMembers)
    .where(
      and(
        eq(teamMembers.teamId, plugins.teamId),
        eq(teamMembers.userId, userId),
        roles ? inArray(teamMembers.role, roles) : undefined,
      ),
    )

/** Authored listings `userId` maintains: their own while still in the team, else the team's admins' (D13). */
export const maintainedBy = (db: Read, userId: SQL | string) =>
  and(
    isNotNull(plugins.visibility),
    or(
      and(eq(plugins.authorId, userId), exists(memberOf(db, sql`${plugins.authorId}`))),
      and(notExists(memberOf(db, sql`${plugins.authorId}`)), exists(memberOf(db, userId, ADMIN_ROLES))),
    ),
  )

/** A personal install following a listing its user maintains takes its latest upload (self-test, plan M3). */
const resolvedId = (db: Read) =>
  sql`case when ${and(
    eq(installs.scope, 'user'),
    isNull(installs.pinVersionId),
    maintainedBy(db, sql`${installs.scopeId}`),
  )} then ${plugins.versionId} else ${installs.resolvedVersionId} end`

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

export const inScope = (t: { scope: string; scopeId: string }) =>
  and(eq(installs.scope, t.scope), eq(installs.scopeId, t.scopeId))

/**
 * Approved platform listings, the target's team's (a user's: their teams'), other teams' public ones and, for a
 * group, the group's own; for a user also the listings they maintain, approved or not.
 */
function visibleTo(db: Read, t: Target) {
  const teams =
    t.scope === 'user'
      ? inArray(
          plugins.teamId,
          db.select({ id: teamMembers.teamId }).from(teamMembers).where(eq(teamMembers.userId, t.scopeId)),
        )
      : eq(plugins.teamId, t.teamId)
  const approved = and(
    isNotNull(plugins.listedVersionId),
    or(
      eq(plugins.scope, 'platform'),
      and(eq(plugins.scope, 'team'), or(teams, eq(plugins.visibility, 'public'))),
      t.groupId ? and(eq(plugins.scope, 'group'), eq(plugins.groupId, t.groupId)) : undefined,
    ),
  )
  return t.scope === 'user' ? or(approved, maintainedBy(db, t.scopeId)) : approved
}

/** A listing's current version for the lists: the listed one, else (a maintainer's draft) its latest upload. */
const currentId = sql`coalesce(${plugins.listedVersionId}, ${plugins.versionId})`

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
      resolvedId: resolved.id,
      resolvedRevision: resolved.revision,
      updatedBy: users.name,
    })
    .from(installs)
    .innerJoin(plugins, eq(plugins.id, installs.listingId))
    .innerJoin(current, eq(current.id, currentId))
    .innerJoin(resolved, eq(resolved.id, resolvedId(db)))
    .leftJoin(users, eq(users.id, installs.updatedBy))
    .where(and(inScope(t), where))
    .orderBy(asc(plugins.name))
  return rows.map(
    (r): InstallDto => ({
      listing: listingSummary(r.listing, r.current),
      scope: t.scope,
      enabled: r.install.enabled,
      pinVersionId: r.install.pinVersionId,
      resolvedVersionId: r.resolvedId,
      resolvedRevision: r.resolvedRevision,
      banReason: r.listing.banReason,
      updatedBy: r.updatedBy,
      updatedAt: r.install.updatedAt.toISOString(),
    }),
  )
}

export async function installable(db: Read, t: Target, where?: SQL): Promise<InstallableDto[]> {
  const rows = await db
    .select({ listing: plugins, current: versionOf(current) })
    .from(plugins)
    .innerJoin(current, eq(current.id, currentId))
    .where(
      and(
        visibleTo(db, t),
        eq(plugins.status, 'listed'),
        t.scope === 'user' ? eq(plugins.type, 'skill') : undefined,
        notInArray(plugins.id, db.select({ id: installs.listingId }).from(installs).where(inScope(t))),
        where,
      ),
    )
    .orderBy(asc(plugins.name))
  const taken = await takenSkillNames(db, t)
  return rows.map((r) => ({
    ...listingSummary(r.listing, r.current),
    nameTaken: r.listing.type === 'skill' && taken.has(r.listing.name),
  }))
}

/** Skill names the scope already has: its skill installs (but `exceptListingId`'s) and the layer's own skills. */
async function takenSkillNames(db: Read, t: Target, exceptListingId?: string) {
  const installed = await db
    .select({ name: plugins.name })
    .from(installs)
    .innerJoin(plugins, eq(plugins.id, installs.listingId))
    .where(
      and(
        inScope(t),
        eq(plugins.type, 'skill'),
        exceptListingId ? ne(plugins.id, exceptListingId) : undefined,
      ),
    )
  const own =
    t.scope === 'repo' || t.scope === 'user'
      ? []
      : await db
          .select({ name: skills.name })
          .from(skills)
          .where(
            and(
              eq(skills.scope, t.scope),
              eq(skills.teamId, t.teamId),
              t.scope === 'group' ? eq(skills.groupId, t.groupId!) : isNull(skills.groupId),
            ),
          )
  return new Set([...installed, ...own].map((r) => r.name))
}

/** Same-layer names must be unique: another skill install of the scope, or the layer's own skill. */
async function skillNameFree(db: Read, t: Target, name: string, listingId: string) {
  if ((await takenSkillNames(db, t, listingId)).has(name))
    fail('conflict', '这里已经有同名的 Skill「{name}」，先移除它再引入', { name })
}

/** Targets `userId` belongs to: their personal layer, their groups, their teams and those teams' repos. */
export function ofMine(db: Read, userId: string, scope: Column, scopeId: SQL) {
  const myTeams = db
    .select({ id: teamMembers.teamId })
    .from(teamMembers)
    .where(eq(teamMembers.userId, userId))
  const myGroups = db
    .select({ id: groupMembers.groupId })
    .from(groupMembers)
    .where(eq(groupMembers.userId, userId))
  const myRepos = db.select({ id: repos.id }).from(repos).where(inArray(repos.teamId, myTeams))
  return or(
    and(eq(scope, 'user'), eq(scopeId, userId)),
    and(eq(scope, 'group'), inArray(scopeId, myGroups)),
    and(eq(scope, 'team'), inArray(scopeId, myTeams)),
    and(eq(scope, 'repo'), inArray(scopeId, myRepos)),
  )
}

const SCOPE_ORDER = ['user', 'group', 'team', 'repo']
export const byScope = (a: { scope: string }, b: { scope: string }) =>
  SCOPE_ORDER.indexOf(a.scope) - SCOPE_ORDER.indexOf(b.scope)

/** Where `userId` could install the skill listing but another skill of the same name already is (a 409 there). */
export async function nameTakenIn(db: Read, userId: string, listing: ListingRow): Promise<TargetRef[]> {
  if (listing.type !== 'skill') return []
  const installed = await db
    .select({ scope: installs.scope, scopeId: installs.scopeId })
    .from(installs)
    .innerJoin(plugins, eq(plugins.id, installs.listingId))
    .where(
      and(
        eq(plugins.type, 'skill'),
        eq(plugins.name, listing.name),
        ne(plugins.id, listing.id),
        ofMine(db, userId, installs.scope, sql`${installs.scopeId}`),
      ),
    )
  const skillScopeId = sql<string>`case when ${skills.scope} = 'group' then ${skills.groupId} else ${skills.teamId} end`
  const own = await db
    .select({ scope: skills.scope, scopeId: skillScopeId })
    .from(skills)
    .where(and(eq(skills.name, listing.name), ofMine(db, userId, skills.scope, skillScopeId)))
  const seen = new Set<string>()
  return [...installed, ...own]
    .filter((x) => !seen.has(x.scopeId) && !!seen.add(x.scopeId))
    .sort(byScope)
    .map((x) => ({ scope: x.scope as TargetRef['scope'], scopeId: x.scopeId }))
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
    .where(and(eq(plugins.id, idParam(listingId, '条目不存在')), visibleTo(ctx.db, t)))
  if (!listing) return fail('not_found', '条目不存在')
  if (t.scope === 'user' && listing.type !== 'skill') fail('invalid', '个人只能引入 Skill')
  const [maintained] =
    t.scope === 'user'
      ? await ctx.db
          .select({ id: plugins.id })
          .from(plugins)
          .where(and(eq(plugins.id, listing.id), maintainedBy(ctx.db, t.scopeId)))
      : []
  const follow = maintained ? listing.versionId : listing.listedVersionId
  if (!follow) return fail('not_found', '条目不存在')
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
          maintained ? undefined : eq(pluginVersions.reviewStatus, 'approved'),
        ),
      )
    if (!v) fail('not_found', '版本不存在')
  }
  if (listing.type === 'plugin' && !pin) {
    const [v] = await ctx.db
      .select({ manifest: pluginVersions.manifest })
      .from(pluginVersions)
      .where(eq(pluginVersions.id, follow))
    if (v && pluginRunsCode(v.manifest)) fail('invalid', '会运行代码的插件必须固定版本引入')
  }
  if (listing.type === 'skill') await skillNameFree(ctx.db, t, listing.name, listing.id)
  const set = {
    enabled: req.enabled,
    pinVersionId: pin || null,
    resolvedVersionId: pin || follow,
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

/**
 * `userId`'s enabled personal skill installs that apply in the group (plan Skill市场-M3): platform and public
 * listings anywhere, team-only ones in their team's groups while the user is still in it; banned ones left out, and
 * unapproved versions only for the listing's maintainers.
 */
export async function personalInstalls(db: Read, groupId: string, userId: string) {
  const team = db.select({ id: groups.teamId }).from(groups).where(eq(groups.id, groupId))
  return db
    .select({ name: plugins.name, version: versionOf(resolved) })
    .from(installs)
    .innerJoin(plugins, eq(plugins.id, installs.listingId))
    .innerJoin(resolved, eq(resolved.id, resolvedId(db)))
    .where(
      and(
        inScope({ scope: 'user', scopeId: userId }),
        eq(installs.enabled, true),
        eq(plugins.type, 'skill'),
        ne(plugins.status, 'banned'),
        or(
          eq(plugins.scope, 'platform'),
          eq(plugins.visibility, 'public'),
          and(inArray(plugins.teamId, team), exists(memberOf(db, userId))),
        ),
        or(eq(resolved.reviewStatus, 'approved'), maintainedBy(db, userId)),
      ),
    )
}

/**
 * A skill listing version, for a machine hosting a bot in a group one of its enabled installs applies to, or running
 * a bot for a turn originated by a user whose enabled personal install resolves to it.
 */
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
  const [allowed] = hosted
    ? [hosted]
    : await db
        .select({ id: installs.id })
        .from(installs)
        .innerJoin(plugins, eq(plugins.id, installs.listingId))
        .innerJoin(
          runs,
          and(eq(runs.originUserId, installs.scopeId), notInArray(runs.status, [...TERMINAL_RUN_STATUS])),
        )
        .innerJoin(bots, and(eq(bots.id, runs.botId), eq(bots.machineId, machineId)))
        .where(
          and(eq(installs.scope, 'user'), eq(installs.enabled, true), sql`${resolvedId(db)} = ${versionId}`),
        )
        .limit(1)
  if (!allowed || v.status === 'banned') return fail('forbidden', '该机器上没有可使用这个 skill 的 Bot')
  return v.files as SkillFile[]
}
