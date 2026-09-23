import { randomBytes } from 'node:crypto'
import { Readable } from 'node:stream'
import { NET_PROBE_MAX_BYTES, NetReportReq } from '@aiws/protocol'
import { eq } from 'drizzle-orm'
import type { FastifyInstance } from 'fastify'
import { z } from 'zod'
import type { Ctx } from '../../context.js'
import { requireMachine } from '../../daemon/auth.js'
import { machines } from '../../db/schema.js'

const ProbeQuery = z.object({ bytes: z.coerce.number().int().min(1).max(NET_PROBE_MAX_BYTES) })
const CHUNK = 64 * 1024

/** Random (incompressible) bytes, so no proxy or transfer encoding can shortcut the throughput measurement. */
function randomStream(total: number) {
  let left = total
  return new Readable({
    read() {
      const n = Math.min(CHUNK, left)
      left -= n
      this.push(n ? randomBytes(n) : null)
    },
  })
}

/** Spec §8.5: daemons measure their link to the server; admins see the latest result per machine. */
export function netRoutes(ctx: Ctx) {
  return async (app: FastifyInstance) => {
    app.get('/api/daemon/net/probe', async (req, reply) => {
      await requireMachine(ctx, req)
      const { bytes } = ProbeQuery.parse(req.query)
      return reply
        .header('content-type', 'application/octet-stream')
        .header('content-length', bytes)
        .header('cache-control', 'no-store')
        .send(randomStream(bytes))
    })

    app.post('/api/daemon/net', async (req, reply) => {
      const machine = await requireMachine(ctx, req)
      const net = NetReportReq.parse(req.body)
      await ctx.db
        .update(machines)
        .set({
          latencyMs: Math.round(net.latencyMs),
          bandwidthMbps: net.bandwidthMbps,
          netMeasuredAt: ctx.now(),
        })
        .where(eq(machines.id, machine.id))
      return reply.status(204).send()
    })
  }
}
