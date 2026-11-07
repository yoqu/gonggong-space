import type { FillSecretReq, SecretCard, SecretRequestDto } from '@gonggong/protocol'
import { and, asc, eq, isNull } from 'drizzle-orm'
import type { Ctx } from '../../context.js'
import { bots, groups, machines, messages, runs, secretRequests, users } from '../../db/schema.js'
import { fail } from '../../lib/errors.js'
import { isLayerAdmin } from '../agent-tools/layers.js'
import { mirrorSecretCard } from '../feishu/mirror.js'
import { requireMember } from '../groups/service.js'
import { forceNewSessions } from '../mcp/service.js'
import { authorName, type MessageMeta, memberIds, messageDto, postEvent } from '../messages/service.js'
import { rerunFor } from '../runs/trigger.js'
import { RANK, type SecretRow, visibleSecrets } from './resolve.js'
import { layerOfRow, setPersonal, setSharedValue } from './service.js'

type RequestRow = typeof secretRequests.$inferSelect
export type Audience = 'origin' | 'admins'

const card = (r: RequestRow, foreign?: boolean): SecretCard => ({
  id: r.id,
  names: r.names,
  audience: r.audience as Audience,
  userId: r.userId,
  filled: r.filledAt !== null,
  ...(foreign !== undefined && { foreign }),
})

/** The definition a value of `name` is filled for: the lowest enabled one the group sees. */
async function definitionOf(ctx: Ctx, groupId: string, name: string): Promise<SecretRow | undefined> {
  const rows = (await visibleSecrets(ctx.db, groupId)).filter((r) => r.name === name && r.enabled)
  return rows.sort((a, b) => (RANK[b.scope] ?? 0) - (RANK[a.scope] ?? 0))[0]
}

/** Posts one 填写密钥 card; `origin` cards are for the run's originator, `admins` cards for the layers' admins. */
export async function postSecretCard(
  ctx: Ctx,
  run: { id: string; groupId: string; botId: string; originUserId: string },
  audience: Audience,
  names: string[],
  forceNewSession: boolean,
) {
  const [req] = (await ctx.db
    .insert(secretRequests)
    .values({
      groupId: run.groupId,
      runId: run.id,
      audience,
      userId: audience === 'origin' ? run.originUserId : null,
      names,
      forceNewSession,
      createdAt: ctx.now(),
    })
    .returning()) as [RequestRow]
  const [bot] = await ctx.db
    .select({ name: bots.name, machineOwner: machines.ownerId })
    .from(bots)
    .leftJoin(machines, eq(machines.id, bots.machineId))
    .where(eq(bots.id, run.botId))
  const [user] = await ctx.db.select({ name: users.name }).from(users).where(eq(users.id, run.originUserId))
  const params = { bot: bot?.name ?? '', user: user?.name ?? '', names: names.join('、') }
  const posted = card(req, audience === 'origin' ? bot?.machineOwner !== run.originUserId : undefined)
  const msg = await postEvent(
    ctx,
    run.groupId,
    audience === 'origin' ? '{bot} 请 {user} 填写自己的密钥：{names}' : '{bot} 请管理员填写密钥：{names}',
    params,
    { secretCard: posted },
  )
  await ctx.db.update(secretRequests).set({ messageId: msg.id }).where(eq(secretRequests.id, req.id))
  await mirrorSecretCard(ctx, run.groupId, req.id)
  return posted
}

/** My unfilled `origin` cards of the group, as posted (so they keep `foreign`). */
export async function pendingSecretCards(ctx: Ctx, userId: string, groupId: string): Promise<SecretCard[]> {
  await requireMember(ctx, groupId, userId)
  const rows = await ctx.db
    .select({ meta: messages.meta })
    .from(secretRequests)
    .innerJoin(messages, eq(messages.id, secretRequests.messageId))
    .where(
      and(
        eq(secretRequests.groupId, groupId),
        eq(secretRequests.audience, 'origin'),
        eq(secretRequests.userId, userId),
        isNull(secretRequests.filledAt),
      ),
    )
    .orderBy(asc(secretRequests.createdAt))
  return rows.flatMap((r) => {
    const c = (r.meta as MessageMeta).secretCard
    return c ? [c] : []
  })
}

/** One card for its group's members, as posted (so it keeps `foreign`). */
export async function secretRequestOf(ctx: Ctx, userId: string, id: string): Promise<SecretRequestDto> {
  const [row] = await ctx.db
    .select({ req: secretRequests, meta: messages.meta, bot: bots.name })
    .from(secretRequests)
    .leftJoin(messages, eq(messages.id, secretRequests.messageId))
    .leftJoin(runs, eq(runs.id, secretRequests.runId))
    .leftJoin(bots, eq(bots.id, runs.botId))
    .where(eq(secretRequests.id, id))
  if (!row) return fail('not_found', '密钥请求不存在')
  await requireMember(ctx, row.req.groupId, userId)
  const posted = (row.meta as MessageMeta | null)?.secretCard ?? card(row.req)
  return { ...posted, filled: row.req.filledAt !== null, groupId: row.req.groupId, bot: row.bot ?? '' }
}

/**
 * Fills every name of the card: an `origin` card by its user as their own values in the group's team, an
 * `admins` card by an admin of each definition's layer as its shared value. The values go nowhere else.
 */
export async function fillSecretRequest(ctx: Ctx, userId: string, id: string, body: FillSecretReq) {
  const [req] = await ctx.db.select().from(secretRequests).where(eq(secretRequests.id, id))
  if (!req) return fail('not_found', '密钥请求不存在')
  if (req.audience === 'origin' && req.userId !== userId) return fail('forbidden', '仅发起人可以填写')
  if (req.filledAt) return fail('conflict', '密钥已填写')
  const given = Object.keys(body.values)
  if (given.length !== req.names.length || !req.names.every((n) => body.values[n]))
    return fail('invalid', '请填写全部密钥')
  const [group] = await ctx.db
    .select({ teamId: groups.teamId })
    .from(groups)
    .where(eq(groups.id, req.groupId))
  if (!group) return fail('not_found', '群不存在')
  const defs: SecretRow[] = []
  for (const name of req.names) {
    const def = await definitionOf(ctx, req.groupId, name)
    if (!def) return fail('conflict', '密钥 {name} 的定义已删除或停用', { name })
    if (req.audience === 'admins') {
      if (def.mode === 'personal') return fail('conflict', '密钥 {name} 已改为每人自填', { name })
      if (!(await isLayerAdmin(ctx, userId, layerOfRow(def))))
        return fail('forbidden', '仅密钥 {name} 所在层的管理员可以填写', { name })
    } else if (def.mode === 'shared') return fail('conflict', '密钥 {name} 已改为只用统一值', { name })
    defs.push(def)
  }
  const [claimed] = await ctx.db
    .update(secretRequests)
    .set({ filledAt: ctx.now() })
    .where(and(eq(secretRequests.id, id), isNull(secretRequests.filledAt)))
    .returning()
  if (!claimed) return fail('conflict', '密钥已填写')
  const extra = { requestId: req.id, forceNewSession: req.forceNewSession }
  for (const def of defs) {
    const value = body.values[def.name] as string
    if (req.audience === 'admins') await setSharedValue(ctx, def, value, userId, extra)
    else
      await setPersonal(
        ctx,
        { userId, teamId: group.teamId, name: def.name },
        value,
        body.allowForeignMachines,
        'secret.fill',
        extra,
      )
  }
  if (req.forceNewSession)
    await forceNewSessions(ctx, { scope: 'group', teamId: group.teamId, groupId: req.groupId })
  const done = (req.messageId ? await refreshCard(ctx, req.messageId) : undefined) ?? card(claimed)
  await mirrorSecretCard(ctx, req.groupId, req.id)
  await carryOn(ctx, req.runId)
  return done
}

/** The asking bot picks its turn up again with the values in place; relay hops can only be restarted from their source. */
async function carryOn(ctx: Ctx, runId: string | null) {
  if (!runId) return
  const [row] = await ctx.db
    .select({ run: runs, message: messages, bot: bots.name })
    .from(runs)
    .innerJoin(messages, eq(messages.id, runs.triggerMessageId))
    .innerJoin(bots, eq(bots.id, runs.botId))
    .where(eq(runs.id, runId))
  if (!row) return
  const { run, message } = row
  if (run.hop === 1 && message.authorUserId && !message.recalledAt) {
    await postEvent(ctx, run.groupId, '已填写密钥，{bot} 继续处理', { bot: row.bot })
    await rerunFor(ctx, message, [run.botId])
  } else await postEvent(ctx, run.groupId, '已填写密钥，重新 @{bot} 即可继续', { bot: row.bot })
}

async function refreshCard(ctx: Ctx, messageId: string) {
  const [m] = await ctx.db.select().from(messages).where(eq(messages.id, messageId))
  if (!m) return
  const meta = m.meta as MessageMeta
  if (!meta.secretCard) return
  const secretCard = { ...meta.secretCard, filled: true }
  const [row] = await ctx.db
    .update(messages)
    .set({ meta: { ...meta, secretCard } })
    .where(eq(messages.id, messageId))
    .returning()
  if (!row) return
  const dto = messageDto(row, await authorName(ctx, row))
  ctx.bus.publish(await memberIds(ctx, dto.groupId), { t: 'message.edited', message: dto })
  return secretCard
}
