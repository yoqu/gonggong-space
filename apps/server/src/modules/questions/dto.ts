import type { Answer, Attachment, Question, QuestionSetDto } from '@aiws/protocol'
import type { attachments, questionSets } from '../../db/schema.js'

type QuestionSet = typeof questionSets.$inferSelect
type AttachmentRow = typeof attachments.$inferSelect

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
  files: AttachmentRow[],
): QuestionSetDto => ({
  id: q.id,
  runId: q.runId,
  questions: q.questions as Question[],
  status: q.status as QuestionSetDto['status'],
  answers: (q.answers as Answer[] | null) ?? null,
  attachments: q.attachmentIds.flatMap((id) => {
    const a = files.find((f) => f.id === id)
    return a ? [attachmentDto(a)] : []
  }),
  answeredBy: q.answeredBy,
  answeredByName,
  answeredAt: q.answeredAt?.toISOString() ?? null,
  expiresAt: q.expiresAt.toISOString(),
  createdAt: q.createdAt.toISOString(),
})
