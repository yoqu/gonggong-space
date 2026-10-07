import { randomUUID } from 'node:crypto'
import {
  BindWorkspaceReq,
  DefaultWorkspaceReq,
  type DirListingDto,
  type RepoAccessReason,
} from '@gonggong/protocol'
import { and, eq, isNull } from 'drizzle-orm'
import type { FastifyInstance } from 'fastify'
import type { Ctx } from '../../context.js'
import { bots, groupBots, machines } from '../../db/schema.js'
import type { MessageKey } from '../../i18n/index.js'
import { fail, HttpError } from '../../lib/errors.js'
import { idParam } from '../../lib/ids.js'
import { requireUser } from '../auth/session.js'
import { publishBot } from '../bots/dto.js'
import { activeBots, requireMember } from '../groups/service.js'
import { groupLocalPaths } from '../repos/service.js'
import { ABSOLUTE, announceCd, requestCd } from './cd.js'
import { daemonWorkspaceRoutes } from './daemon.js'
import { workspaceDiffRoutes } from './diff.js'
import { workspaceFileRoutes } from './files.js'
import { ensureWorkspace, onlineMachine, PAUSING } from './provision.js'
import { listBotStates } from './state.js'

const DIR_TIMEOUT_MS = 10_000

/** A live bot the caller owns: its machine's directories are only ever shown to or bound by its owner (plan W7). */
async function ownBot(ctx: Ctx, userId: string, rawId: string) {
  const [bot] = await ctx.db
    .select()
    .from(bots)
    .where(and(eq(bots.id, idParam(rawId, 'Bot 不存在')), isNull(bots.deletedAt)))
  if (!bot) return fail('not_found', 'Bot 不存在')
  return bot.ownerId === userId ? bot : fail('forbidden', '只有 Bot 主人可以操作其工作区')
}

export function workspaceRoutes(ctx: Ctx) {
  return async (app: FastifyInstance) => {
    /** dir.list on a machine; fails when it is offline, silent or reports an error. */
    const listDirs = async (
      m: { name: string; machineId: string | null },
      path: string | null,
      offline: MessageKey,
    ) => {
      const machineId = onlineMachine(ctx, m.machineId)
      if (!machineId) return fail('conflict', offline, { name: m.name })
      const ask = { t: 'dir.list', requestId: randomUUID(), path } as const
      const res =
        (await ctx.hub.request(machineId, ask, 'dir.result', DIR_TIMEOUT_MS)) ??
        fail('conflict', '{name} 未响应，请稍后重试', { name: m.name })
      if (res.error) throw new HttpError('invalid', res.error)
      return res
    }

    app.get<{ Params: { id: string } }>('/api/groups/:id/bot-states', async (req) => {
      const me = await requireUser(ctx, req)
      await requireMember(ctx, req.params.id, me.id)
      return listBotStates(ctx, req.params.id)
    })

    app.get<{ Params: { id: string }; Querystring: { path?: string } }>(
      '/api/machines/:id/dirs',
      async (req): Promise<DirListingDto> => {
        const me = await requireUser(ctx, req)
        const [m] = await ctx.db
          .select()
          .from(machines)
          .where(and(eq(machines.id, idParam(req.params.id, '机器不存在')), isNull(machines.revokedAt)))
        if (!m) return fail('not_found', '机器不存在')
        if (m.ownerId !== me.id) return fail('forbidden', '只能浏览自己机器上的目录')
        const at = { name: m.name, machineId: m.id }
        const { path, entries, git, unusable, roots } = await listDirs(
          at,
          req.query.path || null,
          '{name} 离线，无法浏览目录',
        )
        return { path, entries, git, unusable, roots }
      },
    )

    app.put<{ Params: { id: string } }>('/api/bots/:id/default-workspace', async (req) => {
      const me = await requireUser(ctx, req)
      const bot = await ownBot(ctx, me.id, req.params.id)
      const { path } = DefaultWorkspaceReq.parse(req.body)
      if (path !== null) {
        if (!ABSOLUTE.test(path)) fail('invalid', '需要本机绝对路径')
        const { unusable } = await listDirs(bot, path, '{name} 离线，无法设置默认工作区')
        if (unusable) throw new HttpError('invalid', unusable)
      }
      await ctx.db.update(bots).set({ defaultWorkspace: path }).where(eq(bots.id, bot.id))
      return publishBot(ctx, bot.id)
    })

    app.put<{ Params: { id: string; botId: string } }>(
      '/api/groups/:id/bots/:botId/workspace',
      async (req, reply) => {
        const me = await requireUser(ctx, req)
        const { group } = await requireMember(ctx, req.params.id, me.id)
        const bot = await ownBot(ctx, me.id, req.params.botId)
        if (!(await activeBots(ctx, group.id)).some((b) => b.id === bot.id))
          fail('not_found', '该 Bot 不在群内')
        const { path, force } = BindWorkspaceReq.parse(req.body)
        if (path !== null && group.mode !== 'partition') fail('conflict', '强制同步群只能使用托管工作区')
        if (path !== null && !ABSOLUTE.test(path)) fail('invalid', '需要本机绝对路径')
        if (!(await requestCd(ctx, { groupId: group.id, botId: bot.id, path, force })))
          fail('conflict', '{bot} 离线，无法绑定工作区', { bot: bot.name })
        await announceCd(ctx, { groupId: group.id, userId: me.id, bot, path })
        return reply.status(204).send()
      },
    )

    // A paused bot's owner fixed its machine's git access: clone again (group admins may ask too).
    app.post<{ Params: { id: string; botId: string } }>(
      '/api/groups/:id/bots/:botId/recheck',
      async (req, reply) => {
        const me = await requireUser(ctx, req)
        const { group, member } = await requireMember(ctx, req.params.id, me.id)
        const bot = (await activeBots(ctx, group.id)).find((b) => b.id === req.params.botId)
        if (!bot) return fail('not_found', '该 Bot 不在群内')
        if (bot.ownerId !== me.id && !member.isAdmin)
          return fail('forbidden', '只有 Bot 主人或群管理员可以重新检查')
        const [gb] = await ctx.db
          .select({ state: groupBots.workspaceState, reason: groupBots.workspaceReason })
          .from(groupBots)
          .where(and(eq(groupBots.groupId, group.id), eq(groupBots.botId, bot.id)))
        const reason = gb?.reason as RepoAccessReason | null | undefined
        if (gb?.state !== 'failed' || !reason || !PAUSING.includes(reason))
          return fail('conflict', '{bot} 未处于暂停状态', { bot: bot.name })
        if (!onlineMachine(ctx, bot.machineId))
          return fail('conflict', '{bot} 离线，上线后会自动重新检查', { bot: bot.name })
        await ensureWorkspace(ctx, group.id, bot)
        return reply.status(204).send()
      },
    )

    /** Where the caller's machines already hold the group's repo (suggested instead of a fresh clone). */
    app.get<{ Params: { id: string } }>('/api/groups/:id/local-paths', async (req) => {
      const me = await requireUser(ctx, req)
      const { group } = await requireMember(ctx, req.params.id, me.id)
      return groupLocalPaths(ctx, me.id, group.id)
    })

    await app.register(daemonWorkspaceRoutes(ctx))
    await app.register(workspaceDiffRoutes(ctx))
    await app.register(workspaceFileRoutes(ctx))
  }
}
