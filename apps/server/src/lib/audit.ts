import type { Ctx } from '../context.js'
import { auditLogs } from '../db/schema.js'

export type AuditCategory = 'approval' | 'question' | 'lock' | 'admin' | 'run'

export async function audit(
  ctx: Ctx,
  entry: {
    category: AuditCategory
    actorUserId: string | null
    action: string
    groupId?: string
    detail?: object
  },
) {
  await ctx.db.insert(auditLogs).values({ ...entry, createdAt: ctx.now() })
}
