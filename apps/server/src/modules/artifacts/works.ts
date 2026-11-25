import {
  type ArtifactVisibility,
  createsArtifacts,
  type PluginManifest,
  type ProtocolKey,
  type WorkDto,
  type WorkGroupDto,
} from '@gonggong/protocol'
import { and, desc, eq, isNull, or } from 'drizzle-orm'
import type { Ctx } from '../../context.js'
import {
  artifacts,
  artifactVersions,
  bots,
  groupMembers,
  groups,
  pluginVersions,
  teamMembers,
  teams,
  users,
} from '../../db/schema.js'
import { fail } from '../../lib/errors.js'
import { findMember } from '../groups/service.js'
import { groupTitle, translateGroupTitle } from '../groups/title.js'
import { postEvent } from '../messages/service.js'
import { groupPluginLists, pluginsOn } from '../plugins/service.js'
import { type Artifact, cardOf, isArtifactManager, refreshCard, thumbnailUrl } from './service.js'

const EVENT: Record<ArtifactVisibility, ProtocolKey> = {
  private: '{user} 把「{title}」设为仅创建人可见',
  group: '{user} 把「{title}」设为本群可见',
  team: '{user} 把「{title}」设为团队可见',
}

/** Its creator, its bot's owner or a group admin sets who may open it; the group hears of it. */
export async function setVisibility(
  ctx: Ctx,
  me: { id: string; name: string },
  a: Artifact,
  visibility: ArtifactVisibility,
) {
  const m = await findMember(ctx, a.groupId, me.id)
  if (!m || !(await isArtifactManager(ctx, a, me.id, m.member.isAdmin)))
    return fail('forbidden', '只有创建人、Bot 主人或群管理员能修改可见范围')
  if (a.visibility === visibility) return a
  const [updated] = await ctx.db
    .update(artifacts)
    .set({ visibility })
    .where(eq(artifacts.id, a.id))
    .returning()
  await refreshCard(ctx, a.id)
  await postEvent(ctx, a.groupId, EVENT[visibility], { user: me.name, title: a.title })
  return updated as Artifact
}

/**
 * Shares a work the caller may open into one of their group chats as a card, so its members discuss it there; editing
 * stays on the work's own page. Another group's members can only open it once it is visible to the team.
 */
export async function postWork(ctx: Ctx, me: { id: string; name: string }, a: Artifact, groupId: string) {
  if (a.archivedAt) return fail('conflict', '作品已删除')
  const to = (await findMember(ctx, groupId, me.id)) ?? fail('not_found', '群不存在或你已不在群内')
  if (groupId !== a.groupId) {
    const [home] = await ctx.db.select({ teamId: groups.teamId }).from(groups).where(eq(groups.id, a.groupId))
    if (home?.teamId !== to.group.teamId) return fail('forbidden', '只能分享到本团队的群')
    if (a.visibility !== 'team') return fail('conflict', '先把作品设为团队可见，其他群的成员才能打开')
  }
  await postEvent(
    ctx,
    groupId,
    '{user} 分享了作品「{title}」',
    { user: me.name, title: a.title },
    { card: await cardOf(ctx.db, a) },
  )
}

/** Every artifact `userId` may open in `teamId` (作品): their groups' works plus those shared with the team. */
export async function listWorks(ctx: Ctx, userId: string, teamId: string): Promise<WorkDto[]> {
  const rows = await ctx.db
    .select({
      a: artifacts,
      groupTitle,
      groupKind: groups.kind,
      groupVisibility: groups.visibility,
      member: groupMembers.userId,
      isAdmin: groupMembers.isAdmin,
      owner: bots.ownerId,
      creatorName: users.name,
      manifest: pluginVersions.manifest,
      head: {
        id: artifactVersions.id,
        artifactId: artifactVersions.artifactId,
        thumbnailHash: artifactVersions.thumbnailHash,
      },
    })
    .from(artifacts)
    .innerJoin(
      groups,
      and(eq(groups.id, artifacts.groupId), eq(groups.teamId, teamId), isNull(groups.archivedAt)),
    )
    .innerJoin(teams, and(eq(teams.id, groups.teamId), isNull(teams.archivedAt)))
    .innerJoin(teamMembers, and(eq(teamMembers.teamId, groups.teamId), eq(teamMembers.userId, userId)))
    .leftJoin(groupMembers, and(eq(groupMembers.groupId, groups.id), eq(groupMembers.userId, userId)))
    .leftJoin(bots, eq(bots.id, artifacts.botId))
    .leftJoin(users, eq(users.id, artifacts.createdBy))
    .leftJoin(pluginVersions, eq(pluginVersions.id, artifacts.pluginVersionId))
    .leftJoin(artifactVersions, eq(artifactVersions.id, artifacts.headVersionId))
    .where(
      and(
        isNull(artifacts.archivedAt),
        or(eq(artifacts.visibility, 'team'), eq(groupMembers.userId, userId)),
      ),
    )
    .orderBy(desc(artifacts.updatedAt))
  return rows
    .filter(
      (r) => r.a.visibility !== 'private' || r.isAdmin || r.a.createdBy === userId || r.owner === userId,
    )
    .map((r) => {
      const access = r.member ? 'edit' : 'view'
      const groupKind = r.groupKind as WorkDto['groupKind']
      const groupVisibility = r.groupVisibility as WorkDto['groupVisibility']
      return {
        id: r.a.id,
        groupId: r.a.groupId,
        // Mask another member's DM name on the server so private chat titles never leak over the wire.
        groupTitle: groupKind === 'dm' && access === 'view' ? '' : translateGroupTitle(r.groupTitle),
        groupKind,
        groupVisibility,
        title: r.a.title,
        pluginTitle: (r.manifest as PluginManifest | null)?.title ?? null,
        site: r.a.siteDir !== null,
        visibility: r.a.visibility as ArtifactVisibility,
        createdBy: r.a.createdBy,
        creatorName: r.creatorName,
        thumbnailUrl: r.head ? thumbnailUrl(r.head) : null,
        updatedAt: r.a.updatedAt.toISOString(),
        access,
      }
    })
}

/** The caller's groups in `teamId` with a creation plugin on: 作品 shows when there is one, and 新建 picks among them. */
export async function workGroups(ctx: Ctx, userId: string, teamId: string): Promise<WorkGroupDto[]> {
  if (!(await pluginsOn(ctx.db))) return []
  const mine = await ctx.db
    .selectDistinct({ id: groups.id, title: groupTitle, kind: groups.kind })
    .from(groups)
    .innerJoin(teams, and(eq(teams.id, groups.teamId), isNull(teams.archivedAt)))
    .innerJoin(teamMembers, and(eq(teamMembers.teamId, groups.teamId), eq(teamMembers.userId, userId)))
    .innerJoin(groupMembers, and(eq(groupMembers.groupId, groups.id), eq(groupMembers.userId, userId)))
    .where(and(eq(groups.teamId, teamId), isNull(groups.archivedAt)))
  const lists = await groupPluginLists(
    ctx.db,
    mine.map((g) => g.id),
  )
  return mine
    .filter((g) => lists.get(g.id)?.some((p) => p.enabledInGroup && createsArtifacts(p.version.manifest)))
    .map((g) => ({ id: g.id, title: translateGroupTitle(g.title), kind: g.kind as WorkGroupDto['kind'] }))
    .sort((x, y) => (x.kind === y.kind ? x.title.localeCompare(y.title, 'zh') : x.kind === 'group' ? -1 : 1))
}
