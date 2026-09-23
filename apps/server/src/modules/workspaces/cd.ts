import { randomUUID } from 'node:crypto'
import { asc, eq } from 'drizzle-orm'
import type { Ctx } from '../../context.js'
import { bots, groupRepos } from '../../db/schema.js'

/**
 * Asks the bot's machine to bind the (group, bot) workspace to `path` (null = back to managed).
 * The daemon validates the directory and answers with workspace.state. Returns false when the machine is offline.
 */
export async function requestCd(ctx: Ctx, o: { groupId: string; botId: string; path: string | null }) {
  const [bot] = await ctx.db.select({ machineId: bots.machineId }).from(bots).where(eq(bots.id, o.botId))
  const [repo] = await ctx.db
    .select()
    .from(groupRepos)
    .where(eq(groupRepos.groupId, o.groupId))
    .orderBy(asc(groupRepos.createdAt))
    .limit(1)
  if (!bot?.machineId || !repo) return false
  return ctx.hub.send(bot.machineId, {
    t: 'workspace.cd',
    requestId: randomUUID(),
    groupId: o.groupId,
    botId: o.botId,
    repo: { id: repo.id, url: repo.url, branch: repo.baseBranch },
    path: o.path,
  })
}
