import type { Answer, Attachment, Question, QuestionSetDto } from '@gonggong/protocol'
import type { attachments, questionSets } from '../../db/schema.js'

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

export const questionSetDto = (
  q: QuestionSet,
  answeredByName: string | null,
  files: Attachment[],
): QuestionSetDto => ({
  id: q.id,
  runId: q.runId,
  questions: q.questions as Question[],
  status: q.status as QuestionSetDto['status'],
  answers: (q.answers as Answer[] | null) ?? null,
  attachments: q.attachmentIds.flatMap((id) => files.filter((f) => f.id === id)),
  answeredBy: q.answeredBy,
  answeredByName,
  answeredAt: q.answeredAt?.toISOString() ?? null,
  expiresAt: q.expiresAt.toISOString(),
  createdAt: q.createdAt.toISOString(),
})
