import { createHash, randomBytes } from 'node:crypto'
import {
  ARTIFACT_CONTEXT_ISSUES_MAX,
  type ArtifactCard,
  type ArtifactDto,
  type ArtifactFile,
  type ArtifactLink,
  type ArtifactVersionDetail,
  type ArtifactVersionDto,
  type ArtifactVersionSource,
  type ArtifactVersionSummary,
  artifactDigestText,
  type DaemonArtifactRef,
  GG_ARTIFACT_MANIFEST,
  type GgArtifactManifest,
} from '@gonggong/protocol'
import { and, desc, eq, inArray, isNull, notInArray, or, type SQL, sql } from 'drizzle-orm'
import type { Ctx } from '../../context.js'
import type { Db } from '../../db/client.js'
import { artifacts, artifactVersions, bots, messages, runs, users } from '../../db/schema.js'
import { fail } from '../../lib/errors.js'
import { isUuid } from '../../lib/ids.js'
import { requireMember } from '../groups/service.js'
import { authorName, type MessageMeta, type MessageRow, memberIds, messageDto } from '../messages/service.js'
import { artifactBlobs, readBlob } from './blobs.js'
import { linksOf } from './html.js'
import { pluginKit } from './kit.js'
import { lintVersion, parseManifest } from './lint.js'

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

export const thumbnailUrl = (v: Pick<Version, 'id' | 'artifactId' | 'thumbnailHash'>) =>
  v.thumbnailHash ? `/api/artifacts/${v.artifactId}/versions/${v.id}/thumbnail` : null

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

function summary({ v, bot, user }: VersionRow): ArtifactVersionSummary {
  return {
    id: v.id,
    artifactId: v.artifactId,
    n: v.n,
    parentVersionId: v.parentVersionId,
    source: v.source as ArtifactVersionSource,
    runId: v.runId,
    userId: v.userId,
    digest: v.digest,
    thumbnailUrl: thumbnailUrl(v),
    stale: v.stale,
    issues: v.issues,
    createdAt: v.createdAt.toISOString(),
    authorName: bot ?? user ?? null,
  }
}

export const versionDto = (row: VersionRow): ArtifactVersionDto => ({ ...summary(row), files: row.v.files })

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

export async function manifestOf(a: Artifact, v: Version | undefined): Promise<GgArtifactManifest | null> {
  const f = v?.files.find((x) => x.path === GG_ARTIFACT_MANIFEST)
  if (!f) return null
  const parsed = parseManifest(
    (await readBlob(a.groupId, f.hash).catch(() => Buffer.from(''))).toString('utf8'),
  )
  return 'manifest' in parsed ? parsed.manifest : null
}

function dto(a: Artifact, head: VersionRow | undefined, running: boolean): ArtifactDto {
  return {
    id: a.id,
    groupId: a.groupId,
    title: a.title,
    dir: a.dir,
    pluginId: a.pluginId,
    pluginVersionId: a.pluginVersionId,
    designSystemId: a.designSystemId,
    headVersionId: a.headVersionId,
    head: head ? summary(head) : null,
    createdAt: a.createdAt.toISOString(),
    updatedAt: a.updatedAt.toISOString(),
    archivedAt: a.archivedAt?.toISOString() ?? null,
    running,
    favorites: a.favorites,
  }
}

export async function listArtifacts(ctx: Ctx, groupId: string): Promise<ArtifactDto[]> {
  const list = await ctx.db
    .select()
    .from(artifacts)
    .where(eq(artifacts.groupId, groupId))
    .orderBy(desc(artifacts.updatedAt))
  const heads = list.flatMap((a) => (a.headVersionId ? [a.headVersionId] : []))
  const [rows, running] = await Promise.all([
    heads.length ? versionRows(ctx.db, inArray(artifactVersions.id, heads)) : [],
    runningIds(ctx.db, groupId),
  ])
  const byId = new Map(rows.map((r) => [r.v.id, r]))
  return list.map((a) => dto(a, a.headVersionId ? byId.get(a.headVersionId) : undefined, running.has(a.id)))
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
  return {
    ...dto(a, head, await isRunning(ctx.db, a)),
    manifest: await manifestOf(a, head?.v),
    undoVersionId: head?.v.parentVersionId ?? null,
    redoVersionId: redo?.id ?? null,
  }
}

export async function listVersions(ctx: Ctx, a: Artifact) {
  const rows = await versionRows(ctx.db, eq(artifactVersions.artifactId, a.id)).orderBy(
    desc(artifactVersions.n),
  )
  return rows.map(summary)
}

export async function findArtifact(db: Read, id: string) {
  if (!isUuid(id)) return undefined
  const [a] = await db.select().from(artifacts).where(eq(artifacts.id, id))
  return a
}

/** An artifact of a group `userId` is a member of. */
export async function requireArtifact(ctx: Ctx, id: string, userId: string) {
  const a = (await findArtifact(ctx.db, id)) ?? fail('not_found', '产物不存在')
  await requireMember(ctx, a.groupId, userId)
  return a
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
  return { ...versionDto(row as VersionRow), manifest, links: await screenLinks(a, v, manifest) }
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
  return {
    type: 'artifact',
    artifactId: a.id,
    title: a.title,
    versionN: head?.n ?? null,
    status: !head ? 'generating' : latest && latest.n > head.n && latest.stale ? 'stale-candidate' : 'ready',
    thumbnailUrl: head ? thumbnailUrl(head) : null,
    issueCount: head?.issues.length ?? 0,
  }
}

/** The artifact's card follows its versions in place. */
export async function refreshCard(ctx: Ctx, artifactId: string) {
  const a = await findArtifact(ctx.db, artifactId)
  if (!a?.messageId) return
  const [row] = await ctx.db.select().from(messages).where(eq(messages.id, a.messageId))
  if (!row) return
  const card = await cardOf(ctx.db, a)
  const [updated] = await ctx.db
    .update(messages)
    .set({ meta: { ...(row.meta as MessageMeta), card } })
    .where(eq(messages.id, row.id))
    .returning()
  const dto = messageDto(updated as MessageRow, await authorName(ctx, updated as MessageRow))
  ctx.bus.publish(await memberIds(ctx, dto.groupId), { t: 'message.edited', message: dto })
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
      ? base().where(and(eq(artifacts.groupId, groupId), inArray(artifacts.id, targets)))
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
