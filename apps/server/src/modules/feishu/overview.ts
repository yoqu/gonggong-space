import type { FeishuOverviewDto } from '@gonggong/protocol'
import { and, asc, count, eq, isNull, ne } from 'drizzle-orm'
import type { Ctx } from '../../context.js'
import {
  bots,
  feishuApps,
  feishuChats,
  feishuIdentities,
  groupMembers,
  groups,
  teams,
  users,
} from '../../db/schema.js'
import { activeBots } from '../groups/service.js'
import { appDto, mainApp } from './apps.js'
import { publicUrl } from './identity.js'
import { botIssue } from './issues.js'

/**
 * 管理后台 · 飞书 at a glance, from what 共工 already knows: nothing is asked of Feishu here, so which bots are in each
 * chat stays on 群设置 · 飞书 and only failures seen since the server started show.
 */
export async function feishuOverview(ctx: Ctx, viewerId: string): Promise<FeishuOverviewDto> {
  const main = await mainApp(ctx)
  const [linked] = await ctx.db.select({ n: count() }).from(feishuIdentities)
  const [others] = main
    ? await ctx.db
        .select({ n: count() })
        .from(feishuIdentities)
        .where(ne(feishuIdentities.userId, main.updatedBy))
    : [{ n: 0 }]

  const botRows = await ctx.db
    .select({ bot: bots, teamName: teams.name, ownerName: users.name, app: feishuApps })
    .from(bots)
    .innerJoin(teams, eq(teams.id, bots.teamId))
    .innerJoin(users, eq(users.id, bots.ownerId))
    .leftJoin(feishuApps, eq(feishuApps.botId, bots.id))
    .where(and(isNull(bots.deletedAt), isNull(teams.archivedAt)))
    .orderBy(asc(teams.name), asc(bots.createdAt))

  const chatRows = await ctx.db
    .select({ chat: feishuChats, group: groups, teamName: teams.name, member: groupMembers.userId })
    .from(feishuChats)
    .innerJoin(groups, eq(groups.id, feishuChats.groupId))
    .innerJoin(teams, eq(teams.id, groups.teamId))
    .leftJoin(groupMembers, and(eq(groupMembers.groupId, groups.id), eq(groupMembers.userId, viewerId)))
    .where(and(isNull(feishuChats.unboundAt), isNull(groups.archivedAt), eq(groups.kind, 'group')))
    .orderBy(asc(feishuChats.createdAt))

  return {
    publicUrl: (await publicUrl(ctx)) ?? '',
    main: appDto(main),
    linkedUsers: linked?.n ?? 0,
    othersLinked: (others?.n ?? 0) > 0,
    // Bots with an app first: the ones the page lists by default.
    bots: botRows
      .map((r) => ({
        botId: r.bot.id,
        name: r.bot.name,
        teamName: r.teamName,
        ownerName: r.ownerName,
        app: appDto(r.app ?? undefined),
      }))
      .sort((a, b) => Number(!a.app) - Number(!b.app)),
    chats: await Promise.all(
      chatRows.map(async (r) => {
        const groupBots = await activeBots(ctx, r.group.id)
        return {
          groupId: r.group.id,
          groupName: r.group.name,
          teamName: r.teamName,
          chatName: r.chat.name,
          boundAt: r.chat.createdAt.toISOString(),
          botsInChat: null,
          botsTotal: groupBots.length,
          issue: groupBots.map((b) => botIssue(ctx, r.group.id, b.id)).find((i) => i) ?? null,
          member: r.member !== null,
        }
      }),
    ),
  }
}
