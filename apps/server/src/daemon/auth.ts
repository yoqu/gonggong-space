import { eq } from 'drizzle-orm'
import type { FastifyRequest } from 'fastify'
import type { Ctx } from '../context.js'
import { machines, users } from '../db/schema.js'
import { sha256 } from '../lib/crypto.js'
import { fail } from '../lib/errors.js'

/** Guards daemon REST calls (`Authorization: Bearer <machine token>`); revoked machines and disabled owners are rejected. */
export async function requireMachine(ctx: Ctx, req: FastifyRequest) {
  const token = /^Bearer (.+)$/.exec(req.headers.authorization ?? '')?.[1]
  if (!token) return fail('unauthorized', 'missing machine token')
  const [row] = await ctx.db
    .select({ machine: machines, ownerDisabled: users.disabledAt })
    .from(machines)
    .innerJoin(users, eq(users.id, machines.ownerId))
    .where(eq(machines.tokenHash, sha256(token)))
  if (!row || row.machine.revokedAt || row.ownerDisabled) return fail('unauthorized', 'machine token revoked')
  return row.machine
}
