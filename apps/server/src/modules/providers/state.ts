import type { DaemonToServer, GroupProviderStateDto, ProviderStateItem } from '@gonggong/protocol'
import { and, eq, inArray } from 'drizzle-orm'
import type { FastifyInstance } from 'fastify'
import type { Ctx } from '../../context.js'
import { bots, groupBots } from '../../db/schema.js'
import { isUuid } from '../../lib/ids.js'
import { requireUser } from '../auth/session.js'
import { requireMember } from '../groups/service.js'
import { memberIds } from '../messages/service.js'

/**
 * 群聊横条 (design §4.3): which sessions keep an older provider, as each daemon reports it. Held in memory per
 * machine only, dropped when the machine goes offline (the daemon reports again after reconnecting).
 */
export function providerStateRoutes(ctx: Ctx) {
  return async (app: FastifyInstance) => {
    const byMachine = new Map<string, ProviderStateItem[]>()
    const forGroup = (groupId: string): GroupProviderStateDto => ({
      items: [...byMachine.values()]
        .flat()
        .filter((i) => i.groupId === groupId)
        .map(({ botId, session, effective }) => ({ botId, session, effective })),
    })
    const push = async (groupIds: Iterable<string>) => {
      for (const groupId of new Set(groupIds))
        ctx.bus.publish(await memberIds(ctx, groupId), {
          t: 'group.providerState',
          groupId,
          ...forGroup(groupId),
        })
    }
    const replace = async (machineId: string, items: ProviderStateItem[]) => {
      const before = byMachine.get(machineId) ?? []
      // Only pairs of this machine's bots in their groups: a daemon speaks for nothing else.
      const ids = [...new Set(items.map((i) => i.botId))].filter(isUuid)
      const pairs = ids.length
        ? await ctx.db
            .select({ groupId: groupBots.groupId, botId: groupBots.botId })
            .from(groupBots)
            .innerJoin(bots, eq(bots.id, groupBots.botId))
            .where(and(eq(bots.machineId, machineId), inArray(groupBots.botId, ids)))
        : []
      const known = new Set(pairs.map((p) => `${p.groupId}/${p.botId}`))
      const after = items.filter((i) => known.has(`${i.groupId}/${i.botId}`))
      if (after.length) byMachine.set(machineId, after)
      else byMachine.delete(machineId)
      await push([...before, ...after].map((i) => i.groupId))
    }

    // Reports of one machine are applied in order.
    let chain = Promise.resolve()
    const queue = (task: () => Promise<void>) => {
      chain = chain.then(task).catch((err) => app.log.error(err))
    }
    const onMessage = (machineId: string, msg: DaemonToServer) => {
      if (msg.t === 'bots.providerState') queue(() => replace(machineId, msg.items))
    }
    const onOffline = (machineId: string) => {
      if (byMachine.has(machineId)) queue(() => replace(machineId, []))
    }
    ctx.hub.on('message', onMessage)
    ctx.hub.on('offline', onOffline)
    app.addHook('onClose', async () => {
      ctx.hub.off('message', onMessage)
      ctx.hub.off('offline', onOffline)
      await chain
    })

    app.get<{ Params: { id: string } }>(
      '/api/groups/:id/provider-state',
      async (req): Promise<GroupProviderStateDto> => {
        const me = await requireUser(ctx, req)
        await requireMember(ctx, req.params.id, me.id)
        return forGroup(req.params.id)
      },
    )
  }
}
