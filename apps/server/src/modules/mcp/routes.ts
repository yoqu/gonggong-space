import { type McpServer, type McpServerDto, SaveMcpReq } from '@aiws/protocol'
import { and, asc, eq, isNull, ne } from 'drizzle-orm'
import type { FastifyInstance } from 'fastify'
import type { Ctx } from '../../context.js'
import type { Db } from '../../db/client.js'
import { groupBots, mcpServers } from '../../db/schema.js'
import { audit } from '../../lib/audit.js'
import { fail } from '../../lib/errors.js'
import { idParam } from '../../lib/ids.js'
import { requireSysadmin } from '../auth/session.js'

type Row = typeof mcpServers.$inferSelect
type IdParams = { Params: { id: string } }

/** The daemon injects the built-in ask server under this name (spec §8.8). */
const RESERVED = 'aiws'

const dto = (r: Row): McpServerDto => ({
  id: r.id,
  enabled: r.enabled,
  config: r.config as McpServer,
  updatedAt: r.updatedAt.toISOString(),
})

/** Enabled global-layer servers, injected when a session is created (spec §7.2, §7.4). */
export async function enabledMcpServers(db: Pick<Db, 'select'>): Promise<McpServer[]> {
  const rows = await db
    .select()
    .from(mcpServers)
    .where(eq(mcpServers.enabled, true))
    .orderBy(asc(mcpServers.name))
  return rows.map((r) => r.config as McpServer)
}

function parse(body: unknown) {
  const req = SaveMcpReq.parse(body)
  const name = req.config.name.trim()
  if (!name) fail('invalid', 'MCP 名称不能为空')
  if (name === RESERVED) fail('invalid', `${RESERVED} 是系统内置 MCP 的名称`)
  return { ...req, config: { ...req.config, name } }
}

/** Running turns are unaffected: they already hold their session; only the next dispatch opens a new one. */
async function forceNewSessions(ctx: Ctx) {
  await ctx.db
    .update(groupBots)
    .set({ newSessionReason: 'config_changed', sessionId: null })
    .where(isNull(groupBots.removedAt))
}

export function mcpRoutes(ctx: Ctx) {
  return async (app: FastifyInstance) => {
    const save = async (actorId: string, action: string, row: Row | undefined, force: boolean) => {
      if (!row) return fail('not_found', 'MCP 不存在')
      if (force) await forceNewSessions(ctx)
      await audit(ctx, {
        category: 'admin',
        actorUserId: actorId,
        action,
        detail: { id: row.id, name: row.name, enabled: row.enabled, forceNewSession: force },
      })
      return dto(row)
    }

    app.get('/api/admin/mcp', async (req) => {
      await requireSysadmin(ctx, req)
      return (await ctx.db.select().from(mcpServers).orderBy(asc(mcpServers.name))).map(dto)
    })

    app.post('/api/admin/mcp', async (req, reply) => {
      const actor = await requireSysadmin(ctx, req)
      const body = parse(req.body)
      const [row] = await ctx.db
        .insert(mcpServers)
        .values({ name: body.config.name, enabled: body.enabled, config: body.config, updatedAt: ctx.now() })
        .onConflictDoNothing({ target: mcpServers.name })
        .returning()
      if (!row) return fail('conflict', 'MCP 名称已存在')
      return reply.status(201).send(await save(actor.id, 'mcp.create', row, body.forceNewSession))
    })

    app.patch<IdParams>('/api/admin/mcp/:id', async (req) => {
      const actor = await requireSysadmin(ctx, req)
      const id = idParam(req.params.id, 'MCP ')
      const body = parse(req.body)
      const [taken] = await ctx.db
        .select({ id: mcpServers.id })
        .from(mcpServers)
        .where(and(eq(mcpServers.name, body.config.name), ne(mcpServers.id, id)))
      if (taken) return fail('conflict', 'MCP 名称已存在')
      const [row] = await ctx.db
        .update(mcpServers)
        .set({ name: body.config.name, enabled: body.enabled, config: body.config, updatedAt: ctx.now() })
        .where(eq(mcpServers.id, id))
        .returning()
      return save(actor.id, 'mcp.update', row, body.forceNewSession)
    })

    app.delete<IdParams & { Querystring: { forceNewSession?: string } }>(
      '/api/admin/mcp/:id',
      async (req, reply) => {
        const actor = await requireSysadmin(ctx, req)
        const id = idParam(req.params.id, 'MCP ')
        const [row] = await ctx.db.delete(mcpServers).where(eq(mcpServers.id, id)).returning()
        await save(actor.id, 'mcp.delete', row, req.query.forceNewSession === 'true')
        return reply.status(204).send()
      },
    )
  }
}
