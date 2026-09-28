import type { DaemonHub } from './daemon/hub.js'
import type { Db } from './db/client.js'
import type { PreviewConfig } from './modules/previews/config.js'
import type { TunnelHub } from './modules/previews/tunnel.js'
import type { Bus } from './realtime/bus.js'

export interface Ctx {
  db: Db
  bus: Bus
  hub: DaemonHub
  tunnels: TunnelHub
  now: () => Date
  config: { heartbeatSec: number; secureCookies: boolean; fingerprint: string | null; preview: PreviewConfig }
}
