import { DaemonToServer, PROTOCOL_VERSION, type ServerToDaemon } from '@aiws/protocol'
import { eq } from 'drizzle-orm'
import type { FastifyInstance } from 'fastify'
import type { WebSocket } from 'ws'
import type { Ctx } from '../context.js'
import { machines, users } from '../db/schema.js'
import { sha256 } from '../lib/crypto.js'
import { daemonRelease, upgradeFor } from '../modules/releases/routes.js'
import { reconcileRuns } from '../modules/runs/reconcile.js'
import type { DaemonConn } from './hub.js'

export const CLOSE = { badHello: 4000, protocol: 4001, replaced: 4002, revoked: 4003, timeout: 4004 } as const
const MISSED_HEARTBEATS = 3

const send = (ws: WebSocket, msg: ServerToDaemon) => ws.send(JSON.stringify(msg))

export function daemonGateway(ctx: Ctx) {
  return async (app: FastifyInstance) => {
    // Close handlers write to the DB; shutdown waits for every socket to finish them.
    const live = new Set<Promise<void>>()
    const sockets = new Set<WebSocket>()
    app.addHook('preClose', async () => {
      for (const ws of sockets) ws.terminate()
      await Promise.all(live)
    })
    app.get('/ws/daemon', { websocket: true }, (ws) => {
      sockets.add(ws)
      let settle!: () => void
      const done = new Promise<void>((r) => (settle = r))
      live.add(done)
      done.then(() => live.delete(done))
      ws.on('close', () => {
        sockets.delete(ws)
        if (!registered) settle()
      })
      let registered = false
      ws.once('message', async (raw) => {
        const parsed = DaemonToServer.safeParse(parseJson(String(raw)))
        if (!parsed.success || parsed.data.t !== 'hello') {
          send(ws, { t: 'reject', reason: 'unauthorized', message: 'expected hello' })
          return ws.close(CLOSE.badHello)
        }
        const hello = parsed.data
        const upgrade = upgradeFor(await daemonRelease(ctx), hello.machine, hello.daemonVersion)
        if (hello.protocol < PROTOCOL_VERSION) {
          send(ws, {
            t: 'reject',
            reason: 'protocol',
            message: `daemon protocol ${hello.protocol} < required ${PROTOCOL_VERSION}, please upgrade`,
            minProtocol: PROTOCOL_VERSION,
            ...(upgrade && { upgrade }),
          })
          return ws.close(CLOSE.protocol)
        }
        const [row] = await ctx.db
          .select({ machine: machines, ownerDisabled: users.disabledAt })
          .from(machines)
          .innerJoin(users, eq(users.id, machines.ownerId))
          .where(eq(machines.tokenHash, sha256(hello.token)))
        if (!row) {
          send(ws, { t: 'reject', reason: 'unauthorized', message: 'unknown machine token' })
          return ws.close(CLOSE.badHello)
        }
        if (row.machine.revokedAt || row.ownerDisabled) {
          send(ws, { t: 'reject', reason: 'revoked', message: 'machine token revoked' })
          return ws.close(CLOSE.revoked)
        }
        const machineId = row.machine.id
        if (ws.readyState !== ws.OPEN) return
        await ctx.db
          .update(machines)
          .set({
            name: hello.machine.name,
            os: hello.machine.os,
            arch: hello.machine.arch,
            agents: hello.agents,
            daemonVersion: hello.daemonVersion,
            protocol: hello.protocol,
            lastSeenAt: ctx.now(),
          })
          .where(eq(machines.id, machineId))

        const conn: DaemonConn = { send: (m) => send(ws, m), close: (c, r) => ws.close(c, r) }
        let timer: NodeJS.Timeout | undefined
        const armTimeout = () => {
          clearTimeout(timer)
          timer = setTimeout(
            () => ws.close(CLOSE.timeout, 'heartbeat timeout'),
            ctx.config.heartbeatSec * 1000 * MISSED_HEARTBEATS,
          )
        }
        registered = true
        ws.on('close', async () => {
          clearTimeout(timer)
          ctx.hub.unregister(machineId, conn)
          await ctx.db.update(machines).set({ lastSeenAt: ctx.now() }).where(eq(machines.id, machineId))
          settle()
        })
        ws.on('message', (data) => {
          armTimeout()
          const msg = DaemonToServer.safeParse(parseJson(String(data)))
          if (!msg.success) return app.log.warn({ machineId }, 'invalid daemon message')
          if (msg.data.t !== 'hello' && msg.data.t !== 'heartbeat')
            ctx.hub.emit('message', machineId, msg.data)
        })
        await reconcileRuns(ctx, machineId, hello.activeRuns)
        if (ws.readyState !== ws.OPEN) return
        armTimeout()
        send(ws, { t: 'welcome', machineId, heartbeatSec: ctx.config.heartbeatSec, upgrade })
        ctx.hub.register(machineId, conn)
      })
    })
  }
}

function parseJson(s: string): unknown {
  try {
    return JSON.parse(s)
  } catch {
    return undefined
  }
}
