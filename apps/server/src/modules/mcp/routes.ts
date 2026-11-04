import { type InheritedMcpDto, type McpServerDto, SaveMcpReq, ToggleInheritedReq } from '@gonggong/protocol'
import { asc } from 'drizzle-orm'
import type { FastifyInstance, FastifyRequest } from 'fastify'
import type { Ctx } from '../../context.js'
import { mcpServers } from '../../db/schema.js'
import { fail } from '../../lib/errors.js'
import { idParam } from '../../lib/ids.js'
import { isLayerAdmin } from '../agent-tools/layers.js'
import { requireSysadmin, requireUser } from '../auth/session.js'
import { requireAdmin, requireMember } from '../groups/service.js'
import { requireTeam } from '../teams/service.js'
import {
  createMcp,
  deleteMcp,
  inheritedMcp,
  inLayer,
  type Layer,
  mcpDto,
  publicConfig,
  setInheritedMcp,
  updateMcp,
} from './service.js'

type Params = { Params: { id?: string; mcpId?: string } }

const readable = <T extends McpServerDto>(d: T, admin: boolean): T =>
  admin ? d : { ...d, config: publicConfig(d.config) }

/** The same list / create / update / delete under `base` for each layer; `authorize` resolves the caller's layer. */
function layerRoutes(ctx: Ctx, app: FastifyInstance, base: string, authorize: Authorize) {
  app.get<Params>(base, async (req) => {
    const { layer, admin } = await authorize(req, true)
    const rows = await ctx.db.select().from(mcpServers).where(inLayer(layer)).orderBy(asc(mcpServers.name))
    return rows.map((r) => readable(mcpDto(r), admin))
  })

  app.post<Params>(base, async (req, reply) => {
    const { actorId, layer } = await authorize(req)
    const body = SaveMcpReq.parse(req.body)
    const row = await createMcp(ctx, layer, body, actorId, body.forceNewSession)
    return reply.status(201).send(mcpDto(row))
  })

  app.patch<Params>(`${base}/:mcpId`, async (req) => {
    const { actorId, layer } = await authorize(req)
    const id = idParam(req.params.mcpId ?? '', 'MCP 不存在')
    const body = SaveMcpReq.parse(req.body)
    return mcpDto(await updateMcp(ctx, layer, id, body, actorId, body.forceNewSession))
  })

  app.delete<Params & { Querystring: { forceNewSession?: string } }>(`${base}/:mcpId`, async (req, reply) => {
    const { actorId, layer } = await authorize(req)
    const id = idParam(req.params.mcpId ?? '', 'MCP 不存在')
    await deleteMcp(ctx, layer, id, actorId, req.query.forceNewSession === 'true')
    return reply.status(204).send()
  })
}

/** Platform / team servers in effect for a group, which its members see and its admins turn on or off for it alone. */
function inheritedRoutes(ctx: Ctx, app: FastifyInstance) {
  type P = { Params: { id: string; name?: string } }
  const list = async (groupId: string): Promise<InheritedMcpDto[]> =>
    (await inheritedMcp(ctx.db, groupId)).map(({ row, enabledInGroup }) => ({
      ...mcpDto(row),
      scope: row.scope as InheritedMcpDto['scope'],
      enabledInGroup,
    }))

  // Full configs only for admins of the row's own layer: a group admin is not one of the team's or the platform's.
  app.get<P>('/api/groups/:id/inherited-mcp', async (req) => {
    const me = await requireUser(ctx, req)
    const { group } = await requireMember(ctx, req.params.id, me.id)
    const admin = {
      platform: await isLayerAdmin(ctx, me.id, { scope: 'platform', teamId: null, groupId: null }),
      team: await isLayerAdmin(ctx, me.id, { scope: 'team', teamId: group.teamId, groupId: null }),
    }
    return (await list(group.id)).map((s) => readable(s, admin[s.scope as 'platform' | 'team']))
  })

  app.put<P>('/api/groups/:id/inherited-mcp/:name', async (req) => {
    const me = await requireUser(ctx, req)
    const { group } = await requireAdmin(ctx, req.params.id, me.id)
    const { enabled } = ToggleInheritedReq.parse(req.body)
    const found = (await list(group.id)).find((s) => s.config.name === req.params.name)
    if (!found) return fail('not_found', 'MCP 不存在')
    await setInheritedMcp(ctx, group.id, found.config.name, enabled, me.id)
    return { ...found, enabledInGroup: enabled }
  })
}

/**
 * `read` lets plain group members list the group layer too; `admin` is false for them, so secrets are left out.
 */
export type Authorize = (
  req: FastifyRequest<{ Params: { id?: string } }>,
  read?: boolean,
) => Promise<{ actorId: string; layer: Layer; admin: boolean }>

/**
 * Platform layer for sysadmins, team layer for team admins, group layer for group admins (plan D8); group members
 * may read the group layer, and with `teamMembersRead` team members the team layer (skills hold no secrets).
 */
export function eachLayer(
  ctx: Ctx,
  segment: string,
  routes: (base: string, authorize: Authorize) => void,
  { teamMembersRead = false } = {},
) {
  routes(`/api/admin/${segment}`, async (req) => ({
    actorId: (await requireSysadmin(ctx, req)).id,
    layer: { scope: 'platform', teamId: null, groupId: null },
    admin: true,
  }))
  routes(`/api/teams/:id/${segment}`, async (req, read) => {
    const me = await requireUser(ctx, req)
    const { team, role } = await requireTeam(
      ctx,
      me.id,
      req.params.id ?? '',
      read && teamMembersRead ? 'member' : 'admin',
    )
    return {
      actorId: me.id,
      layer: { scope: 'team', teamId: team.id, groupId: null },
      admin: role !== 'member',
    }
  })
  routes(`/api/groups/:id/${segment}`, async (req, read) => {
    const me = await requireUser(ctx, req)
    const { group, member } = await (read ? requireMember : requireAdmin)(ctx, req.params.id ?? '', me.id)
    return {
      actorId: me.id,
      layer: { scope: 'group', teamId: group.teamId, groupId: group.id },
      admin: member.isAdmin,
    }
  })
}

export function mcpRoutes(ctx: Ctx) {
  return async (app: FastifyInstance) => {
    eachLayer(ctx, 'mcp', (base, authorize) => layerRoutes(ctx, app, base, authorize))
    inheritedRoutes(ctx, app)
    // Cards from before secrets are read-only: the values now go into secret definitions (secret_request).
    app.post('/api/mcp-secrets/:id', async (req) => {
      await requireUser(ctx, req)
      return fail('conflict', '这张卡片已停用，请让 Bot 用 secret_request 重新发起')
    })
  }
}
