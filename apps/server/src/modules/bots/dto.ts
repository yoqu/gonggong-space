import type { AgentInfo, BotDto, MachineDto, SystemInfo } from '@aiws/protocol'
import { and, asc, count, eq, inArray, isNull, type SQL } from 'drizzle-orm'
import type { Ctx } from '../../context.js'
import { bots, groupBots, groups, machines, runs, users } from '../../db/schema.js'
import { fail } from '../../lib/errors.js'

type BotRow = typeof bots.$inferSelect
type MachineRow = typeof machines.$inferSelect

export const machineAgents = (m: MachineRow) => m.agents as AgentInfo[]

export const machineDto = (ctx: Ctx, m: MachineRow): MachineDto => ({
  id: m.id,
  ownerId: m.ownerId,
  name: m.label ?? m.name,
  hostname: m.name,
  os: m.os as MachineDto['os'],
  arch: m.arch,
  system: m.system as SystemInfo | null,
  online: ctx.hub.isOnline(m.id),
  agents: machineAgents(m),
  daemonVersion: m.daemonVersion,
  lastSeenAt: m.lastSeenAt?.toISOString() ?? null,
  boundAt: m.boundAt.toISOString(),
  createdAt: m.createdAt.toISOString(),
})

function presence(ctx: Ctx, bot: BotRow, agent: AgentInfo | undefined, running: boolean): BotDto['presence'] {
  if (bot.binding !== 'bound') return bot.binding as BotDto['binding'] & BotDto['presence']
  if (!bot.machineId || !agent) return 'agent_missing'
  if (!ctx.hub.isOnline(bot.machineId)) return 'offline'
  return running ? 'running' : 'online'
}

/** Live (non-deleted) bots matching `where`, with owner/machine names and derived presence. */
export async function listBotDtos(ctx: Ctx, where?: SQL): Promise<BotDto[]> {
  const rows = await ctx.db
    .select({ bot: bots, ownerName: users.name, machine: machines })
    .from(bots)
    .innerJoin(users, eq(users.id, bots.ownerId))
    .leftJoin(machines, eq(machines.id, bots.machineId))
    .where(and(isNull(bots.deletedAt), where))
    .orderBy(asc(bots.createdAt))
  if (!rows.length) return []
  const ids = rows.map((r) => r.bot.id)
  const [busy, memberships] = await Promise.all([
    ctx.db
      .selectDistinct({ botId: runs.botId })
      .from(runs)
      .where(and(inArray(runs.botId, ids), eq(runs.status, 'running'))),
    ctx.db
      .select({ botId: groupBots.botId, n: count() })
      .from(groupBots)
      .innerJoin(groups, eq(groups.id, groupBots.groupId))
      .where(and(inArray(groupBots.botId, ids), isNull(groupBots.removedAt), isNull(groups.archivedAt)))
      .groupBy(groupBots.botId),
  ])
  const running = new Set(busy.map((r) => r.botId))
  const groupCount = new Map(memberships.map((r) => [r.botId, r.n]))
  return rows.map(({ bot, ownerName, machine }) => {
    const agent = machine
      ? machineAgents(machine).find((a) => a.kind === bot.agentKind && a.available)
      : undefined
    return {
      id: bot.id,
      name: bot.name,
      ownerId: bot.ownerId,
      ownerName,
      agentKind: bot.agentKind as BotDto['agentKind'],
      machineId: bot.machineId,
      machineName: machine?.name ?? null,
      binding: bot.binding as BotDto['binding'],
      presence: presence(ctx, bot, agent, running.has(bot.id)),
      systemPrompt: bot.systemPrompt,
      tier: bot.tier as BotDto['tier'],
      triggerScope: bot.triggerScope as BotDto['triggerScope'],
      triggerList: bot.triggerList,
      concurrency: bot.concurrency,
      createdBy: bot.createdBy,
      defaultWorkspace: bot.defaultWorkspace,
      agentVersion: agent?.version ?? null,
      agentMinVersion: agent?.minVersion ?? null,
      groupCount: groupCount.get(bot.id) ?? 0,
    }
  })
}

export async function botDto(ctx: Ctx, row: Pick<BotRow, 'id'>) {
  const [dto] = await listBotDtos(ctx, eq(bots.id, row.id))
  return dto ?? fail('not_found', 'bot 不存在')
}

async function everyone(ctx: Ctx) {
  const rows = await ctx.db.select({ id: users.id }).from(users).where(isNull(users.disabledAt))
  return rows.map((r) => r.id)
}

/** Pushes `bot.updated` for every live bot matching `where` to all users (bots are visible team-wide). */
export async function publishBots(ctx: Ctx, where: SQL) {
  const [list, userIds] = await Promise.all([listBotDtos(ctx, where), everyone(ctx)])
  for (const bot of list) ctx.bus.publish(userIds, { t: 'bot.updated', bot })
  return list
}

export async function publishBot(ctx: Ctx, id: string) {
  const [bot] = await publishBots(ctx, eq(bots.id, id))
  return bot ?? fail('not_found', 'bot 不存在')
}

export async function publishBotRemoved(ctx: Ctx, botId: string) {
  ctx.bus.publish(await everyone(ctx), { t: 'bot.removed', botId })
}
