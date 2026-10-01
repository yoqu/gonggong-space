import { eq, sql } from 'drizzle-orm'
import type { Ctx } from '../context.js'
import { auditLogs, groups } from '../db/schema.js'

export type AuditEntry = Omit<typeof auditLogs.$inferInsert, 'id' | 'createdAt'>

/** `audit_logs.team_id` of an event in the group: its team (plan 团队层级 · 团队审计). */
export const teamOfGroupSql = (groupId: string) =>
  sql`(select ${groups.teamId} from ${groups} where ${eq(groups.id, groupId)})`

export async function audit(ctx: Ctx, entry: AuditEntry) {
  const teamId = entry.teamId ?? (entry.groupId ? teamOfGroupSql(entry.groupId) : null)
  await ctx.db.insert(auditLogs).values({ ...entry, teamId })
}
