import { and, eq, inArray, isNull } from 'drizzle-orm'
import type { Ctx } from '../../context.js'
import { feishuChats, feishuIdentities, groupMembers, groups, teamMembers, users } from '../../db/schema.js'
import { publishGroup, removeMember } from '../groups/service.js'
import { forgetMembers, postEvent } from '../messages/service.js'
import { mainApp } from './apps.js'
import { FeishuError } from './client.js'
import { credsOf, type FeishuInbound, onFeishu } from './gateway.js'

/**
 * A bound chat's users mirror the group's members (both ways for joining, Feishu → 共工 for leaving).
 * Only linked, enabled accounts of the group's team take part; everyone else is skipped.
 */

type MemberEvent = FeishuInbound['im.chat.member.user.added_v1']

/** Enabled members of `teamId` linked to one of `unionIds`. */
async function linkedUsers(ctx: Ctx, teamId: string, unionIds: string[]) {
  if (!unionIds.length) return []
  return ctx.db
    .select({ id: users.id, name: users.name })
    .from(feishuIdentities)
    .innerJoin(users, eq(users.id, feishuIdentities.userId))
    .innerJoin(teamMembers, and(eq(teamMembers.userId, users.id), eq(teamMembers.teamId, teamId)))
    .where(and(inArray(feishuIdentities.unionId, unionIds), isNull(users.disabledAt)))
}

async function boundGroupOf(ctx: Ctx, chatId: string) {
  const [row] = await ctx.db
    .select({ id: groups.id, teamId: groups.teamId })
    .from(feishuChats)
    .innerJoin(groups, eq(groups.id, feishuChats.groupId))
    .where(and(eq(feishuChats.chatId, chatId), isNull(feishuChats.unboundAt)))
  return row
}

/** Adds the chat users behind `unionIds` who are not in the group yet. */
export async function joinFromFeishu(ctx: Ctx, group: { id: string; teamId: string }, unionIds: string[]) {
  const current = new Set(
    (
      await ctx.db
        .select({ userId: groupMembers.userId })
        .from(groupMembers)
        .where(eq(groupMembers.groupId, group.id))
    ).map((m) => m.userId),
  )
  const joining = (await linkedUsers(ctx, group.teamId, unionIds)).filter((u) => !current.has(u.id))
  if (!joining.length) return
  await ctx.db
    .insert(groupMembers)
    .values(joining.map((u) => ({ groupId: group.id, userId: u.id })))
    .onConflictDoNothing()
  forgetMembers(group.id)
  for (const u of joining) await postEvent(ctx, group.id, '{member} 随飞书群加入群', { member: u.name })
  await publishGroup(ctx, group.id)
}

/** Takes the users behind `unionIds` out of the group, except its only admin. */
async function leaveFromFeishu(ctx: Ctx, group: { id: string; teamId: string }, unionIds: string[]) {
  const leaving = await linkedUsers(ctx, group.teamId, unionIds)
  if (!leaving.length) return
  const members = await ctx.db.select().from(groupMembers).where(eq(groupMembers.groupId, group.id))
  let removed = false
  for (const u of leaving) {
    const m = members.find((x) => x.userId === u.id)
    if (!m) continue
    if (m.isAdmin && members.filter((x) => x.isAdmin && x.userId !== m.userId).length === 0) continue
    await removeMember(ctx, group.id, u.id, u)
    members.splice(members.indexOf(m), 1)
    await postEvent(ctx, group.id, '{member} 已退出飞书群，移出群', { member: u.name })
    removed = true
  }
  if (removed) await publishGroup(ctx, group.id)
}

/** Pulls a new 共工 member into the bound chat when they are linked and not in it yet. */
export async function pullIntoChat(ctx: Ctx, groupId: string, user: { id: string; name: string }) {
  const [chat] = await ctx.db
    .select({ chatId: feishuChats.chatId })
    .from(feishuChats)
    .where(and(eq(feishuChats.groupId, groupId), isNull(feishuChats.unboundAt)))
  const main = chat && (await mainApp(ctx))
  if (!chat || !main) return
  const [identity] = await ctx.db
    .select({ unionId: feishuIdentities.unionId })
    .from(feishuIdentities)
    .where(eq(feishuIdentities.userId, user.id))
  if (!identity) return
  try {
    const members = await ctx.feishu.api.chatMembers(credsOf(main), chat.chatId)
    if (!members.includes(identity.unionId))
      await ctx.feishu.api.addUsers(credsOf(main), chat.chatId, [identity.unionId])
  } catch (err) {
    if (!(err instanceof FeishuError)) throw err
    await postEvent(ctx, groupId, '未能将 {member} 拉入飞书群：{reason}', {
      member: user.name,
      reason: err.message,
    })
  }
}

/** A newly linked user joins the bound groups of their teams whose chat they are in. */
export async function joinBoundChats(ctx: Ctx, userId: string, unionId: string) {
  const main = await mainApp(ctx)
  if (!main) return
  const bound = await ctx.db
    .select({ id: groups.id, teamId: groups.teamId, chatId: feishuChats.chatId })
    .from(feishuChats)
    .innerJoin(groups, eq(groups.id, feishuChats.groupId))
    .innerJoin(teamMembers, and(eq(teamMembers.teamId, groups.teamId), eq(teamMembers.userId, userId)))
    .where(isNull(feishuChats.unboundAt))
  for (const g of bound) {
    const members = await ctx.feishu.api.chatMembers(credsOf(main), g.chatId).catch((err): string[] => {
      if (err instanceof FeishuError) return []
      throw err
    })
    if (members.includes(unionId)) await joinFromFeishu(ctx, g, [unionId])
  }
}

const unionIdsOf = (ev: MemberEvent) => (ev.users ?? []).flatMap((u) => u.user_id?.union_id ?? [])

/** Member events reach the main app only: bot apps do not subscribe to them. */
export function startFeishuMembers(ctx: Ctx) {
  const on = async (ev: MemberEvent, apply: typeof joinFromFeishu) => {
    const group = ev.chat_id && (await boundGroupOf(ctx, ev.chat_id))
    if (group) await apply(ctx, group, unionIdsOf(ev))
  }
  onFeishu(ctx, 'im.chat.member.user.added_v1', (_app, ev) => on(ev, joinFromFeishu))
  onFeishu(ctx, 'im.chat.member.user.deleted_v1', (_app, ev) => on(ev, leaveFromFeishu))
  onFeishu(ctx, 'im.chat.member.user.withdrawn_v1', (_app, ev) => on(ev, leaveFromFeishu))
}
