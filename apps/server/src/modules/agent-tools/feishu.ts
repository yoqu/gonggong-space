import type { GONGGONG_TOOLS } from '@gonggong/protocol'
import { eq, inArray } from 'drizzle-orm'
import type { z } from 'zod'
import type { Ctx } from '../../context.js'
import { bots, feishuApps, feishuIdentities, type runs, users } from '../../db/schema.js'
import { mainApp } from '../feishu/apps.js'
import { FeishuError, type FeishuHistoryItem } from '../feishu/client.js'
import { credsOf } from '../feishu/gateway.js'
import { userToken } from '../feishu/identity.js'
import { parseContent } from '../feishu/inbound.js'
import { boundChat } from '../feishu/mirror.js'
import { refuse, type ToolOutput } from './service.js'

type Args = z.infer<(typeof GONGGONG_TOOLS)['list_feishu_messages']['input']>

const BODY_MAX = 2000
const time = (d: Date) => d.toISOString().slice(0, 16).replace('T', ' ')
/** Appended to the bot's instructions in groups bound to a Feishu chat (plan §2.6). */
export const FEISHU_HINT =
  '本群已绑定飞书群，飞书里只有与 Bot 交互的消息会同步过来；需要了解飞书群里此前的讨论时，用 gonggong 的 list_feishu_messages 读取，不要猜。'

const clip = (s: string) =>
  s.length > BODY_MAX ? `${s.slice(0, BODY_MAX)}…（已截断，共 ${s.length} 字）` : s

/** Readable text of a Feishu message body; files and cards become a short placeholder. */
function plain(m: FeishuHistoryItem) {
  const { body, files } = parseContent(m.msgType, m.content)
  const line = body.replace(/\s*\n\s*/g, ' ')
  if (m.msgType === 'interactive') return '[卡片]'
  const marks = files.map((f) => (f.type === 'image' ? '[图片]' : `[文件 ${f.name}]`))
  return [line, ...marks].filter(Boolean).join(' ')
}

/** Names for senders: linked users by their main-app open_id, our apps by their bot. */
async function authors(ctx: Ctx, items: FeishuHistoryItem[]) {
  const ids = (type: FeishuHistoryItem['senderType']) => [
    ...new Set(items.filter((m) => m.senderType === type).map((m) => m.senderId)),
  ]
  const people = ids('user').length
    ? await ctx.db
        .select({ id: feishuIdentities.openId, name: users.name })
        .from(feishuIdentities)
        .innerJoin(users, eq(users.id, feishuIdentities.userId))
        .where(inArray(feishuIdentities.openId, ids('user')))
    : []
  const apps = ids('app').length
    ? await ctx.db
        .select({ id: feishuApps.appId, name: bots.name })
        .from(feishuApps)
        .leftJoin(bots, eq(bots.id, feishuApps.botId))
        .where(inArray(feishuApps.appId, ids('app')))
    : []
  const names = new Map([...people, ...apps].map((r) => [r.id, r.name ?? '共工']))
  return (m: FeishuHistoryItem) =>
    names.get(m.senderId) ?? `${m.senderType === 'app' ? '飞书应用' : '飞书用户'}（${m.senderId}）`
}

/** Plan F5: reads the bound chat live as the run's initiator; nothing is stored. */
export async function listFeishuMessages(
  ctx: Ctx,
  run: typeof runs.$inferSelect,
  a: Args,
): Promise<ToolOutput> {
  const before = a.before === undefined ? undefined : new Date(a.before)
  if (before && Number.isNaN(before.getTime())) refuse(`时间格式无效：${a.before}`)
  const chat = (await boundChat(ctx.db, run.groupId)) ?? refuse('当前群未绑定飞书群，无法读取飞书消息')
  const app = (await mainApp(ctx)) ?? refuse('系统未配置飞书主应用，无法读取飞书消息')
  const token = await userToken(ctx, run.originUserId)
  if (token === null) {
    const [u] = await ctx.db.select({ name: users.name }).from(users).where(eq(users.id, run.originUserId))
    return refuse(`触发人「${u?.name ?? ''}」尚未绑定飞书账号（或授权已失效），无法以其身份读取飞书消息`)
  }
  const limit = a.limit ?? 20
  const items = await ctx.feishu.api
    .listMessages(credsOf(app), chat.chatId, token, { before, limit })
    .catch((err) =>
      err instanceof FeishuError ? refuse(`飞书拒绝读取：${err.message}`) : Promise.reject(err),
    )
  const first = items[0]
  if (!first) return { text: '没有符合条件的飞书消息', groups: [] }
  const author = await authors(ctx, items)
  const out = [
    `飞书群「${chat.name}」最近 ${items.length} 条（实时读取，未保存）`,
    ...items.map((m) => `[${time(m.createdAt)}] ${author(m)}: ${clip(plain(m))}`),
  ]
  if (items.length === limit) out.push(`更早：before=${first.createdAt.toISOString()}`)
  return { text: out.join('\n'), groups: [] }
}
