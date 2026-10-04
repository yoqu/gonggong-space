import type { SyncActionKind, SyncDecision } from '@gonggong/protocol'
import { and, eq, inArray, isNotNull, isNull, max, ne, sql } from 'drizzle-orm'
import type { Ctx } from '../../context.js'
import {
  bots,
  groupBots,
  groupMembers,
  messages,
  runs,
  syncConflicts,
  syncReplicas,
} from '../../db/schema.js'
import { fail } from '../../lib/errors.js'
import { openFile } from '../../lib/seal.js'
import { publishBot } from '../bots/dto.js'
import { requireMember } from '../groups/service.js'
import { authorName, messageDto, postEvent, publishMessage } from '../messages/service.js'
import { notify } from '../notifications/notify.js'
import { publishRun, type RunRow } from '../runs/dto.js'
import { ACTIVE, schedule } from '../runs/scheduler.js'
import { triggerRuns } from '../runs/trigger.js'
import { onlineMachine } from '../workspaces/provision.js'
import { blobPath, blobSize, isBinary } from './blobs.js'
import { conflictFiles, publishSync } from './status.js'
import { raiseIssue } from './store.js'

// Settling a paused replica (docs/plan/强制同步-开发计划.md F11, F12, §3.3): local edits, held conflicts.

/** Larger conflict sides are not previewed. */
const PREVIEW_MAX = 1024 * 1024
const PENDING = ['queued', 'offline_wait', ...ACTIVE]

/** The replica of `botId` in a force group, for a group admin or the bot's owner. */
async function requireDecider(ctx: Ctx, userId: string, groupId: string, botId: string) {
  const { group, member } = await requireMember(ctx, groupId, userId)
  const [row] = await ctx.db
    .select({
      name: bots.name,
      ownerId: bots.ownerId,
      machineId: bots.machineId,
      issue: syncReplicas.issue,
    })
    .from(groupBots)
    .innerJoin(bots, eq(bots.id, groupBots.botId))
    .leftJoin(
      syncReplicas,
      and(eq(syncReplicas.groupId, groupBots.groupId), eq(syncReplicas.botId, groupBots.botId)),
    )
    .where(
      and(
        eq(groupBots.groupId, groupId),
        eq(groupBots.botId, botId),
        isNull(groupBots.removedAt),
        isNull(bots.deletedAt),
      ),
    )
  if (!row) return fail('not_found', '该 Bot 不在群内')
  if (!member.isAdmin && row.ownerId !== userId) return fail('forbidden', '仅群管理员或 Bot 主人可操作')
  if (group.mode !== 'force') return fail('conflict', '群不是强制同步模式')
  return row
}

function sendAction(
  ctx: Ctx,
  machineId: string | null,
  groupId: string,
  botId: string,
  action: SyncActionKind,
) {
  const online = onlineMachine(ctx, machineId)
  if (!online || !ctx.hub.send(online, { t: 'sync.action', groupId, botId, action }))
    fail('conflict', 'Bot 所在机器离线，上线后再处理')
}

/** 提交本地改动 / 丢弃本地改动 (F12): the daemon submits them as a version, or backs them up and catches up. */
export async function driftAction(
  ctx: Ctx,
  userId: string,
  groupId: string,
  botId: string,
  choice: 'submit' | 'discard',
) {
  const row = await requireDecider(ctx, userId, groupId, botId)
  if (row.issue !== 'drift') return fail('conflict', '该副本没有待处理的本地改动')
  sendAction(ctx, row.machineId, groupId, botId, { kind: 'drift', choice })
}

async function openConflict(ctx: Ctx, userId: string, groupId: string, conflictId: string) {
  await requireMember(ctx, groupId, userId)
  const [c] = await ctx.db
    .select()
    .from(syncConflicts)
    .where(
      and(
        sql`${syncConflicts.id}::text = ${conflictId}`,
        eq(syncConflicts.groupId, groupId),
        isNull(syncConflicts.resolvedAt),
      ),
    )
  if (!c) return fail('not_found', '冲突不存在或已处理')
  return { c, bot: await requireDecider(ctx, userId, groupId, c.botId) }
}

/** The merge turn of this conflict that has not ended yet, if any. */
async function mergeRun(ctx: Ctx, groupId: string, conflictId: string) {
  const [row] = await ctx.db
    .select({ id: runs.id })
    .from(runs)
    .innerJoin(messages, eq(messages.id, runs.triggerMessageId))
    .where(
      and(
        eq(runs.groupId, groupId),
        inArray(runs.status, PENDING),
        sql`${messages.meta}->'syncResolve'->>'conflictId' = ${conflictId}`,
      ),
    )
    .limit(1)
  return row
}

/**
 * Per-file decisions on a held change (F11), one for each conflicting file. Keep mine / take theirs only: the daemon
 * applies them and re-submits. Any 交给 Bot 合并 (text on both sides only): a merge turn of the bot, triggered in the
 * deciding user's name, applies them first and resolves the markers.
 */
export async function resolveConflict(
  ctx: Ctx,
  userId: string,
  groupId: string,
  conflictId: string,
  decisions: SyncDecision[],
) {
  const { c, bot } = await openConflict(ctx, userId, groupId, conflictId)
  const files = await conflictFiles(c)
  const byPath = new Map(files.map((f) => [f.path, f]))
  if (decisions.length !== files.length || new Set(decisions.map((d) => d.path)).size !== files.length)
    return fail('invalid', '需要为每个冲突文件选择处理方式')
  for (const d of decisions) {
    const f = byPath.get(d.path)
    if (!f) return fail('invalid', '需要为每个冲突文件选择处理方式')
    if (d.choice === 'bot' && (f.binary || !f.mineHash || !f.theirsHash))
      return fail('invalid', '只有双方都存在的文本文件可以交给 Bot 合并')
  }
  if (await mergeRun(ctx, groupId, c.id)) return fail('conflict', '正在由 Bot 合并，请等待本轮结束')
  const merge = decisions.filter((d) => d.choice === 'bot').map((d) => d.path)
  if (!merge.length) return sendAction(ctx, bot.machineId, groupId, c.botId, { kind: 'conflict', decisions })
  // Agent-facing: not translated.
  const [message] = await ctx.db
    .insert(messages)
    .values({
      groupId,
      kind: 'user',
      authorUserId: userId,
      body: `@${bot.name} Resolve the merge conflict markers (<<<<<<< mine / ======= / >>>>>>> theirs) in: ${merge.join(', ')}. Keep both sides' intent, remove every marker, and change nothing else.`,
      meta: { mentions: [c.botId], syncResolve: { conflictId: c.id, decisions } },
    })
    .returning()
  if (!message) return
  await publishMessage(ctx, messageDto(message, await authorName(ctx, message)))
  // The decider is a group admin or the bot's owner: the bot's trigger scope does not apply.
  await triggerRuns(ctx, message, { anyScope: true })
}

/** 整版丢弃: the daemon backs up the held change and makes the tree the head. */
export async function discardConflict(ctx: Ctx, userId: string, groupId: string, conflictId: string) {
  const { c, bot } = await openConflict(ctx, userId, groupId, conflictId)
  if (await mergeRun(ctx, groupId, c.id)) return fail('conflict', '正在由 Bot 合并，请等待本轮结束')
  sendAction(ctx, bot.machineId, groupId, c.botId, { kind: 'discard' })
}

/** One side (base / mine / theirs) of a conflicting file as UTF-8 text, for the conflict dialog's diff. */
export async function conflictText(
  ctx: Ctx,
  userId: string,
  groupId: string,
  conflictId: string,
  hash: string,
) {
  const { c } = await openConflict(ctx, userId, groupId, conflictId)
  const sides = (await conflictFiles(c)).flatMap((f) => [f.mineHash, f.theirsHash, f.baseHash])
  if (!sides.includes(hash)) return fail('not_found', '文件内容不存在')
  const size = await blobSize(groupId, hash)
  if (size === null) return fail('not_found', '文件内容不存在')
  if (await isBinary(groupId, hash)) return fail('invalid', '二进制文件')
  if (size > PREVIEW_MAX) return fail('invalid', '文件过大，无法预览')
  const chunks: Buffer[] = []
  for await (const chunk of await openFile(blobPath(groupId, hash))) chunks.push(chunk as Buffer)
  return Buffer.concat(chunks).toString('utf8')
}

const botOf = async (ctx: Ctx, botId: string) =>
  (await ctx.db.select({ name: bots.name, ownerId: bots.ownerId }).from(bots).where(eq(bots.id, botId)))[0]

/** Local edits paused the replica: its owner is told (F12). */
export async function notifyDrift(ctx: Ctx, groupId: string, botId: string, files: number) {
  const bot = await botOf(ctx, botId)
  if (bot) await notify(ctx, bot.ownerId, 'sync_drift', { groupId, botId, botName: bot.name, files })
}

/** A conflict was held (F11, §3.3): a card in the group, and word to the bot's owner and the group admins. */
export async function announceConflict(
  ctx: Ctx,
  groupId: string,
  botId: string,
  c: { id: string; headVersion: number; files: number },
) {
  const bot = await botOf(ctx, botId)
  if (!bot) return
  const params = { bot: bot.name, version: c.headVersion, n: c.files }
  await postEvent(ctx, groupId, '@{bot} 的改动与 v{version} 冲突：{n} 个文件', params, {
    syncConflict: { id: c.id, botId },
  })
  const admins = await ctx.db
    .select({ userId: groupMembers.userId })
    .from(groupMembers)
    .where(and(eq(groupMembers.groupId, groupId), eq(groupMembers.isAdmin, true)))
  for (const userId of new Set([bot.ownerId, ...admins.map((a) => a.userId)]))
    await notify(ctx, userId, 'sync_conflict', {
      groupId,
      botId,
      botName: bot.name,
      conflictId: c.id,
      version: c.headVersion,
      files: c.files,
    })
}

/**
 * run.done `stopped` (F21): the turn's changes wait in the tree, so the replica pauses like with local edits. The
 * stopper decides on the run card (keep / discard); without one its owner is told as for local edits.
 */
export async function pauseStopped(ctx: Ctx, run: RunRow, files: number) {
  const paused = await ctx.db
    .update(syncReplicas)
    .set({ issue: 'drift', files: [], total: files, reason: null, updatedAt: new Date() })
    .where(
      and(
        eq(syncReplicas.groupId, run.groupId),
        eq(syncReplicas.botId, run.botId),
        isNotNull(syncReplicas.joinedAt),
      ),
    )
    .returning({ botId: syncReplicas.botId })
  if (!paused.length) return
  await publishSync(ctx, run.groupId)
  if (run.interrupt !== 'pending') await notifyDrift(ctx, run.groupId, run.botId, files)
}

/**
 * run.done `waiting`: the daemon found local edits or a held conflict before the turn started, so the run goes back
 * to the queue and waits for the issue (F12). The start never reached the agent: the context cursor and a pending
 * new-session request are restored so the next dispatch carries them again.
 */
export async function requeueRun(ctx: Ctx, run: RunRow, issue: 'drift' | 'held') {
  const back = await ctx.db.transaction(async (tx) => {
    const [row] = await tx
      .update(runs)
      .set({ status: 'queued', step: '', stepI18n: null, startedAt: null })
      .where(and(eq(runs.id, run.id), inArray(runs.status, ACTIVE)))
      .returning()
    if (!row) return null
    const [prev] = await tx
      .select({ seq: max(messages.seq) })
      .from(runs)
      .innerJoin(messages, eq(messages.id, runs.triggerMessageId))
      .where(
        and(
          eq(runs.groupId, run.groupId),
          eq(runs.botId, run.botId),
          ne(runs.id, run.id),
          isNotNull(runs.startedAt),
        ),
      )
    await tx
      .update(groupBots)
      .set({
        contextSeq: sql`least(${groupBots.contextSeq}, ${prev?.seq ?? 0})`,
        ...(run.newSessionReason &&
          run.newSessionReason !== 'first' && { newSessionReason: run.newSessionReason }),
      })
      .where(and(eq(groupBots.groupId, run.groupId), eq(groupBots.botId, run.botId)))
    return { row, raised: await raiseIssue(tx, run.groupId, run.botId, issue) }
  })
  if (!back) return
  await publishRun(ctx, back.row)
  // Its owner is told by the sync.state report that came with it.
  if (back.raised) await publishSync(ctx, run.groupId)
  await schedule(ctx, run.botId)
  await publishBot(ctx, run.botId)
}
