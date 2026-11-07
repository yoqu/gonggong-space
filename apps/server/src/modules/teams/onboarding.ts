import {
  DEFAULT_ONBOARDING_EXAMPLES,
  type TeamOnboardingDto,
  type TeamOnboardingReq,
} from '@gonggong/protocol'
import { and, asc, eq, inArray, isNull } from 'drizzle-orm'
import type { Ctx } from '../../context.js'
import { bots, feishuIdentities, groupBots, groupMembers, groups, messages, teams } from '../../db/schema.js'
import { fail } from '../../lib/errors.js'
import { isUuid } from '../../lib/ids.js'
import { botApp, mainApp } from '../feishu/apps.js'
import { welcomeCard } from '../feishu/cards.js'
import { FeishuError } from '../feishu/client.js'
import { credsOf } from '../feishu/gateway.js'
import { pullIntoChat } from '../feishu/members.js'
import { boundChat, mirrorUserMessage } from '../feishu/mirror.js'
import { activeBots, publishGroup } from '../groups/service.js'
import { forgetMembers, type MessageRow, messageDto, postEvent, publishMessage } from '../messages/service.js'
import { triggerRuns } from '../runs/trigger.js'

type Team = typeof teams.$inferSelect
type User = { id: string; name: string }

/** Stored under `teams.params.onboarding`, beside the param overrides. */
type Stored = { groupId: string | null; botId: string | null; examples: string[] }

export const storedOnboarding = (params: unknown): Stored => {
  const own = (params as { onboarding?: Partial<Stored> }).onboarding
  return {
    groupId: own?.groupId ?? null,
    botId: own?.botId ?? null,
    examples: own?.examples?.length ? own.examples : DEFAULT_ONBOARDING_EXAMPLES,
  }
}

export const chatLink = (chatId: string) =>
  `https://applink.feishu.cn/client/chat/open?openChatId=${encodeURIComponent(chatId)}`

/** The 新手群 and its bot as they are now: a deleted group or a bot no longer in it counts as none. */
async function resolve(ctx: Ctx, team: Team) {
  const stored = storedOnboarding(team.params)
  const [group] = stored.groupId
    ? await ctx.db
        .select({ id: groups.id, name: groups.name })
        .from(groups)
        .where(
          and(
            eq(groups.id, stored.groupId),
            eq(groups.teamId, team.id),
            eq(groups.kind, 'group'),
            isNull(groups.archivedAt),
          ),
        )
    : []
  const bot =
    group && stored.botId ? (await activeBots(ctx, group.id)).find((b) => b.id === stored.botId) : undefined
  return { group, bot, examples: stored.examples }
}

export async function onboardingDto(ctx: Ctx, team: Team, admin: boolean): Promise<TeamOnboardingDto> {
  const { group, bot, examples } = await resolve(ctx, team)
  const chat = group && (await boundChat(ctx.db, group.id))
  return {
    groupId: group?.id ?? null,
    groupName: group?.name ?? null,
    botId: bot?.id ?? null,
    botName: bot?.name ?? null,
    examples,
    feishuUrl: chat ? chatLink(chat.chatId) : null,
    ...(admin && { options: await groupOptions(ctx, team.id) }),
  }
}

async function groupOptions(ctx: Ctx, teamId: string) {
  const list = await ctx.db
    .select({ id: groups.id, name: groups.name })
    .from(groups)
    .where(and(eq(groups.teamId, teamId), eq(groups.kind, 'group'), isNull(groups.archivedAt)))
    .orderBy(asc(groups.createdAt))
  if (!list.length) return []
  const rows = await ctx.db
    .select({ groupId: groupBots.groupId, id: bots.id, name: bots.name })
    .from(groupBots)
    .innerJoin(bots, eq(bots.id, groupBots.botId))
    .where(
      and(
        inArray(
          groupBots.groupId,
          list.map((g) => g.id),
        ),
        isNull(groupBots.removedAt),
        isNull(bots.deletedAt),
      ),
    )
    .orderBy(asc(groupBots.addedAt))
  return list.map((g) => ({
    ...g,
    bots: rows.filter((r) => r.groupId === g.id).map(({ id, name }) => ({ id, name })),
  }))
}

/** Checks the picked group and bot, then stores them; other keys of `teams.params` are kept. */
export async function saveOnboarding(ctx: Ctx, team: Team, req: TeamOnboardingReq) {
  if (req.groupId) {
    const [group] = isUuid(req.groupId)
      ? await ctx.db
          .select({ id: groups.id })
          .from(groups)
          .where(
            and(
              eq(groups.id, req.groupId),
              eq(groups.teamId, team.id),
              eq(groups.kind, 'group'),
              isNull(groups.archivedAt),
            ),
          )
      : []
    if (!group) fail('not_found', '群不存在')
    if (req.botId && !(await activeBots(ctx, req.groupId)).some((b) => b.id === req.botId))
      fail('invalid', '该 Bot 不在群内')
  }
  const onboarding: Stored = {
    groupId: req.groupId,
    botId: req.groupId ? req.botId : null,
    examples: req.examples,
  }
  await ctx.db
    .update(teams)
    .set({ params: { ...(team.params as object), onboarding } })
    .where(eq(teams.id, team.id))
}

/**
 * A new team member joins the 新手群 (when set) with a welcome event there; a Feishu-linked one also gets a welcome
 * card in their DM with the default bot's app. Feishu failures never undo the join.
 */
export async function welcomeToTeam(ctx: Ctx, teamId: string, user: User) {
  const [team] = await ctx.db.select().from(teams).where(eq(teams.id, teamId))
  if (!team) return
  const { group, bot, examples } = await resolve(ctx, team)
  if (!group) return
  const [added] = await ctx.db
    .insert(groupMembers)
    .values({ groupId: group.id, userId: user.id })
    .onConflictDoNothing()
    .returning()
  if (!added) return
  forgetMembers(group.id)
  if (bot)
    await postEvent(ctx, group.id, '欢迎 {member} 加入团队，有问题直接 @{bot}', {
      member: user.name,
      bot: bot.name,
    })
  else await postEvent(ctx, group.id, '欢迎 {member} 加入团队', { member: user.name })
  await publishGroup(ctx, group.id)
  await pullIntoChat(ctx, group.id, user)
  if (bot) await sendWelcomeCard(ctx, team, user.id, group.id, bot, examples)
}

async function sendWelcomeCard(
  ctx: Ctx,
  team: Team,
  userId: string,
  groupId: string,
  bot: { id: string; name: string },
  examples: string[],
) {
  const [identity] = await ctx.db
    .select({ openId: feishuIdentities.openId, unionId: feishuIdentities.unionId })
    .from(feishuIdentities)
    .where(eq(feishuIdentities.userId, userId))
  if (!identity) return
  const own = await botApp(ctx, bot.id)
  const app = own ?? (await mainApp(ctx))
  if (!app) return
  const chat = await boundChat(ctx.db, groupId)
  const card = welcomeCard({
    team: team.name,
    bot: bot.name,
    groupId,
    botId: bot.id,
    examples,
    clickable: !!own,
    chatUrl: chat ? chatLink(chat.chatId) : null,
  })
  // open_id is per app: only the main app's is stored, union_id reaches the user through any app.
  await ctx.feishu.api
    .send(
      credsOf(app),
      own ? identity.unionId : identity.openId,
      { msgType: 'interactive', content: JSON.stringify(card) },
      { receiveIdType: own ? 'union_id' : 'open_id' },
    )
    .catch((err) => {
      if (!(err instanceof FeishuError)) throw err
    })
}

/** A welcome card example clicked: `user` asks `botId` in the group, exactly like typing `@bot question` there. */
export async function askInGroup(ctx: Ctx, user: User, groupId: string, botId: string, question: string) {
  const [member] = isUuid(groupId)
    ? await ctx.db
        .select({ userId: groupMembers.userId })
        .from(groupMembers)
        .innerJoin(groups, eq(groups.id, groupMembers.groupId))
        .where(
          and(eq(groupMembers.groupId, groupId), eq(groupMembers.userId, user.id), isNull(groups.archivedAt)),
        )
    : []
  if (!member) return fail('forbidden', '群不存在或你已不在群内')
  const bot = (await activeBots(ctx, groupId)).find((b) => b.id === botId)
  if (!bot) return fail('invalid', '该 Bot 不在群内')
  const [row] = (await ctx.db
    .insert(messages)
    .values({
      groupId,
      kind: 'user',
      authorUserId: user.id,
      body: `@${bot.name} ${question}`,
      meta: { mentions: [bot.id] },
    })
    .returning()) as [MessageRow]
  await publishMessage(ctx, messageDto(row, user.name))
  await mirrorUserMessage(ctx, row, user)
  await triggerRuns(ctx, row)
}
