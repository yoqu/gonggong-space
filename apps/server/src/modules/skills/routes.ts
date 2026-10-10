import {
  CreateSkillReq,
  RollbackSkillReq,
  type SkillDetailDto,
  type SkillFile,
  type SkillVersionDto,
  UpdateSkillReq,
} from '@gonggong/protocol'
import { and, asc, eq, isNull } from 'drizzle-orm'
import type { FastifyInstance } from 'fastify'
import type { Ctx } from '../../context.js'
import { requireMachine } from '../../daemon/auth.js'
import { bots, groupBots, groups, skills, skillVersions } from '../../db/schema.js'
import { fail } from '../../lib/errors.js'
import { idParam } from '../../lib/ids.js'
import { type Authorize, eachLayer, type Layer } from '../mcp/routes.js'
import {
  createSkill,
  deleteSkill,
  detailDto,
  dto,
  findSkill,
  inLayer,
  listed,
  rollbackSkill,
  skillVersion,
  skillVersionList,
  snapshot,
  updateSkill,
} from './service.js'

type Version = typeof skillVersions.$inferSelect
type Params = { Params: { id?: string; skillId?: string; versionId?: string } }

/** Up to 8 MB of base64 in the JSON body; the decoded files are capped at SKILL_MAX_BYTES. */
const BODY_LIMIT = 8 * 1024 * 1024

function layerRoutes(ctx: Ctx, app: FastifyInstance, base: string, authorize: Authorize) {
  const find = async (l: Layer, id: string) =>
    (await findSkill(ctx, l, eq(skills.id, idParam(id, 'Skill 不存在')))) ?? fail('not_found', 'Skill 不存在')
  const detail = async (l: Layer, id: string): Promise<SkillDetailDto> => detailDto(await find(l, id))

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
    const row = await createSkill(ctx, layer, snapshot(body.files), body.enabled, actorId)
    return reply.status(201).send(await detail(layer, row.id))
  })

  app.patch<Params>(`${base}/:skillId`, { bodyLimit: BODY_LIMIT }, async (req) => {
    const { actorId, layer } = await authorize(req)
    const body = UpdateSkillReq.parse(req.body)
    const current = await find(layer, req.params.skillId ?? '')
    const change = { snapshot: body.files && snapshot(body.files), enabled: body.enabled }
    const { skill } = await updateSkill(ctx, layer, current, change, actorId)
    return detail(layer, skill.id)
  })

  app.delete<Params>(`${base}/:skillId`, async (req, reply) => {
    const { actorId, layer } = await authorize(req)
    const { skill } = await find(layer, req.params.skillId ?? '')
    await deleteSkill(ctx, layer, skill, actorId)
    return reply.status(204).send()
  })

  const version = async (skillId: string, versionId: string) =>
    (await skillVersion(ctx, skillId, eq(skillVersions.id, idParam(versionId, '版本不存在')))) ??
    fail('not_found', '版本不存在')
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
    const rows = await skillVersionList(ctx, skill.id)
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
    const v = await version(skill.id, versionId)
    await rollbackSkill(ctx, layer, skill, v.version, actorId)
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
