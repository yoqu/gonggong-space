import {
  type AgentInfo,
  BOT_AVATARS,
  type BotAvatar,
  type BotDto,
  type MachineDto,
  type SystemInfo,
} from '@gonggong/protocol'
import { and, asc, count, eq, inArray, isNull, type SQL } from 'drizzle-orm'
import type { Ctx } from '../../context.js'
import { botShares, bots, groupBots, groups, machines, runs, teamMembers, users } from '../../db/schema.js'
import { fail } from '../../lib/errors.js'
import { teamOfBot, teamUserIds } from '../teams/service.js'
import { defaultGitEmail } from './git.js'

type BotRow = typeof bots.$inferSelect
type MachineRow = typeof machines.$inferSelect

/** Values from retired looks read as the default character. */
export const botRole = (avatar: string | null): BotAvatar =>
  (BOT_AVATARS as readonly string[]).includes(avatar ?? '') ? (avatar as BotAvatar) : 'role-gong'

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
  features: ctx.hub.features(m.id),
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
  const [busy, memberships, shares] = await Promise.all([
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
    ctx.db
      .select({ botId: botShares.botId, userId: botShares.userId })
      .from(botShares)
      .where(inArray(botShares.botId, ids))
      .orderBy(asc(botShares.createdAt)),
  ])
  const running = new Set(busy.map((r) => r.botId))
  const groupCount = new Map(memberships.map((r) => [r.botId, r.n]))
  return rows.map(({ bot, ownerName, machine }) => {
    const agent = machine
      ? machineAgents(machine).find((a) => a.kind === bot.agentKind && a.available)
      : undefined
    return {
      id: bot.id,
      teamId: bot.teamId,
      name: bot.name,
      ownerId: bot.ownerId,
      ownerName,
      agentKind: bot.agentKind as BotDto['agentKind'],
      avatar: botRole(bot.avatar),
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
      model: bot.model,
      effort: bot.effort,
      catalog: agent?.catalog ?? null,
      approval: bot.approval as BotDto['approval'],
      allowlist: bot.allowlist,
      alwaysAllow: bot.alwaysAllow,
      gitName: bot.gitName,
      gitEmail: bot.gitEmail,
      gitDefaultEmail: defaultGitEmail(bot.id),
      sharedWith: shares.filter((s) => s.botId === bot.id).map((s) => s.userId),
    }
  })
}

export async function botDto(ctx: Ctx, row: Pick<BotRow, 'id'>) {
  const [dto] = await listBotDtos(ctx, eq(bots.id, row.id))
  return dto ?? fail('not_found', 'Bot 不存在')
}

/** Pushes `bot.updated` for every live bot matching `where` to its team (bots are visible team-wide). */
export async function publishBots(ctx: Ctx, where: SQL) {
  const [list, audience] = await Promise.all([
    listBotDtos(ctx, where),
    ctx.db
      .select({ botId: bots.id, userId: teamMembers.userId })
      .from(bots)
      .innerJoin(teamMembers, eq(teamMembers.teamId, bots.teamId))
      .innerJoin(users, and(eq(users.id, teamMembers.userId), isNull(users.disabledAt)))
      .where(where),
  ])
  for (const bot of list)
    ctx.bus.publish(
      audience.filter((a) => a.botId === bot.id).map((a) => a.userId),
      { t: 'bot.updated', bot },
    )
  return list
}

export async function publishBot(ctx: Ctx, id: string) {
  const [bot] = await publishBots(ctx, eq(bots.id, id))
  return bot ?? fail('not_found', 'Bot 不存在')
}

export async function publishBotRemoved(ctx: Ctx, botId: string) {
  ctx.bus.publish(await teamUserIds(ctx, await teamOfBot(ctx, botId)), { t: 'bot.removed', botId })
}
