import { randomUUID } from 'node:crypto'
import {
  AGENT_KINDS,
  AgentKind,
  AgentSettingsReq,
  type ApiProtocol,
  agentMeta,
  agentTakes,
  type BotCatalogDto,
  BotProviderReq,
  CcSwitchApplyReq,
  type CcSwitchImportedDto,
  type CcSwitchPreviewDto,
  fitEffort,
  ImportLinkReq,
  INHERIT_PROVIDER,
  type LegacyProviderStoreView,
  normalizeCandidate,
  normalizePresets,
  normalizeStoreView,
  OfficialProviderReq,
  type ProviderInput,
  type ProviderPreset,
  type ProviderSavedDto,
  type ProviderStoreView,
  providerInputToLegacy,
  SaveProviderReq,
  UseProviderReq,
} from '@gonggong/protocol'
import { and, eq, isNull } from 'drizzle-orm'
import type { FastifyInstance, FastifyRequest } from 'fastify'
import { z } from 'zod'
import type { Ctx } from '../../context.js'
import { bots, groupBots, groupMembers, machines } from '../../db/schema.js'
import { audit } from '../../lib/audit.js'
import { fail } from '../../lib/errors.js'
import { idParam } from '../../lib/ids.js'
import { requireUser } from '../auth/session.js'
import { assertPick, choiceCatalog, pickCatalog, providersCmd } from '../bots/config.js'
import { publishBot } from '../bots/dto.js'
import { ownMachine, quietErrors, relay, requireFeature } from '../machines/relay.js'
import { providerStateRoutes } from './state.js'

const TIMEOUT_MS = 15_000
/** The daemon gives a probe 90 s. */
const REPROBE_TIMEOUT_MS = 100_000

type Params = { id: string }
type ProviderParams = { id: string; pid: string }
type AnyStoreView = ProviderStoreView | LegacyProviderStoreView

/** An older daemon's provider was its agent's: the first agent built for the protocol (anthropic → claude…). */
const agentOfProtocol = (protocol: ApiProtocol) =>
  AGENT_KINDS.find((k) => agentMeta(k).protocols[0] === protocol)

/**
 * A machine's model providers (design §4.2–§4.5): relayed live to its daemon, which alone stores them. Nothing of
 * them is written to the database, the logs or the audit trail (only who did what on which machine).
 */
export function providerRoutes(ctx: Ctx) {
  return async (app: FastifyInstance) => {
    quietErrors(app)
    await app.register(providerStateRoutes(ctx))

    // Older daemons answer in the legacy shapes: the web only ever sees the new ones.
    const view = (v: AnyStoreView | undefined) =>
      normalizeStoreView(v ?? fail('invalid', '机器未返回供应商列表'))
    const saved = (res: { id?: string; view?: AnyStoreView }): ProviderSavedDto => ({
      id: res.id ?? fail('invalid', '机器未返回供应商'),
      view: view(res.view),
    })
    const speaksProtocols = (machineId: string) => ctx.hub.features(machineId).includes('protocolProviders')
    const trail = (userId: string, action: string, detail: { machineId: string; botId?: string }) =>
      audit(ctx, { category: 'admin', actorUserId: userId, action, detail })
    const owned = async (req: { params: Params }, userId: string) => ownMachine(ctx, userId, req.params.id)
    const requireProviderFeatures = (machineId: string, p: ProviderInput) => {
      const endpoints = p.endpoints ?? []
      if (endpoints.some((e) => e.configDir !== undefined || e.executablePath !== undefined))
        requireFeature(
          ctx,
          machineId,
          'claudeProfile',
          '请先升级该机器的 daemon 才能使用该机器 Claude 配置目录',
        )
      if (endpoints.some((e) => e.args?.length))
        requireFeature(ctx, machineId, 'providerArgs', '请先升级该机器的 daemon 才能使用命令行参数')
    }

    /** The agent an older daemon's provider `id` belongs to. */
    const legacyAgentOf = async (machineId: string, id: string) => {
      const found = view((await providersCmd(ctx, machineId, { action: 'list' })).view).providers.find(
        (p) => p.id === id,
      )
      return found?.agents?.[0] ?? fail('not_found', '供应商不存在')
    }

    /**
     * New daemons take the vendor as is, then become the default of each `setDefault` agent; older ones keep one
     * protocol per provider, written as the provider of one agent.
     */
    const save = async (machineId: string, body: unknown, id?: string): Promise<ProviderSavedDto> => {
      const { setDefault, agent, ...fields } = SaveProviderReq.parse(body)
      const input: ProviderInput = id ? { ...fields, id } : fields
      if (!id && !input.apiKey && !input.endpoints?.some((e) => e.configDir))
        fail('invalid', '请填写 API Key')
      requireProviderFeatures(machineId, input)
      if (speaksProtocols(machineId)) {
        const res = saved(await providersCmd(ctx, machineId, { action: 'save', provider: input }))
        for (const a of setDefault)
          res.view = view(
            (await providersCmd(ctx, machineId, { action: 'use', agent: a, choice: res.id })).view,
          )
        return res
      }
      const endpoints = input.endpoints ?? []
      if (endpoints.length > 1 || input.removeProtocols?.length)
        fail('conflict', '请先升级该机器的客户端才能为一个供应商登记多种协议')
      const [endpoint] = endpoints
      const target = id
        ? await legacyAgentOf(machineId, id)
        : (agent ?? (endpoint && agentOfProtocol(endpoint.protocol)) ?? fail('invalid', '请选择供应商的协议'))
      if (endpoint && !agentTakes(target, endpoint.protocol))
        fail('invalid', '{agent} 不支持 {protocol} 协议', {
          agent: agentMeta(target).name,
          protocol: endpoint.protocol,
        })
      if (setDefault.some((a) => a !== target))
        fail('conflict', '请先升级该机器的客户端才能把一个供应商设为多个 Agent 的默认')
      const provider = providerInputToLegacy(input, target)
      return saved(
        await providersCmd(ctx, machineId, { action: 'save', provider, setDefault: setDefault.length > 0 }),
      )
    }

    app.get<{ Params: Params }>('/api/machines/:id/providers', async (req): Promise<ProviderStoreView> => {
      const me = await requireUser(ctx, req)
      const m = await owned(req, me.id)
      return view((await providersCmd(ctx, m.id, { action: 'list' })).view)
    })

    app.get<{ Params: Params }>(
      '/api/machines/:id/providers/presets',
      async (req): Promise<ProviderPreset[]> => {
        const me = await requireUser(ctx, req)
        const m = await owned(req, me.id)
        const { agent } = z.object({ agent: AgentKind.optional() }).parse(req.query)
        return normalizePresets((await providersCmd(ctx, m.id, { action: 'presets', agent })).presets ?? [])
      },
    )

    app.post<{ Params: Params }>('/api/machines/:id/providers', async (req): Promise<ProviderSavedDto> => {
      const me = await requireUser(ctx, req)
      const m = await owned(req, me.id)
      const res = await save(m.id, req.body)
      await trail(me.id, 'machine.providers.save', { machineId: m.id })
      return res
    })

    app.put<{ Params: ProviderParams }>(
      '/api/machines/:id/providers/:pid',
      async (req): Promise<ProviderSavedDto> => {
        const me = await requireUser(ctx, req)
        const m = await owned(req, me.id)
        const res = await save(m.id, req.body, req.params.pid)
        await trail(me.id, 'machine.providers.save', { machineId: m.id })
        return res
      },
    )

    app.delete<{ Params: ProviderParams }>(
      '/api/machines/:id/providers/:pid',
      async (req): Promise<ProviderStoreView> => {
        const me = await requireUser(ctx, req)
        const m = await owned(req, me.id)
        const res = view((await providersCmd(ctx, m.id, { action: 'remove', id: req.params.pid })).view)
        await trail(me.id, 'machine.providers.remove', { machineId: m.id })
        return res
      },
    )

    app.put<{ Params: Params }>(
      '/api/machines/:id/providers/default',
      async (req): Promise<ProviderStoreView> => {
        const me = await requireUser(ctx, req)
        const m = await owned(req, me.id)
        const { agent, choice, model } = UseProviderReq.parse(req.body)
        const withModel = speaksProtocols(m.id)
        if (!withModel && model) fail('conflict', '请先升级该机器的客户端才能为机器默认指定模型')
        const cmd = {
          action: 'use',
          agent,
          choice,
          ...(withModel && model !== undefined && { model }),
        } as const
        const res = view((await providersCmd(ctx, m.id, cmd)).view)
        await trail(me.id, 'machine.providers.default', { machineId: m.id })
        return res
      },
    )

    app.put<{ Params: Params }>(
      '/api/machines/:id/providers/official',
      async (req): Promise<ProviderStoreView> => {
        const me = await requireUser(ctx, req)
        const m = await owned(req, me.id)
        const { agent, ...official } = OfficialProviderReq.parse(req.body)
        if (official.args?.length)
          requireFeature(ctx, m.id, 'claudeArgs', '请先升级该机器的 daemon 才能使用命令行参数')
        const res = view((await providersCmd(ctx, m.id, { action: 'official', agent, official })).view)
        await trail(me.id, 'machine.providers.official', { machineId: m.id })
        return res
      },
    )

    app.put<{ Params: Params }>(
      '/api/machines/:id/agent-settings',
      async (req): Promise<ProviderStoreView> => {
        const me = await requireUser(ctx, req)
        const m = await owned(req, me.id)
        const { agent, ...agentSettings } = AgentSettingsReq.parse(req.body)
        // Older daemons drop an action they do not know, which would leave the request waiting out the timeout.
        requireFeature(ctx, m.id, 'agentSettings', '请先升级该机器的 daemon 才能使用 Agent 设置')
        const res = view(
          (await providersCmd(ctx, m.id, { action: 'agentSettings', agent, agentSettings })).view,
        )
        await trail(me.id, 'machine.providers.agentSettings', { machineId: m.id })
        return res
      },
    )

    app.post<{ Params: Params }>(
      '/api/machines/:id/providers/import-link',
      async (req): Promise<ProviderSavedDto> => {
        const me = await requireUser(ctx, req)
        const m = await owned(req, me.id)
        const { link, setDefault } = ImportLinkReq.parse(req.body)
        const res = saved(await providersCmd(ctx, m.id, { action: 'importLink', link, setDefault }))
        await trail(me.id, 'machine.providers.import', { machineId: m.id })
        return res
      },
    )

    // 新建 Bot: the models a bot about to be created would get with this provider.
    app.get<{ Params: Params }>('/api/machines/:id/catalog', async (req): Promise<BotCatalogDto> => {
      const me = await requireUser(ctx, req)
      const m = await owned(req, me.id)
      const { agent, provider } = z
        .object({ agent: AgentKind, provider: z.string().min(1).default(INHERIT_PROVIDER) })
        .parse(req.query)
      return { catalog: await choiceCatalog(ctx, { machineId: m.id, agentKind: agent }, provider) }
    })

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
      return { candidates: candidates.map(normalizeCandidate) }
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
        .where(and(eq(bots.id, idParam(req.params.id, 'Bot 不存在')), isNull(bots.deletedAt)))
      if (!row) return fail('not_found', 'Bot 不存在')
      const { bot, machineOwner } = row
      if (bot.ownerId !== me.id) return fail('forbidden', '只有 Bot 主人可以设置其供应商')
      if (!bot.machineId || !machineOwner) return fail('conflict', 'Bot 尚未绑定机器')
      if (machineOwner !== me.id) return fail('forbidden', '只能在自己的机器上设置 Bot 的供应商')
      const { choice, model, effort } = BotProviderReq.parse(req.body)
      const agent = bot.agentKind as AgentKind
      const picked = model !== undefined || effort !== undefined
      // Checked against the provider being chosen (inherit: the machine default), before anything changes.
      const catalog = picked
        ? await choiceCatalog(ctx, { machineId: bot.machineId, agentKind: agent }, choice)
        : null
      if (picked) assertPick(catalog, { model, effort }, bot.model)
      const res = view(
        (await providersCmd(ctx, bot.machineId, { action: 'use', agent, botId: bot.id, choice })).view,
      )
      if (picked) {
        const next = model === undefined ? bot.model : model
        // A new model keeps the old level only if it offers it.
        const level =
          effort !== undefined
            ? effort
            : fitEffort(catalog, next, bot.effort) === bot.effort
              ? bot.effort
              : null
        await ctx.db.update(bots).set({ model: next, effort: level }).where(eq(bots.id, bot.id))
        await publishBot(ctx, bot.id)
      }
      await trail(me.id, 'bot.provider', { machineId: bot.machineId, botId: bot.id })
      return res
    })

    // Whoever may pick a model for the bot: its owner, sysadmins and the members of its groups.
    const pickable = async (req: FastifyRequest<{ Params: Params }>) => {
      const me = await requireUser(ctx, req)
      const [bot] = await ctx.db
        .select()
        .from(bots)
        .where(and(eq(bots.id, idParam(req.params.id, 'Bot 不存在')), isNull(bots.deletedAt)))
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
      return bot
    }

    app.get<{ Params: Params }>('/api/bots/:id/catalog', async (req): Promise<BotCatalogDto> => {
      const bot = await pickable(req)
      return { catalog: await pickCatalog(ctx, bot) }
    })

    // 刷新模型: the machine probes the bot's agent again now (e.g. after its CLI config was edited).
    app.post<{ Params: Params }>('/api/bots/:id/catalog/refresh', async (req): Promise<BotCatalogDto> => {
      const bot = await pickable(req)
      if (!bot.machineId) return fail('conflict', 'Bot 尚未绑定机器')
      requireFeature(ctx, bot.machineId, 'reprobe')
      const msg = { t: 'agents.reprobe', requestId: randomUUID(), kind: bot.agentKind as AgentKind } as const
      await relay(ctx, bot.machineId, msg, 'agents.reprobe.result', REPROBE_TIMEOUT_MS)
      return { catalog: await pickCatalog(ctx, bot) }
    })
  }
}
