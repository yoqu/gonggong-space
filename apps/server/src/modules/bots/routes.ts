import { type BotOwnerDto, CreateBotReq, UpdateBotReq } from '@aiws/protocol'
import { and, asc, eq, inArray, isNull, ne } from 'drizzle-orm'
import type { FastifyInstance } from 'fastify'
import type { Ctx } from '../../context.js'
import { requireMachine } from '../../daemon/auth.js'
import { bots, groupBots, machines, users } from '../../db/schema.js'
import { audit } from '../../lib/audit.js'
import { fail } from '../../lib/errors.js'
import { idParam, isUuid } from '../../lib/ids.js'
import { sysParams } from '../admin/params.js'
import { requireUser, type SessionUser } from '../auth/session.js'
import { notify } from '../notifications/notify.js'
import { confirmBot } from './binding.js'
import { botDto, listBotDtos, machineDto, publishBot, publishBotRemoved, publishBots } from './dto.js'

type BotRow = typeof bots.$inferSelect
type IdParams = { Params: { id: string } }

async function loadBot(ctx: Ctx, rawId: string) {
  const id = idParam(rawId, 'bot ')
  const [bot] = await ctx.db
    .select()
    .from(bots)
    .where(and(eq(bots.id, id), isNull(bots.deletedAt)))
  return bot ?? fail('not_found', 'bot 不存在')
}

async function assertNameFree(ctx: Ctx, name: string, exceptId?: string) {
  const [taken] = await ctx.db
    .select({ id: bots.id })
    .from(bots)
    .where(and(eq(bots.name, name), isNull(bots.deletedAt), exceptId ? ne(bots.id, exceptId) : undefined))
  if (taken) fail('conflict', `名称「${name}」已被占用`)
}

async function assertUsers(ctx: Ctx, ids: string[]) {
  const unique = [...new Set(ids)]
  const found = unique.every(isUuid)
    ? await ctx.db.select({ id: users.id }).from(users).where(inArray(users.id, unique))
    : []
  if (found.length !== unique.length) fail('invalid', '指定名单包含不存在的成员')
}

function assertCanManage(user: SessionUser, bot: BotRow) {
  if (user.id !== bot.ownerId && user.role !== 'sysadmin')
    fail('forbidden', '只有归属人或系统管理员可以修改该 bot')
}

/** Sysadmin actions on someone else's bot are audited (spec 9: all admin operations). */
async function auditForeign(ctx: Ctx, user: SessionUser, bot: BotRow, action: string, detail: object = {}) {
  if (user.id !== bot.ownerId)
    await audit(ctx, {
      category: 'admin',
      actorUserId: user.id,
      action,
      detail: { botId: bot.id, name: bot.name, ownerId: bot.ownerId, ...detail },
    })
}

export function botRoutes(ctx: Ctx) {
  return async (app: FastifyInstance) => {
    const pending = new Set<Promise<unknown>>()
    const onMachine = (machineId: string) => {
      const p = publishBots(ctx, eq(bots.machineId, machineId))
        .catch((err) => app.log.error(err))
        .finally(() => pending.delete(p))
      pending.add(p)
    }
    ctx.hub.on('online', onMachine)
    ctx.hub.on('offline', onMachine)
    app.addHook('onClose', async () => {
      ctx.hub.off('online', onMachine)
      ctx.hub.off('offline', onMachine)
      await Promise.all(pending)
    })

    app.get('/api/bots', async (req) => {
      await requireUser(ctx, req)
      return listBotDtos(ctx)
    })

    app.get('/api/bots/owners', async (req): Promise<BotOwnerDto[]> => {
      const user = await requireUser(ctx, req)
      const owners = await ctx.db
        .select({ id: users.id, name: users.name })
        .from(users)
        .where(and(isNull(users.disabledAt), user.role === 'sysadmin' ? undefined : eq(users.id, user.id)))
        .orderBy(asc(users.createdAt))
      const owned = await ctx.db
        .select()
        .from(machines)
        .where(
          and(
            inArray(
              machines.ownerId,
              owners.map((o) => o.id),
            ),
            isNull(machines.revokedAt),
          ),
        )
        .orderBy(asc(machines.createdAt))
      return owners.map((o) => ({
        ...o,
        machines: owned.filter((m) => m.ownerId === o.id).map((m) => machineDto(ctx, m)),
      }))
    })

    app.get<IdParams>('/api/bots/:id', async (req) => {
      await requireUser(ctx, req)
      return botDto(ctx, await loadBot(ctx, req.params.id))
    })

    app.post('/api/bots', async (req) => {
      const user = await requireUser(ctx, req)
      const body = CreateBotReq.parse(req.body)
      const name = body.name.trim()
      if (!name) fail('invalid', '名称不能为空')
      if (body.ownerId !== user.id && user.role !== 'sysadmin') fail('forbidden', '成员只能为自己创建 bot')
      const [owner] = isUuid(body.ownerId)
        ? await ctx.db
            .select()
            .from(users)
            .where(and(eq(users.id, body.ownerId), isNull(users.disabledAt)))
        : []
      if (!owner) return fail('invalid', '归属人不存在或已停用')
      const ownerMachines = await ctx.db
        .select({ id: machines.id })
        .from(machines)
        .where(and(eq(machines.ownerId, owner.id), isNull(machines.revokedAt)))
      if (body.machineId === null) {
        if (ownerMachines.length) fail('invalid', '请选择执行机器')
      } else if (!ownerMachines.some((m) => m.id === body.machineId)) {
        fail('invalid', '执行机器不属于归属人或已吊销')
      }
      await assertNameFree(ctx, name)

      const binding = !body.machineId ? 'pending_bind' : owner.id === user.id ? 'bound' : 'pending_confirm'
      const [bot] = (await ctx.db
        .insert(bots)
        .values({
          name,
          ownerId: owner.id,
          agentKind: body.agentKind,
          machineId: body.machineId,
          binding,
          systemPrompt: body.systemPrompt,
          concurrency: sysParams().botConcurrencyDefault,
          createdBy: user.id,
        })
        .returning()) as [BotRow]
      if (binding === 'pending_confirm')
        await notify(ctx, owner.id, 'bot_confirm', { botId: bot.id, botName: name, byName: user.name })
      await auditForeign(ctx, user, bot, 'bot.create')
      return publishBot(ctx, bot.id)
    })

    app.patch<IdParams>('/api/bots/:id', async (req) => {
      const user = await requireUser(ctx, req)
      const body = UpdateBotReq.parse(req.body)
      const bot = await loadBot(ctx, req.params.id)
      assertCanManage(user, bot)
      const name = body.name?.trim()
      if (name !== undefined) {
        if (!name) fail('invalid', '名称不能为空')
        await assertNameFree(ctx, name, bot.id)
      }
      const tier = body.tier ?? bot.tier
      let triggerScope = body.triggerScope ?? bot.triggerScope
      // Spec 3.6: a full-tier bot may only be triggered by an explicit list.
      if (tier === 'full' && triggerScope === 'all') {
        if (body.triggerScope === 'all') fail('invalid', 'full 档位强制使用指定名单')
        triggerScope = 'list'
      }
      if (body.triggerList) await assertUsers(ctx, body.triggerList)
      await ctx.db
        .update(bots)
        .set({ ...body, name, tier, triggerScope })
        .where(eq(bots.id, bot.id))
      await auditForeign(ctx, user, bot, 'bot.update', { changes: body })
      return publishBot(ctx, bot.id)
    })

    app.post<IdParams>('/api/bots/:id/confirm', async (req) => {
      const user = await requireUser(ctx, req)
      const bot = await loadBot(ctx, req.params.id)
      if (user.id !== bot.ownerId) fail('forbidden', '只有机器主人可以确认')
      if (bot.binding !== 'pending_confirm') fail('conflict', '该 bot 无需确认')
      return confirmBot(ctx, bot)
    })

    app.delete<IdParams>('/api/bots/:id', async (req, reply) => {
      const user = await requireUser(ctx, req)
      const bot = await loadBot(ctx, req.params.id)
      assertCanManage(user, bot)
      await ctx.db.update(bots).set({ deletedAt: ctx.now() }).where(eq(bots.id, bot.id))
      await ctx.db
        .update(groupBots)
        .set({ removedAt: ctx.now() })
        .where(and(eq(groupBots.botId, bot.id), isNull(groupBots.removedAt)))
      await auditForeign(ctx, user, bot, 'bot.delete')
      await publishBotRemoved(ctx, bot.id)
      return reply.status(204).send()
    })

    // ── daemon (machine token) ───────────────────────────────────────────────
    app.get('/api/daemon/bots', async (req) => {
      const machine = await requireMachine(ctx, req)
      return listBotDtos(ctx, eq(bots.machineId, machine.id))
    })

    app.post<IdParams>('/api/daemon/bots/:id/confirm', async (req) => {
      const machine = await requireMachine(ctx, req)
      const bot = await loadBot(ctx, req.params.id)
      if (bot.machineId !== machine.id) fail('not_found', 'bot 不存在')
      if (bot.binding !== 'pending_confirm') fail('conflict', '该 bot 无需确认')
      return confirmBot(ctx, bot)
    })
  }
}
