import type { Ctx } from '../context.js'
import { auditLogs } from '../db/schema.js'

export type AuditEntry = Omit<typeof auditLogs.$inferInsert, 'id' | 'createdAt'>

export async function audit(ctx: Ctx, entry: AuditEntry) {
  await ctx.db.insert(auditLogs).values(entry)
}
