import { type FeishuProjectChatDto, FeishuProjectChatReq } from '@gonggong/protocol'
import { and, asc, eq, inArray, isNull, ne, sql } from 'drizzle-orm'
import type { FastifyInstance } from 'fastify'
import type { z } from 'zod'
import type { Ctx } from '../../context.js'
import {
  bots,
  feishuChats,
  feishuIdentities,
  groups,
  teamMembers,
  teamSections,
  users,
} from '../../db/schema.js'
import { audit } from '../../lib/audit.js'
import { fail, HttpError } from '../../lib/errors.js'
import { mainApp } from '../feishu/apps.js'
import { botsInChat } from '../feishu/chats.js'
import { FeishuError } from '../feishu/client.js'
import { credsOf } from '../feishu/gateway.js'
import { boundGroupOf, syncFromFeishu } from '../feishu/members.js'
import { markBound } from '../feishu/mirror.js'
import { createGroup } from '../groups/create.js'
import { forgetGroupParams } from '../groups/params.js'
import { publishGroup } from '../groups/service.js'
import { setNotice } from '../groups/settings.js'
import { publishDirectory } from '../team-sections/routes.js'
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

type Req = z.output<typeof FeishuProjectChatReq>

/** The 团队分区 named `name` in the team; an unknown name is refused rather than filed nowhere. */
async function teamSectionId(ctx: Ctx, teamId: string, name: string) {
  const [row] = await ctx.db
    .select({ id: teamSections.id })
    .from(teamSections)
    .where(and(eq(teamSections.teamId, teamId), eq(teamSections.name, name)))
    .orderBy(asc(teamSections.position), asc(teamSections.createdAt))
    .limit(1)
  return row?.id ?? fail('invalid', '团队分区「{name}」不存在', { name })
}

/** Team bots by name; unknown or deleted names are left out. */
async function botsNamed(ctx: Ctx, teamId: string, names: string[]) {
  if (!names.length) return []
  const rows = await ctx.db
    .select({ id: bots.id })
    .from(bots)
    .where(and(eq(bots.teamId, teamId), inArray(bots.name, names), isNull(bots.deletedAt)))
  return rows.map((r) => r.id)
}

/** The bound group of the chat; another team's group reads as a conflict. */
async function existing(ctx: Ctx, teamId: string, chatId: string) {
  const bound = await boundGroupOf(ctx, chatId)
  if (!bound) return null
  if (bound.teamId !== teamId) return fail('forbidden', '该飞书群已关联其他团队的群')
  return bound.id
}

/** Section and settings asked for, applied to a new or an already bound group alike. */
async function apply(ctx: Ctx, teamId: string, groupId: string, req: Req, sectionId: string | undefined) {
  const params = {
    ...(req.replyStyle && { replyStyle: req.replyStyle }),
    ...(req.botRepliesInThread !== undefined && { botRepliesInThread: req.botRepliesInThread }),
  }
  const set = {
    ...(sectionId ? { teamSectionId: sectionId } : req.section ? { defaultSection: req.section } : {}),
    ...(Object.keys(params).length
      ? { params: sql`${groups.params} || ${JSON.stringify(params)}::jsonb` }
      : {}),
  }
  if (!Object.keys(set).length) return
  await ctx.db.update(groups).set(set).where(eq(groups.id, groupId))
  forgetGroupParams(ctx.db, groupId)
  await publishGroup(ctx, groupId)
  if (sectionId) await publishDirectory(ctx, teamId)
}

/**
 * 飞书项目: the plugin pulls the main app into a work item's Feishu chat, then asks for its 共工 group. Built like
 * 从飞书群创建 (bound chat, linked team users, team bots already in the chat) without a person signed in.
 */
export function feishuProjectRoutes(ctx: Ctx) {
  return async (app: FastifyInstance) => {
    app.post('/api/integrations/feishu-project/chats', async (req): Promise<FeishuProjectChatDto> => {
      const teamId = integrationTeam(ctx.config.feishuProjectTokens, req)
      const body = FeishuProjectChatReq.parse(req.body)
      const { feishuChatId: chatId, workItem } = body
      const sectionId = body.teamSection ? await teamSectionId(ctx, teamId, body.teamSection) : undefined
      const found = await existing(ctx, teamId, chatId)
      if (found) {
        await apply(ctx, teamId, found, body, sectionId)
        return { groupId: found, created: false }
      }

      const main = (await mainApp(ctx)) ?? fail('unavailable', '系统管理员尚未接入飞书')
      const chat = (await feishu(ctx.feishu.api.listChats(credsOf(main)))).find((c) => c.chatId === chatId)
      if (!chat) return fail('conflict', '共工机器人不在该飞书群中')
      const members = await feishu(ctx.feishu.api.chatMembers(credsOf(main), chatId))
      const owner = await ownerOf(ctx, teamId, chat.ownerUnionId)
      const botIds = [
        ...new Set([
          ...(await botsInChat(ctx, teamId, chatId)),
          ...(await botsNamed(ctx, teamId, body.botNames ?? [])),
        ]),
      ]
      const name = (chat.name || workItem.name || chatId).slice(0, 60)
      let groupId: string
      try {
        groupId = await createGroup(
          ctx,
          owner,
          teamId,
          { name, kind: 'group', memberIds: [], botIds, repo: body.repo ?? null },
          async (tx, id) => {
            const [row] = await tx
              .insert(feishuChats)
              .values({ groupId: id, chatId, name: chat.name, boundBy: owner.id, createdAt: ctx.now() })
              .onConflictDoNothing()
              .returning()
            if (!row) fail('conflict', '该飞书群已关联其他群')
          },
        )
      } catch (err) {
        // A concurrent call bound the chat first: answer as the retry it is.
        const raced =
          err instanceof HttpError && err.code === 'conflict' && (await existing(ctx, teamId, chatId))
        if (raced) {
          await apply(ctx, teamId, raced, body, sectionId)
          return { groupId: raced, created: false }
        }
        throw err
      }
      await apply(ctx, teamId, groupId, body, sectionId)
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
