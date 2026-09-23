import type { MessageDto } from '@aiws/protocol'
import { and, eq } from 'drizzle-orm'
import type { Ctx } from '../../context.js'
import { bots, runs } from '../../db/schema.js'
import { fail } from '../../lib/errors.js'
import { idParam } from '../../lib/ids.js'
import { voidApprovals } from '../approvals/service.js'
import { voidQuestions } from '../questions/service.js'

const LIVE = ['running', 'awaiting_approval', 'awaiting_answer']

export type AppendTarget = { runId: string; machineId: string }

/** 打断并追加 (spec §8.9): a live run of this group whose trigger user (chain initiator) or bot owner is sending. */
export async function appendTarget(
  ctx: Ctx,
  groupId: string,
  userId: string,
  runId: string,
): Promise<AppendTarget> {
  const [row] = await ctx.db
    .select({ run: runs, ownerId: bots.ownerId, machineId: bots.machineId })
    .from(runs)
    .innerJoin(bots, eq(bots.id, runs.botId))
    .where(and(eq(runs.id, idParam(runId, '运行')), eq(runs.groupId, groupId)))
  if (!row) return fail('not_found', '运行不存在')
  if (userId !== row.run.originUserId && userId !== row.ownerId)
    return fail('forbidden', '仅触发人或 bot 主人可以打断并追加')
  if (!LIVE.includes(row.run.status) || !row.machineId || !ctx.hub.isOnline(row.machineId))
    return fail('conflict', '该运行已结束，请直接发送')
  return { runId: row.run.id, machineId: row.machineId }
}

/** The stored message goes into the running session; whatever it was waiting on is withdrawn with the cancel. */
export async function sendAppend(ctx: Ctx, target: AppendTarget, message: MessageDto) {
  ctx.hub.send(target.machineId, {
    t: 'run.append',
    runId: target.runId,
    text: message.body,
    from: message.authorName,
    attachments: message.attachments,
  })
  await voidApprovals(ctx, target.runId, 'stopped')
  await voidQuestions(ctx, target.runId)
}
