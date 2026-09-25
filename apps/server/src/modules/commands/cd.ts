import type { WorkspaceState } from '@gonggong/protocol'
import { eq } from 'drizzle-orm'
import type { Ctx } from '../../context.js'
import { bots } from '../../db/schema.js'
import { postEvent } from '../messages/service.js'
import { ABSOLUTE, announceCd, requestCd } from '../workspaces/cd.js'
import type { CommandHandler } from './registry.js'
import { targets } from './system.js'

/** /cd @bot <absolute path> | --reset (plan D12): only the bot owner, only in partition groups. */
export const cd: CommandHandler = async (ctx, input) => {
  const { group, user, command, bots: inGroup } = input
  const say = (body: string) => postEvent(ctx, group.id, body)
  if (group.mode !== 'partition')
    return void (await say('/cd 仅分区模式可用；强制同步群里非托管工作区的 Bot 为「不参与」'))
  const picked = targets(input)
  const bot = picked[0]
  if (picked.length !== 1 || !bot || !command.args) {
    const example = (bot ?? inGroup[0])?.name ?? 'bot'
    return void (await say(
      `/cd 需要 @ 一个 Bot，如 /cd @${example} /本机/绝对路径，或 /cd @${example} --reset 回到托管`,
    ))
  }
  if (bot.ownerId !== user.id) return void (await say('只有 Bot 主人可以使用 /cd'))
  const reset = command.args === '--reset'
  if (!reset && !ABSOLUTE.test(command.args))
    return void (await say('/cd 需要本机绝对路径，如 /Users/me/code/repo'))
  const path = reset ? null : command.args
  if (!(await requestCd(ctx, { groupId: group.id, botId: bot.id, path })))
    return void (await say(`${bot.name} 离线，无法执行 /cd`))
  await announceCd(ctx, { groupId: group.id, userId: user.id, bot, path })
}

/** Called by the workspaces module when the daemon answers a workspace.cd request; `reset` = the request had path null. */
export async function onCdResult(ctx: Ctx, result: WorkspaceState, reset: boolean) {
  const [bot] = await ctx.db.select({ name: bots.name }).from(bots).where(eq(bots.id, result.botId))
  const name = bot?.name ?? ''
  const body =
    result.state === 'failed'
      ? `${name} 绑定工作区失败：${result.error ?? '未知错误'}`
      : reset
        ? `✓ ${name} 已使用托管工作区`
        : `✓ ${name} 已绑定到 ${result.path}（本机目录）`
  await postEvent(ctx, result.groupId, body)
}
