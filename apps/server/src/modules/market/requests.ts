import {
  DecideInstallRequestReq,
  type InstallRequestDto,
  InstallRequestReq,
  type InstallRequestStatus,
} from '@gonggong/protocol'
import { and, desc, eq, exists, inArray, or, type SQL, sql } from 'drizzle-orm'
import { alias } from 'drizzle-orm/pg-core'
import type { FastifyInstance } from 'fastify'
import { z } from 'zod'
import type { Ctx } from '../../context.js'
import type { Db } from '../../db/client.js'
import {
  groupMembers,
  groups,
  installRequests,
  installs,
  plugins,
  pluginVersions,
  repos,
  teamMembers,
  teams,
  users,
} from '../../db/schema.js'
import { fail } from '../../lib/errors.js'
import { idParam } from '../../lib/ids.js'
import { requireUser, type SessionUser } from '../auth/session.js'
import { requireAdmin, requireMember } from '../groups/service.js'
import { notify, resolveNotifications } from '../notifications/notify.js'
import { requireTeam } from '../teams/service.js'
import { ADMIN_ROLES, inScope, installable, listingSummary, putInstall, type Target } from './service.js'

type Read = Pick<Db, 'select'>
type ScopeTarget = Extract<Target, { teamId: string }>

/** The request's target for a member of it; `admin`: one who may install there directly. */
async function resolveTarget(
  ctx: Ctx,
  scope: ScopeTarget['scope'],
  scopeId: string,
  userId: string,
  admin: boolean,
): Promise<{ target: ScopeTarget; label: string }> {
  if (scope === 'group') {
    const { group } = await (admin ? requireAdmin : requireMember)(ctx, scopeId, userId)
    return {
      target: { scope, scopeId: group.id, teamId: group.teamId, groupId: group.id },
      label: group.name,
    }
  }
  const [repo] =
    scope === 'repo'
      ? await ctx.db
          .select({ id: repos.id, teamId: repos.teamId, name: repos.name })
          .from(repos)
          .where(eq(repos.id, idParam(scopeId, '仓库不存在')))
      : []
  if (scope === 'repo' && !repo) return fail('not_found', '仓库不存在')
  const { team } = await requireTeam(ctx, userId, repo?.teamId ?? scopeId, admin ? 'admin' : 'member')
  return {
    target: { scope, scopeId: repo?.id ?? team.id, teamId: team.id, groupId: null },
    label: repo ? `${team.name} / ${repo.name}` : team.name,
  }
}

async function adminIds(db: Read, t: ScopeTarget) {
  const rows =
    t.scope === 'group'
      ? await db
          .select({ id: groupMembers.userId })
          .from(groupMembers)
          .where(and(eq(groupMembers.groupId, t.scopeId), eq(groupMembers.isAdmin, true)))
      : await db
          .select({ id: teamMembers.userId })
          .from(teamMembers)
          .where(and(eq(teamMembers.teamId, t.teamId), inArray(teamMembers.role, ADMIN_ROLES)))
  return rows.map((r) => r.id)
}

const current = alias(pluginVersions, 'current')
const requester = alias(users, 'requester')
const decider = alias(users, 'decider')
const targetTeam = alias(teams, 'target_team')

const requestRows = (db: Read, where: SQL | undefined) =>
  db
    .select({
      r: installRequests,
      listing: plugins,
      current: { id: current.id, revision: current.revision, manifest: current.manifest },
      requester: requester.name,
      decider: decider.name,
      groupName: groups.name,
      teamName: targetTeam.name,
      repoName: repos.name,
    })
    .from(installRequests)
    .innerJoin(plugins, eq(plugins.id, installRequests.listingId))
    .innerJoin(current, eq(current.id, sql`coalesce(${plugins.listedVersionId}, ${plugins.versionId})`))
    .innerJoin(requester, eq(requester.id, installRequests.requesterId))
    .leftJoin(decider, eq(decider.id, installRequests.decidedBy))
    .leftJoin(groups, and(eq(installRequests.scope, 'group'), eq(groups.id, installRequests.scopeId)))
    .leftJoin(repos, and(eq(installRequests.scope, 'repo'), eq(repos.id, installRequests.scopeId)))
    .leftJoin(
      targetTeam,
      or(
        and(eq(installRequests.scope, 'team'), eq(targetTeam.id, installRequests.scopeId)),
        eq(targetTeam.id, repos.teamId),
      ),
    )
    .where(where)
    .orderBy(desc(installRequests.createdAt))

/** Requests the user may decide: group ones as a group admin, team and repo ones as a team admin. */
const decidableBy = (db: Read, userId: string) =>
  or(
    and(
      eq(installRequests.scope, 'group'),
      exists(
        db
          .select({ one: sql`1` })
          .from(groupMembers)
          .where(
            and(
              eq(groupMembers.groupId, installRequests.scopeId),
              eq(groupMembers.userId, userId),
              eq(groupMembers.isAdmin, true),
            ),
          ),
      ),
    ),
    exists(
      db
        .select({ one: sql`1` })
        .from(teamMembers)
        .where(
          and(
            eq(teamMembers.teamId, targetTeam.id),
            eq(teamMembers.userId, userId),
            inArray(teamMembers.role, ADMIN_ROLES),
          ),
        ),
    ),
  )

async function requestDtos(db: Read, where: SQL | undefined) {
  const rows = await requestRows(db, where)
  return rows.map(
    (x): InstallRequestDto => ({
      id: x.r.id,
      listing: listingSummary(x.listing, x.current),
      scope: x.r.scope as InstallRequestDto['scope'],
      scopeId: x.r.scopeId,
      targetLabel:
        (x.r.scope === 'group'
          ? x.groupName
          : x.r.scope === 'repo'
            ? `${x.teamName} / ${x.repoName}`
            : x.teamName) ?? '',
      pinVersionId: x.r.pinVersionId,
      note: x.r.note,
      status: x.r.status as InstallRequestStatus,
      requester: x.requester,
      decidedBy: x.decider,
      decisionNote: x.r.decisionNote,
      createdAt: x.r.createdAt.toISOString(),
      decidedAt: x.r.decidedAt?.toISOString() ?? null,
    }),
  )
}

const requestDto = async (db: Read, id: string) => (await requestDtos(db, eq(installRequests.id, id)))[0]!

export const listRequests = (db: Read, userId: string, view: 'mine' | 'todo') =>
  requestDtos(
    db,
    view === 'mine'
      ? eq(installRequests.requesterId, userId)
      : and(eq(installRequests.status, 'pending'), decidableBy(db, userId)),
  )

export async function createRequest(ctx: Ctx, me: SessionUser, req: InstallRequestReq) {
  const { target, label } = await resolveTarget(ctx, req.scope, req.scopeId, me.id, false)
  const listingId = idParam(req.listingId, '条目不存在')
  const [installed] = await ctx.db
    .select({ id: installs.id })
    .from(installs)
    .where(and(eq(installs.listingId, listingId), inScope(target)))
  if (installed) fail('conflict', '该条目已经引入')
  const [listing] = await installable(ctx.db, target, eq(plugins.id, listingId))
  if (!listing) return fail('not_found', '条目不存在')
  const pin = req.pinVersionId && idParam(req.pinVersionId, '版本不存在')
  if (pin) {
    const [v] = await ctx.db
      .select({ id: pluginVersions.id })
      .from(pluginVersions)
      .where(
        and(
          eq(pluginVersions.id, pin),
          eq(pluginVersions.pluginId, listingId),
          eq(pluginVersions.reviewStatus, 'approved'),
        ),
      )
    if (!v) fail('not_found', '版本不存在')
  }
  const [row] = await ctx.db
    .insert(installRequests)
    .values({
      listingId,
      scope: target.scope,
      scopeId: target.scopeId,
      pinVersionId: pin || null,
      note: req.note,
      requesterId: me.id,
    })
    .onConflictDoNothing()
    .returning({ id: installRequests.id })
  if (!row) return fail('conflict', '已有待处理的申请')
  for (const userId of await adminIds(ctx.db, target))
    if (userId !== me.id)
      await notify(
        ctx,
        userId,
        'install_request',
        {
          requestId: row.id,
          requesterName: me.name,
          listingName: listing.title,
          targetLabel: label,
        },
        target.teamId,
      )
  return requestDto(ctx.db, row.id)
}

async function findRequest(db: Read, id: string) {
  const [row] = await db
    .select({ r: installRequests })
    .from(installRequests)
    .where(eq(installRequests.id, idParam(id, '申请不存在')))
  return row ?? fail('not_found', '申请不存在')
}

/** Approval installs in the same transaction: a conflict leaves the request pending. */
export async function decideRequest(ctx: Ctx, me: SessionUser, id: string, req: DecideInstallRequestReq) {
  const { r } = await findRequest(ctx.db, id)
  if (r.status !== 'pending') fail('conflict', '这条申请已经处理过了')
  const { target, label } = await resolveTarget(ctx, r.scope as ScopeTarget['scope'], r.scopeId, me.id, true)
  await ctx.db.transaction(async (tx) => {
    const [claimed] = await tx
      .update(installRequests)
      .set({
        status: req.approve ? 'approved' : 'rejected',
        decidedBy: me.id,
        decisionNote: req.note || null,
        decidedAt: ctx.now(),
      })
      .where(and(eq(installRequests.id, r.id), eq(installRequests.status, 'pending')))
      .returning({ id: installRequests.id })
    if (!claimed) fail('not_found', '申请不存在或已处理')
    // putInstall only reads and writes through `db`, which the transaction stands in for.
    if (req.approve)
      await putInstall(
        { ...ctx, db: tx as unknown as Db },
        target,
        r.listingId,
        { enabled: true, pinVersionId: r.pinVersionId },
        me.id,
      )
  })
  await resolveNotifications(ctx, 'install_request', 'requestId', [r.id])
  const dto = await requestDto(ctx.db, r.id)
  await notify(
    ctx,
    r.requesterId,
    'install_request_decided',
    {
      listingName: dto.listing.title,
      targetLabel: label,
      approved: req.approve,
      note: req.note,
    },
    target.teamId,
  )
  return dto
}

export async function cancelRequest(ctx: Ctx, me: SessionUser, id: string) {
  const { r } = await findRequest(ctx.db, id)
  if (r.requesterId !== me.id) fail('forbidden', '只有申请人可以撤回')
  const [done] = await ctx.db
    .update(installRequests)
    .set({ status: 'cancelled', decidedAt: ctx.now() })
    .where(and(eq(installRequests.id, r.id), eq(installRequests.status, 'pending')))
    .returning({ id: installRequests.id })
  if (!done) fail('conflict', '申请已处理')
  await resolveNotifications(ctx, 'install_request', 'requestId', [r.id], undefined, { cancelled: true })
}

const View = z.object({ view: z.enum(['mine', 'todo']) })

/** 申请引入 (plan Skill市场-M4): members ask, the target's admins approve or reject, the requester may cancel. */
export function requestRoutes(ctx: Ctx, app: FastifyInstance) {
  type P = { Params: { id: string } }
  app.post('/api/install-requests', async (req, reply) => {
    const me = await requireUser(ctx, req)
    return reply.status(201).send(await createRequest(ctx, me, InstallRequestReq.parse(req.body)))
  })

  app.get('/api/install-requests', async (req) => {
    const me = await requireUser(ctx, req)
    return listRequests(ctx.db, me.id, View.parse(req.query).view)
  })

  app.post<P>('/api/install-requests/:id/decide', async (req) => {
    const me = await requireUser(ctx, req)
    return decideRequest(ctx, me, req.params.id, DecideInstallRequestReq.parse(req.body))
  })

  app.delete<P>('/api/install-requests/:id', async (req, reply) => {
    await cancelRequest(ctx, await requireUser(ctx, req), req.params.id)
    return reply.status(204).send()
  })
}
