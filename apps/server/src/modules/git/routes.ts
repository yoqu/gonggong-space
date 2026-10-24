import { randomUUID } from 'node:crypto'
import {
  type DaemonFeature,
  type DaemonToServer,
  DecideGitOperationReq,
  FILE_TEXT_MAX_BYTES,
  type FilesTreeDto,
  type FileTextDto,
  GIT_RESOLVE_MAX_BYTES,
  GitActionReq,
  type GitBlameDto,
  GitBlameQuery,
  type GitChangesDto,
  GitChangesQuery,
  type GitCompareDto,
  GitCompareQuery,
  type GitConflictDto,
  GitConflictQuery,
  type GitDiffDto,
  GitDiffQuery,
  type GitLogDto,
  GitLogQuery,
  type GitOperationDto,
  type GitOperationsDto,
  GitRefPathQuery,
  GitRefreshReq,
  type GitRefsDto,
  GitRefsQuery,
  type GitShowDto,
  GitShowQuery,
  type GitStashesDto,
  GitStashesQuery,
  type ServerToDaemon,
} from '@gonggong/protocol'
import { and, desc, eq, ne } from 'drizzle-orm'
import type { FastifyInstance, FastifyReply, FastifyRequest } from 'fastify'
import type { Ctx } from '../../context.js'
import { gitOperations, groups } from '../../db/schema.js'
import { audit } from '../../lib/audit.js'
import { fail, HttpError } from '../../lib/errors.js'
import { idParam } from '../../lib/ids.js'
import { requireUser } from '../auth/session.js'
import { requireMember } from '../groups/service.js'
import { notify, resolveNotifications } from '../notifications/notify.js'
import { groupRedactor } from '../secrets/resolve.js'
import { onlineMachine } from '../workspaces/provision.js'
import {
  assertIdle,
  assertValid,
  auditDetail,
  execute,
  featureFor,
  fields,
  type GitOperation,
  type GitTarget,
  gitTarget,
  guardBase,
  operationDtos,
  PENDING_MS,
  publishOperation,
  setOnly,
  summary,
} from './service.js'

type Read = Extract<
  ServerToDaemon,
  {
    t:
      | 'git.refs'
      | 'git.log'
      | 'git.show'
      | 'git.tree'
      | 'git.read'
      | 'git.compare'
      | 'git.diff'
      | 'git.changes'
      | 'git.blame'
      | 'git.stashes'
      | 'git.conflict'
      | 'git.refresh'
  }
>
type Answer = Extract<DaemonToServer, { t: `${Read['t']}.result` }>
type ReadBody = {
  [K in Read['t']]: Omit<Extract<Read, { t: K }>, 'requestId' | 'groupId' | 'botId' | 'workspace'>
}[Read['t']]
type Req = FastifyRequest<{ Params: { id: string; botId: string }; Querystring: unknown }>

const READ_TIMEOUT_MS = 15_000
/** The daemon gives `git fetch` 120 s. */
const FETCH_TIMEOUT_MS = 130_000
const DIFF_MAX_BYTES = 1024 * 1024
/** A resolution's text (GIT_RESOLVE_MAX_BYTES) with room for its JSON escapes. */
const ACTION_BODY_LIMIT = 3 * 1024 * 1024
const LOG_PAGE = 50
const SETTLED_SHOWN = 20
const strip = (p: string) => p.replace(/^\/+|\/+$/g, '')

/**
 * 群内手动 Git: reads for members; writes run at once for the bot owner and wait for the owner's approval otherwise
 * (see GitActionReq in the protocol).
 */
export function gitRoutes(ctx: Ctx) {
  async function member(req: Req, feature?: DaemonFeature) {
    const me = await requireUser(ctx, req)
    const { group } = await requireMember(ctx, req.params.id, me.id)
    return { me, target: await gitTarget(ctx, group, req.params.botId, feature) }
  }

  async function ask<T extends Answer['t']>(
    t: GitTarget,
    msg: ReadBody,
    reply: T,
    timeoutMs = READ_TIMEOUT_MS,
  ) {
    const offline = () => fail('conflict', '{bot} 离线，无法读取 Git 信息', { bot: t.bot.name })
    const machineId = onlineMachine(ctx, t.bot.machineId) ?? offline()
    const full = {
      ...msg,
      requestId: randomUUID(),
      groupId: t.group.id,
      botId: t.bot.id,
      workspace: t.workspace,
    }
    const res =
      ((await ctx.hub.request(machineId, full as Read, reply, timeoutMs)) as
        | Extract<Answer, { t: T }>
        | undefined) ?? offline()
    if (res.error) throw new HttpError('conflict', res.error)
    return res
  }

  /** Runs a `running` operation; a daemon refusing because a turn holds the directory is a 409 for the caller. */
  async function run(op: GitOperation, t: GitTarget, refuseBusy: boolean) {
    const { operation, busy } = await execute(ctx, op, t)
    if (busy && refuseBusy) fail('conflict', '{bot} 正在运行，等运行结束后再操作', { bot: t.bot.name })
    return operation
  }

  return async (app: FastifyInstance) => {
    app.get('/api/groups/:id/bots/:botId/git/refs', async (req: Req): Promise<GitRefsDto> => {
      const { repo } = GitRefsQuery.parse(req.query)
      const { target } = await member(req, repo ? 'gitRepos' : 'gitOps')
      const res = await ask(target, { t: 'git.refs', ...(repo && { repo }) }, 'git.refs.result')
      return { branches: res.branches, remotes: res.remotes, tags: res.tags, recent: res.recent }
    })

    app.get('/api/groups/:id/bots/:botId/git/log', async (req: Req): Promise<GitLogDto> => {
      const { repo, ref, skip, path, ...flags } = GitLogQuery.parse(req.query)
      const filter = setOnly({ ...flags, path: path && (strip(path) || undefined) })
      const { target } = await member(req, repo || filter ? 'gitOps3' : 'gitOps')
      const msg = { t: 'git.log', repo, ref: ref ?? null, skip, limit: LOG_PAGE, filter } as const
      const res = await ask(target, msg, 'git.log.result')
      return { commits: res.commits, hasMore: res.hasMore }
    })

    app.get('/api/groups/:id/bots/:botId/git/show', async (req: Req): Promise<GitShowDto> => {
      const { repo, commit } = GitShowQuery.parse(req.query)
      const { target } = await member(req, 'gitOps3')
      const res = await ask(target, { t: 'git.show', repo, commit }, 'git.show.result')
      if (!res.commit) return fail('not_found', '提交不存在')
      const redact = await groupRedactor(ctx, target.group.id)
      const { committer, committerEmail, committedAt, branches } = res
      return { commit: res.commit, body: redact(res.body), committer, committerEmail, committedAt, branches }
    })

    app.get('/api/groups/:id/bots/:botId/git/tree', async (req: Req): Promise<FilesTreeDto> => {
      const q = GitRefPathQuery.parse(req.query)
      const { target } = await member(req, q.repo ? 'gitOps3' : 'gitOps')
      const path = strip(q.path)
      const res = await ask(target, { t: 'git.tree', repo: q.repo, ref: q.ref, path }, 'git.tree.result')
      return { path, entries: res.entries, truncated: res.truncated }
    })

    app.get('/api/groups/:id/bots/:botId/git/text', async (req: Req): Promise<FileTextDto> => {
      const q = GitRefPathQuery.parse(req.query)
      const { target } = await member(req, q.repo ? 'gitOps3' : 'gitOps')
      const path = strip(q.path)
      if (!path) return fail('invalid', '缺少文件路径')
      const msg = { t: 'git.read', repo: q.repo, ref: q.ref, path, maxBytes: FILE_TEXT_MAX_BYTES } as const
      const res = await ask(target, msg, 'git.read.result')
      return { path, size: res.size, binary: res.binary, mime: res.mime, text: res.text }
    })

    app.get('/api/groups/:id/bots/:botId/git/compare', async (req: Req): Promise<GitCompareDto> => {
      const { repo, from, to } = GitCompareQuery.parse(req.query)
      const { target } = await member(req, repo ? 'gitOps3' : 'gitOps')
      const res = await ask(target, { t: 'git.compare', repo, from, to: to ?? null }, 'git.compare.result')
      return { changes: res.changes }
    })

    app.get('/api/groups/:id/bots/:botId/git/diff', async (req: Req): Promise<GitDiffDto> => {
      const q = GitDiffQuery.parse(req.query)
      const options = setOnly({ ignoreWhitespace: q.ignoreWhitespace, context: q.context })
      const { target } = await member(req, q.repo || options || q.whitespace ? 'gitOps3' : 'gitOps2')
      const machineId = target.bot.machineId
      // An older daemon gets what it always did: any whitespace mode as ignoring it all, the rename's two sides apart.
      const modes =
        machineId && ctx.hub.features(machineId).includes('gitOps4')
          ? setOnly({ oldPath: (q.oldPath && strip(q.oldPath)) || undefined, whitespace: q.whitespace })
          : q.whitespace && { ignoreWhitespace: true }
      const msg = {
        t: 'git.diff',
        repo: q.repo,
        from: q.from,
        to: q.to ?? null,
        path: (q.path && strip(q.path)) || null,
        maxBytes: DIFF_MAX_BYTES,
        ...options,
        ...modes,
      } as const
      const res = await ask(target, msg, 'git.diff.result')
      const redact = await groupRedactor(ctx, target.group.id)
      return { patch: res.patch && redact(res.patch), truncated: res.truncated }
    })

    app.get('/api/groups/:id/bots/:botId/git/changes', async (req: Req): Promise<GitChangesDto> => {
      const { repo } = GitChangesQuery.parse(req.query)
      const { target } = await member(req, repo ? 'gitOps3' : 'gitOps')
      const machineId = target.bot.machineId
      if (!repo && !(machineId && ctx.hub.features(machineId).includes('gitOps3'))) {
        const msg = { t: 'git.compare', from: 'HEAD', to: null } as const
        const { changes } = await ask(target, msg, 'git.compare.result')
        const plain = { untracked: false, add: null, del: null }
        return {
          changes: changes.map((c) => ({ ...c, ...plain })),
          conflicts: [],
          ongoing: null,
          head: null,
          limited: true,
        }
      }
      const res = await ask(target, { t: 'git.changes', repo }, 'git.changes.result')
      return {
        changes: res.changes,
        conflicts: res.conflicts,
        ongoing: res.ongoing,
        head: res.head,
        limited: false,
      }
    })

    app.get('/api/groups/:id/bots/:botId/git/blame', async (req: Req): Promise<GitBlameDto> => {
      const q = GitBlameQuery.parse(req.query)
      const { target } = await member(req, 'gitOps3')
      const path = strip(q.path)
      if (!path) return fail('invalid', '缺少文件路径')
      const res = await ask(
        target,
        { t: 'git.blame', repo: q.repo, ref: q.ref ?? null, path },
        'git.blame.result',
      )
      return { ranges: res.ranges, commits: res.commits }
    })

    app.get('/api/groups/:id/bots/:botId/git/stashes', async (req: Req): Promise<GitStashesDto> => {
      const { repo } = GitStashesQuery.parse(req.query)
      const { target } = await member(req, 'gitOps3')
      const res = await ask(target, { t: 'git.stashes', repo }, 'git.stashes.result')
      return { stashes: res.stashes }
    })

    app.get('/api/groups/:id/bots/:botId/git/conflict', async (req: Req): Promise<GitConflictDto> => {
      const q = GitConflictQuery.parse(req.query)
      const { target } = await member(req, 'gitOps3')
      const path = strip(q.path)
      if (!path) return fail('invalid', '缺少文件路径')
      const msg = { t: 'git.conflict', repo: q.repo, path, maxBytes: GIT_RESOLVE_MAX_BYTES } as const
      const res = await ask(target, msg, 'git.conflict.result')
      const redact = await groupRedactor(ctx, target.group.id)
      const text = (s: string | null) => s && redact(s)
      return {
        base: text(res.base),
        ours: text(res.ours),
        theirs: text(res.theirs),
        merged: text(res.merged),
        binary: res.binary,
      }
    })

    app.post('/api/groups/:id/bots/:botId/git/refresh', async (req: Req, reply: FastifyReply) => {
      const { target } = await member(req, 'gitOps2')
      const { fetch } = GitRefreshReq.parse(req.body ?? {})
      await ask(
        target,
        { t: 'git.refresh', fetch },
        'git.refresh.result',
        fetch ? FETCH_TIMEOUT_MS : READ_TIMEOUT_MS,
      )
      return reply.code(204).send()
    })

    app.post(
      '/api/groups/:id/bots/:botId/git/actions',
      { bodyLimit: ACTION_BODY_LIMIT },
      async (req: Req): Promise<GitOperationDto> => {
        const me = await requireUser(ctx, req)
        const { group } = await requireMember(ctx, req.params.id, me.id)
        const body = GitActionReq.parse(req.body)
        assertValid(body)
        const asked = fields(body)
        const target = await gitTarget(ctx, group, req.params.botId, featureFor(asked))
        const { op: columns, pushesBase } = await guardBase(ctx, asked, target)
        const owner = target.bot.ownerId === me.id
        if (owner) {
          if (pushesBase && body.action === 'push' && !body.confirmBase)
            fail('conflict', '推送基准分支需要再次确认')
          await assertIdle(ctx, target)
        }
        const [op] = (await ctx.db
          .insert(gitOperations)
          .values({
            groupId: target.group.id,
            botId: target.bot.id,
            ...columns,
            pushesBase,
            status: owner ? 'running' : 'pending_approval',
            requestedBy: me.id,
            createdAt: ctx.now(),
            expiresAt: new Date(ctx.now().getTime() + PENDING_MS),
          })
          .returning()) as [GitOperation]
        if (owner) return run(op, target, true)
        await notify(ctx, target.bot.ownerId, 'git_operation_request', {
          groupId: target.group.id,
          botId: target.bot.id,
          botName: target.bot.name,
          byName: me.name,
          summary: summary(op),
          operationId: op.id,
        })
        await audit(ctx, {
          category: 'admin',
          actorUserId: me.id,
          groupId: target.group.id,
          action: 'git.request',
          detail: auditDetail(op),
        })
        return publishOperation(ctx, op)
      },
    )

    app.post<{ Params: { id: string } }>(
      '/api/git-operations/:id/decide',
      async (req): Promise<GitOperationDto> => {
        const me = await requireUser(ctx, req)
        const { approve } = DecideGitOperationReq.parse(req.body)
        const [row] = await ctx.db
          .select({ op: gitOperations, group: groups })
          .from(gitOperations)
          .innerJoin(groups, eq(groups.id, gitOperations.groupId))
          .where(eq(gitOperations.id, idParam(req.params.id, '操作不存在')))
        if (!row) return fail('not_found', '操作不存在')
        await requireMember(ctx, row.group.id, me.id)
        const target = await gitTarget(ctx, row.group, row.op.botId, approve ? featureFor(row.op) : 'gitOps')
        if (target.bot.ownerId !== me.id) return fail('forbidden', '只有 Bot 主人可以处理 Git 操作申请')
        if (row.op.status !== 'pending_approval') return fail('conflict', '该操作已处理')
        if (row.op.expiresAt <= ctx.now()) return fail('conflict', '该操作已过期')
        const guarded = approve ? await guardBase(ctx, row.op, target) : undefined
        if (guarded) {
          // An approval confirms the push the owner was shown, not one found to land on the base branch only now.
          if (guarded.pushesBase && !row.op.pushesBase) fail('conflict', '推送基准分支需要再次确认')
          await assertIdle(ctx, target)
        }
        const [op] = await ctx.db
          .update(gitOperations)
          .set({
            status: approve ? 'running' : 'rejected',
            decidedBy: me.id,
            ...(guarded && { args: guarded.op.args }),
            ...(!approve && { finishedAt: ctx.now() }),
          })
          .where(and(eq(gitOperations.id, row.op.id), eq(gitOperations.status, 'pending_approval')))
          .returning()
        if (!op) return fail('conflict', '该操作已处理')
        await resolveNotifications(ctx, 'git_operation_request', 'operationId', [op.id])
        await audit(ctx, {
          category: 'admin',
          actorUserId: me.id,
          groupId: op.groupId,
          action: 'git.decide',
          detail: { operationId: op.id, botId: op.botId, action: op.action, approve },
        })
        return approve ? run(op, target, false) : publishOperation(ctx, op)
      },
    )

    app.get<{ Params: { id: string } }>(
      '/api/groups/:id/git/operations',
      async (req): Promise<GitOperationsDto> => {
        const me = await requireUser(ctx, req)
        const { group } = await requireMember(ctx, req.params.id, me.id)
        const [pending, done] = await Promise.all([
          ctx.db
            .select()
            .from(gitOperations)
            .where(and(eq(gitOperations.groupId, group.id), eq(gitOperations.status, 'pending_approval'))),
          ctx.db
            .select()
            .from(gitOperations)
            .where(and(eq(gitOperations.groupId, group.id), ne(gitOperations.status, 'pending_approval')))
            .orderBy(desc(gitOperations.createdAt))
            .limit(SETTLED_SHOWN),
        ])
        const rows = [...pending, ...done].sort((a, b) => b.createdAt.getTime() - a.createdAt.getTime())
        return { operations: await operationDtos(ctx, rows) }
      },
    )
  }
}
