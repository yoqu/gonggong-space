import type { Ctx } from '../../context.js'
import { audit } from '../../lib/audit.js'
import { postEvent } from '../messages/service.js'

export const ABSOLUTE = /^(\/|[A-Za-z]:[\\/])/

export { requestCd } from './provision.js'

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
      ? '已请求 {bot} 使用托管工作区，等待本机确认…'
      : '已请求 {bot} 绑定到 {path}，等待本机校验…',
    { bot: o.bot.name, path: o.path ?? '' },
  )
}
