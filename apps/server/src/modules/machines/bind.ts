import type { AgentKind, DaemonLoginRes, MachineInfo } from '@gonggong/protocol'
import { and, count, eq, isNull } from 'drizzle-orm'
import type { FastifyBaseLogger } from 'fastify'
import type { Ctx } from '../../context.js'
import { CLOSE } from '../../daemon/gateway.js'
import type { Db } from '../../db/client.js'
import { bots, machines, users } from '../../db/schema.js'
import { audit } from '../../lib/audit.js'
import { sha256 } from '../../lib/crypto.js'
import { fail } from '../../lib/errors.js'
import { onMachineBound } from '../bots/binding.js'
import { machineDto } from '../bots/dto.js'
import { onboardBot } from './onboard.js'

/** No I/O/0/1 so codes survive being read aloud or retyped. */
export const CODE_ALPHABET = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789'
export const CODE_FORMAT = /^[A-Z0-9]{4}-[A-Z0-9]{4}$/

type Tx = Parameters<Parameters<Db['transaction']>[0]>[0]
type Machine = typeof machines.$inferSelect
export type Bound = { machine: Machine; ownerName: string; prev: Machine | undefined }

/**
 * Binds the machine to `ownerId` with a new token, inside the caller's transaction: the same host (hardwareId) gets
 * its machine back, or takes it over from another owner who has no bots left on it.
 */
export async function bindMachine(
  tx: Tx,
  ownerId: string,
  info: MachineInfo,
  token: string,
  now: Date,
): Promise<Bound | null> {
  const [owner] = await tx.select({ name: users.name }).from(users).where(eq(users.id, ownerId))
  const { hardwareId } = info
  const [prev] = hardwareId
    ? await tx.select().from(machines).where(eq(machines.hardwareId, hardwareId)).for('update')
    : []
  if (prev && prev.ownerId !== ownerId && !prev.revokedAt) {
    const [{ n } = { n: 0 }] = await tx
      .select({ n: count() })
      .from(bots)
      .where(and(eq(bots.machineId, prev.id), isNull(bots.deletedAt)))
    if (n) {
      const [holder] = await tx.select({ name: users.name }).from(users).where(eq(users.id, prev.ownerId))
      fail('conflict', '这台机器已归属 {owner}，其上还有 {n} 个 Bot，需先删除后才能转给你', {
        owner: holder?.name ?? '',
        n,
      })
    }
  }
  const values = { ownerId, ...info, tokenHash: sha256(token), boundAt: now }
  const [machine] = prev
    ? await tx
        .update(machines)
        .set({ ...values, revokedAt: null, label: prev.ownerId === ownerId ? prev.label : null })
        .where(eq(machines.id, prev.id))
        .returning()
    : await tx
        .insert(machines)
        .values({ ...values, createdAt: now })
        .returning()
  return machine && owner ? { machine, ownerName: owner.name, prev } : null
}

/** After the binding transaction: retire the old daemon session, tell the owners, and make the bot asked for. */
export async function afterBind(
  ctx: Ctx,
  log: FastifyBaseLogger,
  { machine, ownerName, prev }: Bound,
  token: string,
  createBot: AgentKind | undefined,
): Promise<DaemonLoginRes> {
  // A daemon still running on the old token must not keep serving; it reconnects and is told to log in.
  if (prev) ctx.hub.kick(prev.id, CLOSE.replaced, 'rebound')
  const transferred = prev && prev.ownerId !== machine.ownerId
  if (transferred) {
    if (!prev.revokedAt) ctx.bus.publish([prev.ownerId], { t: 'machine.removed', machineId: prev.id })
    await audit(ctx, {
      category: 'admin',
      actorUserId: machine.ownerId,
      action: 'machine.transfer',
      detail: { machineId: machine.id, name: machine.name, fromOwnerId: prev.ownerId },
    })
  }
  await onMachineBound(ctx, machine)
  ctx.bus.publish([machine.ownerId], { t: 'machine.updated', machine: machineDto(ctx, machine) })
  // The machine is bound and its old token void by now: a bot that can't be made must not keep the new token from
  // gg, which then says to create the bot on the Web.
  const bot = createBot
    ? await onboardBot(ctx, machine, createBot).catch((err) => {
        log.warn({ err, machineId: machine.id }, 'onboarding bot not created')
        return undefined
      })
    : undefined
  return {
    token,
    machineId: machine.id,
    ownerName,
    restored: !!prev && !transferred,
    ...(bot && { bot }),
  }
}
