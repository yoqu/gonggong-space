import type { Answer, DaemonToServer, Question } from '@gonggong/protocol'
import { and, asc, eq, inArray, lte, sql } from 'drizzle-orm'
import type { Ctx } from '../../context.js'
import {
  attachments,
  auditLogs,
  bots,
  groups,
  questionLeanings,
  questionSets,
  runs,
  users,
} from '../../db/schema.js'
import { teamOfGroupSql } from '../../lib/audit.js'
import { fail } from '../../lib/errors.js'
import { startSweep } from '../../lib/sweep.js'
import { timeoutMin } from '../approvals/service.js'
import { claimAttachments } from '../attachments/service.js'
import { requireMember } from '../groups/service.js'
import { memberMentions } from '../messages/mentions.js'
import { notify, resolveNotifications } from '../notifications/notify.js'
import { publishRun } from '../runs/dto.js'
import { runStep } from '../runs/step.js'
import { attachmentDto, leaningsOf, questionSetDto } from './dto.js'

type QuestionSet = typeof questionSets.$inferSelect
type QuestionAsk = Extract<DaemonToServer, { t: 'question.ask' }>
type QuestionWithdraw = Extract<DaemonToServer, { t: 'question.withdraw' }>

const TICK_MS = 15_000
const LIVE = ['running', 'awaiting_approval', 'awaiting_answer']

const scoped = (ctx: Ctx) =>
  ctx.db
    .select({ q: questionSets, run: runs, ownerId: bots.ownerId, machineId: bots.machineId })
    .from(questionSets)
    .innerJoin(runs, eq(runs.id, questionSets.runId))
    .innerJoin(bots, eq(bots.id, runs.botId))

/** The built-in ask tool was called (spec §8.8): store the card, await an answer, tell who may answer. */
export async function onQuestionAsk(ctx: Ctx, machineId: string, ask: QuestionAsk) {
  const [row] = await ctx.db
    .select({ run: runs, bot: bots, group: groups })
    .from(runs)
    .innerJoin(bots, eq(bots.id, runs.botId))
    .innerJoin(groups, eq(groups.id, runs.groupId))
    .where(and(eq(runs.id, ask.runId), eq(bots.machineId, machineId), inArray(runs.status, LIVE)))
  if (!row) return
  const assigneeIds = await memberMentions(ctx, row.group.id, ask.questions.map((q) => q.title).join('\n'), {
    skipCode: true,
  })
  const [q] = (await ctx.db
    .insert(questionSets)
    .values({
      runId: ask.runId,
      requestId: ask.requestId,
      questions: ask.questions,
      assigneeIds,
      expiresAt: new Date(ctx.now().getTime() + (await timeoutMin(ctx, row.group)) * 60_000),
      createdAt: ctx.now(),
    })
    .returning()) as [QuestionSet]
  await syncRun(ctx, ask.runId, runStep('等待回答：{n} 个问题', { n: ask.questions.length }))
  const payload = {
    groupId: row.group.id,
    groupName: row.group.name,
    runId: ask.runId,
    questionSetId: q.id,
    botId: row.bot.id,
    botName: row.bot.name,
    count: ask.questions.length,
    title: ask.questions[0]?.title ?? '',
  }
  for (const userId of new Set([row.run.originUserId, row.bot.ownerId, ...assigneeIds]))
    await notify(ctx, userId, 'question', payload)
}

/** Answers must match the card: every question once, choices in range, one choice for single / yes-no, no text where 「其他」 is off. */
function validAnswers(questions: Question[], answers: Answer[]) {
  if (answers.length !== questions.length) return false
  return questions.every((q) => {
    const mine = answers.filter((a) => a.questionId === q.id)
    const a = mine[0]
    if (mine.length !== 1 || !a) return false
    const text = a.text?.trim() ?? ''
    const inRange = a.choices.every((c) => c >= 0 && c < q.options.length)
    const distinct = new Set(a.choices).size === a.choices.length
    if (q.noOther && text) return false
    switch (q.type) {
      case 'text':
        return a.choices.length === 0 && text !== ''
      case 'yesno':
        return a.choices.length === 1 && inRange && !a.text
      case 'single':
        return a.choices.length + (text ? 1 : 0) === 1 && inRange
    }
    return (a.choices.length > 0 || text !== '') && inRange && distinct
  })
}

/**
 * POST /api/runs/:runId/questions/:id/answers: the trigger user (chain initiator), the bot owner or a member the
 * questions @ answers; the first answer settles the card.
 */
export async function answerQuestions(
  ctx: Ctx,
  user: { id: string; name: string },
  runId: string,
  id: string,
  answers: Answer[],
  attachmentIds: string[],
) {
  const [row] = await scoped(ctx).where(and(eq(questionSets.id, id), eq(questionSets.runId, runId)))
  if (!row) return fail('not_found', '提问不存在')
  if (user.id !== row.run.originUserId && user.id !== row.ownerId && !row.q.assigneeIds.includes(user.id))
    return fail('forbidden', '仅触发人、Bot 主人或被 @ 的成员可以回答')
  if (row.q.status !== 'pending') return fail('conflict', '该提问已处理')
  if (!validAnswers(row.q.questions as Question[], answers)) return fail('invalid', '回答与问题不匹配')
  if (attachmentIds.length && (row.q.questions as Question[]).some((q) => q.noOther))
    return fail('invalid', '这个确认只能选给出的选项，不收附件')
  // The card id is the attachments' "message": the daemon writes them to .gonggong/attachments/<card id>/.
  const { settled, files } = await ctx.db.transaction(async (tx) => {
    const files = await claimAttachments(tx, attachmentIds, {
      uploaderId: user.id,
      groupId: row.run.groupId,
      messageId: id,
    })
    const values = { answers, attachmentIds, answeredBy: user.id }
    const settled = await settle(ctx, tx, row, 'answered', values, user)
    return { settled: settled ?? fail('conflict', '该提问已处理'), files }
  })
  await resolveNotifications(ctx, 'question', 'questionSetId', [id])
  const sent = row.machineId
    ? ctx.hub.send(row.machineId, {
        t: 'question.answer',
        runId,
        requestId: settled.requestId,
        answers,
        attachments: files,
        answeredBy: user.name,
      })
    : false
  await syncRun(
    ctx,
    runId,
    sent ? runStep('{who} 已回答', { who: user.name }) : runStep('已回答，等待 Bot 电脑重连后继续…'),
    { whenClear: true },
  )
  return questionSetDto(settled, user.name, files)
}

/**
 * POST /api/runs/:runId/questions/:id/leanings: any group member toggles a leaning on an option of a pending card
 * (倾向, for reference only); the card is pushed again.
 */
export async function toggleLeaning(
  ctx: Ctx,
  user: { id: string },
  runId: string,
  id: string,
  lean: { questionId: string; choice: number },
) {
  const [row] = await scoped(ctx).where(and(eq(questionSets.id, id), eq(questionSets.runId, runId)))
  if (!row) return fail('not_found', '提问不存在')
  await requireMember(ctx, row.run.groupId, user.id)
  const q = (row.q.questions as Question[]).find((x) => x.id === lean.questionId)
  if (!q || q.type === 'text' || lean.choice >= q.options.length) return fail('invalid', '选项不存在')
  if (row.q.status !== 'pending') return fail('conflict', '该提问已处理')
  const where = and(
    eq(questionLeanings.questionSetId, id),
    eq(questionLeanings.questionId, lean.questionId),
    eq(questionLeanings.choice, lean.choice),
    eq(questionLeanings.userId, user.id),
  )
  const removed = await ctx.db.delete(questionLeanings).where(where).returning()
  if (!removed.length)
    await ctx.db
      .insert(questionLeanings)
      .values({ questionSetId: id, questionId: lean.questionId, choice: lean.choice, userId: user.id })
      .onConflictDoNothing()
  await publishRun(ctx, row.run)
  return questionSetDto(row.q, null, [], await leaningsOf(ctx.db, [id]))
}

/** Overdue cards: the agent proceeds with the recommendations and lists its assumptions (spec §8.8). */
export async function expireQuestions(ctx: Ctx) {
  const due = await scoped(ctx).where(
    and(eq(questionSets.status, 'pending'), lte(questionSets.expiresAt, ctx.now())),
  )
  for (const row of due) {
    const settled = await settle(ctx, ctx.db, row, 'expired', {}, null)
    if (!settled) continue
    await resolveNotifications(ctx, 'question', 'questionSetId', [settled.id])
    const sent = row.machineId
      ? ctx.hub.send(row.machineId, {
          t: 'question.answer',
          runId: settled.runId,
          requestId: settled.requestId,
          answers: null,
          attachments: [],
          answeredBy: null,
        })
      : false
    await syncRun(
      ctx,
      settled.runId,
      sent ? runStep('无人回答，agent 按推荐项继续') : runStep('提问超时，等待 Bot 电脑重连后继续…'),
      { whenClear: true },
    )
  }
}

/** The daemon withdrew a pending card of its own live run (e.g. the shared directory freed before an answer). */
export async function onQuestionWithdraw(ctx: Ctx, machineId: string, msg: QuestionWithdraw) {
  const [row] = await ctx.db
    .select({ id: runs.id })
    .from(runs)
    .innerJoin(bots, eq(bots.id, runs.botId))
    .where(and(eq(runs.id, msg.runId), eq(bots.machineId, machineId), inArray(runs.status, LIVE)))
  if (row) await voidQuestions(ctx, msg.runId, msg.requestId)
}

/** Pending cards of a run that ended, was stopped or was interrupted by an append: nobody can answer them. */
export async function voidQuestions(ctx: Ctx, runId: string, requestId?: string) {
  const voided = await ctx.db
    .update(questionSets)
    .set({ status: 'void' })
    .where(
      and(
        eq(questionSets.runId, runId),
        eq(questionSets.status, 'pending'),
        requestId === undefined ? undefined : eq(questionSets.requestId, requestId),
      ),
    )
    .returning()
  if (!voided.length) return
  const [run] = await ctx.db.select({ groupId: runs.groupId }).from(runs).where(eq(runs.id, runId))
  await ctx.db.insert(auditLogs).values(
    voided.map((q) => ({
      category: 'question',
      action: 'void',
      groupId: run?.groupId,
      teamId: run ? teamOfGroupSql(run.groupId) : null,
      detail: auditDetail(q),
      createdAt: ctx.now(),
    })),
  )
  await resolveNotifications(
    ctx,
    'question',
    'questionSetId',
    voided.map((q) => q.id),
  )
  await syncRun(ctx, runId)
}

export function startQuestionTimer(ctx: Ctx) {
  return startSweep('question timeout', () => expireQuestions(ctx), TICK_MS)
}

/** Records the outcome once (a racing answer / timeout loses) and audits it. */
async function settle(
  ctx: Ctx,
  db: Pick<Ctx['db'], 'update' | 'insert'>,
  row: { q: QuestionSet; run: { groupId: string } },
  status: 'answered' | 'expired',
  values: Partial<QuestionSet>,
  actor: { id: string } | null,
) {
  const [q] = await db
    .update(questionSets)
    .set({ ...values, status, answeredAt: actor ? ctx.now() : null })
    .where(and(eq(questionSets.id, row.q.id), eq(questionSets.status, 'pending')))
    .returning()
  if (!q) return null
  await db.insert(auditLogs).values({
    category: 'question',
    actorUserId: actor?.id ?? null,
    action: status,
    groupId: row.run.groupId,
    teamId: teamOfGroupSql(row.run.groupId),
    detail: { ...auditDetail(q), answers: q.answers, attachmentIds: q.attachmentIds },
    createdAt: ctx.now(),
  })
  return q
}

const auditDetail = (q: QuestionSet) => ({
  runId: q.runId,
  questionSetId: q.id,
  questions: (q.questions as Question[]).map((x) => x.title),
})

/** Re-sends settled answers of this machine's live runs on reconnect; the daemon ignores already-handled ids. */
export async function replayQuestionAnswers(ctx: Ctx, machineId: string) {
  const rows = await ctx.db
    .select({ q: questionSets, answeredByName: users.name })
    .from(questionSets)
    .innerJoin(runs, eq(runs.id, questionSets.runId))
    .innerJoin(bots, eq(bots.id, runs.botId))
    .leftJoin(users, eq(users.id, questionSets.answeredBy))
    .where(
      and(
        eq(bots.machineId, machineId),
        inArray(runs.status, LIVE),
        inArray(questionSets.status, ['answered', 'expired']),
      ),
    )
    .orderBy(asc(questionSets.answeredAt), asc(questionSets.createdAt))
  if (!rows.length) return
  const fileIds = rows.flatMap((r) => (r.q.status === 'answered' ? r.q.attachmentIds : []))
  const files = fileIds.length
    ? (await ctx.db.select().from(attachments).where(inArray(attachments.id, fileIds))).map(attachmentDto)
    : []
  for (const { q, answeredByName } of rows) {
    const answered = q.status === 'answered'
    ctx.hub.send(machineId, {
      t: 'question.answer',
      runId: q.runId,
      requestId: q.requestId,
      answers: answered ? ((q.answers as Answer[] | null) ?? null) : null,
      attachments: answered ? q.attachmentIds.flatMap((id) => files.filter((f) => f.id === id)) : [],
      answeredBy: answered ? (answeredByName ?? null) : null,
    })
  }
}

/** A live run awaits an answer exactly while it has a pending card; publishes the run with its cards. */
async function syncRun(
  ctx: Ctx,
  runId: string,
  step?: ReturnType<typeof runStep>,
  opts?: { whenClear?: boolean },
) {
  const pending = sql`exists (select 1 from ${questionSets} where ${questionSets.runId} = ${runs.id} and ${questionSets.status} = 'pending')`
  const stepUpdate =
    step && opts?.whenClear
      ? {
          step: sql`case when ${pending} then ${runs.step} else ${step.step} end`,
          stepI18n: sql`case when ${pending} then ${runs.stepI18n} else ${JSON.stringify(step.stepI18n)}::jsonb end`,
        }
      : step
  const [updated] = await ctx.db
    .update(runs)
    .set({
      status: sql`case when ${pending} then 'awaiting_answer' else 'running' end`,
      ...stepUpdate,
    })
    .where(and(eq(runs.id, runId), inArray(runs.status, ['running', 'awaiting_answer'])))
    .returning()
  const run = updated ?? (await ctx.db.select().from(runs).where(eq(runs.id, runId)))[0]
  if (run) await publishRun(ctx, run)
}
