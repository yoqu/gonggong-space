import { DecideApprovalReq } from '@gonggong/protocol'
import type { FastifyInstance } from 'fastify'
import type { Ctx } from '../../context.js'
import { idParam } from '../../lib/ids.js'
import { requireUser } from '../auth/session.js'
import { decideApproval } from './service.js'

export function approvalRoutes(ctx: Ctx) {
  return async (app: FastifyInstance) => {
    app.post<{ Params: { runId: string; id: string } }>('/api/runs/:runId/approvals/:id', async (req) => {
      const user = await requireUser(ctx, req)
      const { optionId } = DecideApprovalReq.parse(req.body)
      const runId = idParam(req.params.runId, '运行不存在')
      return decideApproval(ctx, user, runId, idParam(req.params.id, '审批请求不存在'), optionId)
    })
  }
}
