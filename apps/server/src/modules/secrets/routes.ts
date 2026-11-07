import {
  CreateSecretReq,
  FillSecretReq,
  type MySecretDto,
  SetMySecretReq,
  UpdateSecretReq,
} from '@gonggong/protocol'
import { and, asc, eq, inArray, isNull, ne, or } from 'drizzle-orm'
import type { FastifyInstance, FastifyRequest } from 'fastify'
import type { Ctx } from '../../context.js'
import { groupMembers, groups, personalSecrets, secrets, teams } from '../../db/schema.js'
import { fail } from '../../lib/errors.js'
import { idParam } from '../../lib/ids.js'
import { isLayerAdmin } from '../agent-tools/layers.js'
import { requireSysadmin, requireUser } from '../auth/session.js'
import { requireAdmin, requireMember } from '../groups/service.js'
import type { Layer } from '../mcp/service.js'
import { currentTeam, requireTeam } from '../teams/service.js'
import { fillSecretRequest, pendingSecretCards } from './requests.js'
import { RANK, type SecretRow, visibleSecrets } from './resolve.js'
import {
  clearPersonal,
  createSecret,
  deleteSecret,
  inSecretLayer,
  layerOfRow,
  overriddenIds,
  secretDtos,
  setPersonal,
  updateSecret,
} from './service.js'

type Req = FastifyRequest<{ Params: { id?: string } }>
/** `read`: listing, open to the layer's members. */
type Authorize = (req: Req, read?: boolean) => Promise<{ actorId: string; layer: Layer }>

const byName = (a: SecretRow, b: SecretRow) =>
  a.name.localeCompare(b.name) || (RANK[a.scope] ?? 0) - (RANK[b.scope] ?? 0)

async function findSecret(ctx: Ctx, id: string) {
  const [row] = await ctx.db
    .select()
    .from(secrets)
    .where(eq(secrets.id, idParam(id, '密钥不存在')))
  return row ?? fail('not_found', '密钥不存在')
}

/** Admins of the row's layer; anyone else learns nothing about it. */
async function requireLayerAdmin(ctx: Ctx, req: FastifyRequest, row: SecretRow) {
  const me = await requireUser(ctx, req)
  if (!(await isLayerAdmin(ctx, me.id, layerOfRow(row)))) fail('not_found', '密钥不存在')
  return me
}

/** A definition the member can see: platform, one of their teams, one of their groups. */
async function requireVisible(ctx: Ctx, userId: string, row: SecretRow) {
  if (row.scope === 'team') await requireTeam(ctx, userId, row.teamId ?? '')
  if (row.scope === 'group') await requireMember(ctx, row.groupId ?? '', userId)
}

export function secretRoutes(ctx: Ctx) {
  return async (app: FastifyInstance) => {
    const layer = (base: string, authorize: Authorize) => {
      app.get<{ Params: { id?: string } }>(base, async (req) => {
        const { layer: l } = await authorize(req, true)
        const rows = await ctx.db.select().from(secrets).where(inSecretLayer(l))
        return secretDtos(ctx.db, rows.sort(byName), l.teamId)
      })
      app.post<{ Params: { id?: string } }>(base, async (req, reply) => {
        const { actorId, layer: l } = await authorize(req)
        const row = await createSecret(ctx, l, CreateSecretReq.parse(req.body), actorId)
        const [dto] = await secretDtos(ctx.db, [row], l.teamId)
        return reply.status(201).send(dto)
      })
    }
    layer('/api/admin/secrets', async (req) => ({
      actorId: (await requireSysadmin(ctx, req)).id,
      layer: { scope: 'platform', teamId: null, groupId: null },
    }))
    layer('/api/teams/:id/secrets', async (req, read) => {
      const me = await requireUser(ctx, req)
      const { team } = await requireTeam(ctx, me.id, req.params.id ?? '', read ? 'member' : 'admin')
      return { actorId: me.id, layer: { scope: 'team', teamId: team.id, groupId: null } }
    })
    // Group admins write the group layer; members also see the inherited rows, marked when a lower row wins.
    app.get<{ Params: { id: string } }>('/api/groups/:id/secrets', async (req) => {
      const me = await requireUser(ctx, req)
      const { group } = await requireMember(ctx, req.params.id, me.id)
      const rows = (await visibleSecrets(ctx.db, group.id)).sort(byName)
      return secretDtos(ctx.db, rows, group.teamId, overriddenIds(rows))
    })
    app.post<{ Params: { id: string } }>('/api/groups/:id/secrets', async (req, reply) => {
      const me = await requireUser(ctx, req)
      const { group } = await requireAdmin(ctx, req.params.id, me.id)
      const l: Layer = { scope: 'group', teamId: group.teamId, groupId: group.id }
      const row = await createSecret(ctx, l, CreateSecretReq.parse(req.body), me.id)
      const [dto] = await secretDtos(ctx.db, [row], group.teamId)
      return reply.status(201).send(dto)
    })

    app.patch<{ Params: { id: string } }>('/api/secrets/:id', async (req) => {
      const row = await findSecret(ctx, req.params.id)
      const me = await requireLayerAdmin(ctx, req, row)
      const saved = await updateSecret(ctx, row, UpdateSecretReq.parse(req.body), me.id)
      return (await secretDtos(ctx.db, [saved], saved.teamId))[0]
    })
    app.delete<{ Params: { id: string } }>('/api/secrets/:id', async (req, reply) => {
      const row = await findSecret(ctx, req.params.id)
      const me = await requireLayerAdmin(ctx, req, row)
      await deleteSecret(ctx, row, me.id)
      return reply.status(204).send()
    })

    app.get('/api/me/secrets', async (req) => {
      const me = await requireUser(ctx, req)
      return mySecrets(ctx, me.id, await currentTeam(ctx, req, me.id))
    })
    app.put<{ Params: { secretId: string } }>('/api/me/secrets/:secretId', async (req) => {
      const me = await requireUser(ctx, req)
      const row = await findSecret(ctx, req.params.secretId)
      await requireVisible(ctx, me.id, row)
      if (row.mode === 'shared') fail('invalid', '该密钥只用统一值，不能填写个人值')
      const teamId = row.teamId ?? (await currentTeam(ctx, req, me.id))
      const body = SetMySecretReq.parse(req.body)
      // The setting is only changed when sent (it defaults to false for a new value).
      const allow = (req.body as { allowForeignMachines?: unknown } | null)?.allowForeignMachines
      await setPersonal(
        ctx,
        { userId: me.id, teamId, name: row.name },
        body.value,
        allow === undefined ? undefined : body.allowForeignMachines,
      )
      const mine = await mySecrets(ctx, me.id, teamId, row.id)
      return mine[0]
    })
    app.delete<{ Params: { secretId: string } }>('/api/me/secrets/:secretId', async (req, reply) => {
      const me = await requireUser(ctx, req)
      const row = await findSecret(ctx, req.params.secretId)
      await requireVisible(ctx, me.id, row)
      const teamId = row.teamId ?? (await currentTeam(ctx, req, me.id))
      await clearPersonal(ctx, { userId: me.id, teamId, name: row.name })
      return reply.status(204).send()
    })

    app.get<{ Params: { groupId: string } }>('/api/groups/:groupId/secret-requests', async (req) => {
      const me = await requireUser(ctx, req)
      return pendingSecretCards(ctx, me.id, idParam(req.params.groupId, '群不存在或你已不在群内'))
    })
    app.post<{ Params: { id: string } }>('/api/secret-requests/:id', async (req) => {
      const me = await requireUser(ctx, req)
      return fillSecretRequest(
        ctx,
        me.id,
        idParam(req.params.id, '密钥请求不存在'),
        FillSecretReq.parse(req.body),
      )
    })
  }
}

/**
 * Definitions of the team the member may fill a value for: platform rows (their value is kept per team), the
 * team's and those of the team's groups they are in. `only` narrows to one definition.
 */
async function mySecrets(ctx: Ctx, userId: string, teamId: string, only?: string): Promise<MySecretDto[]> {
  const mine = ctx.db
    .select({ id: groupMembers.groupId })
    .from(groupMembers)
    .where(eq(groupMembers.userId, userId))
  const rows = await ctx.db
    .select({ s: secrets, team: teams.name, group: groups.name })
    .from(secrets)
    .leftJoin(teams, eq(teams.id, teamId))
    .leftJoin(groups, eq(groups.id, secrets.groupId))
    .where(
      and(
        ne(secrets.mode, 'shared'),
        only ? eq(secrets.id, only) : undefined,
        or(
          eq(secrets.scope, 'platform'),
          and(eq(secrets.scope, 'team'), eq(secrets.teamId, teamId)),
          and(
            eq(secrets.scope, 'group'),
            eq(secrets.teamId, teamId),
            inArray(secrets.groupId, mine),
            isNull(groups.archivedAt),
          ),
        ),
      ),
    )
    .orderBy(asc(secrets.name))
  const values = rows.length
    ? await ctx.db
        .select()
        .from(personalSecrets)
        .where(
          and(
            eq(personalSecrets.userId, userId),
            eq(personalSecrets.teamId, teamId),
            inArray(
              personalSecrets.name,
              rows.map((r) => r.s.name),
            ),
          ),
        )
    : []
  return rows.map(({ s, team, group }) => {
    const v = values.find((p) => p.name === s.name)
    return {
      secret: {
        id: s.id,
        scope: s.scope as MySecretDto['secret']['scope'],
        teamId: s.teamId,
        groupId: s.groupId,
        name: s.name,
        description: s.description,
        mode: s.mode as MySecretDto['secret']['mode'],
        expiresAt: s.expiresAt?.toISOString() ?? null,
      },
      where: group ?? team ?? '',
      mine: v
        ? {
            last4: v.last4,
            updatedBy: null,
            updatedAt: v.updatedAt.toISOString(),
            allowForeignMachines: v.allowForeignMachines,
          }
        : null,
    }
  })
}
