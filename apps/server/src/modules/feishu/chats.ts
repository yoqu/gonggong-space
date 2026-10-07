import { BindFeishuChatReq, type GroupFeishuView } from '@gonggong/protocol'
import { eq, isNull } from 'drizzle-orm'
import type { FastifyInstance } from 'fastify'
import type { Ctx } from '../../context.js'
import { feishuChats, feishuIdentities } from '../../db/schema.js'
import { audit } from '../../lib/audit.js'
import { fail } from '../../lib/errors.js'
import { requireUser } from '../auth/session.js'
import { activeBots, requireAdmin } from '../groups/service.js'
import { botApp, mainApp } from './apps.js'
import { FeishuError } from './client.js'
import { credsOf } from './gateway.js'
import { boundChat, markBound, unbindChat } from './mirror.js'

type Params = { Params: { id: string } }

/** Feishu's own words for a failed call, as a 共工 error. */
async function feishu<T>(call: Promise<T>) {
  try {
    return await call
  } catch (err) {
    if (!(err instanceof FeishuError)) throw err
    return fail('invalid', '飞书调用失败：{reason}', { reason: err.message })
  }
}

/** `added`: a bot app just added to the chat, which Feishu's chat list may not show yet. */
async function view(ctx: Ctx, groupId: string, added?: string): Promise<GroupFeishuView> {
  const main = await mainApp(ctx)
  if (!main) return { available: false, chat: null, chats: [], bots: [] }
  const chat = await boundChat(ctx.db, groupId)
  const taken = new Set(
    (
      await ctx.db
        .select({ chatId: feishuChats.chatId })
        .from(feishuChats)
        .where(isNull(feishuChats.unboundAt))
    ).map((r) => r.chatId),
  )
  const chats = chat
    ? []
    : (await feishu(ctx.feishu.api.listChats(credsOf(main))))
        .filter((c) => !taken.has(c.chatId))
        .map((c) => ({ chatId: c.chatId, name: c.name }))
  const bots = await Promise.all(
    (await activeBots(ctx, groupId)).map(async (b) => {
      const app = await botApp(ctx, b.id)
      const inChat =
        !!chat &&
        !!app &&
        (app.appId === added ||
          (await ctx.feishu.api.listChats(credsOf(app)).catch(() => [])).some(
            (c) => c.chatId === chat.chatId,
          ))
      return { botId: b.id, name: b.name, appId: app?.appId ?? null, inChat }
    }),
  )
  return {
    available: true,
    chat: chat
      ? { groupId, chatId: chat.chatId, name: chat.name, boundAt: chat.createdAt.toISOString() }
      : null,
    chats,
    bots,
  }
}

/** 群设置 · 飞书: a group admin binds the group to one chat of the main app (one to one) and adds bots' apps to it. */
export function feishuChatRoutes(ctx: Ctx) {
  const admin = async (req: Parameters<typeof requireUser>[1], groupId: string) => {
    const user = await requireUser(ctx, req)
    const { group } = await requireAdmin(ctx, groupId, user.id)
    if (group.kind !== 'group') return fail('invalid', '私聊不能绑定飞书群')
    return { user, group }
  }

  return async (app: FastifyInstance) => {
    app.get<Params>('/api/groups/:id/feishu', async (req) => {
      const { group } = await admin(req, req.params.id)
      return view(ctx, group.id)
    })

    app.put<Params>('/api/groups/:id/feishu', async (req) => {
      const { user, group } = await admin(req, req.params.id)
      const { chatId } = BindFeishuChatReq.parse(req.body)
      const main = (await mainApp(ctx)) ?? fail('invalid', '系统管理员尚未配置飞书主应用')
      if (await boundChat(ctx.db, group.id)) return fail('conflict', '该群已绑定飞书群，请先解绑')
      const chat = (await feishu(ctx.feishu.api.listChats(credsOf(main)))).find((c) => c.chatId === chatId)
      if (!chat) return fail('invalid', '主应用不在该飞书群中')
      // The main app is shared by every team: only someone in the Feishu chat may tie it to their group.
      const [identity] = await ctx.db
        .select({ unionId: feishuIdentities.unionId })
        .from(feishuIdentities)
        .where(eq(feishuIdentities.userId, user.id))
      if (!identity) return fail('invalid', '请先在个人设置中绑定飞书账号')
      if (!(await feishu(ctx.feishu.api.chatMembers(credsOf(main), chatId))).includes(identity.unionId))
        return fail('invalid', '你不在该飞书群中，不能绑定')
      const [row] = await ctx.db
        .insert(feishuChats)
        .values({ groupId: group.id, chatId, name: chat.name, boundBy: user.id, createdAt: ctx.now() })
        .onConflictDoNothing()
        .returning()
      if (!row) return fail('conflict', '该飞书群已绑定其他群')
      markBound(ctx, group.id)
      await audit(ctx, {
        category: 'admin',
        actorUserId: user.id,
        teamId: group.teamId,
        groupId: group.id,
        action: 'feishu.chat.bind',
        detail: { chatId, name: chat.name },
      })
      return view(ctx, group.id)
    })

    app.delete<Params>('/api/groups/:id/feishu', async (req, reply) => {
      const { user, group } = await admin(req, req.params.id)
      const chat = await unbindChat(ctx, group.id)
      if (chat)
        await audit(ctx, {
          category: 'admin',
          actorUserId: user.id,
          teamId: group.teamId,
          groupId: group.id,
          action: 'feishu.chat.unbind',
          detail: { chatId: chat.chatId },
        })
      return reply.status(204).send()
    })

    app.post<{ Params: { id: string; botId: string } }>('/api/groups/:id/feishu/bots/:botId', async (req) => {
      const { group } = await admin(req, req.params.id)
      const chat = (await boundChat(ctx.db, group.id)) ?? fail('invalid', '该群尚未绑定飞书群')
      const inGroup = (await activeBots(ctx, group.id)).some((b) => b.id === req.params.botId)
      const app = inGroup ? await botApp(ctx, req.params.botId) : undefined
      if (!app) return fail('invalid', '该 Bot 没有绑定飞书应用')
      const main = (await mainApp(ctx)) ?? fail('invalid', '系统管理员尚未配置飞书主应用')
      await feishu(ctx.feishu.api.addBot(credsOf(main), chat.chatId, app.appId))
      return view(ctx, group.id, app.appId)
    })
  }
}
