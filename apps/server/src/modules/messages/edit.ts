import { parseMentions, RECALL_WINDOW_MS } from '@gonggong/protocol'
import { and, eq, inArray, isNull, sql } from 'drizzle-orm'
import type { Ctx } from '../../context.js'
import { messages, runs } from '../../db/schema.js'
import { fail } from '../../lib/errors.js'
import { parseCommand } from '../commands/index.js'
import { activeBots } from '../groups/service.js'
import { reactionsFor } from '../reactions/service.js'
import { stopRuns } from '../runs/stop.js'
import { rerunFor } from '../runs/trigger.js'
import { QUOTE_MAX } from './quote.js'
import { ownMessage } from './recall.js'
import { type MessageMeta, type MessageRow, memberIds, messageDto } from './service.js'

/** Runs that already reached the agent: an edit stops them and starts over (plan F8). */
const STARTED = ['running', 'awaiting_approval', 'awaiting_answer']

/**
 * 编辑: the author rewrites a plain message of theirs within the recall window; whom it @-s cannot change. Waiting
 * runs read the new text when dispatched; started ones are stopped and rerun with it.
 */
export async function editMessage(ctx: Ctx, user: { id: string; name: string }, id: string, body: string) {
  const m = await ownMessage(ctx, user.id, id)
  if (m.recalledAt) return fail('conflict', '该消息已撤回')
  if (ctx.now().getTime() - m.createdAt.getTime() > RECALL_WINDOW_MS)
    return fail('edit_expired', '超过 24 小时，无法编辑')
  const meta = m.meta as MessageMeta
  if (!body.trim() && !meta.attachments?.length) return fail('invalid', '消息不能为空')
  const inGroup = await activeBots(ctx, m.groupId)
  if (meta.command || meta.appendTo || parseCommand(body, inGroup)) return fail('invalid', '命令消息不能编辑')
  const same = (a: string[], b: string[]) => a.length === b.length && a.every((x) => b.includes(x))
  if (!same(parseMentions(m.body, inGroup), parseMentions(body, inGroup)))
    return fail('invalid', '编辑不能修改 @ 的对象')

  const [row] = (await ctx.db
    .update(messages)
    .set({ body, editedAt: ctx.now() })
    .where(and(eq(messages.id, m.id), isNull(messages.recalledAt)))
    .returning()) as MessageRow[]
  if (!row) return fail('conflict', '该消息已撤回')
  await ctx.db
    .update(messages)
    .set({
      meta: sql`jsonb_set(${messages.meta}, '{quote,text}', to_jsonb(${body.slice(0, QUOTE_MAX)}::text))`,
    })
    .where(
      and(
        eq(messages.groupId, m.groupId),
        sql`${messages.meta}->'quote'->>'kind' = 'message'`,
        sql`${messages.meta}->'quote'->>'id' = ${m.id}`,
      ),
    )

  const started = await ctx.db
    .select({ id: runs.id, botId: runs.botId })
    .from(runs)
    .where(
      and(
        eq(runs.triggerMessageId, m.id),
        eq(runs.hop, 1),
        inArray(runs.status, STARTED),
        isNull(runs.stoppedBy),
      ),
    )
  for (const run of started) await stopRuns(ctx, { groupId: m.groupId, runId: run.id, edited: true }, user)
  if (started.length) await rerunFor(ctx, row, [...new Set(started.map((r) => r.botId))])

  const dto = messageDto(row, user.name, (await reactionsFor(ctx, [row.id], user.id)).get(row.id))
  ctx.bus.publish(await memberIds(ctx, m.groupId), { t: 'message.edited', message: dto })
  return dto
}
