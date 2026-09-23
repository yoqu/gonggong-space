import { DaemonToServer, PROTOCOL_VERSION, type ServerToDaemon } from '@aiws/protocol'
import type { FastifyInstance } from 'fastify'
import type { WebSocket } from 'ws'

export const HEARTBEAT_SEC = 15
const CLOSE_BAD_HELLO = 4000
const CLOSE_PROTOCOL = 4001

const send = (ws: WebSocket, msg: ServerToDaemon) => ws.send(JSON.stringify(msg))

export async function daemonGateway(app: FastifyInstance) {
  app.get('/ws/daemon', { websocket: true }, (ws) => {
    ws.once('message', (raw) => {
      const parsed = DaemonToServer.safeParse(safeJson(String(raw)))
      if (!parsed.success || parsed.data.t !== 'hello') {
        send(ws, { t: 'reject', reason: 'unauthorized', message: 'expected hello' })
        return ws.close(CLOSE_BAD_HELLO)
      }
      if (parsed.data.protocol < PROTOCOL_VERSION) {
        send(ws, {
          t: 'reject',
          reason: 'protocol',
          message: `daemon protocol ${parsed.data.protocol} < required ${PROTOCOL_VERSION}, please upgrade`,
          minProtocol: PROTOCOL_VERSION,
        })
        return ws.close(CLOSE_PROTOCOL)
      }
      send(ws, { t: 'welcome', machineId: 'anonymous', heartbeatSec: HEARTBEAT_SEC })
    })
  })
}

function safeJson(s: string): unknown {
  try {
    return JSON.parse(s)
  } catch {
    return undefined
  }
}
