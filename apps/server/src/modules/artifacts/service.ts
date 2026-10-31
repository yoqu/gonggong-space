import { createHash, randomBytes } from 'node:crypto'
import {
  ARTIFACT_CONTEXT_ISSUES_MAX,
  type ArtifactAccess,
  type ArtifactCard,
  type ArtifactDto,
  type ArtifactFile,
  type ArtifactLink,
  type ArtifactVersionDetail,
  type ArtifactVersionDto,
  type ArtifactVersionSource,
  type ArtifactVersionSummary,
  type ArtifactVisibility,
  artifactDigestText,
  type DaemonArtifactRef,
  GG_ARTIFACT_MANIFEST,
  type GgArtifactManifest,
  type ProtocolKey,
  type RunStatus,
  TERMINAL_RUN_STATUS,
} from '@gonggong/protocol'
import { and, count, desc, eq, inArray, isNull, notInArray, or, type SQL, sql } from 'drizzle-orm'
import type { Ctx } from '../../context.js'
import type { Db } from '../../db/client.js'
import { artifacts, artifactVersions, bots, messages, runs, users } from '../../db/schema.js'
import { t, zh } from '../../i18n/index.js'
import { fail } from '../../lib/errors.js'
import { isUuid } from '../../lib/ids.js'
import { findMember, inTeamOfGroup } from '../groups/service.js'
import {
  authorName,
  type MessageMeta,
  type MessageRow,
  memberIds,
  messageDto,
  postEvent,
} from '../messages/service.js'
import { artifactBlobs, readBlob } from './blobs.js'
import { linksOf } from './html.js'
import { pluginKit } from './kit.js'
import { lintVersion, parseManifest } from './lint.js'
import { snapshotPending } from './snapshots.js'

export type Artifact = typeof artifacts.$inferSelect
export type Version = typeof artifactVersions.$inferSelect
type Read = Pick<Db, 'select'>
type Tx = Parameters<Parameters<Db['transaction']>[0]>[0]

/** Runs holding a bot's slot: while one has an artifact checked out, the panel is read-only. */
const ACTIVE = ['running', 'awaiting_approval', 'awaiting_answer']
/** Artifacts a run checks out at most (targets first, see runArtifacts). */
export const RUN_ARTIFACTS_MAX = 20

const SLUG = 'abcdefghijklmnopqrstuvwxyz0123456789'
/** `design/<base>-<4 random>`. */
export const newArtifactDir = (base: string) =>
  `design/${base}-${[...randomBytes(4)].map((b) => SLUG[b % SLUG.length]).join('')}`

type Thumb = Pick<Version, 'id' | 'artifactId' | 'thumbnailHash'>
export const thumbnailUrl = (v: Thumb) =>
  v.thumbnailHash ? `/api/artifacts/${v.artifactId}/versions/${v.id}/thumbnail` : null

const SCREEN_FILE = /^screens\/([a-z0-9]+(?:-[a-z0-9]+)*)\.html$/
/** The screens a version's files hold (`screens/<id>.html`), without reading its manifest. */
const screenIdsOf = (v: Pick<Version, 'files'>) =>
  v.files.flatMap((f) => {
    const id = SCREEN_FILE.exec(f.path)?.[1]
    return id ? [id] : []
  })

/** An ancestor's thumbnail, and the ancestor whose PNG each screen without its own shows. */
type Fallback = { thumb?: Thumb; screens: Map<string, string> }

/**
 * For each version without a thumbnail (or a screen PNG) of its own yet: the nearest ancestor's, shown marked stale.
 * The daemon screenshots a run's version after the turn, a `local` one never (it is uploaded before the turn) and an
 * `edit` one when the bot's machine is online (artifact.snapshot). A screen no ancestor shot gets none.
 */
async function fallbacks(db: Read, vs: Version[]) {
  const out = new Map<string, Fallback>()
  const need = vs.flatMap((v) => {
    const own = new Set(v.screenThumbs.map((x) => x.screenId))
    const screens = screenIdsOf(v).filter((id) => !own.has(id))
    return !v.thumbnailHash || screens.length ? [{ v, screens }] : []
  })
  if (!need.length) return out
  const all = await db
    .select({
      id: artifactVersions.id,
      artifactId: artifactVersions.artifactId,
      parentVersionId: artifactVersions.parentVersionId,
      thumbnailHash: artifactVersions.thumbnailHash,
      screenThumbs: artifactVersions.screenThumbs,
    })
    .from(artifactVersions)
    .where(inArray(artifactVersions.artifactId, [...new Set(need.map(({ v }) => v.artifactId))]))
  const byId = new Map(all.map((r) => [r.id, r]))
  const parent = (v: { parentVersionId: string | null }) =>
    v.parentVersionId ? byId.get(v.parentVersionId) : undefined
  for (const { v, screens } of need) {
    const f: Fallback = { screens: new Map() }
    const want = new Set(screens)
    let thumb = !v.thumbnailHash
    for (let p = parent(v), hops = 0; p && (thumb || want.size) && hops < all.length; p = parent(p), hops++) {
      if (thumb && p.thumbnailHash) {
        f.thumb = p
        thumb = false
      }
      for (const x of p.screenThumbs) if (want.delete(x.screenId)) f.screens.set(x.screenId, p.id)
    }
    if (f.thumb || f.screens.size) out.set(v.id, f)
  }
  return out
}

const digestOf = (files: ArtifactFile[]) =>
  createHash('sha256').update(artifactDigestText(files)).digest('hex')

const versionRows = (db: Read, where: SQL | undefined) =>
  db
    .select({ v: artifactVersions, bot: bots.name, user: users.name })
    .from(artifactVersions)
    .leftJoin(runs, eq(runs.id, artifactVersions.runId))
    .leftJoin(bots, eq(bots.id, runs.botId))
    .leftJoin(users, eq(users.id, artifactVersions.userId))
    .where(where)

type VersionRow = Awaited<ReturnType<typeof versionRows>>[number]

const screenThumbUrl = (artifactId: string, versionId: string, screenId: string) =>
  `/api/artifacts/${artifactId}/versions/${versionId}/screens/${screenId}/thumbnail`

function summary({ v, bot, user }: VersionRow, fb?: Fallback): ArtifactVersionSummary {
  const screens = [
    ...v.screenThumbs.map((x) => ({
      screenId: x.screenId,
      url: screenThumbUrl(v.artifactId, v.id, x.screenId),
    })),
    ...[...(fb?.screens ?? [])].map(([screenId, from]) => ({
      screenId,
      url: screenThumbUrl(v.artifactId, from, screenId),
      stale: true,
    })),
  ]
  return {
    id: v.id,
    artifactId: v.artifactId,
    n: v.n,
    parentVersionId: v.parentVersionId,
    source: v.source as ArtifactVersionSource,
    runId: v.runId,
    userId: v.userId,
    digest: v.digest,
    thumbnailUrl: thumbnailUrl(fb?.thumb ?? v),
    ...(fb?.thumb && { thumbnailStale: true }),
    ...(screens.length > 0 && { screenThumbs: screens }),
    stale: v.stale,
    issues: v.issues,
    createdAt: v.createdAt.toISOString(),
    authorName: bot ?? user ?? null,
  }
}

export const versionDto = (row: VersionRow, fb?: Fallback): ArtifactVersionDto => ({
  ...summary(row, fb),
  files: row.v.files,
})

/** Ids of `ids` a live run has checked out. */
async function runningIds(db: Read, groupId: string) {
  const live = await db
    .select({ ids: runs.artifacts })
    .from(runs)
    .where(and(eq(runs.groupId, groupId), inArray(runs.status, ACTIVE)))
  return new Set(live.flatMap((r) => r.ids))
}

export async function isRunning(db: Read, a: Artifact) {
  return (await runningIds(db, a.groupId)).has(a.id)
}

/** Runs per bot of the group waiting for their machine (offline_wait): ArtifactDto.queued. */
async function offlineWaits(db: Read, groupId: string) {
  const rows = await db
    .select({ botId: runs.botId, n: count() })
    .from(runs)
    .where(and(eq(runs.groupId, groupId), eq(runs.status, 'offline_wait')))
    .groupBy(runs.botId)
  return new Map(rows.map((r) => [r.botId, r.n]))
}

export async function manifestOf(a: Artifact, v: Version | undefined): Promise<GgArtifactManifest | null> {
  const f = v?.files.find((x) => x.path === GG_ARTIFACT_MANIFEST)
  if (!f) return null
  const parsed = parseManifest(
    (await readBlob(a.groupId, f.hash).catch(() => Buffer.from(''))).toString('utf8'),
  )
  return 'manifest' in parsed ? parsed.manifest : null
}

type Live = { running: boolean; waits: Map<string, number>; fb?: Fallback }

function dto(a: Artifact, head: VersionRow | undefined, live: Live): ArtifactDto {
  const queuedRunCount = (a.botId && live.waits.get(a.botId)) || 0
  return {
    id: a.id,
    groupId: a.groupId,
    title: a.title,
    dir: a.dir,
    pluginId: a.pluginId,
    pluginVersionId: a.pluginVersionId,
    designSystemId: a.designSystemId,
    headVersionId: a.headVersionId,
    head: head ? summary(head, live.fb) : null,
    createdAt: a.createdAt.toISOString(),
    updatedAt: a.updatedAt.toISOString(),
    archivedAt: a.archivedAt?.toISOString() ?? null,
    running: live.running,
    queued: queuedRunCount > 0,
    queuedRunCount,
    favorites: a.favorites,
    botId: a.botId,
    visibility: a.visibility as ArtifactVisibility,
    createdBy: a.createdBy,
  }
}

/** The group's artifacts, without the private ones `viewer` may not open. */
export async function listArtifacts(
  ctx: Ctx,
  groupId: string,
  viewer: { userId: string; isAdmin: boolean },
): Promise<ArtifactDto[]> {
  const all = await ctx.db
    .select({ a: artifacts, owner: bots.ownerId })
    .from(artifacts)
    .leftJoin(bots, eq(bots.id, artifacts.botId))
    .where(and(eq(artifacts.groupId, groupId), isNull(artifacts.archivedAt)))
    .orderBy(desc(artifacts.updatedAt))
  const list = all
    .filter(
      (r) =>
        r.a.visibility !== 'private' || viewer.isAdmin || [r.a.createdBy, r.owner].includes(viewer.userId),
    )
    .map((r) => r.a)
  const heads = list.flatMap((a) => (a.headVersionId ? [a.headVersionId] : []))
  const [rows, running, waits] = await Promise.all([
    heads.length ? versionRows(ctx.db, inArray(artifactVersions.id, heads)) : [],
    runningIds(ctx.db, groupId),
    offlineWaits(ctx.db, groupId),
  ])
  const byId = new Map(rows.map((r) => [r.v.id, r]))
  const fb = await fallbacks(
    ctx.db,
    rows.map((r) => r.v),
  )
  return list.map((a) => {
    const head = a.headVersionId ? byId.get(a.headVersionId) : undefined
    return dto(a, head, { running: running.has(a.id), waits, fb: head && fb.get(head.v.id) })
  })
}

export async function artifactDetail(ctx: Ctx, a: Artifact): Promise<ArtifactDto> {
  const [head] = a.headVersionId ? await versionRows(ctx.db, eq(artifactVersions.id, a.headVersionId)) : []
  const [redo] = a.headVersionId
    ? await ctx.db
        .select({ id: artifactVersions.id })
        .from(artifactVersions)
        .where(
          and(
            eq(artifactVersions.artifactId, a.id),
            eq(artifactVersions.parentVersionId, a.headVersionId),
            eq(artifactVersions.stale, false),
          ),
        )
        .orderBy(desc(artifactVersions.n))
        .limit(1)
    : []
  const fb = head ? (await fallbacks(ctx.db, [head.v])).get(head.v.id) : undefined
  const live = { running: await isRunning(ctx.db, a), waits: await offlineWaits(ctx.db, a.groupId), fb }
  return {
    ...dto(a, head, live),
    manifest: await manifestOf(a, head?.v),
    undoVersionId: head?.v.parentVersionId ?? null,
    redoVersionId: redo?.id ?? null,
  }
}

export async function listVersions(ctx: Ctx, a: Artifact) {
  const rows = await versionRows(ctx.db, eq(artifactVersions.artifactId, a.id)).orderBy(
    desc(artifactVersions.n),
  )
  const fb = await fallbacks(
    ctx.db,
    rows.map((r) => r.v),
  )
  return rows.map((r) => summary(r, fb.get(r.v.id)))
}

export async function findArtifact(db: Read, id: string) {
  if (!isUuid(id)) return undefined
  const [a] = await db.select().from(artifacts).where(eq(artifacts.id, id))
  return a
}

/** Who may open a private artifact or change an artifact's visibility: its creator, its bot's owner, a group admin. */
export async function isArtifactManager(ctx: Ctx, a: Artifact, userId: string, isAdmin: boolean) {
  if (isAdmin || a.createdBy === userId) return true
  if (!a.botId) return false
  const [bot] = await ctx.db.select({ ownerId: bots.ownerId }).from(bots).where(eq(bots.id, a.botId))
  return bot?.ownerId === userId
}

/** The caller's access to `a` (ArtifactDto.visibility); `private`: a member it is hidden from. */
export async function artifactAccess(
  ctx: Ctx,
  a: Artifact,
  userId: string,
): Promise<ArtifactAccess | 'private' | null> {
  const m = await findMember(ctx, a.groupId, userId)
  if (m)
    return a.visibility !== 'private' || (await isArtifactManager(ctx, a, userId, m.member.isAdmin))
      ? 'edit'
      : 'private'
  return a.visibility === 'team' && (await inTeamOfGroup(ctx, a.groupId, userId)) ? 'view' : null
}

/** An artifact `userId` may look at and present. */
export async function viewArtifact(ctx: Ctx, id: string, userId: string) {
  const a = (await findArtifact(ctx.db, id)) ?? fail('not_found', '产物不存在')
  const access = await artifactAccess(ctx, a, userId)
  if (access === 'private') return fail('forbidden', '仅创建人可见')
  if (!access) return fail('not_found', '群不存在或你已不在群内')
  return { a, access }
}

/** An artifact `userId` may change (and annotate, export, hand to a bot): a member of its group it is not hidden from. */
export async function requireArtifact(ctx: Ctx, id: string, userId: string) {
  const { a, access } = await viewArtifact(ctx, id, userId)
  return access === 'edit' ? a : fail('forbidden', '只能查看，进群后才能修改')
}

export async function requireVersion(db: Read, a: Artifact, versionId: string | null | undefined) {
  const id = versionId ?? a.headVersionId ?? fail('not_found', '产物还没有版本')
  const [v] = isUuid(id)
    ? await db
        .select()
        .from(artifactVersions)
        .where(and(eq(artifactVersions.id, id), eq(artifactVersions.artifactId, a.id)))
    : []
  return v ?? fail('not_found', '版本不存在')
}

export async function versionDetail(
  ctx: Ctx,
  a: Artifact,
  versionId: string,
): Promise<ArtifactVersionDetail> {
  const v = await requireVersion(ctx.db, a, versionId)
  const [row] = await versionRows(ctx.db, eq(artifactVersions.id, v.id))
  const manifest = await manifestOf(a, v)
  const fb = (await fallbacks(ctx.db, [v])).get(v.id)
  return { ...versionDto(row as VersionRow, fb), manifest, links: await screenLinks(a, v, manifest) }
}

/** The `data-gg-link`s of every screen the manifest lists. */
async function screenLinks(a: Artifact, v: Version, manifest: GgArtifactManifest | null) {
  const out: ArtifactLink[] = []
  for (const s of manifest?.screens ?? []) {
    const f = v.files.find((x) => x.path === s.file)
    if (!f) continue
    const html = (await readBlob(a.groupId, f.hash)).toString('utf8')
    for (const l of linksOf(html)) out.push({ from: s.id, ...l })
  }
  return out
}

export type SubmitInput = {
  parent: string | null
  submitKey: string | null
  files: ArtifactFile[]
  source: ArtifactVersionSource
  runId: string | null
  userId: string | null
  /** Refuse (409) instead of keeping a stale candidate when the parent is not the head: the panel's edits. */
  onlyHead?: boolean
}

/** Every file's content was uploaded to the artifact store with its declared size. */
async function checkUploaded(a: Artifact, files: ArtifactFile[]) {
  const sizes = await Promise.all(files.map((f) => artifactBlobs.size(a.groupId, f.hash)))
  files.forEach((f, i) => {
    if (sizes[i] === null) fail('invalid', '文件内容未上传：{path}', { path: f.path })
    if (sizes[i] !== f.size) fail('invalid', '文件大小与内容不符：{path}', { path: f.path })
  })
}

/**
 * A new version (§3.2): under the artifact's row lock, a retried `submitKey` gets the version it made; one based on
 * the head becomes the head, anything else is kept as a stale candidate.
 */
export async function submitVersion(ctx: Ctx, a: Artifact, input: SubmitInput) {
  const files = [...input.files].sort((x, y) => (x.path < y.path ? -1 : x.path > y.path ? 1 : 0))
  await checkUploaded(a, files)
  const issues = await lintVersion(
    files,
    (f) => readBlob(a.groupId, f.hash),
    await pluginKit(ctx.db, a.pluginVersionId),
  )
  const out = await ctx.db.transaction(async (tx) => {
    const [locked] = await tx.select().from(artifacts).where(eq(artifacts.id, a.id)).for('update')
    if (!locked) return fail('not_found', '产物不存在')
    if (input.submitKey) {
      const [done] = await tx
        .select()
        .from(artifactVersions)
        .where(and(eq(artifactVersions.artifactId, a.id), eq(artifactVersions.submitKey, input.submitKey)))
      if (done) return { version: done, head: !done.stale, retried: true }
    }
    const parent = input.parent
    if (parent) {
      const [p] = isUuid(parent)
        ? await tx
            .select({ id: artifactVersions.id })
            .from(artifactVersions)
            .where(and(eq(artifactVersions.id, parent), eq(artifactVersions.artifactId, a.id)))
        : []
      if (!p) fail('invalid', '父版本不属于该产物')
    }
    const head = parent === locked.headVersionId
    if (!head && input.onlyHead) fail('conflict', '产物已有新版本，请刷新后重做')
    const [last] = await tx
      .select({ n: artifactVersions.n })
      .from(artifactVersions)
      .where(eq(artifactVersions.artifactId, a.id))
      .orderBy(desc(artifactVersions.n))
      .limit(1)
    const [version] = await tx
      .insert(artifactVersions)
      .values({
        artifactId: a.id,
        n: (last?.n ?? 0) + 1,
        parentVersionId: parent,
        source: input.source,
        runId: input.runId,
        userId: input.userId,
        submitKey: input.submitKey,
        files,
        digest: digestOf(files),
        stale: !head,
        issues,
      })
      .returning()
    await tx
      .update(artifacts)
      .set({ updatedAt: ctx.now(), ...(head && { headVersionId: (version as Version).id }) })
      .where(eq(artifacts.id, a.id))
    return { version: version as Version, head, retried: false }
  })
  if (!out.retried) await refreshCard(ctx, a.id)
  if (!out.retried && out.head && input.source === 'edit') await snapshotPending(ctx, eq(artifacts.id, a.id))
  return { version: out.version, head: out.head, stale: out.version.stale }
}

/**
 * 设为当前版本 / 采用此版本 / Undo / Redo: moves the head to an existing version (versions stay immutable; a stale
 * candidate adopted this way stops being one). The next run checks the new head out.
 */
export async function restoreVersion(ctx: Ctx, a: Artifact, versionId: string) {
  if (await isRunning(ctx.db, a)) fail('conflict', '产物正在被 AI 修改，请等运行结束')
  const v = await requireVersion(ctx.db, a, versionId)
  await ctx.db.transaction(async (tx) => {
    const [locked] = await tx.select().from(artifacts).where(eq(artifacts.id, a.id)).for('update')
    if (locked?.headVersionId === v.id) fail('conflict', '已经是当前版本')
    if (v.stale) await tx.update(artifactVersions).set({ stale: false }).where(eq(artifactVersions.id, v.id))
    await tx
      .update(artifacts)
      .set({ headVersionId: v.id, updatedAt: ctx.now() })
      .where(eq(artifacts.id, a.id))
  })
  await refreshCard(ctx, a.id)
  await snapshotPending(ctx, eq(artifacts.id, a.id))
}

export async function cardOf(db: Read, a: Artifact): Promise<ArtifactCard> {
  const [latest] = await db
    .select()
    .from(artifactVersions)
    .where(eq(artifactVersions.artifactId, a.id))
    .orderBy(desc(artifactVersions.n))
    .limit(1)
  const head = !a.headVersionId
    ? undefined
    : latest?.id === a.headVersionId
      ? latest
      : (await db.select().from(artifactVersions).where(eq(artifactVersions.id, a.headVersionId)))[0]
  const stale = head ? (await fallbacks(db, [head])).get(head.id)?.thumb : undefined
  return {
    type: 'artifact',
    artifactId: a.id,
    title: a.title,
    versionN: head?.n ?? null,
    status: !head ? 'generating' : latest && latest.n > head.n && latest.stale ? 'stale-candidate' : 'ready',
    thumbnailUrl: head ? thumbnailUrl(stale ?? head) : null,
    ...(stale && { thumbnailStale: true }),
    issueCount: head?.issues.length ?? 0,
    visibility: a.visibility as ArtifactVisibility,
    createdBy: a.createdBy,
  }
}

/** The artifact's card follows its versions and title in place. */
export async function refreshCard(ctx: Ctx, artifactId: string) {
  const a = await findArtifact(ctx.db, artifactId)
  if (!a?.messageId) return
  const [row] = await ctx.db.select().from(messages).where(eq(messages.id, a.messageId))
  if (!row) return
  const meta = row.meta as MessageMeta
  const card = await cardOf(ctx.db, a)
  const i18n = meta.i18n?.params?.title !== undefined && {
    ...meta.i18n,
    params: { ...meta.i18n.params, title: a.title },
  }
  const [updated] = await ctx.db
    .update(messages)
    .set({
      meta: { ...meta, card, ...(i18n && { i18n }) },
      ...(i18n && { body: zh(i18n.key as ProtocolKey, i18n.params) }),
    })
    .where(eq(messages.id, row.id))
    .returning()
  const dto = messageDto(updated as MessageRow, await authorName(ctx, updated as MessageRow))
  ctx.bus.publish(await memberIds(ctx, dto.groupId), { t: 'message.edited', message: dto })
}

/** Last status each run's artifacts were refreshed for (this process): only changes push their cards again. */
const seenStatus = new Map<string, string>()

/**
 * A run's status changed: the cards of the artifacts it has checked out and of its bot's artifacts follow, so open
 * canvases reload `running` / `queued` (R04).
 */
export async function refreshRunArtifacts(
  ctx: Ctx,
  rows: { id: string; groupId: string; botId: string; status: string }[],
) {
  for (const run of rows) {
    if (seenStatus.get(run.id) === run.status) continue
    const ended = TERMINAL_RUN_STATUS.includes(run.status as RunStatus)
    if (ended) seenStatus.delete(run.id)
    else seenStatus.set(run.id, run.status)
    const checkedOut = sql`${artifacts.id}::text in (select jsonb_array_elements_text(${runs.artifacts}) from ${runs} where ${runs.id} = ${run.id})`
    const list = await ctx.db
      .select({ id: artifacts.id })
      .from(artifacts)
      .where(
        and(
          eq(artifacts.groupId, run.groupId),
          isNull(artifacts.archivedAt),
          or(eq(artifacts.botId, run.botId), checkedOut),
        ),
      )
    for (const a of list) await refreshCard(ctx, a.id)
    if (ended)
      await snapshotPending(
        ctx,
        and(eq(artifacts.groupId, run.groupId), eq(artifacts.botId, run.botId)) as SQL,
      )
  }
}

/** Artifacts a message points at: its `artifactRefs`, or the artifact card it quotes. */
async function referenced(tx: Tx, meta: MessageMeta) {
  const ids = new Set((meta.artifactRefs ?? []).filter(isUuid))
  if (meta.quote?.kind === 'message' && isUuid(meta.quote.id)) {
    const [q] = await tx.select({ meta: messages.meta }).from(messages).where(eq(messages.id, meta.quote.id))
    const card = (q?.meta as MessageMeta | undefined)?.card
    if (card?.type === 'artifact') ids.add(card.artifactId)
  }
  return [...ids]
}

/**
 * RunStart.artifacts (§3.2): the ones the trigger points at or the bot asked for (artifact_checkout) always, then the bot's own (made for it or changed by
 * its runs), most recently updated first, up to RUN_ARTIFACTS_MAX; `exclude` is every artifact directory of the group.
 */
export async function runArtifacts(tx: Tx, groupId: string, botId: string, meta: MessageMeta) {
  const wanted = sql`${artifacts.checkoutBotIds} @> ${JSON.stringify([botId])}::jsonb`
  const asked = await tx
    .update(artifacts)
    .set({ checkoutBotIds: sql`${artifacts.checkoutBotIds} - ${botId}::text` })
    .where(and(eq(artifacts.groupId, groupId), wanted))
    .returning({ id: artifacts.id })
  const targets = [...new Set([...(await referenced(tx, meta)), ...asked.map((r) => r.id)])]
  const cols = { a: artifacts, head: artifactVersions }
  const base = () =>
    tx
      .select(cols)
      .from(artifacts)
      .leftJoin(artifactVersions, eq(artifactVersions.id, artifacts.headVersionId))
  const [first, all] = await Promise.all([
    targets.length
      ? base().where(
          and(eq(artifacts.groupId, groupId), inArray(artifacts.id, targets), isNull(artifacts.archivedAt)),
        )
      : Promise.resolve([]),
    tx.select({ dir: artifacts.dir }).from(artifacts).where(eq(artifacts.groupId, groupId)),
  ])
  const touched = sql`exists (select 1 from ${artifactVersions} v join ${runs} r on r.id = v.run_id
    where v.artifact_id = ${artifacts.id} and r.bot_id = ${botId})`
  const rest =
    first.length < RUN_ARTIFACTS_MAX
      ? await base()
          .where(
            and(
              eq(artifacts.groupId, groupId),
              isNull(artifacts.archivedAt),
              first.length
                ? notInArray(
                    artifacts.id,
                    first.map((r) => r.a.id),
                  )
                : undefined,
              or(eq(artifacts.botId, botId), touched),
            ),
          )
          .orderBy(desc(artifacts.updatedAt))
          .limit(RUN_ARTIFACTS_MAX - first.length)
      : []
  const picked = [...first, ...rest].slice(0, RUN_ARTIFACTS_MAX)
  const refs: DaemonArtifactRef[] = picked.map(({ a, head }) => ({
    id: a.id,
    dir: a.dir as DaemonArtifactRef['dir'],
    headVersionId: a.headVersionId,
    digest: head?.digest ?? null,
  }))
  return { refs, exclude: all.map((r) => r.dir) as DaemonArtifactRef['dir'][], note: issuesNote(picked) }
}

/** The design-rule findings of the checked-out heads, for the agent to fix first (agent-facing: not translated). */
function issuesNote(picked: { a: Artifact; head: Version | null }[]) {
  const lines: string[] = []
  for (const { a, head } of picked)
    for (const i of head?.issues ?? [])
      if (lines.length < ARTIFACT_CONTEXT_ISSUES_MAX)
        lines.push(`- ${a.dir}/${i.file ?? ''}（v${head?.n}）[${i.code}] ${i.message}`)
  return lines.length ? `以下产物的当前版本有规范问题，动手前先修复：\n${lines.join('\n')}` : null
}

/** PATCH /api/artifacts/:id — the card follows. */
export async function renameArtifact(ctx: Ctx, a: Artifact, title: string) {
  await ctx.db.update(artifacts).set({ title, updatedAt: ctx.now() }).where(eq(artifacts.id, a.id))
  await refreshCard(ctx, a.id)
  return (await findArtifact(ctx.db, a.id)) as Artifact
}

/**
 * POST /api/artifacts/:id/duplicate — a new artifact in the group whose v1 lists the head's files (same blobs, same
 * group store), in a new folder, with its own card.
 */
export async function duplicateArtifact(ctx: Ctx, a: Artifact, userId: string) {
  const head = await requireVersion(ctx.db, a, null)
  const copy = await ctx.db.transaction(async (tx) => {
    const [made] = await tx
      .insert(artifacts)
      .values({
        groupId: a.groupId,
        pluginId: a.pluginId,
        pluginVersionId: a.pluginVersionId,
        designSystemId: a.designSystemId,
        title: t('{title}（副本）', { title: a.title }).slice(0, 80),
        dir: newArtifactDir(`${a.dir.slice('design/'.length, 'design/'.length + 50)}-copy`),
        botId: a.botId,
        createdBy: userId,
        favorites: a.favorites,
      })
      .returning()
    const [v1] = await tx
      .insert(artifactVersions)
      .values({
        artifactId: (made as Artifact).id,
        n: 1,
        parentVersionId: null,
        source: 'edit',
        runId: null,
        userId,
        submitKey: null,
        files: head.files,
        digest: head.digest,
        thumbnailHash: head.thumbnailHash,
        screenThumbs: head.screenThumbs,
        stale: false,
        issues: head.issues,
      })
      .returning()
    const [withHead] = await tx
      .update(artifacts)
      .set({ headVersionId: (v1 as Version).id })
      .where(eq(artifacts.id, (made as Artifact).id))
      .returning()
    return withHead as Artifact
  })
  const posted = await postEvent(
    ctx,
    copy.groupId,
    '产物「{title}」',
    { title: copy.title },
    { card: await cardOf(ctx.db, copy) },
  )
  const [withCard] = await ctx.db
    .update(artifacts)
    .set({ messageId: posted.id })
    .where(eq(artifacts.id, copy.id))
    .returning()
  return withCard as Artifact
}
