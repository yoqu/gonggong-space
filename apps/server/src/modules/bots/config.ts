import { randomUUID } from 'node:crypto'
import {
  type AgentCatalog,
  type AgentKind,
  fitEffort,
  modelEfforts,
  type RunConfigPick,
} from '@gonggong/protocol'
import { and, eq } from 'drizzle-orm'
import type { Ctx } from '../../context.js'
import type { Db } from '../../db/client.js'
import { bots, groupBots, groupMembers, groups, machines } from '../../db/schema.js'
import { fail } from '../../lib/errors.js'
import type { SessionUser } from '../auth/session.js'
import { relay } from '../machines/relay.js'
import { machineAgents } from './dto.js'

type Bot = Pick<typeof bots.$inferSelect, 'agentKind' | 'machineId'>
type Config = { model: string | null; effort: string | null }

export const catalogOf = (agents: ReturnType<typeof machineAgents>, kind: string) =>
  agents.find((a) => a.kind === kind && a.available)?.catalog ?? null

/** What the bot's machine reported its adapter offers. */
export async function botCatalog(db: Pick<Db, 'select'>, bot: Bot): Promise<AgentCatalog | null> {
  if (!bot.machineId) return null
  const [m] = await db.select().from(machines).where(eq(machines.id, bot.machineId))
  return m ? catalogOf(machineAgents(m), bot.agentKind) : null
}

/**
 * What a new session of the bot (no id: a new one) may pick. Only its machine knows the provider in effect (design
 * §2), so it is asked live; daemons without providers, or offline, are checked against what they reported.
 */
export async function pickCatalog(ctx: Ctx, bot: Bot & { id?: string }): Promise<AgentCatalog | null> {
  const { machineId } = bot
  if (!machineId || !ctx.hub.isOnline(machineId) || !ctx.hub.features(machineId).includes('providers'))
    return botCatalog(ctx.db, bot)
  const msg = {
    t: 'providers.cmd',
    requestId: randomUUID(),
    action: 'botCatalog',
    agent: bot.agentKind as AgentKind,
    botId: bot.id,
  } as const
  return (await relay(ctx, machineId, msg, 'providers.result', 15_000)).catalog ?? null
}

/**
 * Picked values must be on the catalog (plan M7); undefined = not picked, null = the adapter's default. An effort is
 * checked against the picked model, else `current` (the one the defaults resolve to).
 */
export function assertPick(catalog: AgentCatalog | null, pick: RunConfigPick, current: string | null) {
  if (!pick.model && !pick.effort) return
  if (!catalog) return fail('invalid', 'Bot 所在机器尚未上报可选模型，只能跟随默认')
  const model = modelEfforts(catalog, pick.model === undefined ? current : pick.model)
  if (pick.model && !model) fail('invalid', `不支持的模型：${pick.model}`)
  if (pick.effort && model && !model.efforts.some((e) => e.value === pick.effort))
    fail('invalid', `该模型不支持推理强度：${pick.effort}`)
}

/** Plan M1: the bot owner or a group admin; in a DM, its member. */
export async function assertCanConfigure(
  ctx: Ctx,
  user: SessionUser,
  bot: { ownerId: string },
  groupId: string,
) {
  if (user.id === bot.ownerId) return
  const [row] = await ctx.db
    .select({ kind: groups.kind, isAdmin: groupMembers.isAdmin })
    .from(groupMembers)
    .innerJoin(groups, eq(groups.id, groupMembers.groupId))
    .where(and(eq(groupMembers.groupId, groupId), eq(groupMembers.userId, user.id)))
  if (!row || (row.kind !== 'dm' && !row.isAdmin)) fail('forbidden', '只有 Bot 主人或群管理员可以切换模型')
}

/** Message pick → group default → bot default; the effort always one the model offers. */
export function resolveConfig(
  catalog: AgentCatalog | null,
  pick: RunConfigPick | undefined,
  group: Config,
  bot: Config,
): Config {
  const model = pick?.model !== undefined ? pick.model : (group.model ?? bot.model)
  const effort = pick?.effort !== undefined ? pick.effort : (group.effort ?? bot.effort)
  return { model, effort: fitEffort(catalog, model, effort) }
}

/** A message's one-shot picks, kept for the bots it triggers only, after the permission and catalog checks. */
export async function checkPicks(
  ctx: Ctx,
  user: SessionUser,
  groupId: string,
  picks: Record<string, RunConfigPick>,
  triggered: string[],
) {
  const kept: Record<string, RunConfigPick> = {}
  for (const [botId, pick] of Object.entries(picks)) {
    if (!triggered.includes(botId) || (pick.model === undefined && pick.effort === undefined)) continue
    const [row] = await ctx.db
      .select({ bot: bots, groupModel: groupBots.model })
      .from(groupBots)
      .innerJoin(bots, eq(bots.id, groupBots.botId))
      .where(and(eq(groupBots.groupId, groupId), eq(groupBots.botId, botId)))
    if (!row) continue
    await assertCanConfigure(ctx, user, row.bot, groupId)
    assertPick(await pickCatalog(ctx, row.bot), pick, row.groupModel ?? row.bot.model)
    kept[botId] = pick
  }
  return kept
}
