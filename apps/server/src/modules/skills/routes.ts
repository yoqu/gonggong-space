import { createHash } from 'node:crypto'
import {
  CreateSkillReq,
  RollbackSkillReq,
  SKILL_MAX_BYTES,
  type SkillDetailDto,
  type SkillDto,
  type SkillFile,
  type SkillVersionDto,
  UpdateSkillReq,
} from '@gonggong/protocol'
import { and, asc, desc, eq, inArray, isNull, ne, or } from 'drizzle-orm'
import type { FastifyInstance } from 'fastify'
import { parse as parseYaml } from 'yaml'
import type { Ctx } from '../../context.js'
import { requireMachine } from '../../daemon/auth.js'
import type { Db } from '../../db/client.js'
import { bots, groupBots, groups, skills, skillVersions, users } from '../../db/schema.js'
import { audit } from '../../lib/audit.js'
import { fail } from '../../lib/errors.js'
import { idParam } from '../../lib/ids.js'
import { type Authorize, eachLayer, type Layer, RANK, type Scope } from '../mcp/routes.js'

type Row = typeof skills.$inferSelect
type Version = typeof skillVersions.$inferSelect
type Params = { Params: { id?: string; skillId?: string; versionId?: string } }

/** Claude Code's skill-name rule; Codex accepts the same. */
const NAME = /^[a-z0-9]+(-[a-z0-9]+)*$/
const NAME_MAX = 64
const DESCRIPTION_MAX = 1024
const BASE64 = /^[A-Za-z0-9+/]*={0,2}$/
/** Up to 8 MB of base64 in the JSON body; the decoded files are capped at SKILL_MAX_BYTES. */
const BODY_LIMIT = 8 * 1024 * 1024

const bytes = (f: SkillFile) =>
  f.encoding === 'base64' ? Buffer.from(f.content, 'base64').length : Buffer.byteLength(f.content)

const validPath = (p: string) =>
  !p.includes('\\') && !p.includes('\0') && p.split('/').every((s) => s !== '' && s !== '.' && s !== '..')

function frontmatter(files: SkillFile[]) {
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
function snapshot(input: SkillFile[]) {
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

const inLayer = (l: Layer) =>
  and(
    eq(skills.scope, l.scope),
    l.teamId ? eq(skills.teamId, l.teamId) : isNull(skills.teamId),
    l.groupId ? eq(skills.groupId, l.groupId) : isNull(skills.groupId),
  )

const listed = (db: Pick<Db, 'select'>) =>
  db
    .select({ skill: skills, version: skillVersions, updatedBy: users.name })
    .from(skills)
    .innerJoin(skillVersions, eq(skillVersions.id, skills.versionId))
    .leftJoin(users, eq(users.id, skills.updatedBy))

const dto = ({
  skill,
  version,
  updatedBy,
}: {
  skill: Row
  version: Version
  updatedBy: string | null
}): SkillDto => ({
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

/**
 * Enabled skills for a run in the group: platform, the group's team and the group itself, a lower layer replacing
 * a same-named skill above it (as `enabledMcpServers`).
 */
export async function enabledSkills(db: Pick<Db, 'select'>, groupId: string) {
  const team = db.select({ id: groups.teamId }).from(groups).where(eq(groups.id, groupId))
  const rows = await db
    .select({
      scope: skills.scope,
      name: skills.name,
      versionId: skillVersions.id,
      digest: skillVersions.digest,
    })
    .from(skills)
    .innerJoin(skillVersions, eq(skillVersions.id, skills.versionId))
    .where(
      and(
        eq(skills.enabled, true),
        or(
          eq(skills.scope, 'platform'),
          and(eq(skills.scope, 'team'), inArray(skills.teamId, team)),
          and(eq(skills.scope, 'group'), eq(skills.groupId, groupId)),
        ),
      ),
    )
  const merged = new Map<string, (typeof rows)[number]>()
  for (const r of rows.sort((a, b) => RANK[a.scope as Scope] - RANK[b.scope as Scope])) merged.set(r.name, r)
  return [...merged.values()]
    .sort((a, b) => (a.name < b.name ? -1 : 1))
    .map(({ name, versionId, digest }) => ({ name, versionId, digest }))
}

function layerRoutes(ctx: Ctx, app: FastifyInstance, base: string, authorize: Authorize) {
  const find = async (l: Layer, id: string) => {
    const [row] = await listed(ctx.db).where(and(inLayer(l), eq(skills.id, idParam(id, 'Skill 不存在'))))
    return row ?? fail('not_found', 'Skill 不存在')
  }
  const detail = async (l: Layer, id: string): Promise<SkillDetailDto> => {
    const row = await find(l, id)
    return { ...dto(row), files: row.version.files as SkillFile[] }
  }
  const nameTaken = async (l: Layer, name: string, except?: string) => {
    const [taken] = await ctx.db
      .select({ id: skills.id })
      .from(skills)
      .where(and(inLayer(l), eq(skills.name, name), except ? ne(skills.id, except) : undefined))
    if (taken) fail('conflict', 'Skill 名称已存在')
  }
  const log = (actorId: string, l: Layer, action: string, row: Row, version?: number) =>
    audit(ctx, {
      category: 'admin',
      actorUserId: actorId,
      teamId: l.teamId,
      groupId: l.groupId,
      action,
      detail: { id: row.id, layer: l.scope, name: row.name, enabled: row.enabled, version },
    })
  /** Appends a version with the next number and makes it current. */
  const addVersion = async (
    tx: Pick<Db, 'select' | 'insert'>,
    skillId: string,
    s: ReturnType<typeof snapshot>,
    by: string,
  ) => {
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

  app.get<Params>(base, async (req) => {
    const { layer } = await authorize(req)
    return (await listed(ctx.db).where(inLayer(layer)).orderBy(asc(skills.name))).map(dto)
  })

  app.get<Params>(`${base}/:skillId`, async (req) => {
    const { layer } = await authorize(req)
    return detail(layer, req.params.skillId ?? '')
  })

  app.post<Params>(base, { bodyLimit: BODY_LIMIT }, async (req, reply) => {
    const { actorId, layer } = await authorize(req)
    const body = CreateSkillReq.parse(req.body)
    const s = snapshot(body.files)
    await nameTaken(layer, s.name)
    const row = await ctx.db.transaction(async (tx) => {
      const [skill] = await tx
        .insert(skills)
        .values({
          ...layer,
          name: s.name,
          description: s.description,
          enabled: body.enabled,
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
    await log(actorId, layer, 'skill.create', row, 1)
    return reply.status(201).send(await detail(layer, row.id))
  })

  app.patch<Params>(`${base}/:skillId`, { bodyLimit: BODY_LIMIT }, async (req) => {
    const { actorId, layer } = await authorize(req)
    const body = UpdateSkillReq.parse(req.body)
    const current = await find(layer, req.params.skillId ?? '')
    const s = body.files && snapshot(body.files)
    if (s) await nameTaken(layer, s.name, current.skill.id)
    const changed = s && s.digest !== current.version.digest
    const [row, version] = await ctx.db.transaction(async (tx) => {
      const v = changed ? await addVersion(tx, current.skill.id, s, actorId) : current.version
      const [updated] = await tx
        .update(skills)
        .set({
          ...(s && { name: s.name, description: s.description }),
          enabled: body.enabled ?? current.skill.enabled,
          versionId: v.id,
          updatedBy: actorId,
          updatedAt: ctx.now(),
        })
        .where(eq(skills.id, current.skill.id))
        .returning()
      return [updated!, v.version] as const
    })
    await log(actorId, layer, 'skill.update', row, version)
    return detail(layer, row.id)
  })

  app.delete<Params>(`${base}/:skillId`, async (req, reply) => {
    const { actorId, layer } = await authorize(req)
    const { skill } = await find(layer, req.params.skillId ?? '')
    await ctx.db.delete(skills).where(eq(skills.id, skill.id))
    await log(actorId, layer, 'skill.delete', skill)
    return reply.status(204).send()
  })

  const version = async (skillId: string, versionId: string) => {
    const [v] = await ctx.db
      .select({ version: skillVersions, createdBy: users.name })
      .from(skillVersions)
      .leftJoin(users, eq(users.id, skillVersions.createdBy))
      .where(and(eq(skillVersions.skillId, skillId), eq(skillVersions.id, idParam(versionId, '版本不存在'))))
    return v ?? fail('not_found', '版本不存在')
  }
  const versionDto = (v: Version, createdBy: string | null, currentId: string): SkillVersionDto => ({
    id: v.id,
    version: v.version,
    digest: v.digest,
    size: v.size,
    createdBy,
    createdAt: v.createdAt.toISOString(),
    current: v.id === currentId,
  })

  app.get<Params>(`${base}/:skillId/versions`, async (req) => {
    const { layer } = await authorize(req)
    const { skill } = await find(layer, req.params.skillId ?? '')
    const rows = await ctx.db
      .select({ version: skillVersions, createdBy: users.name })
      .from(skillVersions)
      .leftJoin(users, eq(users.id, skillVersions.createdBy))
      .where(eq(skillVersions.skillId, skill.id))
      .orderBy(desc(skillVersions.version))
    return rows.map((r) => versionDto(r.version, r.createdBy, skill.versionId!))
  })

  app.get<Params>(`${base}/:skillId/versions/:versionId`, async (req) => {
    const { layer } = await authorize(req)
    const { skill } = await find(layer, req.params.skillId ?? '')
    const v = await version(skill.id, req.params.versionId ?? '')
    return { ...versionDto(v.version, v.createdBy, skill.versionId!), files: v.version.files as SkillFile[] }
  })

  app.post<Params>(`${base}/:skillId/rollback`, async (req) => {
    const { actorId, layer } = await authorize(req)
    const { versionId } = RollbackSkillReq.parse(req.body)
    const { skill } = await find(layer, req.params.skillId ?? '')
    const v = (await version(skill.id, versionId)).version
    const s = frontmatter(v.files as SkillFile[])
    await nameTaken(layer, s.name, skill.id)
    const [row] = await ctx.db
      .update(skills)
      .set({ ...s, versionId: v.id, updatedBy: actorId, updatedAt: ctx.now() })
      .where(eq(skills.id, skill.id))
      .returning()
    await log(actorId, layer, 'skill.rollback', row!, v.version)
    return detail(layer, skill.id)
  })
}

/** A skill version for a machine hosting a bot in some group the skill applies to. */
function daemonRoutes(ctx: Ctx, app: FastifyInstance) {
  app.get<{ Params: { versionId: string } }>('/api/daemon/skills/:versionId', async (req) => {
    const machine = await requireMachine(ctx, req)
    const [found] = await ctx.db
      .select({ skill: skills, files: skillVersions.files })
      .from(skillVersions)
      .innerJoin(skills, eq(skills.id, skillVersions.skillId))
      .where(eq(skillVersions.id, idParam(req.params.versionId, '版本不存在')))
    if (!found) return fail('not_found', '版本不存在')
    const { scope, teamId, groupId } = found.skill
    const [hosted] = await ctx.db
      .select({ id: groupBots.groupId })
      .from(groupBots)
      .innerJoin(bots, eq(bots.id, groupBots.botId))
      .innerJoin(groups, eq(groups.id, groupBots.groupId))
      .where(
        and(
          eq(bots.machineId, machine.id),
          isNull(groupBots.removedAt),
          scope === 'group'
            ? eq(groups.id, groupId!)
            : scope === 'team'
              ? eq(groups.teamId, teamId!)
              : undefined,
        ),
      )
      .limit(1)
    if (!hosted) return fail('forbidden', '该机器上没有可使用这个 skill 的 Bot')
    return { files: found.files as SkillFile[] }
  })
}

export function skillRoutes(ctx: Ctx) {
  return async (app: FastifyInstance) => {
    eachLayer(ctx, 'skills', (base, authorize) => layerRoutes(ctx, app, base, authorize))
    daemonRoutes(ctx, app)
  }
}
