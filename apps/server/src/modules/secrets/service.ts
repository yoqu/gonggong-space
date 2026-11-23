import type { CreateSecretReq, SecretDto, SecretMode, SecretScope, UpdateSecretReq } from '@gonggong/protocol'
import { and, eq, inArray, isNull, ne } from 'drizzle-orm'
import type { Ctx } from '../../context.js'
import type { Db } from '../../db/client.js'
import { bots, personalSecrets, secrets, users } from '../../db/schema.js'
import { audit } from '../../lib/audit.js'
import { fail } from '../../lib/errors.js'
import { seal } from '../../lib/seal.js'
import type { Layer } from '../mcp/service.js'
import { forgetRedactors, RANK, type SecretRow } from './resolve.js'

type Read = Pick<Db, 'select'>
type Extra = Record<string, unknown>

/** Variables the daemon sets for the agent, or that change how the agent or its tools run. */
const RESERVED = new Set([
  'PATH',
  'HOME',
  'SHELL',
  'USER',
  'LOGNAME',
  'PWD',
  'TMPDIR',
  'LANG',
  'APPDATA',
  'USERPROFILE',
  'DISPLAY',
  'WAYLAND_DISPLAY',
  'HTTP_PROXY',
  'HTTPS_PROXY',
  'NO_PROXY',
  'ALL_PROXY',
  'MCP_TOOL_TIMEOUT',
  'API_TIMEOUT_MS',
  'BASH_DEFAULT_TIMEOUT_MS',
  'BASH_MAX_TIMEOUT_MS',
  'MAX_THINKING_TOKENS',
  'DISABLE_AUTO_COMPACT',
  'DISABLE_COMPACT',
  'DISABLE_TELEMETRY',
  'ENABLE_TOOL_SEARCH',
  'MODEL_PROVIDER',
  'NODE_OPTIONS',
])
const RESERVED_PREFIXES = [
  'ANTHROPIC_',
  'CLAUDE_',
  'CODEX_',
  'OPENAI_',
  'GG_',
  'GONGGONG_',
  'GIT_',
  'LC_',
  'XDG_',
  'LD_',
  'DYLD_',
  'NPM_CONFIG_',
]

export const reservedName = (name: string) =>
  RESERVED.has(name) || RESERVED_PREFIXES.some((p) => name.startsWith(p))

function checkName(name: string) {
  if (reservedName(name)) fail('invalid', '{name} 是系统保留的环境变量名，请换一个名称', { name })
}

export const layerOfRow = (r: SecretRow): Layer => ({
  scope: r.scope as SecretScope,
  teamId: r.teamId,
  groupId: r.groupId,
})

export const inSecretLayer = (l: Layer) =>
  and(
    eq(secrets.scope, l.scope),
    l.teamId ? eq(secrets.teamId, l.teamId) : isNull(secrets.teamId),
    l.groupId ? eq(secrets.groupId, l.groupId) : isNull(secrets.groupId),
  )

const sealed = (value: string, actorId: string | null, at: Date) => ({
  value: seal(value),
  last4: value.slice(-4),
  valueUpdatedBy: actorId,
  valueUpdatedAt: at,
})
const CLEARED = { value: null, last4: null, valueUpdatedBy: null, valueUpdatedAt: null }

/**
 * DTOs without values. `teamId`: the team whose members' own values count for platform rows (null: every team);
 * `overridden`: ids replaced by a same-named lower-layer row.
 */
export async function secretDtos(
  db: Read,
  rows: SecretRow[],
  teamId: string | null,
  overridden?: Set<string>,
): Promise<SecretDto[]> {
  const named = [...new Set(rows.filter((r) => r.mode !== 'shared').map((r) => r.name))]
  const updaters = [...new Set(rows.flatMap((r) => (r.valueUpdatedBy ? [r.valueUpdatedBy] : [])))]
  const [filled, people] = await Promise.all([
    named.length
      ? db
          .select({
            teamId: personalSecrets.teamId,
            name: personalSecrets.name,
            userId: users.id,
            userName: users.name,
          })
          .from(personalSecrets)
          .innerJoin(users, eq(users.id, personalSecrets.userId))
          .where(inArray(personalSecrets.name, named))
      : [],
    updaters.length
      ? db.select({ id: users.id, name: users.name }).from(users).where(inArray(users.id, updaters))
      : [],
  ])
  const nameOf = new Map(people.map((u) => [u.id, u.name]))
  return rows.map((r) => {
    const team = r.teamId ?? teamId
    const fills = new Map(
      filled
        .filter((f) => r.mode !== 'shared' && f.name === r.name && (!team || f.teamId === team))
        .map((f) => [f.userId, { userId: f.userId, name: f.userName }]),
    )
    return {
      id: r.id,
      scope: r.scope as SecretScope,
      teamId: r.teamId,
      groupId: r.groupId,
      name: r.name,
      description: r.description,
      mode: r.mode as SecretMode,
      botIds: r.botIds,
      enabled: r.enabled,
      expiresAt: r.expiresAt?.toISOString() ?? null,
      value:
        r.value && r.last4 && r.valueUpdatedAt
          ? {
              last4: r.last4,
              updatedBy: r.valueUpdatedBy ? (nameOf.get(r.valueUpdatedBy) ?? null) : null,
              updatedAt: r.valueUpdatedAt.toISOString(),
            }
          : null,
      personalFilled: [...fills.values()],
      ...(overridden && { overridden: overridden.has(r.id) }),
      updatedAt: r.updatedAt.toISOString(),
    }
  })
}

/** Rows replaced by a same-named row of a lower layer. */
export function overriddenIds(rows: SecretRow[]) {
  const lowest = new Map<string, number>()
  for (const r of rows) lowest.set(r.name, Math.max(lowest.get(r.name) ?? -1, RANK[r.scope] ?? 0))
  return new Set(rows.filter((r) => (RANK[r.scope] ?? 0) < (lowest.get(r.name) ?? 0)).map((r) => r.id))
}

export async function logSecret(
  ctx: Ctx,
  actorId: string | null,
  action: string,
  where: { layer: string; teamId: string | null; groupId: string | null },
  detail: Extra,
) {
  forgetRedactors()
  await audit(ctx, {
    category: 'admin',
    actorUserId: actorId,
    teamId: where.teamId,
    groupId: where.groupId,
    action,
    detail: { ...detail, layer: where.layer },
  })
}

const logRow = (ctx: Ctx, actorId: string | null, action: string, r: SecretRow, extra?: Extra) =>
  logSecret(
    ctx,
    actorId,
    action,
    { layer: r.scope, teamId: r.teamId, groupId: r.groupId },
    { id: r.id, name: r.name, ...extra },
  )

const expiry = (s: string | null) => {
  if (s === null) return null
  const d = new Date(s)
  return Number.isNaN(d.getTime()) ? fail('invalid', '到期时间无效') : d
}

async function checkBots(ctx: Ctx, l: Layer, ids: string[] | null) {
  if (!ids?.length) return ids
  const unique = [...new Set(ids)]
  const found = await ctx.db
    .select({ id: bots.id })
    .from(bots)
    .where(
      and(inArray(bots.id, unique), isNull(bots.deletedAt), l.teamId ? eq(bots.teamId, l.teamId) : undefined),
    )
  if (found.length !== unique.length) fail('invalid', 'Bot 不存在')
  return unique
}

export async function createSecret(
  ctx: Ctx,
  l: Layer,
  body: CreateSecretReq,
  actorId: string | null,
  extra?: Extra,
) {
  checkName(body.name)
  if (body.mode === 'personal' && body.value !== undefined)
    fail('invalid', '「个人」模式的密钥由各成员自己填写，没有统一值')
  const at = ctx.now()
  const [row] = await ctx.db
    .insert(secrets)
    .values({
      ...l,
      name: body.name,
      description: body.description,
      mode: body.mode,
      botIds: await checkBots(ctx, l, body.botIds),
      enabled: body.enabled,
      expiresAt: expiry(body.expiresAt),
      ...(body.value !== undefined && sealed(body.value, actorId, at)),
      updatedBy: actorId,
      updatedAt: at,
    })
    .onConflictDoNothing()
    .returning()
  if (!row) return fail('conflict', '密钥名称已存在')
  await logRow(ctx, actorId, 'secret.define', row, { mode: row.mode, ...extra })
  if (body.value !== undefined) await logRow(ctx, actorId, 'secret.set', row, extra)
  return row
}

export async function updateSecret(ctx: Ctx, row: SecretRow, body: UpdateSecretReq, actorId: string) {
  const l = layerOfRow(row)
  const name = body.name ?? row.name
  if (body.name !== undefined) checkName(body.name)
  const mode = body.mode ?? row.mode
  if (mode === 'personal' && typeof body.value === 'string')
    fail('invalid', '「个人」模式的密钥由各成员自己填写，没有统一值')
  if (name !== row.name) {
    const [taken] = await ctx.db
      .select({ id: secrets.id })
      .from(secrets)
      .where(and(inSecretLayer(l), eq(secrets.name, name), ne(secrets.id, row.id)))
    if (taken) fail('conflict', '密钥名称已存在')
  }
  const at = ctx.now()
  // Turning a definition personal drops its shared value.
  const value =
    typeof body.value === 'string'
      ? sealed(body.value, actorId, at)
      : body.value === null || (mode === 'personal' && row.value)
        ? CLEARED
        : {}
  const [saved] = await ctx.db
    .update(secrets)
    .set({
      name,
      ...(body.description !== undefined && { description: body.description }),
      mode,
      ...(body.botIds !== undefined && { botIds: await checkBots(ctx, l, body.botIds) }),
      ...(body.enabled !== undefined && { enabled: body.enabled }),
      ...(body.expiresAt !== undefined && { expiresAt: expiry(body.expiresAt) }),
      ...value,
      updatedBy: actorId,
      updatedAt: at,
    })
    .where(eq(secrets.id, row.id))
    .returning()
  if (!saved) return fail('not_found', '密钥不存在')
  const { value: _v, ...meta } = body
  if (Object.keys(meta).length) await logRow(ctx, actorId, 'secret.update', saved)
  if ('value' in value) await logRow(ctx, actorId, value.value ? 'secret.set' : 'secret.clear', saved)
  return saved
}

export async function deleteSecret(ctx: Ctx, row: SecretRow, actorId: string) {
  await ctx.db.delete(secrets).where(eq(secrets.id, row.id))
  await logRow(ctx, actorId, 'secret.delete', row)
}

/** Fills a definition's shared value (a 填写密钥 card). */
export async function setSharedValue(
  ctx: Ctx,
  row: SecretRow,
  value: string,
  actorId: string | null,
  extra?: Extra,
  action = 'secret.fill',
) {
  await ctx.db
    .update(secrets)
    .set({ ...sealed(value, actorId, ctx.now()), updatedAt: ctx.now() })
    .where(eq(secrets.id, row.id))
  await logRow(ctx, actorId, action, row, extra)
}

/** The member's own value of `name` in the team; `value` absent only updates the setting of an existing one. */
export async function setPersonal(
  ctx: Ctx,
  key: { userId: string; teamId: string; name: string },
  value: string | undefined,
  allowForeignMachines: boolean | undefined,
  action = 'secret.set',
  extra?: Extra,
) {
  const where = and(
    eq(personalSecrets.userId, key.userId),
    eq(personalSecrets.teamId, key.teamId),
    eq(personalSecrets.name, key.name),
  )
  const at = ctx.now()
  let row: typeof personalSecrets.$inferSelect | undefined
  if (value === undefined) {
    if (allowForeignMachines === undefined) return fail('invalid', '请填写密钥')
    ;[row] = await ctx.db
      .update(personalSecrets)
      .set({ allowForeignMachines, updatedAt: at })
      .where(where)
      .returning()
    if (!row) return fail('invalid', '请填写密钥')
  } else {
    const v = { value: seal(value), last4: value.slice(-4), updatedAt: at }
    ;[row] = await ctx.db
      .insert(personalSecrets)
      .values({ ...key, ...v, allowForeignMachines: allowForeignMachines ?? false })
      .onConflictDoUpdate({
        target: [personalSecrets.userId, personalSecrets.teamId, personalSecrets.name],
        set: { ...v, ...(allowForeignMachines !== undefined && { allowForeignMachines }) },
      })
      .returning()
  }
  const done = row as typeof personalSecrets.$inferSelect
  await logSecret(
    ctx,
    key.userId,
    action,
    { layer: 'personal', teamId: key.teamId, groupId: null },
    { name: key.name, allowForeignMachines: done.allowForeignMachines, ...extra },
  )
  return done
}

export async function clearPersonal(
  ctx: Ctx,
  key: { userId: string; teamId: string; name: string },
  extra?: Extra,
) {
  const gone = await ctx.db
    .delete(personalSecrets)
    .where(
      and(
        eq(personalSecrets.userId, key.userId),
        eq(personalSecrets.teamId, key.teamId),
        eq(personalSecrets.name, key.name),
      ),
    )
    .returning({ id: personalSecrets.id })
  if (gone.length)
    await logSecret(
      ctx,
      key.userId,
      'secret.clear',
      { layer: 'personal', teamId: key.teamId, groupId: null },
      { name: key.name, ...extra },
    )
}
