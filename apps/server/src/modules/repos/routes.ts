import { type RepoDto, RepoProbeReq, type RepoProbeRes } from '@gonggong/protocol'
import type { FastifyInstance } from 'fastify'
import type { Ctx } from '../../context.js'
import { fail } from '../../lib/errors.js'
import { idParam } from '../../lib/ids.js'
import { requireUser } from '../auth/session.js'
import { repoProblem } from '../groups/repo.js'
import { currentTeam } from '../teams/service.js'
import { probeBots } from './probe.js'
import { hideRepo, searchRepos } from './service.js'

export function repoRoutes(ctx: Ctx) {
  return async (app: FastifyInstance) => {
    app.get<{ Querystring: { q?: string } }>('/api/repos', async (req): Promise<RepoDto[]> => {
      const me = await requireUser(ctx, req)
      return searchRepos(ctx, me.id, await currentTeam(ctx, req, me.id), req.query.q ?? '')
    })

    app.delete<{ Params: { id: string } }>('/api/repos/:id', async (req, reply) => {
      const me = await requireUser(ctx, req)
      const teamId = await currentTeam(ctx, req, me.id)
      if (!(await hideRepo(ctx, me, teamId, idParam(req.params.id, '仓库不存在'))))
        fail('forbidden', '只有系统管理员或唯一使用过它的人可以移除')
      return reply.status(204).send()
    })

    app.post('/api/repos/probe', async (req): Promise<RepoProbeRes> => {
      const me = await requireUser(ctx, req)
      const body = RepoProbeReq.parse(req.body)
      const problem = repoProblem(body.url.trim(), body.branch.trim() || 'main')
      if (problem) fail('invalid', problem)
      const botIds = body.botIds.map((id) => idParam(id, 'Bot 不存在'))
      const teamId = await currentTeam(ctx, req, me.id)
      return probeBots(ctx, me.id, teamId, { ...body, botIds, branch: body.branch.trim() || 'main' })
    })
  }
}
