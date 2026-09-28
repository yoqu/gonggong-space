import { eq } from 'drizzle-orm'
import type { Ctx } from '../../context.js'
import { bots } from '../../db/schema.js'
import { audit } from '../../lib/audit.js'
import { postEvent } from '../messages/service.js'
import { currentRepo, forget, onlineMachine, track } from './provision.js'

export const ABSOLUTE = /^(\/|[A-Za-z]:[\\/])/

/**
 * Asks the bot's machine to bind the (group, bot) workspace to `path` (null = managed). The daemon validates the
 * directory (against the group repo, if any) and answers with workspace.state, which the workspace engine applies
 * and hands to `onCdResult`. Returns false when the machine is offline.
 */
export async function requestCd(
  ctx: Ctx,
  o: { groupId: string; botId: string; path: string | null; force?: boolean },
) {
  const [bot] = await ctx.db.select({ machineId: bots.machineId }).from(bots).where(eq(bots.id, o.botId))
  const repo = await currentRepo(ctx, o.groupId, o.botId)
  const machineId = onlineMachine(ctx, bot?.machineId ?? null)
  if (!machineId) return false
  const requestId = track({
    kind: 'cd',
    machineId,
    ...o,
    repoId: repo?.id ?? null,
    cdPath: o.path,
    joined: false,
  })
  const sent = ctx.hub.send(machineId, { t: 'workspace.cd', requestId, ...o, force: !!o.force, repo })
  if (!sent) forget(requestId)
  return sent
}

/** Audit + timeline note once an owner's binding request (/cd or the chat banner) was sent. */
export async function announceCd(
  ctx: Ctx,
  o: { groupId: string; userId: string; bot: { id: string; name: string }; path: string | null },
) {
  await audit(ctx, {
    category: 'run',
    actorUserId: o.userId,
    action: 'command.cd',
    groupId: o.groupId,
    detail: { botId: o.bot.id, path: o.path },
  })
  await postEvent(
    ctx,
    o.groupId,
    o.path === null
      ? `已请求 ${o.bot.name} 使用托管工作区，等待本机确认…`
      : `已请求 ${o.bot.name} 绑定到 ${o.path}，等待本机校验…`,
  )
}
