import { join } from 'node:path'
import type { FastifyInstance } from 'fastify'
import { z } from 'zod'
import type { Ctx } from '../../context.js'
import { requireUser } from '../auth/session.js'
import { requireMember } from '../groups/service.js'
import { Mirrors } from './mirror.js'
import { commandCandidates, fileCandidates } from './service.js'

const FilesQuery = z.object({ q: z.string().max(200).default(''), botId: z.string().optional() })
/** botId: comma-separated ids of the bots mentioned in the draft. */
const CommandsQuery = z.object({ botId: z.string().default('') })

export function candidateRoutes(ctx: Ctx) {
  const mirrors = new Mirrors(join(process.env.AIWS_DATA_DIR ?? '.aiws-dev/data', 'mirrors'), ctx.now)
  return async (app: FastifyInstance) => {
    app.get<{ Params: { id: string } }>('/api/groups/:id/candidates/files', async (req) => {
      const me = await requireUser(ctx, req)
      await requireMember(ctx, req.params.id, me.id)
      const { q, botId } = FilesQuery.parse(req.query)
      return fileCandidates(ctx, mirrors, req.params.id, botId, q)
    })
    app.get<{ Params: { id: string } }>('/api/groups/:id/candidates/commands', async (req) => {
      const me = await requireUser(ctx, req)
      await requireMember(ctx, req.params.id, me.id)
      const { botId } = CommandsQuery.parse(req.query)
      return commandCandidates(ctx, req.params.id, botId.split(',').filter(Boolean))
    })
  }
}
