import {
  BindFeishuChatReq,
  CreateGroupFromFeishuReq,
  type FeishuChatChoicesDto,
  type FeishuIssue,
  type GroupFeishuView,
  type GroupFromFeishuDto,
  UpdateFeishuChatReq,
} from '@gonggong/protocol'
import { and, asc, eq, isNull } from 'drizzle-orm'
import type { FastifyInstance } from 'fastify'
import type { Ctx } from '../../context.js'
import { bots, feishuApps, feishuChats, feishuIdentities, groupMembers, users } from '../../db/schema.js'
import { audit } from '../../lib/audit.js'
import { fail } from '../../lib/errors.js'
import { requireUser } from '../auth/session.js'
import { createGroup } from '../groups/create.js'
import { activeBots, groupDto, publishGroup, requireAdmin } from '../groups/service.js'
import { postEvent } from '../messages/service.js'
import { currentTeam } from '../teams/service.js'
import { botApp, mainApp } from './apps.js'
import { type FeishuChat, FeishuError } from './client.js'
import { credsOf } from './gateway.js'
import { botIssue, failFeishu, hintParams, issueOf, setBotIssue } from './issues.js'
import { joinFromFeishu, syncFromFeishu } from './members.js'
import { boundChat, markBound, unbindChat } from './mirror.js'

type Params = { Params: { id: string } }

/** Feishu's code for a call the app has no scope for. */
const NO_SCOPE = 99991672

/** A failed Feishu call as a 共工 error in plain words. */
async function feishu<T>(call: Promise<T>) {
  try {
    return await call
  } catch (err) {
    if (!(err instanceof FeishuError)) throw err
    return failFeishu('飞书调用失败', issueOf(err))
  }
}

/** The main app's bot name, to tell users which bot a chat needs; null when Feishu does not say. */
const mainAppName = (ctx: Ctx, main: FeishuAppRow) =>
  ctx.feishu.api.appName(credsOf(main)).catch((err) => {
    if (!(err instanceof FeishuError)) throw err
    return null
  })

/** Group members in join order, with their Feishu union id when linked. */
const linkedMembers = (ctx: Ctx, groupId: string) =>
  ctx.db
    .select({ userId: users.id, name: users.name, unionId: feishuIdentities.unionId })
    .from(groupMembers)
    .innerJoin(users, eq(users.id, groupMembers.userId))
    .leftJoin(feishuIdentities, eq(feishuIdentities.userId, users.id))
    .where(eq(groupMembers.groupId, groupId))
    .orderBy(asc(groupMembers.joinedAt))

type FeishuAppRow = NonNullable<Awaited<ReturnType<typeof mainApp>>>

async function unionIdOf(ctx: Ctx, userId: string) {
  const [row] = await ctx.db
    .select({ unionId: feishuIdentities.unionId })
    .from(feishuIdentities)
    .where(eq(feishuIdentities.userId, userId))
  return row?.unionId
}

async function boundChatIds(ctx: Ctx) {
  const rows = await ctx.db
    .select({ chatId: feishuChats.chatId })
    .from(feishuChats)
    .where(isNull(feishuChats.unboundAt))
  return new Set(rows.map((r) => r.chatId))
}

/**
 * The main app's chats `userId` is in and no group has bound yet: the ones they may bind or create a group from.
 * The main app is shared by every team, so chats the user is not in stay hidden (their names may be another team's).
 */
export async function bindableChats(ctx: Ctx, main: FeishuAppRow, userId: string, all?: FeishuChat[]) {
  const me = await unionIdOf(ctx, userId)
  if (!me) return []
  const taken = await boundChatIds(ctx)
  const free = (all ?? (await feishu(ctx.feishu.api.listChats(credsOf(main))))).filter(
    (c) => !taken.has(c.chatId),
  )
  const mine = await Promise.all(
    free.map(async (c) => (await feishu(ctx.feishu.api.chatMembers(credsOf(main), c.chatId))).includes(me)),
  )
  return free.filter((_, i) => mine[i])
}

/** The checks before tying `chatId` to a group (bind, or create a group from it); returns the chat and its users. */
export async function checkBindable(ctx: Ctx, userId: string, chatId: string) {
  const main = (await mainApp(ctx)) ?? fail('invalid', '系统管理员尚未接入飞书')
  const chat = (await feishu(ctx.feishu.api.listChats(credsOf(main)))).find((c) => c.chatId === chatId)
  if (!chat) return fail('invalid', '共工机器人不在该飞书群中')
  if ((await boundChatIds(ctx)).has(chatId)) return fail('conflict', '该飞书群已关联其他群')
  // The main app is shared by every team: only someone in the Feishu chat may tie it to their group.
  const me = (await unionIdOf(ctx, userId)) ?? fail('invalid', '请先在个人设置中绑定飞书账号')
  const members = await feishu(ctx.feishu.api.chatMembers(credsOf(main), chatId))
  if (!members.includes(me)) return fail('invalid', '你不在该飞书群中，不能关联')
  return { main, chat, members }
}

/** The team's bots whose own app is in the chat (Feishu leaves bots out of chat members, so each app is asked). */
async function botsInChat(ctx: Ctx, teamId: string, chatId: string) {
  const apps = await ctx.db
    .select({ app: feishuApps, botId: bots.id })
    .from(feishuApps)
    .innerJoin(bots, eq(bots.id, feishuApps.botId))
    .where(and(eq(bots.teamId, teamId), isNull(bots.deletedAt)))
  const inChat = await Promise.all(
    apps.map(async (a) =>
      (await ctx.feishu.api.listChats(credsOf(a.app)).catch(() => [])).some((c) => c.chatId === chatId),
    ),
  )
  return apps.filter((_, i) => inChat[i]).map((a) => a.botId)
}

/** Whether a bot app is in the chat (Feishu leaves bots out of chat members, so the app itself is asked). */
const appInChat = async (ctx: Ctx, app: Parameters<typeof credsOf>[0], chatId: string) =>
  (await ctx.feishu.api.listChats(credsOf(app)).catch(() => [])).some((c) => c.chatId === chatId)

/** Adds one bot app to the chat through the main app; a refusal is kept as the bot's issue (null once it got in). */
async function addBotApp(
  ctx: Ctx,
  groupId: string,
  main: FeishuAppRow,
  chatId: string,
  botId: string,
  appId: string,
) {
  const issue = await ctx.feishu.api.addBot(credsOf(main), chatId, appId).then(
    () => null,
    (err) => {
      if (!(err instanceof FeishuError)) throw err
      return issueOf(err)
    },
  )
  setBotIssue(ctx, groupId, botId, issue)
  return issue
}

/**
 * Adds the group's bot apps missing from the chat (or only `botId`'s), one by one; one that cannot join keeps its
 * reason for 群设置 · 飞书 to show with a retry. Returns the app ids added and the refused bots.
 */
async function pullBots(ctx: Ctx, groupId: string, main: FeishuAppRow, chatId: string, botId?: string) {
  const added: string[] = []
  const refused: { name: string; botId: string; issue: FeishuIssue }[] = []
  for (const b of await activeBots(ctx, groupId)) {
    if (botId && b.id !== botId) continue
    const app = await botApp(ctx, b.id)
    if (!app) continue
    if (await appInChat(ctx, app, chatId)) {
      setBotIssue(ctx, groupId, b.id, null)
      continue
    }
    const issue = await addBotApp(ctx, groupId, main, chatId, b.id, app.appId)
    if (issue) refused.push({ name: b.name, botId: b.id, issue })
    else added.push(app.appId)
  }
  return { added, refused }
}

/** A bot added to a bound group joins its Feishu chat; when Feishu refuses, the group is told why. */
export async function pullBotIntoChat(ctx: Ctx, groupId: string, botId: string) {
  const chat = await boundChat(ctx.db, groupId)
  const main = chat && (await mainApp(ctx))
  if (!chat || !main) return
  const { refused } = await pullBots(ctx, groupId, main, chat.chatId, botId)
  for (const r of refused)
    await postEvent(
      ctx,
      groupId,
      '{bot} 没能自动拉入飞书群：{what}{todo}',
      { bot: r.name, ...hintParams(r.issue) },
      { feishuIssue: { botId: r.botId, ...r.issue } },
    )
}

/** `added`: bot apps just added to the chat, which Feishu's chat list may not show yet. */
async function view(
  ctx: Ctx,
  groupId: string,
  userId: string,
  added: string[] = [],
): Promise<GroupFeishuView> {
  const main = await mainApp(ctx)
  if (!main) return { available: false, mainAppName: null, chat: null, chats: [], bots: [], members: [] }
  let chat = await boundChat(ctx.db, groupId)
  const all = await feishu(ctx.feishu.api.listChats(credsOf(main)))
  // Renamed on Feishu since binding: the stored name follows, so the group can offer to match it.
  const current = chat && all.find((c) => c.chatId === chat?.chatId)
  if (chat && current && current.name !== chat.name) {
    ;[chat] = await ctx.db
      .update(feishuChats)
      .set({ name: current.name })
      .where(eq(feishuChats.id, chat.id))
      .returning()
    await publishGroup(ctx, groupId)
  }
  const chats = chat
    ? []
    : (await bindableChats(ctx, main, userId, all)).map((c) => ({ chatId: c.chatId, name: c.name }))
  const bots = await Promise.all(
    (await activeBots(ctx, groupId)).map(async (b) => {
      const app = await botApp(ctx, b.id)
      const inChat =
        !!chat && !!app && (added.includes(app.appId) || (await appInChat(ctx, app, chat.chatId)))
      return {
        botId: b.id,
        name: b.name,
        appId: app?.appId ?? null,
        inChat,
        issue: app && !inChat ? botIssue(ctx, groupId, b.id) : null,
      }
    }),
  )
  return {
    available: true,
    mainAppName: await mainAppName(ctx, main),
    chat: chat
      ? {
          groupId,
          chatId: chat.chatId,
          name: chat.name,
          boundAt: chat.createdAt.toISOString(),
          syncOutbound: chat.syncOutbound,
          syncAll: chat.syncAll,
        }
      : null,
    chats,
    bots,
    members: (await linkedMembers(ctx, groupId)).map((m) => ({
      userId: m.userId,
      name: m.name,
      linked: !!m.unionId,
    })),
  }
}

/** 创建飞书群 calls in flight: the main app's 进群 card waits for them, so the chat it just created is bound first. */
export const creatingChats = new Set<Promise<unknown>>()
const tracked = <T>(run: () => Promise<T>) => {
  const p = run()
  creatingChats.add(p)
  return p.finally(() => creatingChats.delete(p))
}

/** Feishu takes at most this many users and bots when creating a chat; the rest are added after. */
const CREATE_USERS = 50
const CREATE_BOTS = 5

/** 群设置 · 飞书: a group admin binds the group to one chat of the main app (one to one) and adds bots' apps to it. */
export function feishuChatRoutes(ctx: Ctx) {
  const admin = async (req: Parameters<typeof requireUser>[1], groupId: string) => {
    const user = await requireUser(ctx, req)
    const { group } = await requireAdmin(ctx, groupId, user.id)
    if (group.kind !== 'group') return fail('invalid', '私聊不能关联飞书群')
    return { user, group }
  }

  return async (app: FastifyInstance) => {
    app.get('/api/feishu/chats', async (req): Promise<FeishuChatChoicesDto> => {
      const user = await requireUser(ctx, req)
      const main = await mainApp(ctx)
      if (!main) return { available: false, mainAppName: null, chats: [] }
      const chats = await bindableChats(ctx, main, user.id)
      return {
        available: true,
        mainAppName: await mainAppName(ctx, main),
        chats: chats.map((c) => ({ chatId: c.chatId, name: c.name })),
      }
    })

    // 从飞书群创建: a group of the current team bound to the chat, with its linked users and the bots whose app is in it.
    app.post('/api/groups/from-feishu', async (req): Promise<GroupFromFeishuDto> => {
      const user = await requireUser(ctx, req)
      const teamId = await currentTeam(ctx, req, user.id)
      const { chatId, name } = CreateGroupFromFeishuReq.parse(req.body)
      const { chat, members } = await checkBindable(ctx, user.id, chatId)
      const botIds = await botsInChat(ctx, teamId, chatId)
      const groupId = await createGroup(
        ctx,
        user,
        teamId,
        { name, kind: 'group', memberIds: [], botIds, repo: null },
        async (tx, groupId) => {
          const [row] = await tx
            .insert(feishuChats)
            .values({ groupId, chatId, name: chat.name, boundBy: user.id, createdAt: ctx.now() })
            .onConflictDoNothing()
            .returning()
          if (!row) fail('conflict', '该飞书群已关联其他群')
        },
      )
      markBound(ctx, groupId)
      const sync = await syncFromFeishu(ctx, { id: groupId, teamId }, members)
      await audit(ctx, {
        category: 'admin',
        actorUserId: user.id,
        teamId,
        groupId,
        action: 'feishu.chat.create_group',
        detail: { chatId, name: chat.name },
      })
      return { ...sync, group: await groupDto(ctx, user.id, groupId) }
    })

    app.get<Params>('/api/groups/:id/feishu', async (req) => {
      const { user, group } = await admin(req, req.params.id)
      return view(ctx, group.id, user.id)
    })

    app.put<Params>('/api/groups/:id/feishu', async (req) => {
      const { user, group } = await admin(req, req.params.id)
      const { chatId } = BindFeishuChatReq.parse(req.body)
      if (await boundChat(ctx.db, group.id)) return fail('conflict', '该群已关联飞书群，请先取消关联')
      const { main, chat, members } = await checkBindable(ctx, user.id, chatId)
      const [row] = await ctx.db
        .insert(feishuChats)
        .values({ groupId: group.id, chatId, name: chat.name, boundBy: user.id, createdAt: ctx.now() })
        .onConflictDoNothing()
        .returning()
      if (!row) return fail('conflict', '该飞书群已关联其他群')
      markBound(ctx, group.id)
      await joinFromFeishu(ctx, group, members)
      const { added } = await pullBots(ctx, group.id, main, chatId)
      await publishGroup(ctx, group.id)
      await audit(ctx, {
        category: 'admin',
        actorUserId: user.id,
        teamId: group.teamId,
        groupId: group.id,
        action: 'feishu.chat.bind',
        detail: { chatId, name: chat.name },
      })
      return view(ctx, group.id, user.id, added)
    })

    app.patch<Params>('/api/groups/:id/feishu', async (req) => {
      const { user, group } = await admin(req, req.params.id)
      const sync = UpdateFeishuChatReq.parse(req.body)
      const chat = (await boundChat(ctx.db, group.id)) ?? fail('invalid', '该群尚未关联飞书群')
      if (Object.keys(sync).length)
        await ctx.db.update(feishuChats).set(sync).where(eq(feishuChats.id, chat.id))
      await audit(ctx, {
        category: 'admin',
        actorUserId: user.id,
        teamId: group.teamId,
        groupId: group.id,
        action: 'feishu.chat.sync',
        detail: { chatId: chat.chatId, ...sync },
      })
      return view(ctx, group.id, user.id)
    })

    // 创建飞书群: a chat owned by the admin with the group's linked members and bot apps, bound to the group.
    app.post<Params>('/api/groups/:id/feishu/chat', (req) =>
      tracked(async () => {
        const { user, group } = await admin(req, req.params.id)
        const main = (await mainApp(ctx)) ?? fail('invalid', '系统管理员尚未接入飞书')
        if (await boundChat(ctx.db, group.id)) return fail('conflict', '该群已关联飞书群，请先取消关联')
        const members = await linkedMembers(ctx, group.id)
        const owner = members.find((m) => m.userId === user.id)?.unionId
        if (!owner) return fail('invalid', '请先在个人设置中绑定飞书账号')
        const unionIds = members.flatMap((m) => (m.unionId && m.unionId !== owner ? [m.unionId] : []))
        const apps: { botId: string; appId: string }[] = []
        for (const b of await activeBots(ctx, group.id)) {
          const app = await botApp(ctx, b.id)
          if (app) apps.push({ botId: b.id, appId: app.appId })
        }
        const appIds = apps.map((a) => a.appId)
        const name = group.name.slice(0, 60)
        const chatId = await ctx.feishu.api
          .createChat(credsOf(main), {
            name,
            ownerUnionId: owner,
            unionIds: unionIds.slice(0, CREATE_USERS),
            botAppIds: appIds.slice(0, CREATE_BOTS),
          })
          .catch((err) =>
            err instanceof FeishuError && err.code === NO_SCOPE
              ? fail(
                  'invalid',
                  '飞书主应用没有建群权限，请系统管理员在飞书开放平台为主应用开通 im:chat:create 并发布版本',
                )
              : feishu(Promise.reject(err)),
          )
        const [row] = await ctx.db
          .insert(feishuChats)
          .values({ groupId: group.id, chatId, name, boundBy: user.id, createdAt: ctx.now() })
          .onConflictDoNothing()
          .returning()
        if (!row) return fail('conflict', '该群已关联飞书群，请先取消关联')
        markBound(ctx, group.id)
        for (let i = CREATE_USERS; i < unionIds.length; i += CREATE_USERS)
          await feishu(ctx.feishu.api.addUsers(credsOf(main), chatId, unionIds.slice(i, i + CREATE_USERS)))
        // One by one: a bot that cannot join (e.g. the chat's bot limit) shows why, with a retry, in the list below.
        for (const a of apps.slice(CREATE_BOTS))
          await addBotApp(ctx, group.id, main, chatId, a.botId, a.appId)
        await publishGroup(ctx, group.id)
        await audit(ctx, {
          category: 'admin',
          actorUserId: user.id,
          teamId: group.teamId,
          groupId: group.id,
          action: 'feishu.chat.create',
          detail: { chatId, name },
        })
        return view(ctx, group.id, user.id)
      }),
    )

    app.delete<Params>('/api/groups/:id/feishu', async (req, reply) => {
      const { user, group } = await admin(req, req.params.id)
      const chat = await unbindChat(ctx, group.id)
      if (chat) {
        await audit(ctx, {
          category: 'admin',
          actorUserId: user.id,
          teamId: group.teamId,
          groupId: group.id,
          action: 'feishu.chat.unbind',
          detail: { chatId: chat.chatId },
        })
        await publishGroup(ctx, group.id)
      }
      return reply.status(204).send()
    })

    app.post<Params>('/api/groups/:id/feishu/sync-members', async (req) => {
      const { group } = await admin(req, req.params.id)
      const chat = (await boundChat(ctx.db, group.id)) ?? fail('invalid', '该群尚未关联飞书群')
      const main = (await mainApp(ctx)) ?? fail('invalid', '系统管理员尚未接入飞书')
      return syncFromFeishu(ctx, group, await feishu(ctx.feishu.api.chatMembers(credsOf(main), chat.chatId)))
    })

    app.post<{ Params: { id: string; botId: string } }>('/api/groups/:id/feishu/bots/:botId', async (req) => {
      const { user, group } = await admin(req, req.params.id)
      const chat = (await boundChat(ctx.db, group.id)) ?? fail('invalid', '该群尚未关联飞书群')
      const inGroup = (await activeBots(ctx, group.id)).some((b) => b.id === req.params.botId)
      const app = inGroup ? await botApp(ctx, req.params.botId) : undefined
      if (!app) return fail('invalid', '该 Bot 还没有接入飞书应用')
      const main = (await mainApp(ctx)) ?? fail('invalid', '系统管理员尚未接入飞书')
      const issue = await addBotApp(ctx, group.id, main, chat.chatId, req.params.botId, app.appId)
      if (issue) return failFeishu('拉入飞书群失败', issue)
      return view(ctx, group.id, user.id, [app.appId])
    })
  }
}
