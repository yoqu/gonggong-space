import {
  BanReq,
  FILE_TEXT_MAX_BYTES,
  type FileTextDto,
  GithubImportReq,
  INLINE_FILE_MIMES,
  InstallReq,
  ListingType,
  MarketSource,
  PluginShelf,
  PublishReq,
  type RepoDto,
  ReviewReq,
  SubmitVersionReq,
  UpdateListingReq,
} from '@gonggong/protocol'
import { and, eq } from 'drizzle-orm'
import type { FastifyInstance, FastifyRequest } from 'fastify'
import { z } from 'zod'
import type { Ctx } from '../../context.js'
import { requireMachine } from '../../daemon/auth.js'
import { repos, users } from '../../db/schema.js'
import { fail } from '../../lib/errors.js'
import { idParam } from '../../lib/ids.js'
import { mimeOf } from '../artifacts/serve.js'
import { requireUser } from '../auth/session.js'
import { requireAdmin, requireMember } from '../groups/service.js'
import { searchRepos } from '../repos/service.js'
import { requireTeam } from '../teams/service.js'
import {
  checkUpstream,
  importGithub,
  listingFile,
  marketDetail,
  marketList,
  myListings,
  preflight,
  publish,
  reviewQueue,
  reviewVersion,
  setBan,
  submitVersion,
  updateListing,
  upstreamMoved,
  versionDiff,
} from './publish.js'
import { requestRoutes } from './requests.js'
import { deleteInstall, installable, listInstalls, putInstall, type Target } from './service.js'

type P = { Params: { id?: string; repoId?: string; listingId?: string } }
type Resolve = (req: FastifyRequest<P>, read: boolean) => Promise<{ actorId: string; target: Target }>

/** The install list, the listings it may still take and changes to it, under `base` (a group, team, repo or the caller). */
function scopeRoutes(ctx: Ctx, app: FastifyInstance, base: string, resolve: Resolve) {
  app.get<P>(`${base}/installs`, async (req) => listInstalls(ctx.db, (await resolve(req, true)).target))

  app.get<P>(`${base}/installable`, async (req) => installable(ctx.db, (await resolve(req, true)).target))

  app.put<P>(`${base}/installs/:listingId`, async (req) => {
    const { actorId, target } = await resolve(req, false)
    return putInstall(ctx, target, req.params.listingId ?? '', InstallReq.parse(req.body), actorId)
  })

  app.delete<P>(`${base}/installs/:listingId`, async (req, reply) => {
    const { actorId, target } = await resolve(req, false)
    await deleteInstall(ctx, target, req.params.listingId ?? '', actorId)
    return reply.status(204).send()
  })
}

/** Members read a group's, team's or repo's installs; group admins change the group's, team admins the team's and its repos'. */
export function marketRoutes(ctx: Ctx) {
  return async (app: FastifyInstance) => {
    scopeRoutes(ctx, app, '/api/groups/:id', async (req, read) => {
      const me = await requireUser(ctx, req)
      const { group } = await (read ? requireMember : requireAdmin)(ctx, req.params.id ?? '', me.id)
      return {
        actorId: me.id,
        target: { scope: 'group', scopeId: group.id, teamId: group.teamId, groupId: group.id },
      }
    })

    scopeRoutes(ctx, app, '/api/me', async (req) => {
      const me = await requireUser(ctx, req)
      return { actorId: me.id, target: { scope: 'user', scopeId: me.id, teamId: null, groupId: null } }
    })

    const teamOf = async (req: FastifyRequest<P>, read: boolean) => {
      const me = await requireUser(ctx, req)
      const { team } = await requireTeam(ctx, me.id, req.params.id ?? '', read ? 'member' : 'admin')
      return { actorId: me.id, teamId: team.id }
    }
    scopeRoutes(ctx, app, '/api/teams/:id', async (req, read) => {
      const { actorId, teamId } = await teamOf(req, read)
      return { actorId, target: { scope: 'team', scopeId: teamId, teamId, groupId: null } }
    })
    scopeRoutes(ctx, app, '/api/teams/:id/repos/:repoId', async (req, read) => {
      const { actorId, teamId } = await teamOf(req, read)
      const [repo] = await ctx.db
        .select({ id: repos.id })
        .from(repos)
        .where(and(eq(repos.id, idParam(req.params.repoId ?? '', '仓库不存在')), eq(repos.teamId, teamId)))
      if (!repo) return fail('not_found', '仓库不存在')
      return { actorId, target: { scope: 'repo', scopeId: repo.id, teamId, groupId: null } }
    })

    app.get<{ Params: { id: string }; Querystring: { q?: string } }>(
      '/api/teams/:id/repos',
      async (req): Promise<RepoDto[]> => {
        const me = await requireUser(ctx, req)
        const { team } = await requireTeam(ctx, me.id, req.params.id)
        return searchRepos(ctx, me.id, team.id, req.query.q ?? '')
      },
    )

    publishRoutes(ctx, app)
    requestRoutes(ctx, app)
  }
}

const MarketQuery = z.object({
  q: z.string().optional(),
  type: ListingType.optional(),
  source: MarketSource.optional(),
  shelf: PluginShelf.optional(),
})

/** Up to 8 MB of base64 in the JSON body, as plugin uploads; the decoded files are capped at 5 MB. */
const BODY_LIMIT = 8 * 1024 * 1024
const INLINE = new Set<string>(INLINE_FILE_MIMES)

/** The market page, authors' listings and their review (plan Skill市场-M2). */
function publishRoutes(ctx: Ctx, app: FastifyInstance) {
  type V = { Params: { id: string; versionId: string } }
  app.get('/api/market', async (req) =>
    marketList(ctx, await requireUser(ctx, req), MarketQuery.parse(req.query)),
  )

  // The desktop app's read-only Skill page, as the machine's owner (plan Skill市场-M4 D14).
  const owner = async (req: FastifyRequest) => {
    const machine = await requireMachine(ctx, req)
    const [me] = await ctx.db
      .select({ id: users.id, role: users.role })
      .from(users)
      .where(eq(users.id, machine.ownerId))
    return me ?? fail('unauthorized', 'machine token revoked')
  }
  app.get('/api/daemon/market', async (req) =>
    marketList(ctx, await owner(req), MarketQuery.parse(req.query)),
  )
  app.get('/api/daemon/me/installs', async (req) => {
    const me = await owner(req)
    return listInstalls(ctx.db, { scope: 'user', scopeId: me.id, teamId: null, groupId: null })
  })

  app.get('/api/market/mine', async (req) => myListings(ctx.db, await requireUser(ctx, req)))

  app.get('/api/market/mine/upstream', async (req) => upstreamMoved(ctx, await requireUser(ctx, req)))

  app.get<{ Querystring: { teamId?: string } }>('/api/market/reviews', async (req) =>
    reviewQueue(ctx, await requireUser(ctx, req), req.query.teamId),
  )

  app.get<{ Params: { id: string }; Querystring: { versionId?: string } }>('/api/market/:id', async (req) =>
    marketDetail(ctx, await requireUser(ctx, req), req.params.id, req.query.versionId),
  )

  // 文件 in a listing's detail: a file of the version shown there, as text (FileViewer) or raw bytes (media).
  type F = { Params: { id: string }; Querystring: { path?: string; versionId?: string } }
  const file = async (req: FastifyRequest<F>) => {
    const { path, versionId } = req.query
    if (!path) return fail('invalid', '缺少文件路径')
    return listingFile(ctx, await requireUser(ctx, req), req.params.id, path, versionId)
  }
  app.get<F>('/api/market/:id/files/text', async (req): Promise<FileTextDto> => {
    const f = await file(req)
    const bytes = Buffer.from(f.content, f.encoding === 'base64' ? 'base64' : 'utf8')
    const binary = f.encoding === 'base64'
    return {
      path: f.path,
      size: bytes.length,
      binary,
      mime: mimeOf(f.path).split(';')[0]!,
      text: binary || bytes.length > FILE_TEXT_MAX_BYTES ? null : f.content,
    }
  })
  app.get<F>('/api/market/:id/files/raw', async (req, reply) => {
    const f = await file(req)
    const mime = mimeOf(f.path)
    const inline = INLINE.has(mime.split(';')[0]!)
    const name = encodeURIComponent(f.path.split('/').pop() ?? f.path)
    return reply
      .headers({
        'content-type': mime,
        'content-security-policy': 'sandbox',
        'x-content-type-options': 'nosniff',
        'content-disposition': `${inline ? 'inline' : 'attachment'}; filename*=UTF-8''${name}`,
      })
      .send(Buffer.from(f.content, f.encoding === 'base64' ? 'base64' : 'utf8'))
  })

  app.post('/api/market', { bodyLimit: BODY_LIMIT }, async (req, reply) => {
    const me = await requireUser(ctx, req)
    const { created, body } = await publish(ctx, me, PublishReq.parse(req.body))
    return reply.status(created ? 201 : 200).send(body)
  })

  app.post('/api/market/preflight', { bodyLimit: BODY_LIMIT }, async (req) =>
    preflight(ctx, await requireUser(ctx, req), PublishReq.parse(req.body)),
  )

  app.post('/api/market/import/github', async (req, reply) => {
    const me = await requireUser(ctx, req)
    const { created, body } = await importGithub(ctx, me, GithubImportReq.parse(req.body))
    return reply.status(created ? 201 : 200).send(body)
  })

  app.post<{ Params: { id: string } }>('/api/market/:id/check-upstream', async (req) =>
    checkUpstream(ctx, await requireUser(ctx, req), req.params.id),
  )

  app.patch<{ Params: { id: string } }>('/api/market/:id', async (req) =>
    updateListing(ctx, await requireUser(ctx, req), req.params.id, UpdateListingReq.parse(req.body)),
  )

  app.post<V>('/api/market/:id/versions/:versionId/submit', async (req) => {
    const me = await requireUser(ctx, req)
    const { changelog } = SubmitVersionReq.parse(req.body)
    return submitVersion(ctx, me, req.params.id, req.params.versionId, changelog)
  })

  app.post<V>('/api/market/:id/versions/:versionId/review', async (req, reply) => {
    const me = await requireUser(ctx, req)
    await reviewVersion(ctx, me, req.params.id, req.params.versionId, ReviewReq.parse(req.body))
    return reply.status(204).send()
  })

  app.get<V>('/api/market/:id/versions/:versionId/diff', async (req) =>
    versionDiff(ctx, await requireUser(ctx, req), req.params.id, req.params.versionId),
  )

  app.post<{ Params: { id: string } }>('/api/market/:id/ban', async (req, reply) => {
    const me = await requireUser(ctx, req)
    await setBan(ctx, me, req.params.id, BanReq.parse(req.body).reason)
    return reply.status(204).send()
  })

  app.delete<{ Params: { id: string } }>('/api/market/:id/ban', async (req, reply) => {
    await setBan(ctx, await requireUser(ctx, req), req.params.id, null)
    return reply.status(204).send()
  })
}
