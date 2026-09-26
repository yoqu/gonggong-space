import type { DaemonHub } from './daemon/hub.js'
import type { Db } from './db/client.js'
import type { Bus } from './realtime/bus.js'

export interface Ctx {
  db: Db
  bus: Bus
  hub: DaemonHub
  now: () => Date
  config: { heartbeatSec: number; secureCookies: boolean; fingerprint: string | null }
}
