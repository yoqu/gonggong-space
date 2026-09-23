import {
  type AdminGroupDto,
  type AdminMachineDto,
  AuditQuery,
  type SystemParams,
  UpdateSystemParamsReq,
} from '@aiws/protocol'
import { asc, count, desc, eq, isNull } from 'drizzle-orm'
import type { FastifyInstance } from 'fastify'
import type { Ctx } from '../../context.js'
import { groupBots, groupMembers, groupRepos, groups, machines, users } from '../../db/schema.js'
import { requireSysadmin } from '../auth/session.js'
import { machineDto } from '../bots/dto.js'
import { listAudit } from './audit.js'
import { saveSysParams, sysParams } from './params.js'

/** 管理后台 · 群 / 机器与网络 / 审计记录 / 系统参数 (sysadmin only). */
export function adminRoutes(ctx: Ctx) {
  return async (app: FastifyInstance) => {
    app.get('/api/admin/groups', async (req): Promise<AdminGroupDto[]> => {
      await requireSysadmin(ctx, req)
      const [rows, repos, members, bots] = await Promise.all([
        ctx.db.select().from(groups).orderBy(desc(groups.createdAt)),
        ctx.db.select({ groupId: groupRepos.groupId, url: groupRepos.url }).from(groupRepos),
        ctx.db
          .select({ groupId: groupMembers.groupId, n: count() })
          .from(groupMembers)
          .groupBy(groupMembers.groupId),
        ctx.db
          .select({ groupId: groupBots.groupId, n: count() })
          .from(groupBots)
          .where(isNull(groupBots.removedAt))
          .groupBy(groupBots.groupId),
      ])
      const n = (list: { groupId: string; n: number }[], id: string) =>
        list.find((x) => x.groupId === id)?.n ?? 0
      return rows.map((g) => ({
        id: g.id,
        name: g.name,
        kind: g.kind as AdminGroupDto['kind'],
        mode: g.mode as AdminGroupDto['mode'],
        repo: repos.find((r) => r.groupId === g.id)?.url ?? null,
        members: n(members, g.id),
        bots: n(bots, g.id),
        archivedAt: g.archivedAt?.toISOString() ?? null,
      }))
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
