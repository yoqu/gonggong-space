import {
  type BotOwnerDto,
  type BotPlaceDto,
  CreateBotReq,
  type DaemonBotDto,
  effortName,
  fitEffort,
  GroupBotConfigReq,
  GroupBotTierReq,
  modelName,
  TERMINAL_RUN_STATUS,
  type Tier,
  UpdateBotReq,
} from '@gonggong/protocol'
import { and, asc, desc, eq, inArray, isNull, max, ne, notInArray } from 'drizzle-orm'
import type { FastifyInstance } from 'fastify'
import type { Ctx } from '../../context.js'
import { requireMachine } from '../../daemon/auth.js'
import {
  bots,
  feishuApps,
  groupBots,
  groups,
  machines,
  runs,
  teamMembers,
  teams,
  users,
} from '../../db/schema.js'
import { audit } from '../../lib/audit.js'
import { fail } from '../../lib/errors.js'
import { idParam, isUuid } from '../../lib/ids.js'
import { assertNotDemo } from '../admin/params.js'
import { requireUser, type SessionUser } from '../auth/session.js'
import { reloadFeishu } from '../feishu/gateway.js'
import { teamParams } from '../groups/params.js'
import { publishDmsOf } from '../groups/service.js'
import { postEvent } from '../messages/service.js'
import { notify } from '../notifications/notify.js'
import { stepI18nOf } from '../runs/step.js'
import { leaveBots } from '../sync/switch.js'
import { currentTeam, requireTeam } from '../teams/service.js'
import { updateBotState } from '../workspaces/state.js'
import { confirmBot } from './binding.js'
import { assertCanConfigure, assertPick, pickCatalog } from './config.js'
import { botDto, listBotDtos, machineDto, publishBot, publishBotRemoved, publishBots } from './dto.js'
import { applyTier, assertTierAllowed, TIER_LABEL } from './tier.js'

type BotRow = typeof bots.$inferSelect
type IdParams = { Params: { id: string } }

async function loadBot(ctx: Ctx, rawId: string) {
  const id = idParam(rawId, 'Bot 不存在')
  const [bot] = await ctx.db
    .select()
    .from(bots)
    .where(and(eq(bots.id, id), isNull(bots.deletedAt)))
  return bot ?? fail('not_found', 'Bot 不存在')
}

async function assertNameFree(ctx: Ctx, name: string, exceptId?: string) {
  const [taken] = await ctx.db
    .select({ id: bots.id })
    .from(bots)
    .where(and(eq(bots.name, name), isNull(bots.deletedAt), exceptId ? ne(bots.id, exceptId) : undefined))
  if (taken) fail('conflict', '名称「{name}」已被占用', { name })
}

/** Trigger lists name members of the bot's team. */
async function assertUsers(ctx: Ctx, teamId: string, ids: string[]) {
  const unique = [...new Set(ids)]
  const found = unique.every(isUuid)
    ? await ctx.db
        .select({ id: teamMembers.userId })
        .from(teamMembers)
        .where(and(eq(teamMembers.teamId, teamId), inArray(teamMembers.userId, unique)))
    : []
  if (found.length !== unique.length) fail('invalid', '指定名单包含不存在的成员')
}

function assertCanManage(user: SessionUser, bot: BotRow) {
  if (user.id !== bot.ownerId && user.role !== 'sysadmin')
    fail('forbidden', '只有归属人或系统管理员可以修改该 Bot')
}

/** Same command, same entry: `go  build` and `go build` are one prefix. */
const normalizeAllowlist = (list: string[]) => [...new Set(list.map((s) => s.trim().split(/\s+/).join(' ')))]

/** Sysadmin actions on someone else's bot are audited (spec 9: all admin operations). */
async function auditForeign(ctx: Ctx, user: SessionUser, bot: BotRow, action: string, detail: object = {}) {
  if (user.id !== bot.ownerId)
    await audit(ctx, {
      category: 'admin',
      actorUserId: user.id,
      teamId: bot.teamId,
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
      const user = await requireUser(ctx, req)
      return listBotDtos(ctx, eq(bots.teamId, await currentTeam(ctx, req, user.id)))
    })

    app.get('/api/bots/owners', async (req): Promise<BotOwnerDto[]> => {
      const user = await requireUser(ctx, req)
      const teamId = await currentTeam(ctx, req, user.id)
      const owners = await ctx.db
        .select({ id: users.id, name: users.name })
        .from(users)
        .innerJoin(teamMembers, and(eq(teamMembers.userId, users.id), eq(teamMembers.teamId, teamId)))
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
      const user = await requireUser(ctx, req)
      const bot = await loadBot(ctx, req.params.id)
      await requireTeam(ctx, user.id, bot.teamId)
      return botDto(ctx, bot)
    })

    app.get<IdParams>('/api/bots/:id/activity', async (req): Promise<BotPlaceDto[]> => {
      const user = await requireUser(ctx, req)
      const bot = await loadBot(ctx, req.params.id)
      if (user.id !== bot.ownerId && user.role !== 'sysadmin')
        fail('forbidden', '仅 Bot 主人或系统管理员可查看该 Bot 的工作情况')
      const places = await ctx.db
        .select({
          groupId: groups.id,
          groupName: groups.name,
          groupKind: groups.kind,
          workspacePath: groupBots.workspacePath,
          lastRunAt: max(runs.startedAt),
        })
        .from(groupBots)
        .innerJoin(groups, eq(groups.id, groupBots.groupId))
        .leftJoin(runs, and(eq(runs.groupId, groupBots.groupId), eq(runs.botId, bot.id)))
        .where(and(eq(groupBots.botId, bot.id), isNull(groupBots.removedAt), isNull(groups.archivedAt)))
        .groupBy(groups.id, groupBots.workspacePath)
      const live = await ctx.db
        .select({
          id: runs.id,
          groupId: runs.groupId,
          status: runs.status,
          step: runs.step,
          stepI18n: runs.stepI18n,
          startedAt: runs.startedAt,
        })
        .from(runs)
        .where(and(eq(runs.botId, bot.id), notInArray(runs.status, [...TERMINAL_RUN_STATUS])))
        .orderBy(desc(runs.queuedAt))
      const dtos = places.map((p): BotPlaceDto => {
        const run = live.find((r) => r.groupId === p.groupId)
        return {
          ...p,
          groupKind: p.groupKind as BotPlaceDto['groupKind'],
          lastRunAt: p.lastRunAt?.toISOString() ?? null,
          run: run
            ? {
                id: run.id,
                status: run.status as NonNullable<BotPlaceDto['run']>['status'],
                step: run.step,
                ...stepI18nOf(run),
                startedAt: run.startedAt?.toISOString() ?? null,
              }
            : null,
        }
      })
      return dtos.sort((a, b) => +!a.run - +!b.run || (b.lastRunAt ?? '').localeCompare(a.lastRunAt ?? ''))
    })

    app.post('/api/bots', async (req) => {
      const user = await requireUser(ctx, req)
      const teamId = await currentTeam(ctx, req, user.id)
      const body = CreateBotReq.parse(req.body)
      const name = body.name.trim()
      if (!name) fail('invalid', '名称不能为空')
      if (body.ownerId !== user.id && user.role !== 'sysadmin') fail('forbidden', '成员只能为自己创建 Bot')
      const [owner] = isUuid(body.ownerId)
        ? await ctx.db
            .select({ id: users.id })
            .from(users)
            .innerJoin(teamMembers, and(eq(teamMembers.userId, users.id), eq(teamMembers.teamId, teamId)))
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
      if (body.model || body.effort) {
        const catalog = await pickCatalog(ctx, { machineId: body.machineId, agentKind: body.agentKind })
        assertPick(catalog, { model: body.model, effort: body.effort }, null)
      }

      const binding = !body.machineId ? 'pending_bind' : owner.id === user.id ? 'bound' : 'pending_confirm'
      const [bot] = (await ctx.db
        .insert(bots)
        .values({
          teamId,
          name,
          ownerId: owner.id,
          agentKind: body.agentKind,
          machineId: body.machineId,
          binding,
          systemPrompt: body.systemPrompt,
          avatar: body.avatar,
          model: body.model,
          effort: body.effort,
          concurrency: (await teamParams(ctx.db, teamId)).botConcurrencyDefault,
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
      // Plan J9: what runs unattended on the owner's machine is the owner's call alone.
      if ((body.approval !== undefined || body.allowlist !== undefined) && user.id !== bot.ownerId)
        fail('forbidden', '命令审批只有 Bot 主人能修改')
      if (body.allowlist) body.allowlist = normalizeAllowlist(body.allowlist)
      await assertTierAllowed(ctx, body.tier)
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
      if (body.triggerList) await assertUsers(ctx, bot.teamId, body.triggerList)
      if (body.model !== undefined || body.effort !== undefined) {
        const catalog = await pickCatalog(ctx, bot)
        assertPick(catalog, { model: body.model, effort: body.effort }, bot.model)
        // A new model keeps the old level only if it offers it.
        if (body.model !== undefined && body.effort === undefined)
          body.effort = fitEffort(catalog, body.model, bot.effort) === bot.effort ? bot.effort : null
      }
      await ctx.db
        .update(bots)
        .set({ ...body, name, tier, triggerScope })
        .where(eq(bots.id, bot.id))
      await auditForeign(ctx, user, bot, 'bot.update', { changes: body })
      const approval = { approval: body.approval ?? bot.approval, allowlist: body.allowlist ?? bot.allowlist }
      if (approval.approval !== bot.approval || approval.allowlist.join('\n') !== bot.allowlist.join('\n'))
        await audit(ctx, {
          category: 'admin',
          actorUserId: user.id,
          teamId: bot.teamId,
          action: 'bot.approval',
          detail: {
            botId: bot.id,
            name: bot.name,
            from: { approval: bot.approval, allowlist: bot.allowlist },
            to: approval,
          },
        })
      if (tier !== bot.tier) await applyTier(ctx, user.id, bot.id)
      if (name !== undefined && name !== bot.name) await publishDmsOf(ctx, bot.id)
      return publishBot(ctx, bot.id)
    })

    app.put<{ Params: { id: string; botId: string } }>(
      '/api/groups/:id/bots/:botId/tier',
      async (req, reply) => {
        const user = await requireUser(ctx, req)
        const { tier } = GroupBotTierReq.parse(req.body)
        const bot = await loadBot(ctx, req.params.botId)
        const groupId = idParam(req.params.id, '群不存在')
        const [gb] = await ctx.db
          .select({ tier: groupBots.tier })
          .from(groupBots)
          .where(
            and(eq(groupBots.groupId, groupId), eq(groupBots.botId, bot.id), isNull(groupBots.removedAt)),
          )
        if (!gb) return fail('not_found', '该 Bot 不在群内')
        assertCanManage(user, bot)
        await assertTierAllowed(ctx, tier)
        if (gb.tier === tier) return reply.status(204).send()
        await updateBotState(ctx, groupId, bot.id, { tier })
        await auditForeign(ctx, user, bot, 'bot.groupTier', { groupId, tier })
        await postEvent(
          ctx,
          groupId,
          tier
            ? '{user} 将 {bot} 在本群的档位设为「{tier}」'
            : '{user} 将 {bot} 在本群的档位恢复为跟随全局（{tier}）',
          { user: user.name, bot: bot.name, tier: { key: TIER_LABEL[tier ?? (bot.tier as Tier)] } },
        )
        await applyTier(ctx, user.id, bot.id, groupId)
        return reply.status(204).send()
      },
    )

    app.put<{ Params: { id: string; botId: string } }>(
      '/api/groups/:id/bots/:botId/config',
      async (req, reply) => {
        const user = await requireUser(ctx, req)
        const { model, effort } = GroupBotConfigReq.parse(req.body)
        const bot = await loadBot(ctx, req.params.botId)
        const groupId = idParam(req.params.id, '群不存在')
        const [gb] = await ctx.db
          .select({ model: groupBots.model, effort: groupBots.effort })
          .from(groupBots)
          .where(
            and(eq(groupBots.groupId, groupId), eq(groupBots.botId, bot.id), isNull(groupBots.removedAt)),
          )
        if (!gb) return fail('not_found', '该 Bot 不在群内')
        await assertCanConfigure(ctx, user, bot, groupId)
        const catalog = model || effort ? await pickCatalog(ctx, bot) : null
        assertPick(catalog, { model, effort }, bot.model)
        if (gb.model === model && gb.effort === effort) return reply.status(204).send()
        await updateBotState(ctx, groupId, bot.id, { model, effort })
        const now = model ?? bot.model
        const picked = fitEffort(catalog, now, effort ?? bot.effort)
        const params = {
          user: user.name,
          bot: bot.name,
          model: now === null ? { key: '默认模型' } : modelName(catalog, now),
          ...(picked && { effort: { key: effortName(picked) } }),
        }
        await postEvent(
          ctx,
          groupId,
          !(model || effort)
            ? '{user} 将 {bot} 在本群的模型恢复为跟随 Bot 默认'
            : picked
              ? '{user} 将 {bot} 在本群的模型设为 {model} · {effort}'
              : '{user} 将 {bot} 在本群的模型设为 {model}',
          params,
        )
        return reply.status(204).send()
      },
    )

    app.post<IdParams>('/api/bots/:id/confirm', async (req) => {
      const user = await requireUser(ctx, req)
      const bot = await loadBot(ctx, req.params.id)
      if (user.id !== bot.ownerId) fail('forbidden', '只有机器主人可以确认')
      if (bot.binding !== 'pending_confirm') fail('conflict', '该 Bot 无需确认')
      return confirmBot(ctx, bot)
    })

    app.delete<IdParams>('/api/bots/:id', async (req, reply) => {
      const user = await requireUser(ctx, req)
      const bot = await loadBot(ctx, req.params.id)
      assertCanManage(user, bot)
      await assertNotDemo(ctx, user)
      await ctx.db.update(bots).set({ deletedAt: ctx.now() }).where(eq(bots.id, bot.id))
      await ctx.db
        .update(groupBots)
        .set({ removedAt: ctx.now() })
        .where(and(eq(groupBots.botId, bot.id), isNull(groupBots.removedAt)))
      await leaveBots(ctx, [bot.id])
      await ctx.db.delete(feishuApps).where(eq(feishuApps.botId, bot.id))
      await reloadFeishu(ctx)
      await auditForeign(ctx, user, bot, 'bot.delete')
      await publishBotRemoved(ctx, bot.id)
      await publishDmsOf(ctx, bot.id)
      return reply.status(204).send()
    })

    // ── daemon (machine token) ───────────────────────────────────────────────
    app.get('/api/daemon/bots', async (req) => {
      const machine = await requireMachine(ctx, req)
      const [list, names] = await Promise.all([
        listBotDtos(ctx, eq(bots.machineId, machine.id)),
        ctx.db
          .selectDistinct({ id: teams.id, name: teams.name })
          .from(teams)
          .innerJoin(bots, eq(bots.teamId, teams.id))
          .where(eq(bots.machineId, machine.id)),
      ])
      const teamName = new Map(names.map((n) => [n.id, n.name]))
      return list.map(
        (b): DaemonBotDto => ({ ...b, teamName: teamName.get(b.teamId) ?? fail('not_found', '团队不存在') }),
      )
    })
  }
}
