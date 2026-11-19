import type { ProtocolKey, RunConfigPick } from '@gonggong/protocol'
import { and, count, eq, inArray } from 'drizzle-orm'
import type { Ctx } from '../../context.js'
import { bots, groupBots, runs } from '../../db/schema.js'
import { HttpError } from '../../lib/errors.js'
import { assertPick, botCatalog, checkPick, isEmptyPick } from '../bots/config.js'
import { postEvent } from '../messages/service.js'

/** Run statuses that still occupy a bot or keep a task/webhook busy. */
export const UNFINISHED = ['queued', 'offline_wait', 'running', 'awaiting_approval', 'awaiting_answer']

export type BotRunPicks = Record<string, RunConfigPick>
const samePick = (a: RunConfigPick, b: RunConfigPick | undefined) =>
  a.model === b?.model && a.effort === b?.effort

/** The first candidate that is online and idle, else the first online one (its run queues); null when none is. */
export async function pickAvailableBot<T extends { id: string; name: string; machineId: string | null }>(
  ctx: Ctx,
  groupId: string,
  candidates: T[],
): Promise<T | null> {
  if (!candidates.length) return null
  const ids = candidates.map((b) => b.id)
  const state = await ctx.db
    .select({ id: bots.id, binding: bots.binding, workspace: groupBots.workspaceState })
    .from(bots)
    .innerJoin(groupBots, and(eq(groupBots.botId, bots.id), eq(groupBots.groupId, groupId)))
    .where(inArray(bots.id, ids))
  const busy = await ctx.db
    .select({ botId: runs.botId, n: count() })
    .from(runs)
    .where(and(inArray(runs.botId, ids), inArray(runs.status, UNFINISHED)))
    .groupBy(runs.botId)
  const usable = candidates.filter((b) => {
    const st = state.find((x) => x.id === b.id)
    return (
      st?.binding === 'bound' &&
      !['unbound', 'confirm'].includes(st.workspace) &&
      !!b.machineId &&
      ctx.hub.isOnline(b.machineId)
    )
  })
  return usable.find((b) => !busy.some((x) => x.botId === b.id)) ?? usable[0] ?? null
}

/** Picks of the candidates only; new or changed ones are checked as a message pick by `actorUserId`. */
export async function checkBotRunOptions(
  ctx: Ctx,
  groupId: string,
  picks: BotRunPicks,
  botIds: string[],
  actorUserId: string,
  saved: BotRunPicks = {},
): Promise<BotRunPicks> {
  const kept: BotRunPicks = {}
  for (const id of botIds) {
    const pick = picks[id]
    if (!pick || isEmptyPick(pick)) continue
    if (samePick(pick, saved[id]) || (await checkPick(ctx, { id: actorUserId }, groupId, id, pick)))
      kept[id] = pick
  }
  return kept
}

/**
 * Resolves a saved model/effort pick for `botId` into message `meta.runOptions`, if its machine still offers it;
 * otherwise falls back to defaults and posts the given `fallbackKey` event in the group.
 */
export async function resolveBotRunOptions(
  ctx: Ctx,
  o: {
    groupId: string
    name: string
    runOptions: BotRunPicks
    botId: string
    botName: string
    fallbackKey: ProtocolKey
  },
): Promise<{ runOptions?: BotRunPicks }> {
  const pick = o.runOptions[o.botId]
  if (!pick) return {}
  const [row] = await ctx.db
    .select({ bot: bots, groupModel: groupBots.model })
    .from(groupBots)
    .innerJoin(bots, eq(bots.id, groupBots.botId))
    .where(and(eq(groupBots.groupId, o.groupId), eq(groupBots.botId, o.botId)))
  try {
    if (row) assertPick(await botCatalog(ctx.db, row.bot), pick, row.groupModel ?? row.bot.model)
    return { runOptions: { [o.botId]: pick } }
  } catch (err) {
    if (!(err instanceof HttpError)) throw err
    await postEvent(ctx, o.groupId, o.fallbackKey, {
      name: o.name,
      bot: o.botName,
      pick: [pick.model, pick.effort].filter(Boolean).join(' · '),
    })
    return {}
  }
}
