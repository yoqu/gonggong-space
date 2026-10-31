import {
  CreateGroupDesignSystemReq,
  CreationReq,
  type GroupPluginDto,
  type SkillFile,
  TogglePluginReq,
  UploadPluginReq,
} from '@gonggong/protocol'
import { and, eq, inArray, sql } from 'drizzle-orm'
import type { FastifyInstance, FastifyRequest } from 'fastify'
import type { Ctx } from '../../context.js'
import { requireMachine } from '../../daemon/auth.js'
import { bots, plugins, pluginVersions, runs } from '../../db/schema.js'
import { fail } from '../../lib/errors.js'
import { idParam } from '../../lib/ids.js'
import { requireUser } from '../auth/session.js'
import { requireAdmin, requireMember, requireReader } from '../groups/service.js'
import { type Authorize, eachLayer } from '../mcp/routes.js'
import { ACTIVE } from '../runs/scheduler.js'
import { requireTeam } from '../teams/service.js'
import { createCreation, dismissDraft } from './creations.js'
import { createDesignSystem, deleteDesignSystem, designSystemDto, listDesignSystems } from './designSystems.js'
import {
  botStates,
  deletePlugin,
  groupPluginList,
  inLayer,
  listed,
  pluginBlocker,
  pluginDto,
  pluginSnapshot,
  pluginsOn,
  requirePluginsOn,
  savePlugin,
  setGroupPlugin,
} from './service.js'

type Params = { Params: { id?: string; pluginId?: string } }

/** Up to 8 MB of base64 in the JSON body; the decoded files are capped at PLUGIN_MAX_BYTES. */
const BODY_LIMIT = 8 * 1024 * 1024

/** `group`: the group layer, managed only while the master switch is on; its list is the group view below. */
function layerRoutes(ctx: Ctx, app: FastifyInstance, base: string, authorize: Authorize, group: boolean) {
  const writer = async (req: Parameters<Authorize>[0]) => {
    const auth = await authorize(req)
    if (group) await requirePluginsOn(ctx.db)
    return auth
  }
  const find = async (layer: Parameters<typeof inLayer>[0], id: string) => {
    const [row] = await listed(ctx.db, and(inLayer(layer), eq(plugins.id, idParam(id, '插件不存在'))))
    return row ?? fail('not_found', '插件不存在')
  }

  if (!group)
    app.get<Params>(base, async (req) => {
      const { layer } = await authorize(req, true)
      return (await listed(ctx.db, inLayer(layer))).map(pluginDto)
    })

  app.post<Params>(base, { bodyLimit: BODY_LIMIT }, async (req, reply) => {
    const { actorId, layer } = await writer(req)
    const { files } = UploadPluginReq.parse(req.body)
    const saved = await savePlugin(ctx, layer, pluginSnapshot(files), actorId)
    return reply.status(saved.created ? 201 : 200).send(pluginDto(await find(layer, saved.plugin.id)))
  })

  app.delete<Params>(`${base}/:pluginId`, async (req, reply) => {
    const { actorId, layer } = await writer(req)
    const { plugin } = await find(layer, req.params.pluginId ?? '')
    await deletePlugin(ctx, layer, plugin, actorId)
    return reply.status(204).send()
  })
}

/** Plugins in effect for a group with its switch and per-bot availability; off entirely without the master switch. */
function groupRoutes(ctx: Ctx, app: FastifyInstance) {
  type P = { Params: { id: string; pluginId?: string } }
  const list = async (groupId: string, userId: string): Promise<GroupPluginDto[]> => {
    const [rows, states] = await Promise.all([
      groupPluginList(ctx.db, groupId),
      botStates(ctx, groupId, userId),
    ])
    return rows.map((r) => ({
      ...pluginDto(r),
      enabledInGroup: r.enabledInGroup,
      bots: states.map((b) => ({ botId: b.id, blocker: pluginBlocker(r.version.manifest, b.state) })),
    }))
  }

  app.get<P>('/api/groups/:id/plugins', async (req) => {
    const me = await requireUser(ctx, req)
    const { group } = await requireMember(ctx, req.params.id, me.id)
    return (await pluginsOn(ctx.db)) ? list(group.id, me.id) : []
  })

  app.put<P>('/api/groups/:id/plugins/:pluginId', async (req) => {
    const me = await requireUser(ctx, req)
    const { group } = await requireAdmin(ctx, req.params.id, me.id)
    await requirePluginsOn(ctx.db)
    const { enabled } = TogglePluginReq.parse(req.body)
    const found = (await groupPluginList(ctx.db, group.id)).find((r) => r.plugin.id === req.params.pluginId)
    if (!found) return fail('not_found', '插件不存在')
    await setGroupPlugin(ctx, group.id, found.plugin, enabled, me.id)
    return (await list(group.id, me.id)).find((p) => p.id === found.plugin.id)
  })

  app.post<P>('/api/groups/:id/creations', async (req) => {
    const me = await requireUser(ctx, req)
    return createCreation(ctx, me, req.params.id, CreationReq.parse(req.body))
  })

  type D = { Params: { id: string; dsId?: string } }
  const member = async (req: FastifyRequest<D>) => {
    const me = await requireUser(ctx, req)
    const row = await requireMember(ctx, req.params.id, me.id)
    await requirePluginsOn(ctx.db)
    return { me, ...row }
  }
  app.get<D>('/api/groups/:id/design-systems', async (req) => {
    const { group } = await member(req)
    return (await listDesignSystems(ctx, group.id)).map(designSystemDto)
  })
  app.post<D>('/api/groups/:id/design-systems', async (req, reply) => {
    const { me, group } = await member(req)
    const row = await createDesignSystem(ctx, group.id, me.id, CreateGroupDesignSystemReq.parse(req.body))
    return reply.status(201).send(designSystemDto(row))
  })
  app.delete<D>('/api/groups/:id/design-systems/:dsId', async (req, reply) => {
    const { me, group, member: m } = await member(req)
    await deleteDesignSystem(ctx, group.id, req.params.dsId ?? '', { id: me.id, isAdmin: m.isAdmin })
    return reply.status(204).send()
  })

  app.post<{ Params: { id: string; messageId: string } }>(
    '/api/groups/:id/creation-drafts/:messageId/dismiss',
    async (req, reply) => {
      const me = await requireUser(ctx, req)
      await dismissDraft(ctx, me, req.params.id, req.params.messageId)
      return reply.status(204).send()
    },
  )
}

const MIME: Record<string, string> = {
  png: 'image/png',
  jpg: 'image/jpeg',
  jpeg: 'image/jpeg',
  gif: 'image/gif',
  webp: 'image/webp',
  svg: 'image/svg+xml',
  css: 'text/css; charset=utf-8',
  md: 'text/markdown; charset=utf-8',
  json: 'application/json; charset=utf-8',
}

/** A file of a plugin's current version (template previews), for readers of its layer. */
function fileRoutes(ctx: Ctx, app: FastifyInstance) {
  app.get<{ Params: { id: string; '*': string } }>('/api/plugins/:id/files/*', async (req, reply) => {
    const me = await requireUser(ctx, req)
    const [row] = await ctx.db
      .select({ plugin: plugins, files: pluginVersions.files })
      .from(plugins)
      .innerJoin(pluginVersions, eq(pluginVersions.id, plugins.versionId))
      .where(eq(plugins.id, idParam(req.params.id, '插件不存在')))
    if (!row) return fail('not_found', '插件不存在')
    const { scope, teamId, groupId } = row.plugin
    if (scope === 'team') await requireTeam(ctx, me.id, teamId!)
    if (scope === 'group') await requireReader(ctx, groupId!, me.id)
    const path = req.params['*']
    const file = (row.files as SkillFile[]).find((f) => f.path === path) ?? fail('not_found', '文件不存在')
    const ext = path.split('.').pop()?.toLowerCase() ?? ''
    return reply
      .headers({
        'content-type': MIME[ext] ?? 'application/octet-stream',
        'content-security-policy': 'sandbox',
        'x-content-type-options': 'nosniff',
      })
      .send(Buffer.from(file.content, file.encoding === 'base64' ? 'base64' : 'utf8'))
  })
}

/** A plugin version for a machine one of whose live runs was sent it (RunStart.plugins). */
function daemonRoutes(ctx: Ctx, app: FastifyInstance) {
  app.get<{ Params: { versionId: string } }>('/api/daemon/plugins/:versionId', async (req) => {
    const machine = await requireMachine(ctx, req)
    const versionId = idParam(req.params.versionId, '版本不存在')
    const [found] = await ctx.db
      .select({ files: pluginVersions.files })
      .from(pluginVersions)
      .where(eq(pluginVersions.id, versionId))
    if (!found) return fail('not_found', '版本不存在')
    const [sent] = await ctx.db
      .select({ id: runs.id })
      .from(runs)
      .innerJoin(bots, eq(bots.id, runs.botId))
      .where(
        and(
          eq(bots.machineId, machine.id),
          inArray(runs.status, ACTIVE),
          sql`${runs.plugins} @> ${JSON.stringify([{ versionId }])}::jsonb`,
        ),
      )
      .limit(1)
    if (!sent) return fail('forbidden', '该机器上没有正在使用这个插件版本的运行')
    return { files: found.files as SkillFile[] }
  })
}

export function pluginRoutes(ctx: Ctx) {
  return async (app: FastifyInstance) => {
    eachLayer(ctx, 'plugins', (base, authorize) =>
      layerRoutes(ctx, app, base, authorize, base.startsWith('/api/groups/')),
    )
    groupRoutes(ctx, app)
    fileRoutes(ctx, app)
    daemonRoutes(ctx, app)
  }
}
