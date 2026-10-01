import { type AdminTeamDto, CreateAdminTeamReq, SetTeamOwnerReq } from '@gonggong/protocol'
import { and, asc, count, eq, isNull, ne, type SQL } from 'drizzle-orm'
import type { FastifyInstance } from 'fastify'
import type { Ctx } from '../../context.js'
import { teamMembers, teams, users } from '../../db/schema.js'
import { audit } from '../../lib/audit.js'
import { fail } from '../../lib/errors.js'
import { idParam } from '../../lib/ids.js'
import { requireSysadmin } from '../auth/session.js'
import { publishMember, publishTeam } from '../teams/dto.js'
import { archiveTeam } from '../teams/members.js'
import { createTeam } from '../teams/service.js'
import { sysParams } from './params.js'

type P = { Params: { id: string } }

async function adminTeamDtos(ctx: Ctx, where?: SQL): Promise<AdminTeamDto[]> {
  const [rows, people] = await Promise.all([
    ctx.db.select().from(teams).where(where).orderBy(asc(teams.createdAt)),
    ctx.db
      .select({ teamId: teamMembers.teamId, userId: users.id, name: users.name, role: teamMembers.role })
      .from(teamMembers)
      .innerJoin(users, eq(users.id, teamMembers.userId))
      .where(isNull(users.disabledAt))
      .orderBy(asc(teamMembers.joinedAt)),
  ])
  return rows.map((team) => {
    const members = people.filter((p) => p.teamId === team.id)
    const owner = members.find((m) => m.role === 'owner')
    return {
      id: team.id,
      name: team.name,
      avatar: team.avatar,
      ownerId: owner?.userId ?? null,
      ownerName: owner?.name ?? null,
      members: members.length,
      archivedAt: team.archivedAt?.toISOString() ?? null,
      createdAt: team.createdAt.toISOString(),
    }
  })
}

/** 管理后台 · 团队 (plan §4): platform governance of teams; sysadmins are not members of them (D3). */
export function adminTeamRoutes(ctx: Ctx) {
  const one = async (id: string) =>
    (await adminTeamDtos(ctx, eq(teams.id, id)))[0] ?? fail('not_found', '团队不存在')

  const load = async (id: string) => {
    const [team] = await ctx.db
      .select()
      .from(teams)
      .where(eq(teams.id, idParam(id, '团队不存在')))
    return team ?? fail('not_found', '团队不存在')
  }

  const enabledUser = async (id: string) => {
    const [user] = await ctx.db
      .select({ id: users.id, name: users.name })
      .from(users)
      .where(and(eq(users.id, idParam(id, '账号不存在')), isNull(users.disabledAt)))
    return user ?? fail('not_found', '账号不存在')
  }

  /** Plan D11: single-team mode keeps exactly one live team. */
  const assertMayAddLiveTeam = async () => {
    if (!(await sysParams(ctx.db)).singleTeamMode) return
    const [live] = await ctx.db.select({ n: count() }).from(teams).where(isNull(teams.archivedAt))
    if (live?.n) fail('forbidden', '单团队模式下不能新建团队')
  }

  return async (app: FastifyInstance) => {
    app.get('/api/admin/teams', async (req) => {
      await requireSysadmin(ctx, req)
      return adminTeamDtos(ctx)
    })

    app.post('/api/admin/teams', async (req, reply) => {
      const actor = await requireSysadmin(ctx, req)
      const body = CreateAdminTeamReq.parse(req.body)
      await assertMayAddLiveTeam()
      const owner = await enabledUser(body.ownerId)
      const team = await ctx.db.transaction((tx) => createTeam(tx, body.name, owner.id))
      await audit(ctx, {
        category: 'admin',
        actorUserId: actor.id,
        teamId: team.id,
        action: 'team.create',
        detail: { name: team.name, ownerId: owner.id },
      })
      await publishMember(ctx, team.id, owner.id)
      return reply.status(201).send(await one(team.id))
    })

    app.post<P>('/api/admin/teams/:id/archive', async (req) => {
      const actor = await requireSysadmin(ctx, req)
      const team = await load(req.params.id)
      if (!team.archivedAt) await archiveTeam(ctx, team, actor)
      return one(team.id)
    })

    app.post<P>('/api/admin/teams/:id/unarchive', async (req) => {
      const actor = await requireSysadmin(ctx, req)
      const team = await load(req.params.id)
      if (!team.archivedAt) return fail('conflict', '该团队未归档')
      await assertMayAddLiveTeam()
      await ctx.db.update(teams).set({ archivedAt: null }).where(eq(teams.id, team.id))
      await audit(ctx, {
        category: 'admin',
        actorUserId: actor.id,
        teamId: team.id,
        action: 'team.unarchive',
        detail: { name: team.name },
      })
      await publishTeam(ctx, team.id)
      return one(team.id)
    })

    // The account becomes an owner (joining if needed); the previous owners stay on as admins.
    app.put<P>('/api/admin/teams/:id/owner', async (req) => {
      const actor = await requireSysadmin(ctx, req)
      const team = await load(req.params.id)
      const user = await enabledUser(SetTeamOwnerReq.parse(req.body).userId)
      const demoted = await ctx.db.transaction(async (tx) => {
        const rows = await tx
          .update(teamMembers)
          .set({ role: 'admin' })
          .where(
            and(
              eq(teamMembers.teamId, team.id),
              eq(teamMembers.role, 'owner'),
              ne(teamMembers.userId, user.id),
            ),
          )
          .returning({ userId: teamMembers.userId })
        await tx
          .insert(teamMembers)
          .values({ teamId: team.id, userId: user.id, role: 'owner' })
          .onConflictDoUpdate({ target: [teamMembers.teamId, teamMembers.userId], set: { role: 'owner' } })
        return rows
      })
      await audit(ctx, {
        category: 'admin',
        actorUserId: actor.id,
        teamId: team.id,
        action: 'team.owner',
        detail: { userId: user.id, name: user.name },
      })
      if (!team.archivedAt)
        for (const userId of [user.id, ...demoted.map((d) => d.userId)])
          await publishMember(ctx, team.id, userId)
      return one(team.id)
    })
  }
}
