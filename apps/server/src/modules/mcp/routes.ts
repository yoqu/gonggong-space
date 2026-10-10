import { type McpServer, type McpServerDto, SaveMcpReq } from '@gonggong/protocol'
import { and, asc, eq, inArray, isNull, ne, or } from 'drizzle-orm'
import type { FastifyInstance, FastifyRequest } from 'fastify'
import type { Ctx } from '../../context.js'
import type { Db } from '../../db/client.js'
import { groupBots, groups, mcpServers } from '../../db/schema.js'
import { audit } from '../../lib/audit.js'
import { fail } from '../../lib/errors.js'
import { idParam } from '../../lib/ids.js'
import { requireSysadmin, requireUser } from '../auth/session.js'
import { requireAdmin } from '../groups/service.js'
import { requireTeam } from '../teams/service.js'

type Row = typeof mcpServers.$inferSelect
export type Scope = 'platform' | 'team' | 'group'
/** One layer's rows (plan D8): platform has neither id, team rows a team, group rows both. */
export type Layer = { scope: Scope; teamId: string | null; groupId: string | null }
type Params = { Params: { id?: string; mcpId?: string } }

/** The daemon injects the built-in ask server under this name (spec §8.8). */
const RESERVED = 'gonggong'
export const RANK: Record<Scope, number> = { platform: 0, team: 1, group: 2 }

const dto = (r: Row): McpServerDto => ({
  id: r.id,
  enabled: r.enabled,
  config: r.config as McpServer,
  updatedAt: r.updatedAt.toISOString(),
})

const inLayer = (l: Layer) =>
  and(
    eq(mcpServers.scope, l.scope),
    l.teamId ? eq(mcpServers.teamId, l.teamId) : isNull(mcpServers.teamId),
    l.groupId ? eq(mcpServers.groupId, l.groupId) : isNull(mcpServers.groupId),
  )

/**
 * Enabled servers for a new session in the group (spec §7.2, §7.4): platform, the group's team and the group itself,
 * a lower layer replacing a same-named server above it.
 */
export async function enabledMcpServers(db: Pick<Db, 'select'>, groupId: string): Promise<McpServer[]> {
  const team = db.select({ id: groups.teamId }).from(groups).where(eq(groups.id, groupId))
  const rows = await db
    .select()
    .from(mcpServers)
    .where(
      and(
        eq(mcpServers.enabled, true),
        or(
          eq(mcpServers.scope, 'platform'),
          and(eq(mcpServers.scope, 'team'), inArray(mcpServers.teamId, team)),
          and(eq(mcpServers.scope, 'group'), eq(mcpServers.groupId, groupId)),
        ),
      ),
    )
  const merged = new Map<string, Row>()
  for (const r of rows.sort((a, b) => RANK[a.scope as Scope] - RANK[b.scope as Scope])) merged.set(r.name, r)
  return [...merged.values()].sort((a, b) => (a.name < b.name ? -1 : 1)).map((r) => r.config as McpServer)
}

function parse(body: unknown) {
  const req = SaveMcpReq.parse(body)
  const name = req.config.name.trim()
  if (!name) fail('invalid', 'MCP 名称不能为空')
  if (name === RESERVED) fail('invalid', `${RESERVED} 是系统内置 MCP 的名称`)
  return { ...req, config: { ...req.config, name } }
}

/** Running turns are unaffected: they already hold their session; only the next dispatch opens a new one. */
async function forceNewSessions(ctx: Ctx, l: Layer) {
  const affected = l.groupId
    ? eq(groupBots.groupId, l.groupId)
    : l.teamId
      ? inArray(
          groupBots.groupId,
          ctx.db.select({ id: groups.id }).from(groups).where(eq(groups.teamId, l.teamId)),
        )
      : undefined
  await ctx.db
    .update(groupBots)
    .set({ newSessionReason: 'config_changed', sessionId: null })
    .where(and(isNull(groupBots.removedAt), affected))
}

/** The same list / create / update / delete under `base` for each layer; `authorize` resolves the caller's layer. */
function layerRoutes(ctx: Ctx, app: FastifyInstance, base: string, authorize: Authorize) {
  const save = async (actorId: string, l: Layer, action: string, row: Row | undefined, force: boolean) => {
    if (!row) return fail('not_found', 'MCP 不存在')
    if (force) await forceNewSessions(ctx, l)
    await audit(ctx, {
      category: 'admin',
      actorUserId: actorId,
      teamId: l.teamId,
      groupId: l.groupId,
      action,
      detail: { id: row.id, layer: l.scope, name: row.name, enabled: row.enabled, forceNewSession: force },
    })
    return dto(row)
  }

  app.get<Params>(base, async (req) => {
    const { layer } = await authorize(req)
    return (await ctx.db.select().from(mcpServers).where(inLayer(layer)).orderBy(asc(mcpServers.name))).map(
      dto,
    )
  })

  app.post<Params>(base, async (req, reply) => {
    const { actorId, layer } = await authorize(req)
    const body = parse(req.body)
    const [row] = await ctx.db
      .insert(mcpServers)
      .values({
        ...layer,
        name: body.config.name,
        enabled: body.enabled,
        config: body.config,
        updatedAt: ctx.now(),
      })
      .onConflictDoNothing()
      .returning()
    if (!row) return fail('conflict', 'MCP 名称已存在')
    return reply.status(201).send(await save(actorId, layer, 'mcp.create', row, body.forceNewSession))
  })

  app.patch<Params>(`${base}/:mcpId`, async (req) => {
    const { actorId, layer } = await authorize(req)
    const id = idParam(req.params.mcpId ?? '', 'MCP 不存在')
    const body = parse(req.body)
    const [taken] = await ctx.db
      .select({ id: mcpServers.id })
      .from(mcpServers)
      .where(and(inLayer(layer), eq(mcpServers.name, body.config.name), ne(mcpServers.id, id)))
    if (taken) return fail('conflict', 'MCP 名称已存在')
    const [row] = await ctx.db
      .update(mcpServers)
      .set({ name: body.config.name, enabled: body.enabled, config: body.config, updatedAt: ctx.now() })
      .where(and(inLayer(layer), eq(mcpServers.id, id)))
      .returning()
    return save(actorId, layer, 'mcp.update', row, body.forceNewSession)
  })

  app.delete<Params & { Querystring: { forceNewSession?: string } }>(`${base}/:mcpId`, async (req, reply) => {
    const { actorId, layer } = await authorize(req)
    const id = idParam(req.params.mcpId ?? '', 'MCP 不存在')
    const [row] = await ctx.db
      .delete(mcpServers)
      .where(and(inLayer(layer), eq(mcpServers.id, id)))
      .returning()
    await save(actorId, layer, 'mcp.delete', row, req.query.forceNewSession === 'true')
    return reply.status(204).send()
  })
}

export type Authorize = (
  req: FastifyRequest<{ Params: { id?: string } }>,
) => Promise<{ actorId: string; layer: Layer }>

/** Platform layer for sysadmins, team layer for team admins, group layer for group admins (plan D8). */
export function eachLayer(ctx: Ctx, segment: string, routes: (base: string, authorize: Authorize) => void) {
  routes(`/api/admin/${segment}`, async (req) => ({
    actorId: (await requireSysadmin(ctx, req)).id,
    layer: { scope: 'platform', teamId: null, groupId: null },
  }))
  routes(`/api/teams/:id/${segment}`, async (req) => {
    const me = await requireUser(ctx, req)
    const { team } = await requireTeam(ctx, me.id, req.params.id ?? '', 'admin')
    return { actorId: me.id, layer: { scope: 'team', teamId: team.id, groupId: null } }
  })
  routes(`/api/groups/:id/${segment}`, async (req) => {
    const me = await requireUser(ctx, req)
    const { group } = await requireAdmin(ctx, req.params.id ?? '', me.id)
    return { actorId: me.id, layer: { scope: 'group', teamId: group.teamId, groupId: group.id } }
  })
}

export function mcpRoutes(ctx: Ctx) {
  return async (app: FastifyInstance) =>
    eachLayer(ctx, 'mcp', (base, authorize) => layerRoutes(ctx, app, base, authorize))
}
