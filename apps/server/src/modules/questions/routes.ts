import { AnswerQuestionsReq } from '@gonggong/protocol'
import type { FastifyInstance } from 'fastify'
import type { Ctx } from '../../context.js'
import { idParam } from '../../lib/ids.js'
import { requireUser } from '../auth/session.js'
import { answerQuestions } from './service.js'

export function questionRoutes(ctx: Ctx) {
  return async (app: FastifyInstance) => {
    app.post<{ Params: { runId: string; id: string } }>(
      '/api/runs/:runId/questions/:id/answers',
      async (req) => {
        const user = await requireUser(ctx, req)
        const { answers, attachmentIds } = AnswerQuestionsReq.parse(req.body)
        const runId = idParam(req.params.runId, '运行')
        return answerQuestions(ctx, user, runId, idParam(req.params.id, '提问'), answers, attachmentIds)
      },
    )
  }
}
