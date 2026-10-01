import { and, asc, eq, inArray, isNull, lt, or, sql } from 'drizzle-orm'
import type { Ctx } from '../../context.js'
import {
  bots,
  groupBots,
  groupMembers,
  groups,
  teamInvites,
  teamMembers,
  teams,
  users,
} from '../../db/schema.js'
import { audit } from '../../lib/audit.js'
import { sha256 } from '../../lib/crypto.js'
import { fail } from '../../lib/errors.js'
import type { SessionUser } from '../auth/session.js'
import { publishBotRemoved } from '../bots/dto.js'
import { publishGroup, removeMember } from '../groups/service.js'
import { postEvent } from '../messages/service.js'
import { stopRuns } from '../runs/stop.js'
import { publishMember } from './dto.js'
import { teamUserIds } from './service.js'

type User = { id: string; name: string }

/** A group left without an admin gets its earliest remaining member as one. */
async function appointHeir(ctx: Ctx, groupId: string) {
  const rest = await ctx.db
    .select({ userId: groupMembers.userId, isAdmin: groupMembers.isAdmin, name: users.name })
    .from(groupMembers)
    .innerJoin(users, eq(users.id, groupMembers.userId))
    .where(eq(groupMembers.groupId, groupId))
    .orderBy(asc(groupMembers.joinedAt))
  const [heir] = rest
  if (!heir || rest.some((m) => m.isAdmin)) return
  await ctx.db
    .update(groupMembers)
    .set({ isAdmin: true })
    .where(and(eq(groupMembers.groupId, groupId), eq(groupMembers.userId, heir.userId)))
  await postEvent(ctx, groupId, '{member} 接任群管理员', { member: heir.name })
}

/**
 * Plan D13, an account disable scoped to one team: the user leaves every group of the team taking their bots along
 * (unfinished runs stop), their bots of the team are deleted, and the membership ends. Other teams are untouched.
 */
export async function removeFromTeam(ctx: Ctx, teamId: string, user: User, by: User) {
  const left = user.id === by.id
  const theirGroups = await ctx.db
    .select({ id: groups.id, kind: groups.kind })
    .from(groupMembers)
    .innerJoin(groups, eq(groups.id, groupMembers.groupId))
    .where(and(eq(groupMembers.userId, user.id), eq(groups.teamId, teamId), isNull(groups.archivedAt)))
  for (const g of theirGroups) {
    await removeMember(ctx, g.id, user.id, by)
    if (g.kind === 'group') {
      await postEvent(ctx, g.id, left ? '{user} 退出了团队' : '{user} 被移出团队', { user: user.name })
      await appointHeir(ctx, g.id)
    }
    await publishGroup(ctx, g.id)
  }
  const now = ctx.now()
  const owned = await ctx.db.transaction(async (tx) => {
    const owned = await tx
      .update(bots)
      .set({ deletedAt: now })
      .where(and(eq(bots.ownerId, user.id), eq(bots.teamId, teamId), isNull(bots.deletedAt)))
      .returning({ id: bots.id })
    if (owned.length)
      await tx
        .update(groupBots)
        .set({ removedAt: now })
        .where(
          and(
            inArray(
              groupBots.botId,
              owned.map((b) => b.id),
            ),
            isNull(groupBots.removedAt),
          ),
        )
    await tx.delete(teamMembers).where(and(eq(teamMembers.teamId, teamId), eq(teamMembers.userId, user.id)))
    return owned
  })
  for (const b of owned) await publishBotRemoved(ctx, b.id)
  ctx.bus.publish([user.id], { t: 'team.removed', teamId })
  ctx.bus.publish(await teamUserIds(ctx, teamId), { t: 'team.member_removed', teamId, userId: user.id })
  await audit(ctx, {
    category: 'admin',
    actorUserId: by.id,
    teamId,
    action: left ? 'team.leave' : 'team.member.remove',
    detail: { userId: user.id, name: user.name, bots: owned.length },
  })
}

/** Plan D15 (by its owner or a sysadmin): members lose it, its groups go read-only and their runs stop. */
export async function archiveTeam(ctx: Ctx, team: typeof teams.$inferSelect, by: SessionUser) {
  const audience = await teamUserIds(ctx, team.id)
  await ctx.db.update(teams).set({ archivedAt: ctx.now() }).where(eq(teams.id, team.id))
  const live = await ctx.db
    .select({ id: groups.id })
    .from(groups)
    .where(and(eq(groups.teamId, team.id), isNull(groups.archivedAt)))
  for (const g of live) await stopRuns(ctx, { groupId: g.id }, by)
  await audit(ctx, {
    category: 'admin',
    actorUserId: by.id,
    teamId: team.id,
    action: 'team.archive',
    detail: { name: team.name },
  })
  ctx.bus.publish(audience, { t: 'team.removed', teamId: team.id })
}

/** The invite behind `token`, its team and inviter; `usable` is false once expired, used up or revoked. */
export async function findInvite(ctx: Ctx, token: string) {
  const [row] = await ctx.db
    .select({ invite: teamInvites, team: teams, inviterName: users.name })
    .from(teamInvites)
    .innerJoin(teams, eq(teams.id, teamInvites.teamId))
    .innerJoin(users, eq(users.id, teamInvites.createdBy))
    .where(eq(teamInvites.tokenHash, sha256(token)))
  if (!row) return fail('not_found', '邀请链接无效')
  const { invite, team } = row
  const usable =
    !invite.revokedAt &&
    !team.archivedAt &&
    invite.expiresAt > ctx.now() &&
    (invite.maxUses === null || invite.uses < invite.maxUses)
  return { ...row, usable }
}

export type FoundInvite = Awaited<ReturnType<typeof findInvite>>

/** Joins `user` to the invite's team with its role, using it up once; a member already in is left as is. */
export async function acceptInvite(ctx: Ctx, found: FoundInvite, user: User) {
  const { invite } = found
  if (!found.usable) return fail('code_expired', '邀请链接已失效')
  const [already] = await ctx.db
    .select({ role: teamMembers.role })
    .from(teamMembers)
    .where(and(eq(teamMembers.teamId, invite.teamId), eq(teamMembers.userId, user.id)))
  if (already) return
  const joined = await ctx.db.transaction(async (tx) => {
    const [used] = await tx
      .update(teamInvites)
      .set({ uses: sql`${teamInvites.uses} + 1` })
      .where(
        and(
          eq(teamInvites.id, invite.id),
          or(isNull(teamInvites.maxUses), lt(teamInvites.uses, teamInvites.maxUses)),
        ),
      )
      .returning({ id: teamInvites.id })
    if (!used) return false
    await tx.insert(teamMembers).values({ teamId: invite.teamId, userId: user.id, role: invite.role })
    return true
  })
  if (!joined) return fail('code_expired', '邀请链接已失效')
  await publishMember(ctx, invite.teamId, user.id)
  await audit(ctx, {
    category: 'admin',
    actorUserId: user.id,
    teamId: invite.teamId,
    action: 'team.invite.accept',
    detail: { inviteId: invite.id, userId: user.id, name: user.name, role: invite.role },
  })
}
