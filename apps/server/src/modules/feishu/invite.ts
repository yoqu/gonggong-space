import type { Ctx } from '../../context.js'
import { translator } from '../../i18n/index.js'
import { noticeCard } from './cards.js'
import { creatingChats } from './chats.js'
import { credsOf, type FeishuAppRow, onFeishu } from './gateway.js'
import { publicUrl } from './identity.js'
import { boundGroupOf } from './members.js'

const zt = translator('zh')

/**
 * How long the main app waits after joining a chat before offering to create its group: an integration (飞书项目)
 * that pulled it in creates and binds the group itself meanwhile.
 */
export const inviteDelay = { ms: 30_000 }
const pending = new Set<Promise<unknown>>()
/** Waits for the 进群 cards still waiting out `inviteDelay` (tests). */
export const settleInvites = () => Promise.allSettled([...pending])

/**
 * 主应用进群: a chat no group is bound to gets a card opening 从飞书群创建 with the chat preselected, where a new group
 * is created or one the clicker administers is linked. The main app serves every team, so the team (and who may
 * create or link) is decided in 共工, not here.
 */
export function startFeishuInvite(ctx: Ctx) {
  onFeishu(ctx, 'im.chat.member.bot.added_v1', async (app, ev) => {
    const chatId = ev.chat_id
    if (app.kind !== 'main' || !chatId) return
    // The event is answered right away; Feishu redelivers events whose handler runs long.
    const run = new Promise((r) => setTimeout(r, inviteDelay.ms).unref())
      .then(() => invite(ctx, app, chatId))
      .catch((err) => console.error('feishu invite card:', err))
      .finally(() => pending.delete(run))
    pending.add(run)
  })
}

async function invite(ctx: Ctx, app: FeishuAppRow, chatId: string) {
  // A chat 创建飞书群 just made is bound once that request finishes.
  await Promise.allSettled([...creatingChats])
  const base = await publicUrl(ctx)
  if (await boundGroupOf(ctx, chatId)) return
  const card = base
    ? noticeCard(
        zt(
          '这个飞书群还没有接入共工。点下方按钮新建或关联已有的共工群，已绑定飞书账号的成员会自动加入，之后在群里 @Bot 即可使用。',
        ),
        { label: zt('接入共工'), url: `${base}/?feishuChat=${encodeURIComponent(chatId)}` },
      )
    : noticeCard(zt('这个飞书群还没有接入共工。请在共工的群设置 › 飞书里关联本群。'))
  await ctx.feishu.api.send(credsOf(app), chatId, {
    msgType: 'interactive',
    content: JSON.stringify(card),
  })
}
