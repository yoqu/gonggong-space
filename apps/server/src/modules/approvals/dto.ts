import type { ApprovalDto, PermissionOption } from '@aiws/protocol'
import { asc, eq, inArray } from 'drizzle-orm'
import type { Ctx } from '../../context.js'
import { approvals, users } from '../../db/schema.js'

type Row = typeof approvals.$inferSelect

export const approvalDto = (a: Row, decidedByName: string | null): ApprovalDto => ({
  id: a.id,
  runId: a.runId,
  title: a.title,
  toolKind: a.toolKind,
  detail: a.detail,
  options: a.options as PermissionOption[],
  status: a.status as ApprovalDto['status'],
  decidedBy: a.decidedBy,
  decidedByName,
  decidedAt: a.decidedAt?.toISOString() ?? null,
  expiresAt: a.expiresAt.toISOString(),
  createdAt: a.createdAt.toISOString(),
})

/** Approvals of the given runs in request order, keyed by run id. */
export async function approvalsByRun(ctx: Ctx, runIds: string[]) {
  const out = new Map<string, ApprovalDto[]>()
  if (!runIds.length) return out
  const rows = await ctx.db
    .select({ a: approvals, name: users.name })
    .from(approvals)
    .leftJoin(users, eq(users.id, approvals.decidedBy))
    .where(inArray(approvals.runId, runIds))
    .orderBy(asc(approvals.createdAt), asc(approvals.id))
  for (const { a, name } of rows) out.set(a.runId, [...(out.get(a.runId) ?? []), approvalDto(a, name)])
  return out
}
