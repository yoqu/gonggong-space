import type { UserCardDto } from '@gonggong/protocol'
import { and, eq, isNull } from 'drizzle-orm'
import { alias } from 'drizzle-orm/pg-core'
import type { Ctx } from '../../context.js'
import { groupMembers, groups, users } from '../../db/schema.js'
import { fail } from '../../lib/errors.js'
import type { SessionUser } from '../auth/session.js'
import { avatarUrl } from './dto.js'

/** Visible to sysadmins, oneself, and anyone sharing a live group (`groupId` narrows to that group); others get not_found. */
export async function userCard(
  ctx: Ctx,
  viewer: SessionUser,
  id: string,
  groupId?: string,
): Promise<UserCardDto> {
  const [user] = await ctx.db.select().from(users).where(eq(users.id, id))
  if (!user) return fail('not_found', '账号不存在')
  const mine = alias(groupMembers, 'mine')
  const memberships = await ctx.db
    .select({ isAdmin: groupMembers.isAdmin, shared: mine.userId })
    .from(groupMembers)
    .innerJoin(groups, and(eq(groups.id, groupMembers.groupId), isNull(groups.archivedAt)))
    .leftJoin(mine, and(eq(mine.groupId, groupMembers.groupId), eq(mine.userId, viewer.id)))
    .where(and(eq(groupMembers.userId, id), groupId ? eq(groupMembers.groupId, groupId) : undefined))
  const visible = viewer.role === 'sysadmin' || viewer.id === id || memberships.some((m) => m.shared)
  if (!visible) return fail('not_found', '账号不存在')
  return {
    id: user.id,
    name: user.name,
    account: user.account,
    avatar: avatarUrl(user.avatar),
    role: user.role as UserCardDto['role'],
    groupAdmin: Boolean(groupId && memberships[0]?.isAdmin),
    online: ctx.bus.isConnected(user.id),
  }
}
