import { DecidePluginTrustReq, type PluginTrustDto } from '@gonggong/protocol'
import { and, desc, eq, isNull } from 'drizzle-orm'
import type { FastifyInstance } from 'fastify'
import type { Ctx } from '../../context.js'
import { machines, plugins, pluginTrusts, pluginVersions, users } from '../../db/schema.js'
import { audit } from '../../lib/audit.js'
import { fail } from '../../lib/errors.js'
import { idParam } from '../../lib/ids.js'
import { requireUser } from '../auth/session.js'
import { resolveNotifications } from '../notifications/notify.js'

/** The machine, for its owner only: they decide what runs on it. */
async function ownMachine(ctx: Ctx, userId: string, id: string) {
  const [m] = await ctx.db
    .select()
    .from(machines)
    .where(and(eq(machines.id, idParam(id, '机器不存在')), isNull(machines.revokedAt)))
  if (!m) return fail('not_found', '机器不存在')
  if (m.ownerId !== userId) return fail('forbidden', '只有机器主人能授权插件在这台机器上运行')
  return m
}

async function trusts(ctx: Ctx, machineId: string, trustId?: string): Promise<PluginTrustDto[]> {
  const rows = await ctx.db
    .select({ trust: pluginTrusts, plugin: plugins.name, manifest: pluginVersions.manifest, by: users.name })
    .from(pluginTrusts)
    .innerJoin(plugins, eq(plugins.id, pluginTrusts.pluginId))
    .innerJoin(pluginVersions, eq(pluginVersions.id, pluginTrusts.versionId))
    .leftJoin(users, eq(users.id, pluginTrusts.decidedBy))
    .where(
      and(
        eq(pluginTrusts.machineId, machineId),
        trustId ? eq(pluginTrusts.id, idParam(trustId, '授权不存在')) : undefined,
      ),
    )
    .orderBy(desc(pluginTrusts.createdAt))
  return rows.map(({ trust: r, plugin, manifest: m, by }) => ({
    id: r.id,
    machineId: r.machineId,
    pluginId: r.pluginId,
    pluginName: plugin,
    pluginTitle: m.title,
    version: m.version,
    versionId: r.versionId,
    permissions: m.permissions,
    mcp: m.contributes.mcp,
    status: r.status as PluginTrustDto['status'],
    requestedAt: r.createdAt.toISOString(),
    decidedBy: by,
    decidedAt: r.decidedAt?.toISOString() ?? null,
  }))
}

const log = (ctx: Ctx, actorUserId: string, action: string, t: PluginTrustDto) =>
  audit(ctx, {
    category: 'admin',
    actorUserId,
    action,
    detail: { machineId: t.machineId, plugin: t.pluginName, version: t.version, versionId: t.versionId },
  })

/** 插件运行授权 on 我的机器 (plan 插件扩展点 §9). */
export function trustRoutes(ctx: Ctx, app: FastifyInstance) {
  type P = { Params: { id: string; trustId: string } }

  app.get<P>('/api/machines/:id/plugin-trusts', async (req) => {
    const me = await requireUser(ctx, req)
    const m = await ownMachine(ctx, me.id, req.params.id)
    return trusts(ctx, m.id)
  })

  app.put<P>('/api/machines/:id/plugin-trusts/:trustId', async (req) => {
    const me = await requireUser(ctx, req)
    const m = await ownMachine(ctx, me.id, req.params.id)
    const { allow } = DecidePluginTrustReq.parse(req.body)
    const [found] = await trusts(ctx, m.id, req.params.trustId)
    if (!found) return fail('not_found', '授权不存在')
    await ctx.db
      .update(pluginTrusts)
      .set({ status: allow ? 'allowed' : 'denied', decidedBy: me.id, decidedAt: ctx.now() })
      .where(eq(pluginTrusts.id, found.id))
    await resolveNotifications(ctx, 'plugin_trust', 'trustId', [found.id])
    await log(ctx, me.id, allow ? 'plugin.trust_allow' : 'plugin.trust_deny', found)
    return (await trusts(ctx, m.id, found.id))[0]
  })

  app.delete<P>('/api/machines/:id/plugin-trusts/:trustId', async (req, reply) => {
    const me = await requireUser(ctx, req)
    const m = await ownMachine(ctx, me.id, req.params.id)
    const [found] = await trusts(ctx, m.id, req.params.trustId)
    if (!found) return fail('not_found', '授权不存在')
    await ctx.db.delete(pluginTrusts).where(eq(pluginTrusts.id, found.id))
    await resolveNotifications(ctx, 'plugin_trust', 'trustId', [found.id])
    await log(ctx, me.id, 'plugin.trust_revoke', found)
    return reply.status(204).send()
  })
}
