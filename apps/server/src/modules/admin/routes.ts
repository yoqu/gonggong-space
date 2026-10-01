import {
  type AdminGroupDto,
  type AdminMachineDto,
  AuditQuery,
  type BotDto,
  type SystemParams,
  UpdateSystemParamsReq,
} from '@gonggong/protocol'
import { asc, eq, isNull } from 'drizzle-orm'
import type { FastifyInstance } from 'fastify'
import type { Ctx } from '../../context.js'
import { bots, groups, machines, users } from '../../db/schema.js'
import { idParam } from '../../lib/ids.js'
import { requireSysadmin } from '../auth/session.js'
import { listBotDtos, machineDto } from '../bots/dto.js'
import { listAudit } from './audit.js'
import { adminGroupDtos } from './groups.js'
import { saveSysParams, sysParams } from './params.js'

type TeamQuery = { Querystring: { teamId?: string } }

/** 管理后台's 团队 filter. */
const inTeam = (column: typeof groups.teamId | typeof bots.teamId, teamId: string | undefined) =>
  teamId ? eq(column, idParam(teamId, '团队不存在')) : undefined

/** 管理后台 · 群 / 机器与网络 / 审计记录 / 系统参数 (sysadmin only). */
export function adminRoutes(ctx: Ctx) {
  return async (app: FastifyInstance) => {
    app.get<TeamQuery>('/api/admin/groups', async (req): Promise<AdminGroupDto[]> => {
      await requireSysadmin(ctx, req)
      return adminGroupDtos(ctx, inTeam(groups.teamId, req.query.teamId))
    })

    app.get<TeamQuery>('/api/admin/bots', async (req): Promise<BotDto[]> => {
      await requireSysadmin(ctx, req)
      return listBotDtos(ctx, inTeam(bots.teamId, req.query.teamId))
    })

    app.get('/api/admin/machines', async (req): Promise<AdminMachineDto[]> => {
      await requireSysadmin(ctx, req)
      const rows = await ctx.db
        .select({ m: machines, ownerName: users.name })
        .from(machines)
        .innerJoin(users, eq(users.id, machines.ownerId))
        .where(isNull(machines.revokedAt))
        .orderBy(asc(users.createdAt), asc(machines.createdAt))
      return rows.map(({ m, ownerName }) => ({
        ...machineDto(ctx, m),
        ownerName,
        protocol: m.protocol,
        latencyMs: m.latencyMs,
        bandwidthMbps: m.bandwidthMbps,
        netMeasuredAt: m.netMeasuredAt?.toISOString() ?? null,
      }))
    })

    app.get('/api/admin/audit', async (req) => {
      await requireSysadmin(ctx, req)
      return listAudit(ctx, AuditQuery.parse(req.query))
    })

    app.get('/api/admin/params', async (req): Promise<SystemParams> => {
      await requireSysadmin(ctx, req)
      return sysParams(ctx.db)
    })

    app.put('/api/admin/params', async (req): Promise<SystemParams> => {
      const actor = await requireSysadmin(ctx, req)
      return saveSysParams(ctx, UpdateSystemParamsReq.parse(req.body), actor.id)
    })
  }
}
