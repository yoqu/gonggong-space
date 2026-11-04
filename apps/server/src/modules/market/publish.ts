import type {
  ListingSource,
  ListingType,
  ListingVersionDto,
  ListingVisibility,
  MarketListingDetailDto,
  MarketListingDto,
  MarketSource,
  MyListingDto,
  PluginManifest,
  PublishReq,
  ReviewItemDto,
  ReviewReq,
  SkillFile,
  UpdateListingReq,
} from '@gonggong/protocol'
import {
  and,
  desc,
  eq,
  exists,
  ilike,
  inArray,
  isNotNull,
  isNull,
  notExists,
  notInArray,
  or,
  type SQL,
  sql,
} from 'drizzle-orm'
import { alias } from 'drizzle-orm/pg-core'
import type { Ctx } from '../../context.js'
import type { Db } from '../../db/client.js'
import { installs, plugins, pluginVersions, teamMembers, teams, users } from '../../db/schema.js'
import { t } from '../../i18n/index.js'
import { audit } from '../../lib/audit.js'
import { fail } from '../../lib/errors.js'
import { idParam, isUuid } from '../../lib/ids.js'
import { type ListingSnapshot, listingSnapshot } from '../plugins/service.js'
import { fetchGithubSkill, upstreamCommit } from './github.js'
import { listingSummary, listVersion } from './service.js'

type Read = Pick<Db, 'select'>
type ListingRow = typeof plugins.$inferSelect
export type Me = { id: string; role: string }

const ADMIN_ROLES = ['admin', 'owner']

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
const maintainedBy = (db: Read, userId: string) =>
  and(
    isNotNull(plugins.visibility),
    or(
      and(eq(plugins.authorId, userId), exists(memberOf(db, sql`${plugins.authorId}`))),
      and(notExists(memberOf(db, sql`${plugins.authorId}`)), exists(memberOf(db, userId, ADMIN_ROLES))),
    ),
  )

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

/** Team visibility: the team's admins; public: sysadmins. */
async function reviews(db: Read, me: Me, listing: ListingRow) {
  if (listing.visibility === 'public') return me.role === 'sysadmin'
  return !!listing.visibility && ADMIN_ROLES.includes((await teamRole(db, me.id, listing.teamId!)) ?? '')
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

export async function marketList(
  ctx: Ctx,
  me: Me,
  f: { q?: string; type?: ListingType; source?: MarketSource },
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
      like
        ? or(
            ilike(plugins.name, like),
            ilike(sql`${shown.manifest}->>'title'`, like),
            ilike(sql`${shown.manifest}->>'description'`, like),
          )
        : undefined,
    ),
  ).orderBy(desc(plugins.updatedAt))
  return rows.map((c) => cardDto(c, mine) as MarketListingDto)
}

/** One listing at its listed version, or `versionId`; unapproved versions only for its maintainers and reviewers. */
export async function marketDetail(
  ctx: Ctx,
  me: Me,
  id: string,
  versionId?: string,
): Promise<MarketListingDetailDto> {
  const listing = await findListing(ctx.db, id)
  const mine = await myTeamIds(ctx.db, me.id)
  const canEdit = await maintains(ctx.db, me.id, listing.id)
  const privileged = canEdit || (await reviews(ctx.db, me, listing))
  const inMarket =
    !!listing.listedVersionId &&
    listing.status !== 'banned' &&
    (listing.scope === 'platform' ||
      (listing.scope === 'team' && (listing.visibility === 'public' || mine.has(listing.teamId!))))
  if (!inMarket && !privileged) return fail('not_found', '条目不存在')
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
  const [card] = await cards(ctx.db, eq(shown.id, pick), eq(plugins.id, listing.id))
  const [v] = await ctx.db
    .select({ files: pluginVersions.files })
    .from(pluginVersions)
    .where(eq(pluginVersions.id, pick))
  const files = v!.files as SkillFile[]
  const manifest = card!.shown.manifest
  const readmePath =
    listing.type === 'plugin' ? `skills/${(manifest as PluginManifest).entry}/SKILL.md` : 'SKILL.md'
  const readme = files.find((f) => f.path === readmePath && f.encoding === 'utf8')?.content ?? ''
  const dto = cardDto(card!, mine)
  return {
    ...dto,
    // Never approved: only its maintainers and reviewers get here.
    listedVersionId: dto.listedVersionId ?? '',
    listedRevision: dto.listedRevision ?? 0,
    readme,
    files: files.map((f) => ({
      path: f.path,
      size: f.encoding === 'base64' ? Buffer.from(f.content, 'base64').length : Buffer.byteLength(f.content),
    })),
    versions: versions.map(versionDto),
    ghSource: listing.ghSource,
    canEdit,
  }
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
    if (!made && (listing.type !== s.type || !(await maintains(tx, me.id, listing.id))))
      fail('conflict', '同名的插件或 Skill 已存在')
    const added = await addDraft(ctx, tx, listing, s, me.id, ghSource)
    return { listing, created: !!made, added }
  })
  if (saved.added) await log(ctx, me, saved.listing, 'market.publish')
  return {
    created: saved.created,
    body: { listing: await myListing(ctx.db, me, saved.listing.id), warnings: publishWarnings(s.files) },
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
const sourceUrl = (s: ListingSource) => {
  const repo = s.url.replace(/\/tree\/.*$/, '').replace(/\.git$/, '')
  return s.ref || s.path ? `${repo}/tree/${s.ref ?? 'HEAD'}${s.path ? `/${s.path}` : ''}` : repo
}

export async function checkUpstream(ctx: Ctx, me: Me, id: string) {
  const listing = await requireMaintained(ctx, me, id)
  const source = listing.ghSource ?? fail('invalid', '该条目不是从 GitHub 导入的')
  const commit = await upstreamCommit(source)
  if (commit === source.commit) return { changed: false, commit }
  const fetched = await fetchGithubSkill(sourceUrl(source))
  const s = listingSnapshot(fetched.files)
  if (s.manifest.name !== listing.name || s.type !== listing.type)
    fail('invalid', 'GitHub 上的名称变成了 {name}，请重新导入', { name: s.manifest.name })
  const added = await ctx.db.transaction((tx) => addDraft(ctx, tx, listing, s, me.id, fetched.source))
  if (added) await log(ctx, me, listing, 'market.publish', { commit: fetched.source.commit })
  return { changed: true, commit: fetched.source.commit }
}

export async function updateListing(ctx: Ctx, me: Me, id: string, req: UpdateListingReq) {
  const listing = await requireMaintained(ctx, me, id)
  if (listing.status === 'banned') fail('forbidden', '已封禁的条目不能修改')
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

export async function submitVersion(ctx: Ctx, me: Me, id: string, versionId: string, changelog: string) {
  const listing = await requireMaintained(ctx, me, id)
  const v = await findVersion(ctx.db, listing, versionId)
  if (v.reviewStatus !== 'draft' && v.reviewStatus !== 'rejected')
    fail('conflict', '只能提交草稿或被驳回的版本')
  await ctx.db
    .update(pluginVersions)
    .set({ reviewStatus: 'pending', changelog })
    .where(eq(pluginVersions.id, v.id))
  await log(ctx, me, listing, 'market.submit', { revision: v.revision })
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
  await ctx.db.transaction(async (tx) => {
    await tx
      .update(pluginVersions)
      .set({
        reviewStatus: req.approve ? 'approved' : 'rejected',
        reviewerId: me.id,
        reviewNote: req.note || null,
      })
      .where(eq(pluginVersions.id, v.id))
    if (!req.approve) return
    const [listed] = listing.listedVersionId
      ? await tx
          .select({ revision: pluginVersions.revision })
          .from(pluginVersions)
          .where(eq(pluginVersions.id, listing.listedVersionId))
      : []
    if (!listed || listed.revision < v.revision) await listVersion(tx, listing.id, v.id)
  })
  await log(ctx, me, listing, req.approve ? 'market.approve' : 'market.reject', {
    revision: v.revision,
    note: req.note,
  })
}
