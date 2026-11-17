import { randomUUID } from 'node:crypto'
import type { AgentKind } from '@gonggong/protocol'
import { and, desc, eq, inArray, isNull, lt } from 'drizzle-orm'
import type { Ctx } from '../../context.js'
import { bots, groupBots, messages, runs, users } from '../../db/schema.js'
import { fail } from '../../lib/errors.js'
import { idParam } from '../../lib/ids.js'
import { createGroup } from '../groups/create.js'
import { requireMember } from '../groups/service.js'
import { requestCd } from '../workspaces/cd.js'
import { currentRepo, onlineMachine } from '../workspaces/provision.js'
import { updateBotState } from '../workspaces/state.js'
import { postEvent } from './service.js'

const FORK_TIMEOUT_MS = 10_000
const SUMMARY_MESSAGES = 20
const SUMMARY_CHARS = 200

/**
 * Branches a bot reply into a new private chat with the same bot. The adapter forks the session the reply's run
 * ended with, so the new chat continues from that round; the new chat starts with the conversation that led to the
 * reply. Returns the new chat's id.
 */
export async function branchMessage(ctx: Ctx, me: { id: string; name: string }, messageId: string) {
  const [m] = await ctx.db
    .select()
    .from(messages)
    .where(eq(messages.id, idParam(messageId, '消息不存在')))
  if (!m) return fail('not_found', '消息不存在')
  const { group } = await requireMember(ctx, m.groupId, me.id)
  if (m.kind !== 'bot' || !m.runId || m.recalledAt) return fail('invalid', '只能从 Bot 的回复分支')
  const [run] = await ctx.db.select().from(runs).where(eq(runs.id, m.runId))
  if (run?.status !== 'completed' || !run.sessionAfter) return fail('invalid', '这条回复没有可分支的会话')
  // The bot's session moves on with every completed round, so only its latest one can be forked.
  const [latest] = await ctx.db
    .select({ id: runs.id })
    .from(runs)
    .where(and(eq(runs.groupId, group.id), eq(runs.botId, run.botId), eq(runs.status, 'completed')))
    .orderBy(desc(runs.startedAt))
    .limit(1)
  if (latest?.id !== run.id) return fail('invalid', '只能从最新一轮分支')
  const [row] = await ctx.db
    .select({
      id: bots.id,
      name: bots.name,
      ownerId: bots.ownerId,
      machineId: bots.machineId,
      agentKind: bots.agentKind,
      cdPath: groupBots.cdPath,
      extraDirs: groupBots.extraDirs,
    })
    .from(groupBots)
    .innerJoin(bots, eq(bots.id, groupBots.botId))
    .where(
      and(
        eq(groupBots.groupId, group.id),
        eq(groupBots.botId, run.botId),
        isNull(groupBots.removedAt),
        isNull(bots.deletedAt),
      ),
    )
  if (!row) return fail('not_found', '该 Bot 不在群内')
  // Only the owner: a fork of a shared bot would expose its session history to the sharee.
  if (row.ownerId !== me.id) return fail('forbidden', '只能分支你自己的 Bot 的回复')
  const machineId = onlineMachine(ctx, row.machineId)
  if (!machineId) return fail('conflict', '{bot} 离线，无法分支', { bot: row.name })
  if (!ctx.hub.features(machineId).includes('sessionFork'))
    return fail('conflict', '{bot} 所在电脑的共工客户端版本过旧，请升级后再分支', { bot: row.name })

  // The session lives in the bot's workspace on its owner's machine: fork it before any chat is opened.
  const forked = await ctx.hub.request(
    machineId,
    {
      t: 'session.fork',
      requestId: randomUUID(),
      agent: row.agentKind as AgentKind,
      groupId: group.id,
      botId: row.id,
      workspace: { repo: await currentRepo(ctx, group.id), cdPath: row.cdPath },
      sessionId: run.sessionAfter,
    },
    'session.fork.result',
    FORK_TIMEOUT_MS,
  )
  if (!forked) return fail('conflict', '{bot} 无响应，无法分支', { bot: row.name })
  if (!forked.sessionId) return fail('conflict', '分支失败：{error}', { error: forked.error ?? '未知错误' })

  const dm = await createGroup(ctx, me, group.teamId, {
    name: row.name,
    kind: 'dm',
    memberIds: [],
    botIds: [row.id],
    repo: null,
  })
  await updateBotState(ctx, dm, row.id, { sessionId: forked.sessionId, extraDirs: row.extraDirs })
  // The same directory binding as the source chat; the daemon validates it and reports back.
  await requestCd(ctx, { groupId: dm, botId: row.id, path: row.cdPath })

  const earlier = await ctx.db
    .select({ body: messages.body, userName: users.name, botName: bots.name })
    .from(messages)
    .leftJoin(users, eq(users.id, messages.authorUserId))
    .leftJoin(bots, eq(bots.id, messages.authorBotId))
    .where(
      and(
        eq(messages.groupId, group.id),
        lt(messages.seq, m.seq),
        inArray(messages.kind, ['user', 'bot']),
        isNull(messages.recalledAt),
      ),
    )
    .orderBy(desc(messages.seq))
    .limit(SUMMARY_MESSAGES)
  if (earlier.length)
    await postEvent(ctx, dm, '分支自「{group}」，以下是分支点之前的对话：\n{summary}', {
      group: group.name,
      summary: earlier
        .reverse()
        .map((r) => `${r.userName ?? r.botName ?? ''}：${clip(r.body)}`)
        .join('\n'),
    })
  else await postEvent(ctx, dm, '分支自「{group}」，分支点之前没有对话', { group: group.name })
  return dm
}

const clip = (body: string) => {
  const line = body.replace(/\s+/g, ' ').trim()
  return line.length > SUMMARY_CHARS ? `${line.slice(0, SUMMARY_CHARS)}…` : line
}
