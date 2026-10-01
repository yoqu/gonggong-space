import { TERMINAL_RUN_STATUS } from '@gonggong/protocol'
import { and, eq, inArray, isNull, notInArray } from 'drizzle-orm'
import type { Ctx } from '../../context.js'
import { CLOSE } from '../../daemon/gateway.js'
import { bots, groupBots, machines, runs, users, webSessions } from '../../db/schema.js'
import { audit } from '../../lib/audit.js'
import { fail } from '../../lib/errors.js'
import type { SessionUser } from '../auth/session.js'
import { publishBotRemoved } from '../bots/dto.js'
import { publishGroup } from '../groups/service.js'
import { postEvent } from '../messages/service.js'
import { publishRun } from '../runs/dto.js'
import { forgetStream } from '../runs/engine.js'
import { runStep } from '../runs/step.js'
import { notifyChainDone, stopRuns } from '../runs/stop.js'
import { toUserDto } from './dto.js'

async function load(ctx: Ctx, id: string) {
  const [user] = await ctx.db.select().from(users).where(eq(users.id, id))
  return user ?? fail('not_found', '账号不存在')
}

/**
 * Spec §9 账号停用: sessions and daemon tokens are revoked at once, the daemons are kicked (they wipe their managed
 * workspaces on the resulting reject), the member's bots leave every group and their unfinished runs end as
 * interrupted. Group memberships, messages and audit records stay.
 */
export async function disableUser(ctx: Ctx, id: string, actor: SessionUser) {
  if (id === actor.id) fail('invalid', '不能停用自己的账号')
  const user = await load(ctx, id)
  if (user.disabledAt) fail('conflict', '账号已停用')
  const now = ctx.now()
  const { revoked, owned, removed } = await ctx.db.transaction(async (tx) => {
    await tx.update(users).set({ disabledAt: now }).where(eq(users.id, id))
    await tx
      .update(webSessions)
      .set({ revokedAt: now })
      .where(and(eq(webSessions.userId, id), isNull(webSessions.revokedAt)))
    const revoked = await tx
      .update(machines)
      .set({ revokedAt: now })
      .where(and(eq(machines.ownerId, id), isNull(machines.revokedAt)))
      .returning({ id: machines.id })
    const owned = await tx
      .update(bots)
      .set({ deletedAt: now })
      .where(and(eq(bots.ownerId, id), isNull(bots.deletedAt)))
      .returning({ id: bots.id, name: bots.name })
    const removed = owned.length
      ? await tx
          .update(groupBots)
          .set({ removedAt: now })
          .where(
            and(
              inArray(
                groupBots.botId,
                owned.map((b) => b.id),
              ),
              isNull(groupBots.removedAt),
            ),
          )
          .returning({ groupId: groupBots.groupId, botId: groupBots.botId })
      : []
    return { revoked, owned, removed }
  })
  ctx.bus.disconnect(id)

  const botIds = owned.map((b) => b.id)
  const unfinished = botIds.length
    ? await ctx.db
        .selectDistinct({ groupId: runs.groupId })
        .from(runs)
        .where(and(inArray(runs.botId, botIds), notInArray(runs.status, [...TERMINAL_RUN_STATUS])))
    : []
  // Stopped before the kick so run.cancel still reaches the daemon and it winds its agents down.
  for (const { groupId } of unfinished) await stopRuns(ctx, { groupId, botIds }, actor)
  for (const m of revoked) ctx.hub.kick(m.id, CLOSE.revoked, 'revoked')
  // Live runs normally end on the daemon's run.done, which a revoked daemon never sends.
  const cut = botIds.length
    ? await ctx.db
        .update(runs)
        .set({
          status: 'interrupted',
          ...runStep('{user} 的账号已停用，本轮中断', { user: user.name }),
          endedAt: now,
        })
        .where(and(inArray(runs.botId, botIds), notInArray(runs.status, [...TERMINAL_RUN_STATUS])))
        .returning()
    : []
  for (const run of cut) {
    forgetStream(run.id)
    await publishRun(ctx, run)
    await notifyChainDone(ctx, run)
  }

  for (const { groupId, botId } of removed) {
    const name = owned.find((b) => b.id === botId)?.name ?? ''
    await postEvent(ctx, groupId, '{bot} 被移出 · {user} 的账号已停用', { bot: name, user: user.name })
  }
  for (const groupId of new Set(removed.map((r) => r.groupId))) await publishGroup(ctx, groupId)
  for (const botId of botIds) await publishBotRemoved(ctx, botId)
  await audit(ctx, {
    category: 'admin',
    actorUserId: actor.id,
    action: 'user.disable',
    detail: { userId: id, account: user.account, machines: revoked.length, bots: owned.length },
  })
  return toUserDto({ ...user, disabledAt: now })
}

/** Lets the account log in again; revoked machines and removed bots stay gone (the member binds anew). */
export async function enableUser(ctx: Ctx, id: string, actor: SessionUser) {
  const user = await load(ctx, id)
  if (!user.disabledAt) fail('conflict', '账号未停用')
  const [row] = await ctx.db.update(users).set({ disabledAt: null }).where(eq(users.id, id)).returning()
  await audit(ctx, {
    category: 'admin',
    actorUserId: actor.id,
    action: 'user.enable',
    detail: { userId: id, account: user.account },
  })
  return toUserDto(row ?? user)
}
