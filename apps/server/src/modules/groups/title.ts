import { inArray, sql } from 'drizzle-orm'
import type { Ctx } from '../../context.js'
import { groups } from '../../db/schema.js'
import { isUuid } from '../../lib/ids.js'

const DELETED_BOT = '已删除的 Bot'

/**
 * What people see a group called: a DM is titled by its Bot's current name until its owner renames it; a Bot shared
 * by someone else is followed by its owner's name.
 * Columns are spelled out qualified: drizzle leaves them bare in single-table selects, where `id` would bind to `b`.
 */
export const groupTitle = sql<string>`case when "groups"."kind" = 'dm' and not "groups"."renamed" then coalesce((
  select case when b.deleted_at is not null then ${DELETED_BOT}::text
    when b.owner_id <> "groups"."created_by" then b.name || ' · ' || u.name else b.name end
  from group_bots gb join bots b on b.id = gb.bot_id join users u on u.id = b.owner_id
  where gb.group_id = "groups"."id"
  order by (gb.removed_at is null and b.deleted_at is null) desc, gb.created_at
  limit 1), "groups"."name") else "groups"."name" end`

export async function groupTitles(ctx: Ctx, ids: string[]) {
  const valid = [...new Set(ids.filter(isUuid))]
  if (!valid.length) return new Map<string, string>()
  const rows = await ctx.db
    .select({ id: groups.id, title: groupTitle })
    .from(groups)
    .where(inArray(groups.id, valid))
  return new Map(rows.map((r) => [r.id, r.title]))
}
