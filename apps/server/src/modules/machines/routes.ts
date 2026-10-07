import { randomInt } from 'node:crypto'
import {
  type BindCodeDto,
  DaemonLoginReq,
  type DaemonLoginRes,
  type DaemonToServer,
  type MachineDto,
  UpdateMachineReq,
} from '@gonggong/protocol'
import { and, asc, count, eq, gt, isNull, sql } from 'drizzle-orm'
import type { FastifyInstance, FastifyRequest } from 'fastify'
import { z } from 'zod'
import type { Ctx } from '../../context.js'
import { requireMachine } from '../../daemon/auth.js'
import { CLOSE } from '../../daemon/gateway.js'
import { bindCodes, bots, machines, users } from '../../db/schema.js'
import { audit } from '../../lib/audit.js'
import { newToken, sha256 } from '../../lib/crypto.js'
import { fail } from '../../lib/errors.js'
import { idParam } from '../../lib/ids.js'
import { Throttle } from '../../lib/throttle.js'
import { assertNotDemo } from '../admin/params.js'
import { requireUser } from '../auth/session.js'
import { onMachineBound } from '../bots/binding.js'
import { machineDto, publishBots } from '../bots/dto.js'
import { netRoutes } from './net.js'
import { toolRoutes } from './tools.js'

const CODE_TTL_MS = 10 * 60_000
/** No I/O/0/1 so codes survive being read aloud or retyped. */
const CODE_ALPHABET = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789'
const CODE_FORMAT = /^[A-Z0-9]{4}-[A-Z0-9]{4}$/
const CODE_MAX_FAILURES = 5
const IP_MAX_FAILURES = 10
const IP_WINDOW_MS = 10 * 60_000

const randomCode = () => {
  const c = Array.from({ length: 8 }, () => CODE_ALPHABET[randomInt(CODE_ALPHABET.length)]).join('')
  return `${c.slice(0, 4)}-${c.slice(4)}`
}

/** The server as the browser reaches it (the web already tells daemons to use `location.origin`). */
const publicOrigin = (req: FastifyRequest) => {
  const { origin } = req.headers
  return origin ?? `${req.protocol}://${req.host}`
}

/** Plan J1: `gonggong://bind?server=…&code=…`. */
function bindLink(server: string, code: string) {
  return `gonggong://bind?server=${encodeURIComponent(server)}&code=${code}`
}

export function machineRoutes(ctx: Ctx) {
  return async (app: FastifyInstance) => {
    /*
     * D3 asks to void a code after 5 consecutive wrong attempts, but a wrong code cannot be attributed to
     * the issuing user's code. So brute force is bounded per client IP (10 failures / 10 min → code_locked),
     * and a code that exists but is expired or used counts its own failures (after 5 → code_locked).
     */
    const ipThrottle = new Throttle(IP_MAX_FAILURES, IP_WINDOW_MS, ctx.now)

    const pending = new Set<Promise<void>>()
    const pushState = (machineId: string) => {
      const p: Promise<void> = (async () => {
        const [m] = await ctx.db.select().from(machines).where(eq(machines.id, machineId))
        if (m && !m.revokedAt)
          ctx.bus.publish([m.ownerId], { t: 'machine.updated', machine: machineDto(ctx, m) })
      })()
        .catch((err) => app.log.error(err))
        .finally(() => pending.delete(p))
      pending.add(p)
    }
    // Detection changed after hello (path set / reset, re-check): bot presence depends on it.
    const onMessage = (machineId: string, msg: DaemonToServer) => {
      if (msg.t !== 'agents.update') return
      const p = (async () => {
        await ctx.db.update(machines).set({ agents: msg.agents }).where(eq(machines.id, machineId))
        pushState(machineId)
        await publishBots(ctx, eq(bots.machineId, machineId))
      })()
        .catch((err) => app.log.error(err))
        .finally(() => pending.delete(p))
      pending.add(p)
    }
    await app.register(netRoutes(ctx))
    await app.register(toolRoutes(ctx))
    ctx.hub.on('online', pushState)
    ctx.hub.on('offline', pushState)
    ctx.hub.on('message', onMessage)
    app.addHook('onClose', async () => {
      ctx.hub.off('online', pushState)
      ctx.hub.off('offline', pushState)
      ctx.hub.off('message', onMessage)
      await Promise.all(pending)
    })

    app.post('/api/bind-codes', async (req): Promise<BindCodeDto> => {
      const user = await requireUser(ctx, req)
      const expiresAt = new Date(ctx.now().getTime() + CODE_TTL_MS)
      for (;;) {
        const [row] = await ctx.db
          .insert(bindCodes)
          .values({ code: randomCode(), userId: user.id, expiresAt, createdAt: ctx.now() })
          .onConflictDoNothing()
          .returning()
        if (row) {
          const link = bindLink(publicOrigin(req), row.code)
          return { code: row.code, expiresAt: row.expiresAt.toISOString(), link }
        }
      }
    })

    app.post('/api/daemon/login', async (req): Promise<DaemonLoginRes> => {
      if (ipThrottle.blocked(req.ip)) return fail('code_locked', '绑定码尝试次数过多，请 10 分钟后再试')
      const body = DaemonLoginReq.parse(req.body)
      const code = body.code.trim().toUpperCase()
      if (!CODE_FORMAT.test(code)) {
        ipThrottle.fail(req.ip)
        return fail('invalid', '绑定码格式应为 XXXX-XXXX')
      }
      const now = ctx.now()
      const token = newToken('mt')
      const bound = await ctx.db.transaction(async (tx) => {
        const [claimed] = await tx
          .update(bindCodes)
          .set({ usedAt: now })
          .where(and(eq(bindCodes.code, code), isNull(bindCodes.usedAt), gt(bindCodes.expiresAt, now)))
          .returning()
        if (!claimed) return null
        const [owner] = await tx.select({ name: users.name }).from(users).where(eq(users.id, claimed.userId))
        const { hardwareId } = body.machine
        const [prev] = hardwareId
          ? await tx.select().from(machines).where(eq(machines.hardwareId, hardwareId)).for('update')
          : []
        if (prev && prev.ownerId !== claimed.userId && !prev.revokedAt) {
          const [{ n } = { n: 0 }] = await tx
            .select({ n: count() })
            .from(bots)
            .where(and(eq(bots.machineId, prev.id), isNull(bots.deletedAt)))
          if (n) {
            const [holder] = await tx
              .select({ name: users.name })
              .from(users)
              .where(eq(users.id, prev.ownerId))
            fail('conflict', '这台机器已归属 {owner}，其上还有 {n} 个 Bot，需先删除后才能转给你', {
              owner: holder?.name ?? '',
              n,
            })
          }
        }
        const values = { ownerId: claimed.userId, ...body.machine, tokenHash: sha256(token), boundAt: now }
        const [machine] = prev
          ? await tx
              .update(machines)
              .set({ ...values, revokedAt: null, label: prev.ownerId === claimed.userId ? prev.label : null })
              .where(eq(machines.id, prev.id))
              .returning()
          : await tx
              .insert(machines)
              .values({ ...values, createdAt: now })
              .returning()
        return machine && owner && { machine, ownerName: owner.name, prev }
      })
      if (!bound) {
        ipThrottle.fail(req.ip)
        const [row] = await ctx.db
          .update(bindCodes)
          .set({ failedAttempts: sql`${bindCodes.failedAttempts} + 1` })
          .where(eq(bindCodes.code, code))
          .returning()
        if (!row) return fail('unauthorized', '绑定码无效，请核对后重试')
        if (row.failedAttempts > CODE_MAX_FAILURES)
          return fail('code_locked', '绑定码已作废，请在 Web 端重新生成')
        return fail(
          'code_expired',
          row.usedAt ? '绑定码已被使用，请在 Web 端重新生成' : '绑定码已过期，请在 Web 端重新生成',
        )
      }
      const { machine, ownerName, prev } = bound
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
      return { token, machineId: machine.id, ownerName, restored: !!prev && !transferred }
    })

    app.post('/api/daemon/logout', async (req, reply) => {
      const m = await requireMachine(ctx, req)
      await ctx.db
        .update(machines)
        .set({ tokenHash: sha256(newToken('void')) })
        .where(eq(machines.id, m.id))
      ctx.hub.kick(m.id, CLOSE.replaced, 'logged out')
      return reply.status(204).send()
    })

    app.get('/api/machines', async (req): Promise<MachineDto[]> => {
      const user = await requireUser(ctx, req)
      const { all } = z.object({ all: z.literal('1').optional() }).parse(req.query)
      if (all && user.role !== 'sysadmin') return fail('forbidden', '仅系统管理员可查看全部机器')
      const rows = await ctx.db
        .select()
        .from(machines)
        .where(and(isNull(machines.revokedAt), all ? undefined : eq(machines.ownerId, user.id)))
        .orderBy(asc(machines.createdAt))
      return rows.map((m) => machineDto(ctx, m))
    })

    app.patch<{ Params: { id: string } }>('/api/machines/:id', async (req): Promise<MachineDto> => {
      const user = await requireUser(ctx, req)
      const id = idParam(req.params.id, '机器不存在')
      const { name } = UpdateMachineReq.parse(req.body)
      const [m] = await ctx.db
        .select()
        .from(machines)
        .where(and(eq(machines.id, id), isNull(machines.revokedAt)))
      if (!m) return fail('not_found', '机器不存在')
      if (m.ownerId !== user.id && user.role !== 'sysadmin') return fail('forbidden', '只能修改自己的机器')
      const label = name || null
      await ctx.db.update(machines).set({ label }).where(eq(machines.id, id))
      const dto = machineDto(ctx, { ...m, label })
      ctx.bus.publish([m.ownerId], { t: 'machine.updated', machine: dto })
      return dto
    })

    app.delete<{ Params: { id: string } }>('/api/machines/:id', async (req, reply) => {
      const user = await requireUser(ctx, req)
      const id = idParam(req.params.id, '机器不存在')
      const [m] = await ctx.db
        .select()
        .from(machines)
        .where(and(eq(machines.id, id), isNull(machines.revokedAt)))
      if (!m) return fail('not_found', '机器不存在')
      if (m.ownerId !== user.id && user.role !== 'sysadmin') return fail('forbidden', '只能吊销自己的机器')
      await assertNotDemo(ctx, user)
      const [{ n } = { n: 0 }] = await ctx.db
        .select({ n: count() })
        .from(bots)
        .where(and(eq(bots.machineId, id), isNull(bots.deletedAt)))
      if (n) return fail('conflict', '还有 {n} 个 Bot 绑定在这台机器上，请先删除', { n })
      await ctx.db.update(machines).set({ revokedAt: ctx.now() }).where(eq(machines.id, id))
      ctx.hub.kick(id, CLOSE.revoked, 'revoked')
      ctx.bus.publish([m.ownerId], { t: 'machine.removed', machineId: id })
      await audit(ctx, {
        category: 'admin',
        actorUserId: user.id,
        action: 'machine.revoke',
        detail: { machineId: id, name: m.name, ownerId: m.ownerId },
      })
      return reply.status(204).send()
    })
  }
}
