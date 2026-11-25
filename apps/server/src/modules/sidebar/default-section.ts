import { and, asc, eq, isNotNull, isNull, max, sql } from 'drizzle-orm'
import type { Ctx } from '../../context.js'
import { groupMembers, groups, sidebarSections } from '../../db/schema.js'

/**
 * Files the group under its default section for members who never placed it themselves: each one's own section of
 * that name (a top-level one first), created when they have none. Members told of a new section reload theirs.
 */
export async function fileDefaultSection(ctx: Ctx, groupId: string) {
  const pending = await ctx.db
    .select({ userId: groupMembers.userId, teamId: groups.teamId, name: groups.defaultSection })
    .from(groupMembers)
    .innerJoin(groups, eq(groups.id, groupMembers.groupId))
    .where(
      and(
        eq(groupMembers.groupId, groupId),
        isNotNull(groups.defaultSection),
        isNull(groupMembers.sectionId),
        eq(groupMembers.sectionMoved, false),
      ),
    )
  const created: string[] = []
  for (const { userId, teamId, name } of pending) {
    if (!name) continue
    const made = await ctx.db.transaction(async (tx) => {
      // Two pushes of the same group at once must not give a member the section twice.
      await tx.execute(sql`select pg_advisory_xact_lock(hashtext(${`sidebar:${userId}:${teamId}`}))`)
      const [found] = await tx
        .select({ id: sidebarSections.id })
        .from(sidebarSections)
        .where(
          and(
            eq(sidebarSections.userId, userId),
            eq(sidebarSections.teamId, teamId),
            eq(sidebarSections.name, name),
          ),
        )
        .orderBy(sql`${sidebarSections.parentId} is not null`, asc(sidebarSections.position))
        .limit(1)
      let sectionId = found?.id
      if (!sectionId) {
        const [last] = await tx
          .select({ position: max(sidebarSections.position) })
          .from(sidebarSections)
          .where(and(eq(sidebarSections.userId, userId), eq(sidebarSections.teamId, teamId)))
        const [row] = await tx
          .insert(sidebarSections)
          .values({ teamId, userId, name, position: (last?.position ?? -1) + 1 })
          .returning({ id: sidebarSections.id })
        sectionId = row!.id
      }
      await tx
        .update(groupMembers)
        .set({ sectionId })
        .where(
          and(
            eq(groupMembers.groupId, groupId),
            eq(groupMembers.userId, userId),
            isNull(groupMembers.sectionId),
            eq(groupMembers.sectionMoved, false),
          ),
        )
      return !found
    })
    if (made) created.push(userId)
  }
  if (created.length) ctx.bus.publish(created, { t: 'sections.changed' })
}
