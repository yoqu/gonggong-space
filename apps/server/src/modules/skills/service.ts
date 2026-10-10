import { createHash } from 'node:crypto'
import { SKILL_MAX_BYTES, type SkillDetailDto, type SkillDto, type SkillFile } from '@gonggong/protocol'
import { and, desc, eq, inArray, isNull, ne, or, type SQL } from 'drizzle-orm'
import { parse as parseYaml } from 'yaml'
import type { Ctx } from '../../context.js'
import type { Db } from '../../db/client.js'
import { groups, skills, skillVersions, users } from '../../db/schema.js'
import { audit } from '../../lib/audit.js'
import { fail } from '../../lib/errors.js'
import { type Layer, RANK, type Scope } from '../mcp/routes.js'

export type SkillRow = typeof skills.$inferSelect
type Version = typeof skillVersions.$inferSelect
export type Listed = { skill: SkillRow; version: Version; updatedBy: string | null }
export type Snapshot = ReturnType<typeof snapshot>
/** Extra audit detail, e.g. the bot and run acting for the user. */
type Extra = Record<string, unknown>

/** Claude Code's skill-name rule; Codex accepts the same. */
const NAME = /^[a-z0-9]+(-[a-z0-9]+)*$/
const NAME_MAX = 64
const DESCRIPTION_MAX = 1024
const BASE64 = /^[A-Za-z0-9+/]*={0,2}$/

const bytes = (f: SkillFile) =>
  f.encoding === 'base64' ? Buffer.from(f.content, 'base64').length : Buffer.byteLength(f.content)

const validPath = (p: string) =>
  !p.includes('\\') && !p.includes('\0') && p.split('/').every((s) => s !== '' && s !== '.' && s !== '..')

export function frontmatter(files: SkillFile[]) {
  const main = files.find((f) => f.path === 'SKILL.md')
  if (!main || main.encoding !== 'utf8') return fail('invalid', '缺少 SKILL.md')
  const m = /^---\r?\n([\s\S]*?)\r?\n---(\r?\n|$)/.exec(main.content)
  let meta: unknown
  try {
    meta = m ? parseYaml(m[1]!) : null
  } catch {
    meta = null
  }
  if (!meta || typeof meta !== 'object') return fail('invalid', 'SKILL.md 缺少 frontmatter')
  const { name, description } = meta as Record<string, unknown>
  if (typeof name !== 'string' || !NAME.test(name) || name.length > NAME_MAX)
    return fail('invalid', 'SKILL.md 的 name 只能用小写字母、数字和连字符，最长 64 个字符')
  if (typeof description !== 'string' || !description.trim() || description.length > DESCRIPTION_MAX)
    return fail('invalid', 'SKILL.md 缺少 description（最长 1024 个字符）')
  return { name, description: description.trim() }
}

/** Validates the folder and returns it sorted by path, with its frontmatter, digest and size. */
export function snapshot(input: SkillFile[]) {
  const files = [...input].sort((a, b) => (a.path < b.path ? -1 : 1))
  const seen = new Set<string>()
  for (const f of files) {
    if (!validPath(f.path)) fail('invalid', '文件路径不合法：{path}', { path: f.path })
    if (seen.has(f.path)) fail('invalid', '文件重复：{path}', { path: f.path })
    if (f.encoding === 'base64' && (f.content.length % 4 !== 0 || !BASE64.test(f.content)))
      fail('invalid', '文件内容不是合法的 base64：{path}', { path: f.path })
    seen.add(f.path)
  }
  const size = files.reduce((n, f) => n + bytes(f), 0)
  if (size > SKILL_MAX_BYTES) fail('invalid', 'Skill 不能超过 5 MB')
  const hash = createHash('sha256')
  for (const f of files) hash.update(`${f.path}\0${f.encoding}\0${f.content}\0`)
  return { files, size, digest: hash.digest('hex'), ...frontmatter(files) }
}

export const inLayer = (l: Layer) =>
  and(
    eq(skills.scope, l.scope),
    l.teamId ? eq(skills.teamId, l.teamId) : isNull(skills.teamId),
    l.groupId ? eq(skills.groupId, l.groupId) : isNull(skills.groupId),
  )

/** Skills joined with their current version and last editor. */
export const listed = (db: Pick<Db, 'select'>) =>
  db
    .select({ skill: skills, version: skillVersions, updatedBy: users.name })
    .from(skills)
    .innerJoin(skillVersions, eq(skillVersions.id, skills.versionId))
    .leftJoin(users, eq(users.id, skills.updatedBy))

export const dto = ({ skill, version, updatedBy }: Listed): SkillDto => ({
  id: skill.id,
  name: skill.name,
  description: skill.description,
  enabled: skill.enabled,
  versionId: version.id,
  version: version.version,
  size: version.size,
  updatedBy,
  updatedAt: skill.updatedAt.toISOString(),
})

export const detailDto = (row: Listed): SkillDetailDto => ({
  ...dto(row),
  files: row.version.files as SkillFile[],
})

export async function findSkill(ctx: Ctx, l: Layer, where: SQL) {
  const [row] = await listed(ctx.db).where(and(inLayer(l), where))
  return row
}

async function nameTaken(ctx: Ctx, l: Layer, name: string, except?: string) {
  const [taken] = await ctx.db
    .select({ id: skills.id })
    .from(skills)
    .where(and(inLayer(l), eq(skills.name, name), except ? ne(skills.id, except) : undefined))
  if (taken) fail('conflict', 'Skill 名称已存在')
}

const log = (
  ctx: Ctx,
  actorId: string,
  l: Layer,
  action: string,
  row: SkillRow,
  version?: number,
  extra?: Extra,
) =>
  audit(ctx, {
    category: 'admin',
    actorUserId: actorId,
    teamId: l.teamId,
    groupId: l.groupId,
    action,
    detail: { id: row.id, layer: l.scope, name: row.name, enabled: row.enabled, version, ...extra },
  })

/** Appends a version with the next number. */
async function addVersion(tx: Pick<Db, 'select' | 'insert'>, skillId: string, s: Snapshot, by: string) {
  const [last] = await tx
    .select({ version: skillVersions.version })
    .from(skillVersions)
    .where(eq(skillVersions.skillId, skillId))
    .orderBy(desc(skillVersions.version))
    .limit(1)
  const [v] = await tx
    .insert(skillVersions)
    .values({
      skillId,
      version: (last?.version ?? 0) + 1,
      files: s.files,
      digest: s.digest,
      size: s.size,
      createdBy: by,
    })
    .returning()
  return v!
}

export async function createSkill(
  ctx: Ctx,
  l: Layer,
  s: Snapshot,
  enabled: boolean,
  actorId: string,
  extra?: Extra,
) {
  await nameTaken(ctx, l, s.name)
  const row = await ctx.db.transaction(async (tx) => {
    const [skill] = await tx
      .insert(skills)
      .values({
        ...l,
        name: s.name,
        description: s.description,
        enabled,
        updatedBy: actorId,
        updatedAt: ctx.now(),
      })
      .onConflictDoNothing()
      .returning()
    if (!skill) return fail('conflict', 'Skill 名称已存在')
    const v = await addVersion(tx, skill.id, s, actorId)
    await tx.update(skills).set({ versionId: v.id }).where(eq(skills.id, skill.id))
    return skill
  })
  await log(ctx, actorId, l, 'skill.create', row, 1, extra)
  return row
}

/** New files make a new version unless identical to the current one. */
export async function updateSkill(
  ctx: Ctx,
  l: Layer,
  current: Listed,
  change: { snapshot?: Snapshot; enabled?: boolean },
  actorId: string,
  extra?: Extra,
) {
  const s = change.snapshot
  if (s) await nameTaken(ctx, l, s.name, current.skill.id)
  const changed = s && s.digest !== current.version.digest
  const [row, version] = await ctx.db.transaction(async (tx) => {
    const v = changed ? await addVersion(tx, current.skill.id, s, actorId) : current.version
    const [updated] = await tx
      .update(skills)
      .set({
        ...(s && { name: s.name, description: s.description }),
        enabled: change.enabled ?? current.skill.enabled,
        versionId: v.id,
        updatedBy: actorId,
        updatedAt: ctx.now(),
      })
      .where(eq(skills.id, current.skill.id))
      .returning()
    return [updated!, v.version] as const
  })
  await log(ctx, actorId, l, 'skill.update', row, version, extra)
  return { skill: row, version }
}

export async function deleteSkill(ctx: Ctx, l: Layer, skill: SkillRow, actorId: string, extra?: Extra) {
  await ctx.db.delete(skills).where(eq(skills.id, skill.id))
  await log(ctx, actorId, l, 'skill.delete', skill, undefined, extra)
}

const versionRows = (ctx: Ctx, where: SQL) =>
  ctx.db
    .select({ version: skillVersions, createdBy: users.name })
    .from(skillVersions)
    .leftJoin(users, eq(users.id, skillVersions.createdBy))
    .where(where)

export const skillVersionList = (ctx: Ctx, skillId: string) =>
  versionRows(ctx, eq(skillVersions.skillId, skillId)).orderBy(desc(skillVersions.version))

/** One version of the skill, by id or number. */
export async function skillVersion(ctx: Ctx, skillId: string, which: SQL) {
  const [v] = await versionRows(ctx, and(eq(skillVersions.skillId, skillId), which)!)
  return v
}

/** Points the skill back at an earlier version (no new version is made). */
export async function rollbackSkill(
  ctx: Ctx,
  l: Layer,
  skill: SkillRow,
  v: Version,
  actorId: string,
  extra?: Extra,
) {
  const s = frontmatter(v.files as SkillFile[])
  await nameTaken(ctx, l, s.name, skill.id)
  const [row] = await ctx.db
    .update(skills)
    .set({ ...s, versionId: v.id, updatedBy: actorId, updatedAt: ctx.now() })
    .where(eq(skills.id, skill.id))
    .returning()
  await log(ctx, actorId, l, 'skill.rollback', row!, v.version, extra)
  return row!
}

/** Skills applying to the group, enabled or not: platform, the group's team and the group itself. */
export function visibleIn(db: Pick<Db, 'select'>, groupId: string) {
  const team = db.select({ id: groups.teamId }).from(groups).where(eq(groups.id, groupId))
  return or(
    eq(skills.scope, 'platform'),
    and(eq(skills.scope, 'team'), inArray(skills.teamId, team)),
    and(eq(skills.scope, 'group'), eq(skills.groupId, groupId)),
  )
}

/** One per name, sorted by name: a lower layer replaces a same-named skill above it. */
export function mergeSkills<T extends { scope: string; name: string }>(rows: T[]) {
  const merged = new Map<string, T>()
  for (const r of [...rows].sort((a, b) => RANK[a.scope as Scope] - RANK[b.scope as Scope]))
    merged.set(r.name, r)
  return [...merged.values()].sort((a, b) => (a.name < b.name ? -1 : 1))
}

/** Enabled skills for a run in the group, merged across layers (as `enabledMcpServers`). */
export async function enabledSkills(db: Pick<Db, 'select'>, groupId: string) {
  const rows = await db
    .select({
      scope: skills.scope,
      name: skills.name,
      description: skills.description,
      versionId: skillVersions.id,
      digest: skillVersions.digest,
    })
    .from(skills)
    .innerJoin(skillVersions, eq(skillVersions.id, skills.versionId))
    .where(and(eq(skills.enabled, true), visibleIn(db, groupId)))
  return mergeSkills(rows).map(({ name, description, versionId, digest }) => ({
    name,
    description,
    versionId,
    digest,
  }))
}
