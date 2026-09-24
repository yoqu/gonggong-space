import type { Answer, DaemonToServer, Question } from '@aiws/protocol'
import { and, eq, inArray, lte, sql } from 'drizzle-orm'
import type { Ctx } from '../../context.js'
import { auditLogs, bots, groups, questionSets, runs } from '../../db/schema.js'
import { fail } from '../../lib/errors.js'
import { timeoutMin } from '../approvals/service.js'
import { claimAttachments } from '../attachments/service.js'
import { notify, resolveNotifications } from '../notifications/notify.js'
import { publishRun } from '../runs/dto.js'
import { questionSetDto } from './dto.js'

type QuestionSet = typeof questionSets.$inferSelect
type QuestionAsk = Extract<DaemonToServer, { t: 'question.ask' }>

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
  const [q] = (await ctx.db
    .insert(questionSets)
    .values({
      runId: ask.runId,
      requestId: ask.requestId,
      questions: ask.questions,
      expiresAt: new Date(ctx.now().getTime() + (await timeoutMin(ctx, row.group)) * 60_000),
      createdAt: ctx.now(),
    })
    .returning()) as [QuestionSet]
  await syncRun(ctx, ask.runId, `等待回答：${ask.questions.length} 个问题`)
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
  for (const userId of new Set([row.run.originUserId, row.bot.ownerId]))
    await notify(ctx, userId, 'question', payload)
}

/** Answers must match the card: every question once, choices in range, one choice for single / yes-no. */
function validAnswers(questions: Question[], answers: Answer[]) {
  if (answers.length !== questions.length) return false
  return questions.every((q) => {
    const mine = answers.filter((a) => a.questionId === q.id)
    const a = mine[0]
    if (mine.length !== 1 || !a) return false
    const text = a.text?.trim() ?? ''
    const inRange = a.choices.every((c) => c >= 0 && c < q.options.length)
    const distinct = new Set(a.choices).size === a.choices.length
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

/** POST /api/runs/:runId/questions/:id/answers: the trigger user (chain initiator) or the bot owner answers. */
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
  if (user.id !== row.run.originUserId && user.id !== row.ownerId)
    return fail('forbidden', '仅触发人或 bot 主人可以回答')
  if (row.q.status !== 'pending') return fail('conflict', '该提问已处理')
  if (!validAnswers(row.q.questions as Question[], answers)) return fail('invalid', '回答与问题不匹配')
  // The card id is the attachments' "message": the daemon writes them to .aiws/attachments/<card id>/.
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
  if (row.machineId)
    ctx.hub.send(row.machineId, {
      t: 'question.answer',
      runId,
      requestId: settled.requestId,
      answers,
      attachments: files,
      answeredBy: user.name,
    })
  await syncRun(ctx, runId)
  return questionSetDto(settled, user.name, files)
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
    if (row.machineId)
      ctx.hub.send(row.machineId, {
        t: 'question.answer',
        runId: settled.runId,
        requestId: settled.requestId,
        answers: null,
        attachments: [],
        answeredBy: null,
      })
    await syncRun(ctx, settled.runId)
  }
}

/** Pending cards of a run that ended, was stopped or was interrupted by an append: nobody can answer them. */
export async function voidQuestions(ctx: Ctx, runId: string) {
  const voided = await ctx.db
    .update(questionSets)
    .set({ status: 'void' })
    .where(and(eq(questionSets.runId, runId), eq(questionSets.status, 'pending')))
    .returning()
  if (!voided.length) return
  const [run] = await ctx.db.select({ groupId: runs.groupId }).from(runs).where(eq(runs.id, runId))
  await ctx.db.insert(auditLogs).values(
    voided.map((q) => ({
      category: 'question',
      action: 'void',
      groupId: run?.groupId,
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
  const timer = setInterval(() => {
    expireQuestions(ctx).catch((err) => console.error('question timeout:', err))
  }, TICK_MS)
  return () => clearInterval(timer)
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

/** A live run awaits an answer exactly while it has a pending card; publishes the run with its cards. */
async function syncRun(ctx: Ctx, runId: string, step?: string) {
  const pending = sql`exists (select 1 from ${questionSets} where ${questionSets.runId} = ${runs.id} and ${questionSets.status} = 'pending')`
  const [updated] = await ctx.db
    .update(runs)
    .set({
      status: sql`case when ${pending} then 'awaiting_answer' else 'running' end`,
      ...(step !== undefined && { step }),
    })
    .where(and(eq(runs.id, runId), inArray(runs.status, ['running', 'awaiting_answer'])))
    .returning()
  const run = updated ?? (await ctx.db.select().from(runs).where(eq(runs.id, runId)))[0]
  if (run) await publishRun(ctx, run)
}
