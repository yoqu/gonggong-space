import type { I18nParams, ProtocolKey } from '@gonggong/protocol'
import { audit } from '../../lib/audit.js'
import { postEvent } from '../messages/service.js'
import { stopRuns } from '../runs/stop.js'
import type { CommandHandler } from './registry.js'
import { targets } from './system.js'

/** /stop [@bot …] (plan D7): the mentioned bots' unfinished runs, or every one in the group. Any member may stop. */
export const stop: CommandHandler = async (ctx, input) => {
  const { group, user } = input
  const picked = targets(input)
  // Sent in a thread, /stop stops that thread's runs and answers there (as /new).
  const thread = input.message.threadRootId ?? undefined
  const stopped = await stopRuns(
    ctx,
    { groupId: group.id, botIds: picked.map((b) => b.id), threadRootId: thread },
    user,
  )
  const say = (key: ProtocolKey, params?: I18nParams) => postEvent(ctx, group.id, key, params, {}, thread)
  if (!stopped.length) return void (await say('没有运行中的轮次'))
  await audit(ctx, {
    category: 'run',
    actorUserId: user.id,
    action: 'command.stop',
    groupId: group.id,
    detail: { botIds: picked.map((b) => b.id), runIds: stopped.map((r) => r.id) },
  })
  // A thread's runs are named by their bots, never "every run of the group".
  const named = picked.length
    ? picked
    : thread
      ? input.bots.filter((b) => stopped.some((r) => r.botId === b.id))
      : []
  const params = {
    user: user.name,
    bots: named.map((b) => b.name).join('、'),
    n: stopped.length,
    chain: stopped.some((r) => r.hop > 1) ? { key: '（含接力链，整条链终止）' } : '',
  }
  await say(
    named.length
      ? '{user} /stop · 停止 {bots} 的 {n} 个轮次{chain}'
      : '{user} /stop · 未 @ Bot，停止本群全部 {n} 个轮次{chain}',
    params,
  )
}
