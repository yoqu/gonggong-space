import type { DaemonToServer, GroupProviderStateDto, ProviderStateItem } from '@gonggong/protocol'
import { and, eq, inArray, isNotNull, isNull } from 'drizzle-orm'
import type { FastifyInstance } from 'fastify'
import type { Ctx } from '../../context.js'
import { bots, groupBots } from '../../db/schema.js'
import { isUuid } from '../../lib/ids.js'
import { requireUser } from '../auth/session.js'
import { requireMember } from '../groups/service.js'
import { memberIds } from '../messages/service.js'

const refreshers = new WeakMap<Ctx, (groupId: string) => Promise<void>>()

/** Pushes the group's banner again after a (group, bot) session changed on the server (e.g. /new). */
export const refreshProviderState = (ctx: Ctx, groupId: string) => refreshers.get(ctx)?.(groupId)

/**
 * 群聊横条 (design §4.3): which sessions keep an older provider, as each daemon reports it. Held in memory per
 * machine only, dropped when the machine goes offline (the daemon reports again after reconnecting).
 */
export function providerStateRoutes(ctx: Ctx) {
  return async (app: FastifyInstance) => {
    const byMachine = new Map<string, ProviderStateItem[]>()
    const reported = (groupId: string) => [...byMachine.values()].flat().filter((i) => i.groupId === groupId)
    // The daemon lists a session until a newer one has run; a bot whose next turn starts afresh (/new, a reset
    // session) has nothing left to switch.
    const forGroup = async (groupId: string): Promise<GroupProviderStateDto> => {
      const items = reported(groupId)
      const ids = [...new Set(items.map((i) => i.botId))]
      const resuming = ids.length
        ? await ctx.db
            .select({ botId: groupBots.botId })
            .from(groupBots)
            .where(
              and(
                eq(groupBots.groupId, groupId),
                inArray(groupBots.botId, ids),
                isNotNull(groupBots.sessionId),
                isNull(groupBots.newSessionReason),
              ),
            )
        : []
      const keep = new Set(resuming.map((r) => r.botId))
      return {
        items: items
          .filter((i) => keep.has(i.botId))
          .map(({ botId, session, effective }) => ({ botId, session, effective })),
      }
    }
    // What each group was last told, so a refresh after an unrelated bot state change sends nothing.
    const shown = new Map<string, string>()
    const push = async (groupIds: Iterable<string>, changedOnly = false) => {
      for (const groupId of new Set(groupIds)) {
        const state = await forGroup(groupId)
        const key = JSON.stringify(state.items)
        if (changedOnly && shown.get(groupId) === key) continue
        shown.set(groupId, key)
        ctx.bus.publish(await memberIds(ctx, groupId), { t: 'group.providerState', groupId, ...state })
      }
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
    refreshers.set(ctx, async (groupId) => {
      if (reported(groupId).length) queue(() => push([groupId], true))
    })
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
