import { type FeishuProjectChatDto, FeishuProjectChatReq } from '@gonggong/protocol'
import { and, asc, eq, isNull, ne, sql } from 'drizzle-orm'
import type { FastifyInstance } from 'fastify'
import type { Ctx } from '../../context.js'
import { feishuChats, feishuIdentities, groups, teamMembers, users } from '../../db/schema.js'
import { audit } from '../../lib/audit.js'
import { fail, HttpError } from '../../lib/errors.js'
import { mainApp } from '../feishu/apps.js'
import { botsInChat } from '../feishu/chats.js'
import { FeishuError } from '../feishu/client.js'
import { credsOf } from '../feishu/gateway.js'
import { boundGroupOf, syncFromFeishu } from '../feishu/members.js'
import { markBound } from '../feishu/mirror.js'
import { createGroup } from '../groups/create.js'
import { publishGroup } from '../groups/service.js'
import { setNotice } from '../groups/settings.js'
import { integrationTeam } from './tokens.js'

/** Feishu failing is worth retrying, unlike a bad request. */
const feishu = <T>(call: Promise<T>) =>
  call.catch((err) =>
    err instanceof FeishuError
      ? fail('unavailable', '飞书调用失败：{reason}', { reason: err.message })
      : Promise.reject(err),
  )

/** Who owns the new group: the chat's owner when they are an enabled member of the team, else its earliest admin. */
async function ownerOf(ctx: Ctx, teamId: string, ownerUnionId: string | undefined) {
  const inTeam = and(eq(teamMembers.teamId, teamId), eq(teamMembers.userId, users.id))
  const [owner] = ownerUnionId
    ? await ctx.db
        .select({ id: users.id, name: users.name })
        .from(feishuIdentities)
        .innerJoin(users, eq(users.id, feishuIdentities.userId))
        .innerJoin(teamMembers, inTeam)
        .where(and(eq(feishuIdentities.unionId, ownerUnionId), isNull(users.disabledAt)))
    : []
  if (owner) return owner
  const [admin] = await ctx.db
    .select({ id: users.id, name: users.name })
    .from(teamMembers)
    .innerJoin(users, inTeam)
    .where(and(eq(teamMembers.teamId, teamId), ne(teamMembers.role, 'member'), isNull(users.disabledAt)))
    .orderBy(sql`${teamMembers.role} <> 'owner'`, asc(teamMembers.joinedAt))
    .limit(1)
  return admin ?? fail('conflict', '团队没有可用的管理员')
}

/** The bound group of the chat filed under `section` for its members; another team's group reads as a conflict. */
async function existing(ctx: Ctx, teamId: string, chatId: string, section: string | undefined) {
  const bound = await boundGroupOf(ctx, chatId)
  if (!bound) return null
  if (bound.teamId !== teamId) return fail('forbidden', '该飞书群已关联其他团队的群')
  if (section) {
    await ctx.db.update(groups).set({ defaultSection: section }).where(eq(groups.id, bound.id))
    await publishGroup(ctx, bound.id)
  }
  return bound.id
}

/**
 * 飞书项目: the plugin pulls the main app into a work item's Feishu chat, then asks for its 共工 group. Built like
 * 从飞书群创建 (bound chat, linked team users, team bots already in the chat) without a person signed in.
 */
export function feishuProjectRoutes(ctx: Ctx) {
  return async (app: FastifyInstance) => {
    app.post('/api/integrations/feishu-project/chats', async (req): Promise<FeishuProjectChatDto> => {
      const teamId = integrationTeam(ctx.config.feishuProjectTokens, req)
      const { feishuChatId: chatId, section, workItem } = FeishuProjectChatReq.parse(req.body)
      const found = await existing(ctx, teamId, chatId, section)
      if (found) return { groupId: found, created: false }

      const main = (await mainApp(ctx)) ?? fail('unavailable', '系统管理员尚未接入飞书')
      const chat = (await feishu(ctx.feishu.api.listChats(credsOf(main)))).find((c) => c.chatId === chatId)
      if (!chat) return fail('conflict', '共工机器人不在该飞书群中')
      const members = await feishu(ctx.feishu.api.chatMembers(credsOf(main), chatId))
      const owner = await ownerOf(ctx, teamId, chat.ownerUnionId)
      const botIds = await botsInChat(ctx, teamId, chatId)
      const name = (chat.name || workItem.name || chatId).slice(0, 60)
      let groupId: string
      try {
        groupId = await createGroup(
          ctx,
          owner,
          teamId,
          { name, kind: 'group', memberIds: [], botIds, repo: null },
          async (tx, id) => {
            const [row] = await tx
              .insert(feishuChats)
              .values({ groupId: id, chatId, name: chat.name, boundBy: owner.id, createdAt: ctx.now() })
              .onConflictDoNothing()
              .returning()
            if (!row) fail('conflict', '该飞书群已关联其他群')
            if (section) await tx.update(groups).set({ defaultSection: section }).where(eq(groups.id, id))
          },
        )
      } catch (err) {
        // A concurrent call bound the chat first: answer as the retry it is.
        const raced =
          err instanceof HttpError &&
          err.code === 'conflict' &&
          (await existing(ctx, teamId, chatId, section))
        if (raced) return { groupId: raced, created: false }
        throw err
      }
      markBound(ctx, groupId)
      await setNotice(ctx, groupId, `需求：${workItem.name}\n${workItem.url}`, owner.id)
      await syncFromFeishu(ctx, { id: groupId, teamId }, members)
      await publishGroup(ctx, groupId)
      await audit(ctx, {
        category: 'admin',
        actorUserId: owner.id,
        teamId,
        groupId,
        action: 'feishu.project.create_group',
        detail: { chatId, name, workItem },
      })
      return { groupId, created: true }
    })
  }
}
