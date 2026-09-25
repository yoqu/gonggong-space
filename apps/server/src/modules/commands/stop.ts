import { audit } from '../../lib/audit.js'
import { postEvent } from '../messages/service.js'
import { stopRuns } from '../runs/stop.js'
import type { CommandHandler } from './registry.js'
import { targets } from './system.js'

/** /stop [@bot …] (plan D7): the mentioned bots' unfinished runs, or every one in the group. Any member may stop. */
export const stop: CommandHandler = async (ctx, input) => {
  const { group, user } = input
  const picked = targets(input)
  const stopped = await stopRuns(ctx, { groupId: group.id, botIds: picked.map((b) => b.id) }, user)
  if (!stopped.length) return void (await postEvent(ctx, group.id, '没有运行中的轮次'))
  await audit(ctx, {
    category: 'run',
    actorUserId: user.id,
    action: 'command.stop',
    groupId: group.id,
    detail: { botIds: picked.map((b) => b.id), runIds: stopped.map((r) => r.id) },
  })
  const scope = picked.length ? `停止 ${picked.map((b) => b.name).join('、')} 的 ` : '未 @ Bot，停止本群全部 '
  const chain = stopped.some((r) => r.hop > 1) ? '（含接力链，整条链终止）' : ''
  await postEvent(ctx, group.id, `${user.name} /stop · ${scope}${stopped.length} 个轮次${chain}`)
}
