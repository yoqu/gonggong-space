import { type McpServer, SECRET_NAME } from '@gonggong/protocol'
import { and, eq, isNull, or } from 'drizzle-orm'
import type { Ctx } from '../../context.js'
import { mcpServers, secrets } from '../../db/schema.js'
import { open } from '../../lib/seal.js'
import { createSecret, reservedName, setSharedValue } from '../secrets/service.js'
import type { Layer, McpRow, Scope } from './service.js'

/** A value referencing a secret definition (plan 团队密钥-方案 §8). */
const REF = /^\$\{secret:([A-Z][A-Z0-9_]{1,63})\}$/
/** Placeholders written before secrets existed (filled on an MCP card). */
const PLACEHOLDER = /^\$\{secret:[A-Za-z0-9_.-]+\}$/

/** env (stdio) or headers (http): every value there is a secret. */
const secretsOf = (c: McpServer) => (c.transport === 'stdio' ? c.env : c.headers)
const withSecrets = (c: McpServer, s: Record<string, string>): McpServer =>
  c.transport === 'stdio' ? { ...c, env: s } : { ...c, headers: s }

const refOf = (v: string) => REF.exec(v)?.[1] ?? null
const ref = (name: string) => `\${secret:${name}}`

/** Keys whose values are not `${secret:NAME}` references (plain text the agent must not set). */
export const nonRefs = (c: McpServer) =>
  Object.entries(secretsOf(c))
    .filter(([, v]) => !refOf(v))
    .map(([k]) => k)

const refsOf = (c: McpServer) =>
  Object.values(secretsOf(c)).flatMap((v) => {
    const n = refOf(v)
    return n ? [n] : []
  })

/** Referenced names without a value for this run. */
export const missingRefs = (c: McpServer, env: Record<string, string>) =>
  [...new Set(refsOf(c))].filter((n) => !(n in env))

/** The config with references replaced by the run's values; null when one has none (not sent this run). */
export function substitute(c: McpServer, env: Record<string, string>): McpServer | null {
  if (missingRefs(c, env).length) return null
  const s = Object.fromEntries(
    Object.entries(secretsOf(c)).map(([k, v]) => {
      const n = refOf(v)
      return [k, n ? (env[n] as string) : v]
    }),
  )
  return withSecrets(c, s)
}

/** The config as an agent may see it: which secret each key references and whether this run has it. */
export function describeMasked(c: McpServer, env: Record<string, string>) {
  const lines =
    c.transport === 'stdio' ? [`  启动：${[c.command, ...c.args].join(' ')}`] : [`  地址：${c.url}`]
  const entries = Object.entries(secretsOf(c))
  if (entries.length)
    lines.push(
      `  ${c.transport === 'stdio' ? 'env' : 'headers'}：${entries
        .map(([k, v]) => {
          const n = refOf(v)
          return n ? `${k} → ${ref(n)}（${n in env ? '已就绪' : '缺值'}）` : `${k}（未引用密钥）`
        })
        .join('、')}`,
    )
  return lines
}

/** `MCP_<server>_<KEY>`: upper case, anything else `_`, at most 64 characters. */
function mcpSecretName(server: string, key: string, n = 1) {
  const base = `MCP_${server}_${key}`.toUpperCase().replace(/[^A-Z0-9]/g, '_')
  const suffix = n > 1 ? `_${n}` : ''
  return `${base.slice(0, 64 - suffix.length)}${suffix}`
}

/** Definitions a server of layer `l` sees: platform, and its team / group. */
const seenFrom = (l: Layer) =>
  or(
    eq(secrets.scope, 'platform'),
    l.teamId ? and(eq(secrets.scope, 'team'), eq(secrets.teamId, l.teamId)) : undefined,
    l.groupId ? and(eq(secrets.scope, 'group'), eq(secrets.groupId, l.groupId)) : undefined,
  )

async function definedFrom(ctx: Ctx, l: Layer, name: string) {
  const [row] = await ctx.db
    .select()
    .from(secrets)
    .where(and(eq(secrets.name, name), seenFrom(l)))
    .limit(1)
  return row
}

async function inLayer(ctx: Ctx, l: Layer, name: string) {
  const [row] = await ctx.db
    .select()
    .from(secrets)
    .where(
      and(
        eq(secrets.scope, l.scope),
        l.teamId ? eq(secrets.teamId, l.teamId) : isNull(secrets.teamId),
        l.groupId ? eq(secrets.groupId, l.groupId) : isNull(secrets.groupId),
        eq(secrets.name, name),
      ),
    )
  return row
}

/** A definition of `MCP_<server>_<KEY>` in the layer holding `value` (or none yet); its name. */
async function defineFor(
  ctx: Ctx,
  l: Layer,
  server: string,
  key: string,
  value: string | null,
  actorId: string | null,
) {
  for (let n = 1; ; n++) {
    const name = mcpSecretName(server, key, n)
    if (reservedName(name) || !SECRET_NAME.test(name)) continue
    const row = await inLayer(ctx, l, name)
    const description = `MCP「${server}」的 ${key}`
    if (!row) {
      await createSecret(
        ctx,
        l,
        {
          name,
          description,
          mode: 'shared',
          botIds: null,
          enabled: true,
          expiresAt: null,
          ...(value !== null && { value }),
        },
        actorId,
        { mcp: server },
      )
      return name
    }
    if (value === null || (row.value && open(row.value) === value)) return name
    if (!row.value && row.mode !== 'personal') {
      await setSharedValue(ctx, row, value, actorId, { mcp: server }, 'secret.set')
      return name
    }
  }
}

/**
 * Leaves only references in env / headers (plan §8): a plain value becomes a shared secret of the server's layer,
 * a reference nothing defines gets a definition without a value. `migrate` renames such references (old
 * per-server placeholders) to `MCP_<server>_<KEY>`; agents' and admins' new references keep their name.
 */
export async function externalize(
  ctx: Ctx,
  l: Layer,
  c: McpServer,
  actorId: string | null,
  migrate = false,
): Promise<McpServer> {
  const out: Record<string, string> = {}
  for (const [key, v] of Object.entries(secretsOf(c))) {
    const name = refOf(v)
    if (name && (await definedFrom(ctx, l, name))) out[key] = v
    else if (name && !migrate) {
      if (!reservedName(name))
        await createSecret(
          ctx,
          l,
          {
            name,
            description: `MCP「${c.name}」的 ${key}`,
            mode: 'shared',
            botIds: null,
            enabled: true,
            expiresAt: null,
          },
          actorId,
          { mcp: c.name },
        )
      out[key] = v
    } else out[key] = ref(await defineFor(ctx, l, c.name, key, PLACEHOLDER.test(v) ? null : v, actorId))
  }
  return withSecrets(c, out)
}

/** Startup, idempotent: plain values and old placeholders in stored servers become secrets (plan §8). */
export async function migrateMcpSecrets(ctx: Ctx) {
  for (const row of await ctx.db.select().from(mcpServers)) {
    const config = row.config as McpServer
    if (Object.values(secretsOf(config)).every((v) => refOf(v))) {
      const l = layerOf(row)
      let defined = true
      for (const n of refsOf(config)) if (!(await definedFrom(ctx, l, n))) defined = false
      if (defined) continue
    }
    const next = await externalize(ctx, layerOf(row), config, null, true)
    await ctx.db.update(mcpServers).set({ config: next }).where(eq(mcpServers.id, row.id))
  }
}

const layerOf = (r: McpRow): Layer => ({ scope: r.scope as Scope, teamId: r.teamId, groupId: r.groupId })
