import { type ActionAnswer, type AnswerActionsReq, findUiBlocks, type MessageDto } from '@gonggong/protocol'
import { and, eq, isNull, sql } from 'drizzle-orm'
import type { Ctx } from '../../context.js'
import { messages } from '../../db/schema.js'
import { audit } from '../../lib/audit.js'
import { fail } from '../../lib/errors.js'
import { idParam } from '../../lib/ids.js'
import { mirrorReply, mirrorUserMessage } from '../feishu/mirror.js'
import { activeBots, requireMember } from '../groups/service.js'
import { triggerRuns } from '../runs/trigger.js'
import { publishThread } from '../threads/service.js'
import { resolveQuote } from './quote.js'
import { type MessageMeta, type MessageRow, memberIds, messageDto, publishMessage } from './service.js'

/**
 * A click on a bot reply's ```actions block (plan 富交互消息 · 层 2): recorded once on the reply, then sent as the
 * clicker's own message @-ing the bot and quoting the reply, so the next turn goes the way of any other @.
 */
export async function answerActions(
  ctx: Ctx,
  user: { id: string; name: string },
  id: string,
  req: AnswerActionsReq,
): Promise<MessageDto> {
  const [m] = await ctx.db
    .select()
    .from(messages)
    .where(eq(messages.id, idParam(id, '消息不存在')))
  if (!m) return fail('not_found', '消息不存在')
  await requireMember(ctx, m.groupId, user.id)
  if (m.kind !== 'bot' || !m.authorBotId || m.recalledAt) return fail('not_found', '消息不存在')
  const block = findUiBlocks(m.body)
    .map((b) => b.block)
    .find((b) => b.lang === 'actions' && b.data.id === req.blockId)
  if (block?.lang !== 'actions') return fail('not_found', '按钮已失效')
  const { options, multiple } = block.data
  const picks = [...new Set(req.options)]
  const chosen = picks.flatMap((i) => options[i] ?? [])
  if (chosen.length < picks.length) return fail('invalid', '选项不存在')
  if (!multiple && chosen.length > 1) return fail('invalid', '只能选择一项')
  const bot = (await activeBots(ctx, m.groupId)).find((b) => b.id === m.authorBotId)
  if (!bot) return fail('conflict', '该 Bot 不在群内')

  const answer: ActionAnswer = {
    userId: user.id,
    name: user.name,
    labels: chosen.map((o) => o.label),
    at: ctx.now().toISOString(),
  }
  const quote = await resolveQuote(ctx, m.groupId, { kind: 'message', id: m.id })
  // The agent reads the values; members see the labels on the answered block.
  const body = `@${bot.name} 选择了「${chosen.map((o) => o.value ?? o.label).join('、')}」`
  const { reply, sent } = await ctx.db.transaction(async (tx) => {
    const [reply] = (await tx
      .update(messages)
      .set({
        meta: sql`jsonb_set(${messages.meta}, '{actions}', coalesce(${messages.meta}->'actions', '{}'::jsonb) || jsonb_build_object(${req.blockId}::text, ${JSON.stringify(answer)}::jsonb))`,
      })
      .where(
        and(
          eq(messages.id, m.id),
          isNull(messages.recalledAt),
          sql`${messages.meta}->'actions'->${req.blockId}::text is null`,
        ),
      )
      .returning()) as MessageRow[]
    if (!reply) return fail('conflict', '已有人作答')
    const meta: MessageMeta = { mentions: [bot.id], quote }
    const [sent] = (await tx
      .insert(messages)
      .values({
        groupId: m.groupId,
        kind: 'user',
        authorUserId: user.id,
        body,
        meta,
        createdAt: ctx.now(),
        // Answered in the thread the reply is in.
        threadRootId: m.threadRootId,
      })
      .returning()) as [MessageRow]
    return { reply, sent }
  })

  const dto = messageDto(reply, bot.name)
  ctx.bus.publish(await memberIds(ctx, m.groupId), { t: 'message.edited', message: dto })
  await publishMessage(ctx, messageDto(sent, user.name))
  if (m.threadRootId) await publishThread(ctx, { id: m.threadRootId, groupId: m.groupId })
  await audit(ctx, {
    category: 'question',
    actorUserId: user.id,
    groupId: m.groupId,
    action: 'actions.answer',
    detail: { messageId: m.id, blockId: req.blockId, options: req.options },
  })
  await mirrorReply(ctx, reply)
  await mirrorUserMessage(ctx, sent, user)
  await triggerRuns(ctx, sent)
  return dto
}
