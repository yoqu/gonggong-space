import type { DaemonWorkspaceDto } from '@aiws/protocol'
import { and, asc, eq, inArray } from 'drizzle-orm'
import type { FastifyInstance } from 'fastify'
import type { Ctx } from '../../context.js'
import { requireMachine } from '../../daemon/auth.js'
import { bots, groupBots, groupRepos, groups, runs } from '../../db/schema.js'
import { audit } from '../../lib/audit.js'
import { fail } from '../../lib/errors.js'
import { idParam } from '../../lib/ids.js'
import { postEvent } from '../messages/service.js'
import { requestCd } from './cd.js'

const LIVE = ['running', 'awaiting_approval', 'awaiting_answer']

type PairParams = { Params: { groupId: string; botId: string } }

/** Machine-token routes behind the desktop app's 工作区 page. */
export function daemonWorkspaceRoutes(ctx: Ctx) {
  return async (app: FastifyInstance) => {
    app.get('/api/daemon/workspaces', async (req): Promise<DaemonWorkspaceDto[]> => {
      const machine = await requireMachine(ctx, req)
      const rows = await ctx.db
        .select({ gb: groupBots, g: groups, bot: bots })
        .from(groupBots)
        .innerJoin(groups, eq(groups.id, groupBots.groupId))
        .innerJoin(bots, eq(bots.id, groupBots.botId))
        .where(eq(bots.machineId, machine.id))
        .orderBy(asc(groupBots.addedAt))
      if (!rows.length) return []
      const groupIds = [...new Set(rows.map((r) => r.g.id))]
      const repos = await ctx.db
        .select({ id: groupRepos.id, groupId: groupRepos.groupId })
        .from(groupRepos)
        .where(inArray(groupRepos.groupId, groupIds))
        .orderBy(asc(groupRepos.createdAt))
      const live = await ctx.db
        .select({ groupId: runs.groupId, botId: runs.botId })
        .from(runs)
        .where(and(inArray(runs.groupId, groupIds), inArray(runs.status, LIVE)))
      return rows.map(({ gb, g, bot }) => {
        const removed = !!(gb.removedAt || bot.deletedAt || g.archivedAt)
        return {
          groupId: g.id,
          groupName: g.name,
          groupKind: g.kind as DaemonWorkspaceDto['groupKind'],
          botId: bot.id,
          botName: bot.name,
          kind: gb.workspaceKind as DaemonWorkspaceDto['kind'],
          cdPath: gb.cdPath,
          repoId: removed ? null : (repos.find((r) => r.groupId === g.id)?.id ?? null),
          removed,
          running: live.some((r) => r.groupId === g.id && r.botId === bot.id),
        }
      })
    })

    /** 改回托管 = `/cd @bot --reset` issued by the bot owner from the machine itself. */
    app.post<PairParams>('/api/daemon/workspaces/:groupId/:botId/reset-cd', async (req, reply) => {
      const machine = await requireMachine(ctx, req)
      const groupId = idParam(req.params.groupId, '群')
      const botId = idParam(req.params.botId, 'bot')
      const [row] = await ctx.db
        .select({ gb: groupBots, bot: bots })
        .from(groupBots)
        .innerJoin(bots, eq(bots.id, groupBots.botId))
        .where(and(eq(groupBots.groupId, groupId), eq(groupBots.botId, botId)))
      if (!row || row.bot.machineId !== machine.id || row.gb.removedAt || row.bot.deletedAt)
        return fail('not_found', '工作区不存在')
      if (row.gb.workspaceKind !== 'cd') return fail('conflict', '该工作区不是 /cd 绑定')
      if (!(await requestCd(ctx, { groupId, botId, path: null })))
        return fail('conflict', '本机未连接服务器，无法改回托管')
      await audit(ctx, {
        category: 'run',
        actorUserId: row.bot.ownerId,
        action: 'command.cd',
        groupId,
        detail: { botId, path: null },
      })
      await postEvent(ctx, groupId, `已请求 ${row.bot.name} 恢复托管工作区，等待本机确认…`)
      return reply.status(204).send()
    })
  }
}
