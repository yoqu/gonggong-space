import type { Answer, Attachment, Question, QuestionSetDto } from '@gonggong/protocol'
import { asc, eq, inArray } from 'drizzle-orm'
import type { Db } from '../../db/client.js'
import { type attachments, questionLeanings, type questionSets, users } from '../../db/schema.js'

type QuestionSet = typeof questionSets.$inferSelect
type AttachmentRow = typeof attachments.$inferSelect

/** One question's answer as text (picked options, then free text); null when it was not answered. */
export function answerText(q: Question, answers: Answer[] | null): string | null {
  if (!answers) return null
  const a = answers.find((x) => x.questionId === q.id)
  const parts = (a?.choices ?? []).map((c) => q.options[c]).filter((o) => o !== undefined)
  const text = a?.text?.trim()
  if (text) parts.push(q.type === 'text' ? text : `其他：${text}`)
  return parts.join('、') || '（未作答）'
}

export const attachmentDto = (a: AttachmentRow): Attachment => ({
  id: a.id,
  name: a.name,
  size: a.size,
  mime: a.mime,
  messageId: a.messageId ?? '',
})

export type Leaning = QuestionSetDto['leanings'][number] & { questionSetId: string }

/** `leanings` may hold other cards' too; only a pending card shows its own. */
export const questionSetDto = (
  q: QuestionSet,
  answeredByName: string | null,
  files: Attachment[],
  leanings: Leaning[] = [],
): QuestionSetDto => ({
  id: q.id,
  runId: q.runId,
  questions: q.questions as Question[],
  status: q.status as QuestionSetDto['status'],
  answers: (q.answers as Answer[] | null) ?? null,
  attachments: q.attachmentIds.flatMap((id) => files.filter((f) => f.id === id)),
  assigneeIds: q.assigneeIds,
  answeredBy: q.answeredBy,
  answeredByName,
  answeredAt: q.answeredAt?.toISOString() ?? null,
  expiresAt: q.expiresAt.toISOString(),
  createdAt: q.createdAt.toISOString(),
  leanings:
    q.status === 'pending'
      ? leanings
          .filter((l) => l.questionSetId === q.id)
          .map(({ questionId, choice, userId, name }) => ({ questionId, choice, userId, name }))
      : [],
})

/** Members' leanings on the cards, oldest first, with their names. */
export async function leaningsOf(db: Pick<Db, 'select'>, setIds: string[]): Promise<Leaning[]> {
  if (!setIds.length) return []
  return db
    .select({
      questionSetId: questionLeanings.questionSetId,
      questionId: questionLeanings.questionId,
      choice: questionLeanings.choice,
      userId: questionLeanings.userId,
      name: users.name,
    })
    .from(questionLeanings)
    .innerJoin(users, eq(users.id, questionLeanings.userId))
    .where(inArray(questionLeanings.questionSetId, setIds))
    .orderBy(asc(questionLeanings.createdAt))
}
