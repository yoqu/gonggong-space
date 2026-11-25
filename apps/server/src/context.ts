import type { DaemonHub } from './daemon/hub.js'
import type { Db } from './db/client.js'
import type { FeishuApi } from './modules/feishu/client.js'
import type { FeishuConnector } from './modules/feishu/gateway.js'
import type { IntegrationToken } from './modules/integrations/tokens.js'
import type { LiveKit } from './modules/live/livekit.js'
import type { PreviewConfig } from './modules/previews/config.js'
import type { TunnelHub } from './modules/previews/tunnel.js'
import type { Bus } from './realtime/bus.js'

export interface Ctx {
  db: Db
  bus: Bus
  hub: DaemonHub
  tunnels: TunnelHub
  livekit: LiveKit
  feishu: { api: FeishuApi; connector: FeishuConnector }
  now: () => Date
  config: {
    heartbeatSec: number
    secureCookies: boolean
    preview: PreviewConfig
    /** 飞书项目 integration tokens, each bound to one team (GONGGONG_FEISHU_PROJECT_TOKENS). */
    feishuProjectTokens: IntegrationToken[]
  }
}
