import type { McpServer, McpServerDto } from '@gonggong/protocol'
import { and, eq, inArray, isNull, ne, or, type SQL } from 'drizzle-orm'
import type { Ctx } from '../../context.js'
import type { Db } from '../../db/client.js'
import { groupBots, groupMcpOverrides, groups, mcpServers } from '../../db/schema.js'
import { audit } from '../../lib/audit.js'
import { fail } from '../../lib/errors.js'
import { keptIn, setInherited as setOverride, turnedOff } from '../../lib/group-overrides.js'
import { publishBotState, RESET_SESSION } from '../workspaces/state.js'
import { externalize } from './secrets.js'

export type McpRow = typeof mcpServers.$inferSelect
export type Scope = 'platform' | 'team' | 'group'
/** One layer's rows (plan D8): platform has neither id, team rows a team, group rows both. */
export type Layer = { scope: Scope; teamId: string | null; groupId: string | null }
/** Extra audit detail, e.g. the bot and run acting for the user. */
type Extra = Record<string, unknown>

/** The daemon injects the built-in ask server under this name (spec §8.8). */
const RESERVED = 'gonggong'
export const RANK: Record<Scope, number> = { platform: 0, team: 1, group: 2 }

export const mcpDto = (r: McpRow): McpServerDto => ({
  id: r.id,
  enabled: r.enabled,
  config: r.config as McpServer,
  updatedAt: r.updatedAt.toISOString(),
})

/** What a non-admin sees of a server: name and transport only, as the command line, URL, env and headers may hold secrets. */
export const publicConfig = (c: McpServer): McpServer =>
  c.transport === 'http'
    ? { transport: 'http', name: c.name, url: '', headers: {} }
    : { transport: 'stdio', name: c.name, command: '', args: [], env: {} }

export const inLayer = (l: Layer) =>
  and(
    eq(mcpServers.scope, l.scope),
    l.teamId ? eq(mcpServers.teamId, l.teamId) : isNull(mcpServers.teamId),
    l.groupId ? eq(mcpServers.groupId, l.groupId) : isNull(mcpServers.groupId),
  )

/** Servers applying to the group, enabled or not: platform, the group's team and the group itself. */
export function visibleIn(db: Pick<Db, 'select'>, groupId: string) {
  const team = db.select({ id: groups.teamId }).from(groups).where(eq(groups.id, groupId))
  return or(
    eq(mcpServers.scope, 'platform'),
    and(eq(mcpServers.scope, 'team'), inArray(mcpServers.teamId, team)),
    and(eq(mcpServers.scope, 'group'), eq(mcpServers.groupId, groupId)),
  )
}

/** One per name, sorted by name: a lower layer replaces a same-named server above it. */
export function mergeMcp<T extends { scope: string; name: string }>(rows: T[]) {
  const merged = new Map<string, T>()
  for (const r of [...rows].sort((a, b) => RANK[a.scope as Scope] - RANK[b.scope as Scope]))
    merged.set(r.name, r)
  return [...merged.values()].sort((a, b) => (a.name < b.name ? -1 : 1))
}

export const mcpTurnedOff = (db: Pick<Db, 'select'>, groupId: string) =>
  turnedOff(db, groupMcpOverrides, groupId)

/**
 * Enabled servers for a new session in the group (spec §7.2, §7.4): platform, the group's team and the group itself,
 * a lower layer replacing a same-named server above it; inherited ones the group turned off are left out.
 */
export async function enabledMcpServers(db: Pick<Db, 'select'>, groupId: string): Promise<McpServer[]> {
  const off = await mcpTurnedOff(db, groupId)
  const rows = await db
    .select()
    .from(mcpServers)
    .where(and(eq(mcpServers.enabled, true), visibleIn(db, groupId)))
  return mergeMcp(rows.filter(keptIn(off))).map((r) => r.config as McpServer)
}

/** Platform and team servers in effect above the group, merged, with whether the group keeps them on. */
export async function inheritedMcp(db: Pick<Db, 'select'>, groupId: string) {
  const rows = await db
    .select()
    .from(mcpServers)
    .where(and(eq(mcpServers.enabled, true), ne(mcpServers.scope, 'group'), visibleIn(db, groupId)))
  const off = await mcpTurnedOff(db, groupId)
  return mergeMcp(rows).map((row) => ({ row, enabledInGroup: !off.has(row.name) }))
}

/** Turns inherited server `name` on or off for the group alone; false when it already was. */
export const setInheritedMcp = (
  ctx: Ctx,
  groupId: string,
  name: string,
  enabled: boolean,
  actorId: string,
  extra?: Extra,
) => setOverride(ctx, groupMcpOverrides, 'mcp.group_toggle', groupId, name, enabled, actorId, extra)

function validConfig(config: McpServer): McpServer {
  const name = config.name.trim()
  if (!name) fail('invalid', 'MCP 名称不能为空')
  if (name === RESERVED) fail('invalid', `${RESERVED} 是系统内置 MCP 的名称`)
  return { ...config, name }
}

/** Running turns are unaffected: they already hold their session; only the next dispatch opens a new one. */
export async function forceNewSessions(ctx: Ctx, l: Layer) {
  const affected = l.groupId
    ? eq(groupBots.groupId, l.groupId)
    : l.teamId
      ? inArray(
          groupBots.groupId,
          ctx.db.select({ id: groups.id }).from(groups).where(eq(groups.teamId, l.teamId)),
        )
      : undefined
  const rows = await ctx.db
    .update(groupBots)
    .set({ ...RESET_SESSION, newSessionReason: 'config_changed' })
    .where(and(isNull(groupBots.removedAt), affected))
    .returning()
  for (const row of rows) await publishBotState(ctx, row)
}

async function logMcp(
  ctx: Ctx,
  actorId: string,
  l: Layer,
  action: string,
  row: McpRow,
  force: boolean,
  extra?: Extra,
) {
  if (force) await forceNewSessions(ctx, l)
  await audit(ctx, {
    category: 'admin',
    actorUserId: actorId,
    teamId: l.teamId,
    groupId: l.groupId,
    action,
    detail: {
      id: row.id,
      layer: l.scope,
      name: row.name,
      enabled: row.enabled,
      forceNewSession: force,
      ...extra,
    },
  })
}

export async function findMcp(ctx: Ctx, l: Layer, where: SQL) {
  const [row] = await ctx.db
    .select()
    .from(mcpServers)
    .where(and(inLayer(l), where))
  return row
}

type Save = { enabled: boolean; config: McpServer }

export async function createMcp(ctx: Ctx, l: Layer, s: Save, actorId: string, force: boolean, extra?: Extra) {
  const valid = validConfig(s.config)
  const [exists] = await ctx.db
    .select({ id: mcpServers.id })
    .from(mcpServers)
    .where(and(inLayer(l), eq(mcpServers.name, valid.name)))
  if (exists) return fail('conflict', 'MCP 名称已存在')
  const config = await externalize(ctx, l, valid, actorId)
  const [row] = await ctx.db
    .insert(mcpServers)
    .values({ ...l, name: config.name, enabled: s.enabled, config, updatedAt: ctx.now() })
    .onConflictDoNothing()
    .returning()
  if (!row) return fail('conflict', 'MCP 名称已存在')
  await logMcp(ctx, actorId, l, 'mcp.create', row, force, extra)
  return row
}

export async function updateMcp(
  ctx: Ctx,
  l: Layer,
  id: string,
  s: Save,
  actorId: string,
  force: boolean,
  extra?: Extra,
) {
  const valid = validConfig(s.config)
  const [taken] = await ctx.db
    .select({ id: mcpServers.id })
    .from(mcpServers)
    .where(and(inLayer(l), eq(mcpServers.name, valid.name), ne(mcpServers.id, id)))
  if (taken) return fail('conflict', 'MCP 名称已存在')
  const [current] = await ctx.db
    .select({ id: mcpServers.id })
    .from(mcpServers)
    .where(and(inLayer(l), eq(mcpServers.id, id)))
  if (!current) return fail('not_found', 'MCP 不存在')
  const config = await externalize(ctx, l, valid, actorId)
  const [row] = await ctx.db
    .update(mcpServers)
    .set({ name: config.name, enabled: s.enabled, config, updatedAt: ctx.now() })
    .where(and(inLayer(l), eq(mcpServers.id, id)))
    .returning()
  if (!row) return fail('not_found', 'MCP 不存在')
  await logMcp(ctx, actorId, l, 'mcp.update', row, force, extra)
  return row
}

export async function deleteMcp(
  ctx: Ctx,
  l: Layer,
  id: string,
  actorId: string,
  force: boolean,
  extra?: Extra,
) {
  const [row] = await ctx.db
    .delete(mcpServers)
    .where(and(inLayer(l), eq(mcpServers.id, id)))
    .returning()
  if (!row) return fail('not_found', 'MCP 不存在')
  await logMcp(ctx, actorId, l, 'mcp.delete', row, force, extra)
  return row
}
