import type {
  ArtifactVisibility,
  PluginManifest,
  ProtocolKey,
  WorkDto,
  WorkGroupDto,
} from '@gonggong/protocol'
import { and, desc, eq, isNull, or } from 'drizzle-orm'
import type { Ctx } from '../../context.js'
import {
  artifacts,
  artifactVersions,
  bots,
  groupMembers,
  groupPlugins,
  groups,
  pluginVersions,
  teamMembers,
  teams,
  users,
} from '../../db/schema.js'
import { fail } from '../../lib/errors.js'
import { findMember } from '../groups/service.js'
import { postEvent } from '../messages/service.js'
import { pluginsOn } from '../plugins/service.js'
import { type Artifact, isArtifactManager, refreshCard, thumbnailUrl } from './service.js'

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

/** Every artifact `userId` may open, across the live groups of their live teams (作品). */
export async function listWorks(ctx: Ctx, userId: string): Promise<WorkDto[]> {
  const rows = await ctx.db
    .select({
      a: artifacts,
      groupTitle: groups.name,
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
    .innerJoin(groups, and(eq(groups.id, artifacts.groupId), isNull(groups.archivedAt)))
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
    .map((r) => ({
      id: r.a.id,
      groupId: r.a.groupId,
      groupTitle: r.groupTitle,
      title: r.a.title,
      pluginTitle: (r.manifest as PluginManifest | null)?.title ?? null,
      visibility: r.a.visibility as ArtifactVisibility,
      createdBy: r.a.createdBy,
      creatorName: r.creatorName,
      thumbnailUrl: r.head ? thumbnailUrl(r.head) : null,
      updatedAt: r.a.updatedAt.toISOString(),
      access: r.member ? 'edit' : 'view',
    }))
}

/** The caller's groups with a creation plugin on: 作品 shows when there is one, and 新建 picks among them. */
export async function workGroups(ctx: Ctx, userId: string): Promise<WorkGroupDto[]> {
  if (!(await pluginsOn(ctx.db))) return []
  const mine = await ctx.db
    .selectDistinct({ id: groups.id, title: groups.name })
    .from(groups)
    .innerJoin(teams, and(eq(teams.id, groups.teamId), isNull(teams.archivedAt)))
    .innerJoin(teamMembers, and(eq(teamMembers.teamId, groups.teamId), eq(teamMembers.userId, userId)))
    .innerJoin(groupMembers, and(eq(groupMembers.groupId, groups.id), eq(groupMembers.userId, userId)))
    .innerJoin(groupPlugins, and(eq(groupPlugins.groupId, groups.id), eq(groupPlugins.enabled, true)))
    .where(and(isNull(groups.archivedAt), eq(groups.kind, 'group')))
  return mine.sort((x, y) => x.title.localeCompare(y.title, 'zh'))
}
