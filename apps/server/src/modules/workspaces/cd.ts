import { eq } from 'drizzle-orm'
import type { Ctx } from '../../context.js'
import { bots } from '../../db/schema.js'
import { currentRepo, forget, onlineMachine, track } from './provision.js'

/**
 * Asks the bot's machine to bind the (group, bot) workspace to `path` (null = back to managed). The daemon validates
 * the directory and answers with workspace.state, which the workspace engine applies and hands to `onCdResult`.
 * Returns false when the machine is offline or the group has no repo.
 */
export async function requestCd(ctx: Ctx, o: { groupId: string; botId: string; path: string | null }) {
  const [bot] = await ctx.db.select({ machineId: bots.machineId }).from(bots).where(eq(bots.id, o.botId))
  const repo = await currentRepo(ctx, o.groupId)
  const machineId = onlineMachine(ctx, bot?.machineId ?? null)
  if (!repo || !machineId) return false
  const requestId = track({ kind: 'cd', machineId, ...o, repoId: repo.id, cdPath: o.path, joined: false })
  const sent = ctx.hub.send(machineId, { t: 'workspace.cd', requestId, ...o, repo })
  if (!sent) forget(requestId)
  return sent
}
