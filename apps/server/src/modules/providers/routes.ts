import { randomUUID } from 'node:crypto'
import {
  AgentKind,
  type BotCatalogDto,
  BotProviderReq,
  CcSwitchApplyReq,
  type CcSwitchImportedDto,
  type CcSwitchPreviewDto,
  ImportLinkReq,
  type ProviderPreset,
  type ProviderSavedDto,
  type ProviderStoreView,
  type ProvidersCmd,
  SaveProviderReq,
  UseProviderReq,
} from '@gonggong/protocol'
import { and, eq, isNull } from 'drizzle-orm'
import type { FastifyInstance } from 'fastify'
import { z } from 'zod'
import type { Ctx } from '../../context.js'
import { bots, groupBots, groupMembers, machines } from '../../db/schema.js'
import { audit } from '../../lib/audit.js'
import { fail } from '../../lib/errors.js'
import { idParam } from '../../lib/ids.js'
import { requireUser } from '../auth/session.js'
import { pickCatalog } from '../bots/config.js'
import { ownMachine, quietErrors, relay, requireFeature } from '../machines/relay.js'
import { providerStateRoutes } from './state.js'

const TIMEOUT_MS = 15_000

type Params = { id: string }
type ProviderParams = { id: string; pid: string }

/**
 * A machine's model providers (design §4.2–§4.5): relayed live to its daemon, which alone stores them. Nothing of
 * them is written to the database, the logs or the audit trail (only who did what on which machine).
 */
export function providerRoutes(ctx: Ctx) {
  return async (app: FastifyInstance) => {
    quietErrors(app)
    await app.register(providerStateRoutes(ctx))

    const cmd = async (machineId: string, body: Omit<ProvidersCmd, 't' | 'requestId'>) => {
      requireFeature(ctx, machineId, 'providers')
      const msg = { t: 'providers.cmd', requestId: randomUUID(), ...body } as const
      return relay(ctx, machineId, msg, 'providers.result', TIMEOUT_MS)
    }
    const view = (v: ProviderStoreView | undefined) => v ?? fail('invalid', '机器未返回供应商列表')
    const saved = (res: { id?: string; view?: ProviderStoreView }): ProviderSavedDto => ({
      id: res.id ?? fail('invalid', '机器未返回供应商'),
      view: view(res.view),
    })
    const trail = (userId: string, action: string, detail: { machineId: string; botId?: string }) =>
      audit(ctx, { category: 'admin', actorUserId: userId, action, detail })
    const owned = async (req: { params: Params }, userId: string) => ownMachine(ctx, userId, req.params.id)

    app.get<{ Params: Params }>('/api/machines/:id/providers', async (req): Promise<ProviderStoreView> => {
      const me = await requireUser(ctx, req)
      const m = await owned(req, me.id)
      return view((await cmd(m.id, { action: 'list' })).view)
    })

    app.get<{ Params: Params }>(
      '/api/machines/:id/providers/presets',
      async (req): Promise<ProviderPreset[]> => {
        const me = await requireUser(ctx, req)
        const m = await owned(req, me.id)
        const { agent } = z.object({ agent: AgentKind.optional() }).parse(req.query)
        return (await cmd(m.id, { action: 'presets', agent })).presets ?? []
      },
    )

    app.post<{ Params: Params }>('/api/machines/:id/providers', async (req): Promise<ProviderSavedDto> => {
      const me = await requireUser(ctx, req)
      const m = await owned(req, me.id)
      const { setDefault, ...provider } = SaveProviderReq.parse(req.body)
      if (!provider.apiKey) fail('invalid', '请填写 API Key')
      const res = saved(await cmd(m.id, { action: 'save', provider, setDefault }))
      await trail(me.id, 'machine.providers.save', { machineId: m.id })
      return res
    })

    app.put<{ Params: ProviderParams }>(
      '/api/machines/:id/providers/:pid',
      async (req): Promise<ProviderSavedDto> => {
        const me = await requireUser(ctx, req)
        const m = await owned(req, me.id)
        const { setDefault, ...provider } = SaveProviderReq.parse(req.body)
        const res = saved(
          await cmd(m.id, { action: 'save', provider: { ...provider, id: req.params.pid }, setDefault }),
        )
        await trail(me.id, 'machine.providers.save', { machineId: m.id })
        return res
      },
    )

    app.delete<{ Params: ProviderParams }>(
      '/api/machines/:id/providers/:pid',
      async (req): Promise<ProviderStoreView> => {
        const me = await requireUser(ctx, req)
        const m = await owned(req, me.id)
        const res = view((await cmd(m.id, { action: 'remove', id: req.params.pid })).view)
        await trail(me.id, 'machine.providers.remove', { machineId: m.id })
        return res
      },
    )

    app.put<{ Params: Params }>(
      '/api/machines/:id/providers/default',
      async (req): Promise<ProviderStoreView> => {
        const me = await requireUser(ctx, req)
        const m = await owned(req, me.id)
        const { agent, choice } = UseProviderReq.parse(req.body)
        const res = view((await cmd(m.id, { action: 'use', agent, choice })).view)
        await trail(me.id, 'machine.providers.default', { machineId: m.id })
        return res
      },
    )

    app.post<{ Params: Params }>(
      '/api/machines/:id/providers/import-link',
      async (req): Promise<ProviderSavedDto> => {
        const me = await requireUser(ctx, req)
        const m = await owned(req, me.id)
        const { link, setDefault } = ImportLinkReq.parse(req.body)
        const res = saved(await cmd(m.id, { action: 'importLink', link, setDefault }))
        await trail(me.id, 'machine.providers.import', { machineId: m.id })
        return res
      },
    )

    const ccSwitch = (machineId: string) => {
      const noCcSwitch = ctx.hub.features(machineId).includes('providers')
        ? '这台机器上没有 CC Switch'
        : undefined
      requireFeature(ctx, machineId, 'ccSwitch', noCcSwitch)
    }

    app.get<{ Params: Params }>('/api/machines/:id/ccswitch', async (req): Promise<CcSwitchPreviewDto> => {
      const me = await requireUser(ctx, req)
      const m = await owned(req, me.id)
      ccSwitch(m.id)
      const msg = { t: 'ccswitch.read', requestId: randomUUID() } as const
      const { candidates } = await relay(ctx, m.id, msg, 'ccswitch.result', TIMEOUT_MS)
      return { candidates }
    })

    app.post<{ Params: Params }>(
      '/api/machines/:id/ccswitch/apply',
      async (req): Promise<CcSwitchImportedDto> => {
        const me = await requireUser(ctx, req)
        const m = await owned(req, me.id)
        const { keys, setDefault } = CcSwitchApplyReq.parse(req.body)
        ccSwitch(m.id)
        const msg = { t: 'ccswitch.apply', requestId: randomUUID(), keys, setDefault } as const
        const res = await relay(ctx, m.id, msg, 'ccswitch.result', TIMEOUT_MS)
        await trail(me.id, 'machine.providers.import', { machineId: m.id })
        return { imported: res.imported, view: view(res.view) }
      },
    )

    // §5: a bot's provider is set by its owner, who must also own the machine it runs on.
    app.put<{ Params: Params }>('/api/bots/:id/provider', async (req): Promise<ProviderStoreView> => {
      const me = await requireUser(ctx, req)
      const [row] = await ctx.db
        .select({ bot: bots, machineOwner: machines.ownerId })
        .from(bots)
        .leftJoin(machines, and(eq(machines.id, bots.machineId), isNull(machines.revokedAt)))
        .where(and(eq(bots.id, idParam(req.params.id, 'Bot ')), isNull(bots.deletedAt)))
      if (!row) return fail('not_found', 'Bot 不存在')
      const { bot, machineOwner } = row
      if (bot.ownerId !== me.id) return fail('forbidden', '只有 Bot 主人可以设置其供应商')
      if (!bot.machineId || !machineOwner) return fail('conflict', 'Bot 尚未绑定机器')
      if (machineOwner !== me.id) return fail('forbidden', '只能在自己的机器上设置 Bot 的供应商')
      const { choice } = BotProviderReq.parse(req.body)
      const res = view(
        (
          await cmd(bot.machineId, {
            action: 'use',
            agent: bot.agentKind as AgentKind,
            botId: bot.id,
            choice,
          })
        ).view,
      )
      await trail(me.id, 'bot.provider', { machineId: bot.machineId, botId: bot.id })
      return res
    })

    // Whoever may pick a model for the bot: its owner, sysadmins and the members of its groups.
    app.get<{ Params: Params }>('/api/bots/:id/catalog', async (req): Promise<BotCatalogDto> => {
      const me = await requireUser(ctx, req)
      const [bot] = await ctx.db
        .select()
        .from(bots)
        .where(and(eq(bots.id, idParam(req.params.id, 'Bot ')), isNull(bots.deletedAt)))
      if (!bot) return fail('not_found', 'Bot 不存在')
      if (bot.ownerId !== me.id && me.role !== 'sysadmin') {
        const [seat] = await ctx.db
          .select({ groupId: groupBots.groupId })
          .from(groupBots)
          .innerJoin(
            groupMembers,
            and(eq(groupMembers.groupId, groupBots.groupId), eq(groupMembers.userId, me.id)),
          )
          .where(and(eq(groupBots.botId, bot.id), isNull(groupBots.removedAt)))
          .limit(1)
        if (!seat) return fail('forbidden', '只有 Bot 所在群的成员可以查看其可选模型')
      }
      return { catalog: await pickCatalog(ctx, bot) }
    })
  }
}
