import type {
  InstalledTarget,
  ListingSource,
  ListingType,
  ListingVersionDto,
  ListingVisibility,
  MarketListingDetailDto,
  MarketListingDto,
  MarketSource,
  MyListingDto,
  PluginManifest,
  PublishPreflightRes,
  PublishReq,
  ReviewItemDto,
  ReviewReq,
  SkillFile,
  UpdateListingReq,
  UpstreamMovedDto,
  VersionDiffDto,
} from '@gonggong/protocol'
import { type PluginShelf, pluginRunsCode, shelfCategories } from '@gonggong/protocol'
import {
  and,
  desc,
  eq,
  ilike,
  inArray,
  isNotNull,
  isNull,
  lt,
  ne,
  notInArray,
  or,
  type SQL,
  sql,
} from 'drizzle-orm'
import { alias } from 'drizzle-orm/pg-core'
import type { Ctx } from '../../context.js'
import type { Db } from '../../db/client.js'
import {
  groupMembers,
  groups,
  installs,
  plugins,
  pluginVersions,
  repos,
  teamMembers,
  teams,
  users,
} from '../../db/schema.js'
import { t } from '../../i18n/index.js'
import { audit } from '../../lib/audit.js'
import { fail } from '../../lib/errors.js'
import { idParam, isUuid } from '../../lib/ids.js'
import { notify, resolveNotifications } from '../notifications/notify.js'
import { type ListingSnapshot, listingSnapshot, presetsOnPlatformOnly } from '../plugins/service.js'
import { fetchGithubSkill, upstreamCommit } from './github.js'
import { requestedIn } from './requests.js'
import { ADMIN_ROLES, byScope, listingSummary, listVersion, maintainedBy, nameTakenIn } from './service.js'

type Read = Pick<Db, 'select'>
type ListingRow = typeof plugins.$inferSelect
export type Me = { id: string; role: string }

// ── Warnings ────
const SECRET =
  /\b(?:sk-[A-Za-z0-9_-]{16,}|ghp_[A-Za-z0-9]{20,}|github_pat_\w{20,}|AKIA[0-9A-Z]{16}|xox[abprs]-[\w-]{10,})/
const ABSOLUTE_PATH = /(?:\/Users\/|\/home\/|[A-Za-z]:\\Users\\)[^\s'"`)\]]+/

/** Likely secrets and local absolute paths in the files, shown to the author without refusing them. */
export function publishWarnings(files: SkillFile[]) {
  return files.flatMap((f) => {
    if (f.encoding !== 'utf8') return []
    const secret = SECRET.exec(f.content)
    const path = ABSOLUTE_PATH.exec(f.content)
    return [
      ...(secret
        ? [t('{path} 可能包含密钥：{sample}', { path: f.path, sample: `${secret[0].slice(0, 6)}…` })]
        : []),
      ...(path ? [t('{path} 包含本机绝对路径：{sample}', { path: f.path, sample: path[0] })] : []),
    ]
  })
}

// ── Who may do what ────
async function maintains(db: Read, userId: string, listingId: string) {
  const [row] = await db
    .select({ id: plugins.id })
    .from(plugins)
    .where(and(eq(plugins.id, listingId), maintainedBy(db, userId)))
  return !!row
}

async function findListing(db: Read, id: string) {
  const [row] = await db
    .select()
    .from(plugins)
    .where(eq(plugins.id, idParam(id, '条目不存在')))
  return row ?? fail('not_found', '条目不存在')
}

async function requireMaintained(ctx: Ctx, me: Me, id: string) {
  const listing = await findListing(ctx.db, id)
  if (!(await maintains(ctx.db, me.id, listing.id))) fail('forbidden', '只有维护者可以修改')
  return listing
}

async function teamRole(db: Read, userId: string, teamId: string) {
  const [row] = await db
    .select({ role: teamMembers.role })
    .from(teamMembers)
    .where(and(eq(teamMembers.teamId, teamId), eq(teamMembers.userId, userId)))
  return row?.role ?? null
}

/** Team visibility: the team's admins; public and layer listings: sysadmins. */
async function reviews(db: Read, me: Me, listing: ListingRow) {
  if (listing.visibility !== 'team') return me.role === 'sysadmin'
  return ADMIN_ROLES.includes((await teamRole(db, me.id, listing.teamId!)) ?? '')
}

/** Who maintains the listing now (D13), for notices. */
async function maintainerIds(db: Read, listingId: string) {
  const member = alias(teamMembers, 'maintainer')
  const rows = await db
    .select({ id: member.userId })
    .from(plugins)
    .innerJoin(member, eq(member.teamId, plugins.teamId))
    .where(and(eq(plugins.id, listingId), maintainedBy(db, sql`${member.userId}`)))
  return rows.map((r) => r.id)
}

const installTeam = alias(teams, 'install_team')

/**
 * Who installed the listing, for notices, by team: a personal install's owner (team null), else whoever last set the
 * install up; `targets` labels where (group, team, 「团队 / 仓库」, '' for personal). Maintainers and `skip` left out.
 */
async function installers(db: Read, listingId: string, skip: string, where?: SQL) {
  const rows = await db
    .select({
      scope: installs.scope,
      scopeId: installs.scopeId,
      updatedBy: installs.updatedBy,
      group: groups.name,
      groupTeam: groups.teamId,
      repo: repos.name,
      team: installTeam.name,
      teamId: installTeam.id,
    })
    .from(installs)
    .leftJoin(groups, and(eq(installs.scope, 'group'), eq(groups.id, installs.scopeId)))
    .leftJoin(repos, and(eq(installs.scope, 'repo'), eq(repos.id, installs.scopeId)))
    .leftJoin(
      installTeam,
      or(
        and(eq(installs.scope, 'team'), eq(installTeam.id, installs.scopeId)),
        eq(installTeam.id, repos.teamId),
      ),
    )
    .where(and(eq(installs.listingId, listingId), where))
  const left = new Set([skip, ...(await maintainerIds(db, listingId))])
  const out = new Map<string, { userId: string; teamId: string | null; targets: string[] }>()
  for (const r of rows) {
    const userId = r.scope === 'user' ? r.scopeId : r.updatedBy
    if (!userId || left.has(userId)) continue
    const teamId = r.groupTeam ?? r.teamId
    const label = r.group ?? (r.repo ? `${r.team} / ${r.repo}` : (r.team ?? ''))
    const key = `${userId}:${teamId}`
    const entry = out.get(key) ?? { userId, teamId, targets: [] }
    entry.targets.push(label)
    out.set(key, entry)
  }
  return [...out.values()]
}

/** Who reviews the listing's versions, for notices: see `reviews`. */
async function reviewerIds(db: Read, listing: ListingRow) {
  const rows =
    listing.visibility === 'team'
      ? await db
          .select({ id: teamMembers.userId })
          .from(teamMembers)
          .where(and(eq(teamMembers.teamId, listing.teamId!), inArray(teamMembers.role, ADMIN_ROLES)))
      : await db
          .select({ id: users.id })
          .from(users)
          .where(and(eq(users.role, 'sysadmin'), isNull(users.disabledAt)))
  return rows.map((r) => r.id)
}

export async function requireTeamMember(db: Read, userId: string, teamId: string) {
  if (!isUuid(teamId) || !(await teamRole(db, userId, teamId))) fail('forbidden', '只能发布到你所在的团队')
}

const myTeamIds = async (db: Read, userId: string) =>
  new Set(
    (await db.select({ id: teamMembers.teamId }).from(teamMembers).where(eq(teamMembers.userId, userId))).map(
      (r) => r.id,
    ),
  )

// ── Reading ────
const shown = alias(pluginVersions, 'shown')
const listedV = alias(pluginVersions, 'listed')
const author = alias(users, 'author')
const creator = alias(users, 'creator')
const versionCols = (v: typeof shown | typeof pluginVersions) => ({
  id: v.id,
  revision: v.revision,
  manifest: v.manifest,
  reviewStatus: v.reviewStatus,
  changelog: v.changelog,
  reviewNote: v.reviewNote,
  createdAt: v.createdAt,
})

/** Listings with one version each (`on` picks it) and what their cards show. */
const cards = (db: Read, on: SQL, where: SQL | undefined) =>
  db
    .select({
      listing: plugins,
      shown: versionCols(shown),
      creator: creator.name,
      listedRevision: listedV.revision,
      teamName: teams.name,
      author: author.name,
      installs: sql<number>`(select count(*) from ${installs} where ${installs.listingId} = ${plugins.id})::int`,
    })
    .from(plugins)
    .innerJoin(shown, on)
    .leftJoin(creator, eq(creator.id, shown.createdBy))
    .leftJoin(listedV, eq(listedV.id, plugins.listedVersionId))
    .leftJoin(teams, eq(teams.id, plugins.teamId))
    .leftJoin(author, eq(author.id, plugins.authorId))
    .where(where)
type Card = Awaited<ReturnType<typeof cards>>[number]

const versionDto = (c: Pick<Card, 'shown' | 'creator'>): ListingVersionDto => ({
  id: c.shown.id,
  revision: c.shown.revision,
  reviewStatus: c.shown.reviewStatus as ListingVersionDto['reviewStatus'],
  changelog: c.shown.changelog,
  reviewNote: c.shown.reviewNote,
  createdBy: c.creator,
  createdAt: c.shown.createdAt.toISOString(),
})

const sourceOf = (l: ListingRow, mine: Set<string>): MarketSource =>
  l.scope === 'platform' ? 'official' : l.teamId && mine.has(l.teamId) ? 'team' : 'public'

const cardDto = (c: Card, mine: Set<string>): ReviewItemDto['listing'] => ({
  ...listingSummary(c.listing, c.shown),
  source: sourceOf(c.listing, mine),
  visibility: c.listing.visibility as ListingVisibility | null,
  teamId: c.listing.teamId,
  teamName: c.teamName,
  author: c.author,
  agents: 'agents' in c.shown.manifest ? c.shown.manifest.agents : [],
  listedVersionId: c.listing.listedVersionId,
  listedRevision: c.listedRevision,
  installs: c.installs,
  updatedAt: c.listing.updatedAt.toISOString(),
})

const myDto = (c: Card): MyListingDto => ({
  ...listingSummary(c.listing, c.shown),
  visibility: c.listing.visibility as ListingVisibility,
  teamId: c.listing.teamId!,
  latest: versionDto(c),
  listedVersionId: c.listing.listedVersionId,
  ghSource: c.listing.ghSource,
  banReason: c.listing.banReason,
})

/** Platform listings, the caller's teams' and other teams' public ones, by source. */
function marketScope(mine: Set<string>) {
  const ids = [...mine]
  return {
    official: eq(plugins.scope, 'platform'),
    team: ids.length ? and(eq(plugins.scope, 'team'), inArray(plugins.teamId, ids)) : sql`false`,
    public: and(
      eq(plugins.scope, 'team'),
      eq(plugins.visibility, 'public'),
      ids.length ? notInArray(plugins.teamId, ids) : undefined,
    ),
  }
}

const installedTeam = alias(teams, 'installed_team')

/** Where the caller sees each listing installed: their personal layer, groups they are in, their teams and repos. */
async function installedIn(db: Read, userId: string, listingIds: string[]) {
  const out = new Map<string, InstalledTarget[]>()
  if (!listingIds.length) return out
  const rows = await db
    .select({
      listingId: installs.listingId,
      scope: installs.scope,
      scopeId: installs.scopeId,
      group: groups.name,
      team: installedTeam.name,
      repo: repos.name,
    })
    .from(installs)
    .leftJoin(
      groupMembers,
      and(
        eq(installs.scope, 'group'),
        eq(groupMembers.groupId, installs.scopeId),
        eq(groupMembers.userId, userId),
      ),
    )
    .leftJoin(groups, and(eq(groups.id, groupMembers.groupId), isNull(groups.archivedAt)))
    .leftJoin(repos, and(eq(installs.scope, 'repo'), eq(repos.id, installs.scopeId)))
    .leftJoin(
      teamMembers,
      and(
        eq(teamMembers.userId, userId),
        or(
          and(eq(installs.scope, 'team'), eq(teamMembers.teamId, installs.scopeId)),
          eq(teamMembers.teamId, repos.teamId),
        ),
      ),
    )
    .leftJoin(installedTeam, eq(installedTeam.id, teamMembers.teamId))
    .where(
      and(
        inArray(installs.listingId, listingIds),
        or(
          and(eq(installs.scope, 'user'), eq(installs.scopeId, userId)),
          isNotNull(groups.id),
          isNotNull(installedTeam.id),
        ),
      ),
    )
  rows.sort((a, b) => byScope(a, b) || (a.group ?? a.team ?? '').localeCompare(b.group ?? b.team ?? ''))
  for (const r of rows) {
    const label = r.group ?? (r.repo ? `${r.team} / ${r.repo}` : (r.team ?? ''))
    out.set(r.listingId, [
      ...(out.get(r.listingId) ?? []),
      { scope: r.scope as InstalledTarget['scope'], scopeId: r.scopeId, label },
    ])
  }
  return out
}

export async function marketList(
  ctx: Ctx,
  me: Me,
  f: { q?: string; type?: ListingType; source?: MarketSource; shelf?: PluginShelf },
): Promise<MarketListingDto[]> {
  const mine = await myTeamIds(ctx.db, me.id)
  const scope = marketScope(mine)
  const like = f.q?.trim() && `%${f.q.trim().replace(/[\\%_]/g, (c) => `\\${c}`)}%`
  const rows = await cards(
    ctx.db,
    eq(shown.id, plugins.listedVersionId),
    and(
      eq(plugins.status, 'listed'),
      f.source ? scope[f.source] : or(...Object.values(scope)),
      f.type ? eq(plugins.type, f.type) : undefined,
      f.shelf
        ? and(
            eq(plugins.type, 'plugin'),
            inArray(sql`${shown.manifest}->>'category'`, shelfCategories(f.shelf)),
          )
        : undefined,
      like
        ? or(
            ilike(plugins.name, like),
            ilike(sql`${shown.manifest}->>'title'`, like),
            ilike(sql`${shown.manifest}->>'description'`, like),
          )
        : undefined,
    ),
  ).orderBy(desc(plugins.updatedAt))
  const where = await installedIn(
    ctx.db,
    me.id,
    rows.map((c) => c.listing.id),
  )
  return rows.map(
    (c) => ({ ...cardDto(c, mine), installedIn: where.get(c.listing.id) ?? [] }) as MarketListingDto,
  )
}

/** One listing at its listed version, or `versionId`; unapproved versions only for its maintainers and reviewers. */
/** The listing and the version of it the caller may see: `versionId`, else the listed one; 404 otherwise. */
async function shownVersion(ctx: Ctx, me: Me, id: string, versionId?: string) {
  const listing = await findListing(ctx.db, id)
  const mine = await myTeamIds(ctx.db, me.id)
  const canEdit = await maintains(ctx.db, me.id, listing.id)
  const canReview = await reviews(ctx.db, me, listing)
  const privileged = canEdit || canReview
  const inMarket =
    !!listing.listedVersionId &&
    (listing.scope === 'platform' ||
      (listing.scope === 'team' && (listing.visibility === 'public' || mine.has(listing.teamId!))))
  // A banned listing leaves the market but stays readable where the caller has it installed, to see why.
  const readable =
    inMarket && (listing.status !== 'banned' || !!(await installedIn(ctx.db, me.id, [listing.id])).size)
  if (!readable && !privileged) return fail('not_found', '条目不存在')
  const versions = await ctx.db
    .select({ shown: versionCols(pluginVersions), creator: users.name })
    .from(pluginVersions)
    .leftJoin(users, eq(users.id, pluginVersions.createdBy))
    .where(
      and(
        eq(pluginVersions.pluginId, listing.id),
        privileged ? undefined : eq(pluginVersions.reviewStatus, 'approved'),
      ),
    )
    .orderBy(desc(pluginVersions.revision))
  const pick = versionId ?? listing.listedVersionId ?? versions[0]?.shown.id
  if (!pick || !versions.some((v) => v.shown.id === pick)) return fail('not_found', '版本不存在')
  return { listing, mine, canEdit, canReview, versions, pick }
}

export async function marketDetail(
  ctx: Ctx,
  me: Me,
  id: string,
  versionId?: string,
): Promise<MarketListingDetailDto> {
  const { listing, mine, canEdit, canReview, versions, pick } = await shownVersion(ctx, me, id, versionId)
  const [card] = await cards(ctx.db, eq(shown.id, pick), eq(plugins.id, listing.id))
  const [v] = await ctx.db
    .select({ files: pluginVersions.files })
    .from(pluginVersions)
    .where(eq(pluginVersions.id, pick))
  const files = v!.files as SkillFile[]
  const plugin = listing.type === 'plugin' ? (card!.shown.manifest as PluginManifest) : null
  const readmePath = !plugin ? 'SKILL.md' : plugin.entry ? `skills/${plugin.entry}/SKILL.md` : 'README.md'
  const readme = files.find((f) => f.path === readmePath && f.encoding === 'utf8')?.content ?? ''
  const where = await installedIn(ctx.db, me.id, [listing.id])
  return {
    ...cardDto(card!, mine),
    installedIn: where.get(listing.id) ?? [],
    requestedIn: await requestedIn(ctx.db, me.id, listing.id),
    nameTakenIn: await nameTakenIn(ctx.db, me.id, listing),
    canReview,
    banReason: listing.banReason,
    readme,
    permissions: plugin?.permissions ?? [],
    mcp: plugin?.contributes.mcp ?? [],
    files: files.map((f) => ({
      path: f.path,
      size: f.encoding === 'base64' ? Buffer.from(f.content, 'base64').length : Buffer.byteLength(f.content),
    })),
    versions: versions.map(versionDto),
    ghSource: listing.ghSource,
    canEdit,
  }
}

/** One file of a listing's shown version (see `shownVersion`), for 文件 in its detail. */
export async function listingFile(ctx: Ctx, me: Me, id: string, path: string, versionId?: string) {
  const { pick } = await shownVersion(ctx, me, id, versionId)
  const [v] = await ctx.db
    .select({ files: pluginVersions.files })
    .from(pluginVersions)
    .where(eq(pluginVersions.id, pick))
  return (v!.files as SkillFile[]).find((f) => f.path === path) ?? fail('not_found', '文件不存在')
}

/** Listings the caller maintains, with their latest upload. */
export async function myListings(db: Read, me: Me, where?: SQL) {
  const rows = await cards(db, eq(shown.id, plugins.versionId), and(maintainedBy(db, me.id), where)).orderBy(
    desc(plugins.updatedAt),
  )
  return rows.map(myDto)
}

const myListing = async (db: Read, me: Me, id: string) => (await myListings(db, me, eq(plugins.id, id)))[0]!

/** Pending versions for a team's admins (`teamId`) or, without it, for sysadmins (public listings). */
export async function reviewQueue(ctx: Ctx, me: Me, teamId?: string): Promise<ReviewItemDto[]> {
  if (teamId) {
    if (!isUuid(teamId) || !ADMIN_ROLES.includes((await teamRole(ctx.db, me.id, teamId)) ?? ''))
      fail('forbidden', '仅团队管理员可操作')
  } else if (me.role !== 'sysadmin') fail('forbidden', '仅系统管理员可操作')
  const mine = await myTeamIds(ctx.db, me.id)
  const rows = await cards(
    ctx.db,
    and(eq(shown.pluginId, plugins.id), eq(shown.reviewStatus, 'pending'))!,
    teamId
      ? and(eq(plugins.teamId, teamId), eq(plugins.visibility, 'team'))
      : eq(plugins.visibility, 'public'),
  ).orderBy(shown.createdAt)
  return rows.map((c) => ({ listing: cardDto(c, mine), version: versionDto(c) }))
}

// ── Writing ────
const log = (ctx: Ctx, me: Me, listing: ListingRow, action: string, detail: Record<string, unknown> = {}) =>
  audit(ctx, {
    category: 'admin',
    actorUserId: me.id,
    teamId: listing.teamId,
    action,
    detail: { id: listing.id, name: listing.name, ...detail },
  })

/** A new draft unless the files equal the latest upload; a GitHub import also records where it came from. */
async function addDraft(
  ctx: Ctx,
  tx: Pick<Db, 'select' | 'insert' | 'update'>,
  listing: ListingRow,
  s: ListingSnapshot,
  actorId: string,
  ghSource?: ListingSource,
) {
  const [last] = await tx
    .select({ revision: pluginVersions.revision, digest: pluginVersions.digest })
    .from(pluginVersions)
    .where(eq(pluginVersions.pluginId, listing.id))
    .orderBy(desc(pluginVersions.revision))
    .limit(1)
  const same = last?.digest === s.digest
  const [v] = same
    ? []
    : await tx
        .insert(pluginVersions)
        .values({
          pluginId: listing.id,
          revision: (last?.revision ?? 0) + 1,
          files: s.files,
          manifest: s.manifest as PluginManifest,
          digest: s.digest,
          size: s.size,
          reviewStatus: 'draft',
          createdBy: actorId,
        })
        .returning({ id: pluginVersions.id })
  if (v || ghSource)
    await tx
      .update(plugins)
      .set({
        ...(v && { versionId: v.id }),
        ...(ghSource && { ghSource }),
        updatedBy: actorId,
        updatedAt: ctx.now(),
      })
      .where(eq(plugins.id, listing.id))
  return !!v
}

/** A new authored listing in the team, or a new draft of the same-named one the caller maintains. */
export async function publish(ctx: Ctx, me: Me, req: PublishReq, ghSource?: ListingSource) {
  await requireTeamMember(ctx.db, me.id, req.teamId)
  const s = listingSnapshot(req.files)
  const saved = await ctx.db.transaction(async (tx) => {
    const [made] = await tx
      .insert(plugins)
      .values({
        scope: 'team',
        teamId: req.teamId,
        name: s.manifest.name,
        type: s.type,
        authorId: me.id,
        visibility: req.visibility,
        updatedBy: me.id,
        updatedAt: ctx.now(),
      })
      .onConflictDoNothing()
      .returning()
    const [listing] = made
      ? [made]
      : await tx
          .select()
          .from(plugins)
          .where(
            and(
              eq(plugins.scope, 'team'),
              eq(plugins.teamId, req.teamId),
              isNull(plugins.groupId),
              eq(plugins.name, s.manifest.name),
            ),
          )
          .for('update')
    if (!listing) return fail('conflict', '插件正在被修改，请重试')
    if (!made) await requireOwnName(tx, me, listing, s)
    publicCode(s, listing.visibility)
    presetsOnPlatformOnly(s)
    const added = await addDraft(ctx, tx, listing, s, me.id, ghSource)
    return { listing, created: !!made, added }
  })
  if (saved.added) await log(ctx, me, saved.listing, 'market.publish')
  return {
    created: saved.created,
    body: {
      listing: await myListing(ctx.db, me, saved.listing.id),
      warnings: publishWarnings(s.files),
      unchanged: !saved.added,
    },
  }
}

/** Plugins that run code stay in their team for now (plan 插件扩展点 §13). */
function publicCode(s: ListingSnapshot, visibility: string | null) {
  if (visibility === 'public' && s.type === 'plugin' && pluginRunsCode(s.manifest))
    fail('invalid', '会运行代码的插件暂时只能在团队内可见')
}

/** The same-named listing in the team may take a new version only from its maintainers, and of the same type. */
async function requireOwnName(db: Read, me: Me, listing: ListingRow, s: ListingSnapshot) {
  if (listing.type === s.type && (await maintains(db, me.id, listing.id))) return
  if (!listing.visibility)
    fail('conflict', '团队里已有自建的同名 Skill「{name}」，请修改 name 后再发布', { name: listing.name })
  fail('conflict', '团队里已有同名的条目「{name}」，它不是你维护的或类型不同，请修改 name 后再发布', {
    name: listing.name,
  })
}

/** What `publish` would do with these files, without saving (PublishPreflightRes). */
export async function preflight(ctx: Ctx, me: Me, req: PublishReq): Promise<PublishPreflightRes> {
  await requireTeamMember(ctx.db, me.id, req.teamId)
  const s = listingSnapshot(req.files)
  const [listing] = await ctx.db
    .select()
    .from(plugins)
    .where(
      and(
        eq(plugins.scope, 'team'),
        eq(plugins.teamId, req.teamId),
        isNull(plugins.groupId),
        eq(plugins.name, s.manifest.name),
      ),
    )
  if (listing) await requireOwnName(ctx.db, me, listing, s)
  publicCode(s, listing?.visibility ?? req.visibility)
  const [last] = listing
    ? await ctx.db
        .select({ revision: pluginVersions.revision, digest: pluginVersions.digest })
        .from(pluginVersions)
        .where(eq(pluginVersions.pluginId, listing.id))
        .orderBy(desc(pluginVersions.revision))
        .limit(1)
    : []
  const unchanged = !!last && last.digest === s.digest
  return {
    type: s.type,
    name: s.manifest.name,
    title: 'title' in s.manifest ? s.manifest.title : s.manifest.name,
    description: s.manifest.description,
    kind: !listing ? 'new' : unchanged ? 'unchanged' : 'version',
    revision: unchanged ? last!.revision : (last?.revision ?? 0) + 1,
    visibility: (listing?.visibility as ListingVisibility | undefined) ?? req.visibility,
    warnings: publishWarnings(s.files),
  }
}

export async function importGithub(
  ctx: Ctx,
  me: Me,
  req: { teamId: string; visibility: ListingVisibility; url: string },
) {
  await requireTeamMember(ctx.db, me.id, req.teamId)
  const { files, source } = await fetchGithubSkill(req.url)
  return publish(ctx, me, { teamId: req.teamId, visibility: req.visibility, files }, source)
}

/** The GitHub URL of a recorded source, at its ref and sub-directory. */
export async function checkUpstream(ctx: Ctx, me: Me, id: string) {
  const listing = await requireMaintained(ctx, me, id)
  const source = listing.ghSource ?? fail('invalid', '该条目不是从 GitHub 导入的')
  const commit = await upstreamCommit(source)
  if (commit === source.commit) return { changed: false, drafted: false, commit }
  const fetched = await fetchGithubSkill(source.url)
  const s = listingSnapshot(fetched.files)
  if (s.manifest.name !== listing.name || s.type !== listing.type)
    fail('invalid', 'GitHub 上的名称变成了 {name}，请重新导入', { name: s.manifest.name })
  const added = await ctx.db.transaction((tx) => addDraft(ctx, tx, listing, s, me.id, fetched.source))
  if (added) await log(ctx, me, listing, 'market.publish', { commit: fetched.source.commit })
  return { changed: true, drafted: added, commit: fetched.source.commit }
}

const UPSTREAM_TTL_MS = 10 * 60_000
/** Upstream commits per source and server, so opening 我的发布 doesn't spend GitHub's 60 requests an hour. */
const upstreamSeen = new WeakMap<Ctx, Map<string, { at: number; commit: Promise<string> }>>()

/** GitHub-imported listings the caller maintains whose upstream moved past the recorded commit (UpstreamMovedDto). */
export async function upstreamMoved(ctx: Ctx, me: Me): Promise<UpstreamMovedDto[]> {
  const seen = upstreamSeen.get(ctx) ?? new Map()
  upstreamSeen.set(ctx, seen)
  const now = ctx.now().getTime()
  const rows = await ctx.db
    .select({ id: plugins.id, source: plugins.ghSource })
    .from(plugins)
    .where(and(maintainedBy(ctx.db, me.id), isNotNull(plugins.ghSource), ne(plugins.status, 'banned')))
  const moved = await Promise.all(
    rows.map(async ({ id, source }) => {
      const key = `${source!.url}#${source!.ref ?? ''}`
      let hit = seen.get(key)
      if (!hit || now - hit.at > UPSTREAM_TTL_MS) {
        hit = { at: now, commit: upstreamCommit(source!) }
        seen.set(key, hit)
      }
      // Only a hint: an unreachable or rate-limited GitHub leaves it out; 检查上游更新 reports the error.
      const commit = await hit.commit.catch(() => null)
      return commit && commit !== source!.commit ? [{ listingId: id, commit }] : []
    }),
  )
  return moved.flat()
}

export async function updateListing(ctx: Ctx, me: Me, id: string, req: UpdateListingReq) {
  const listing = await requireMaintained(ctx, me, id)
  if (listing.status === 'banned') fail('forbidden', '已封禁的条目不能修改')
  // Approval was given for the old audience: team admins must not be able to make a listing public.
  if (req.visibility && req.visibility !== listing.visibility && listing.listedVersionId)
    fail('conflict', '已有版本审核通过，不能再修改可见范围')
  if (req.visibility === 'public' && listing.type === 'plugin') {
    const code = await ctx.db
      .select({ manifest: pluginVersions.manifest })
      .from(pluginVersions)
      .where(eq(pluginVersions.pluginId, listing.id))
    if (code.some((v) => pluginRunsCode(v.manifest))) fail('invalid', '会运行代码的插件暂时只能在团队内可见')
  }
  await ctx.db
    .update(plugins)
    .set({ ...req, updatedBy: me.id, updatedAt: ctx.now() })
    .where(eq(plugins.id, listing.id))
  await log(ctx, me, listing, 'market.update', req)
  return myListing(ctx.db, me, listing.id)
}

async function findVersion(db: Read, listing: ListingRow, versionId: string) {
  const [v] = await db
    .select()
    .from(pluginVersions)
    .where(
      and(eq(pluginVersions.id, idParam(versionId, '版本不存在')), eq(pluginVersions.pluginId, listing.id)),
    )
  return v ?? fail('not_found', '版本不存在')
}

export async function submitVersion(
  ctx: Ctx,
  me: Me & { name: string },
  id: string,
  versionId: string,
  changelog: string,
) {
  const listing = await requireMaintained(ctx, me, id)
  const v = await findVersion(ctx.db, listing, versionId)
  if (v.reviewStatus !== 'draft' && v.reviewStatus !== 'rejected')
    fail('conflict', '只能提交草稿或被驳回的版本')
  await ctx.db
    .update(pluginVersions)
    .set({ reviewStatus: 'pending', changelog })
    .where(eq(pluginVersions.id, v.id))
  await log(ctx, me, listing, 'market.submit', { revision: v.revision })
  for (const userId of await reviewerIds(ctx.db, listing))
    if (userId !== me.id)
      await notify(
        ctx,
        userId,
        'listing_submitted',
        {
          listingId: listing.id,
          versionId: v.id,
          listingName: listingSummary(listing, v).title,
          revision: v.revision,
          byName: me.name,
        },
        listing.visibility === 'team' ? listing.teamId : null,
      )
  return myListing(ctx.db, me, listing.id)
}

/** Approving lists the version (when newer than the listed one) and moves following installs to it. */
export async function reviewVersion(ctx: Ctx, me: Me, id: string, versionId: string, req: ReviewReq) {
  const listing = await findListing(ctx.db, id)
  const v = await findVersion(ctx.db, listing, versionId)
  if (!(await reviews(ctx.db, me, listing))) fail('forbidden', '你不能审核这个版本')
  const own = v.createdBy === me.id || listing.authorId === me.id
  if (own && !(listing.visibility === 'public' && me.role === 'sysadmin'))
    fail('forbidden', '不能审核自己发布的版本')
  if (v.reviewStatus !== 'pending') fail('conflict', '版本不在待审核状态')
  const moved = await ctx.db.transaction(async (tx) => {
    await tx
      .update(pluginVersions)
      .set({
        reviewStatus: req.approve ? 'approved' : 'rejected',
        reviewerId: me.id,
        reviewNote: req.note || null,
      })
      .where(eq(pluginVersions.id, v.id))
    if (!req.approve) return false
    const [listed] = listing.listedVersionId
      ? await tx
          .select({ revision: pluginVersions.revision })
          .from(pluginVersions)
          .where(eq(pluginVersions.id, listing.listedVersionId))
      : []
    if (listed && listed.revision >= v.revision) return false
    await listVersion(tx, listing.id, v.id)
    return true
  })
  await log(ctx, me, listing, req.approve ? 'market.approve' : 'market.reject', {
    revision: v.revision,
    note: req.note,
  })
  await resolveNotifications(ctx, 'listing_submitted', 'versionId', [v.id])
  const title = listingSummary(listing, v).title
  for (const userId of await maintainerIds(ctx.db, listing.id))
    if (userId !== me.id)
      await notify(
        ctx,
        userId,
        'listing_reviewed',
        {
          listingId: listing.id,
          listingName: title,
          revision: v.revision,
          approved: req.approve,
          note: req.note,
        },
        listing.teamId,
      )
  if (moved)
    for (const i of await installers(ctx.db, listing.id, me.id, isNull(installs.pinVersionId)))
      await notify(
        ctx,
        i.userId,
        'listing_upgraded',
        {
          listingId: listing.id,
          listingName: title,
          revision: v.revision,
          changelog: v.changelog,
          targets: i.targets,
        },
        i.teamId,
      )
}

/** Changed files of a version against the latest approved one before it, for maintainers and reviewers. */
export async function versionDiff(ctx: Ctx, me: Me, id: string, versionId: string): Promise<VersionDiffDto> {
  const listing = await findListing(ctx.db, id)
  if (!(await maintains(ctx.db, me.id, listing.id)) && !(await reviews(ctx.db, me, listing)))
    fail('forbidden', '只有维护者和审核人可以查看改动')
  const v = await findVersion(ctx.db, listing, versionId)
  const [base] = await ctx.db
    .select({ id: pluginVersions.id, revision: pluginVersions.revision, files: pluginVersions.files })
    .from(pluginVersions)
    .where(
      and(
        eq(pluginVersions.pluginId, listing.id),
        eq(pluginVersions.reviewStatus, 'approved'),
        lt(pluginVersions.revision, v.revision),
      ),
    )
    .orderBy(desc(pluginVersions.revision))
    .limit(1)
  const byPath = (files: unknown) => new Map((files as SkillFile[]).map((f) => [f.path, f]))
  const before = byPath(base?.files ?? [])
  const after = byPath(v.files)
  const paths = [...new Set([...before.keys(), ...after.keys()])].sort()
  return {
    base: base ? { versionId: base.id, revision: base.revision } : null,
    files: paths.flatMap((path) => {
      const b = before.get(path)
      const a = after.get(path)
      if (b && a && b.content === a.content && b.encoding === a.encoding) return []
      const binary = b?.encoding === 'base64' || a?.encoding === 'base64'
      const text = (f?: SkillFile) => (f && !binary ? f.content : null)
      return [
        {
          path,
          status: !b ? 'added' : !a ? 'removed' : 'modified',
          binary,
          before: text(b),
          after: text(a),
        } as const,
      ]
    }),
  }
}

/** A reason bans the listing (no longer delivered, installed or shown); null lifts the ban. */
export async function setBan(ctx: Ctx, me: Me, id: string, reason: string | null) {
  const listing = await findListing(ctx.db, id)
  if (!(await reviews(ctx.db, me, listing))) fail('forbidden', '只有审核人可以封禁或解封')
  if (!reason && listing.status !== 'banned') fail('conflict', '条目没有被封禁')
  await ctx.db
    .update(plugins)
    .set({
      status: reason ? 'banned' : (listing.statusBeforeBan ?? 'listed'),
      banReason: reason,
      statusBeforeBan: reason ? (listing.statusBeforeBan ?? listing.status) : null,
      updatedBy: me.id,
      updatedAt: ctx.now(),
    })
    .where(eq(plugins.id, listing.id))
  await log(ctx, me, listing, reason ? 'market.ban' : 'market.unban', reason ? { reason } : {})
  const [shown] = await ctx.db
    .select({ manifest: pluginVersions.manifest })
    .from(pluginVersions)
    .where(eq(pluginVersions.id, (listing.listedVersionId ?? listing.versionId)!))
  const title = (shown?.manifest as { title?: string } | undefined)?.title ?? listing.name
  const notice = { listingId: listing.id, listingName: title, banned: !!reason, reason: reason ?? '' }
  for (const userId of await maintainerIds(ctx.db, listing.id))
    if (userId !== me.id) await notify(ctx, userId, 'listing_banned', notice, listing.teamId)
  for (const i of await installers(ctx.db, listing.id, me.id))
    await notify(ctx, i.userId, 'listing_banned', { ...notice, targets: i.targets }, i.teamId)
}
