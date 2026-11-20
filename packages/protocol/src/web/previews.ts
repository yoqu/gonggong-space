import { z } from 'zod'
import { DevtoolsBlocker, Permission } from '../common.js'

// ── Previews (plan 结果预览) ─────────────────────────────────────────────────
export const PreviewKind = z.enum(['http', 'static', 'gui', 'miniprogram'])
export const PreviewDto = z.object({
  id: z.string(),
  groupId: z.string(),
  groupName: z.string(),
  botId: z.string(),
  botName: z.string(),
  kind: PreviewKind,
  title: z.string(),
  path: z.string(),
  serviceId: z.string().nullable(),
  serviceName: z.string().nullable(),
  /** The loopback port it tunnels to; null for a static site. */
  port: z.number().int().nullable(),
  /** Its first-screen PNG (GET /api/previews/:id/snapshot) was taken then; null until the machine managed one. */
  snapshotAt: z.string().nullable(),
  /** online = its machine's tunnel is up; stopped = the service behind it is not running (启动 brings it back). */
  status: z.enum(['online', 'offline', 'stopped']),
  /**
   * login = a mini program whose machine's WeChat devtools nobody is logged in to: its snapshot is their login QR
   * code, served to managers only; the card turns into the simulator once scanned.
   */
  awaiting: z.enum(['login']).nullable(),
  /** Why the machine could not take the last snapshot, until one works. */
  snapshotError: z.string().nullable(),
  /** Its machine's gg-cast while someone watches a live preview (`gui`, `miniprogram`); null otherwise. */
  live: z
    .object({
      state: z.enum(['starting', 'live', 'failed']),
      error: z.string().nullable(),
      missing: z.array(Permission),
      devtools: DevtoolsBlocker.optional(),
      /** When a failed one is tried again (the machine's retryIn); 立即重试 = POST /api/previews/:id/live/retry. */
      retryAt: z.string().optional(),
    })
    .nullable(),
  /**
   * Remote control of a live preview (plan P14): at most one member controls; members ask, the bot owner or a group
   * admin approves (or takes over). Null for previews without a live view.
   */
  control: z
    .object({
      controller: z.object({ id: z.string(), name: z.string() }).nullable(),
      requests: z.array(z.object({ id: z.string(), name: z.string() })),
    })
    .nullable(),
  /** The bot owner and group admins may close it and share it publicly. */
  canManage: z.boolean(),
  createdAt: z.string(),
})
export type PreviewDto = z.infer<typeof PreviewDto>
export const ServiceDto = z.object({
  id: z.string(),
  groupId: z.string(),
  groupName: z.string(),
  botId: z.string(),
  botName: z.string(),
  name: z.string(),
  command: z.string(),
  cwd: z.string(),
  port: z.number().int().nullable(),
  status: z.enum(['starting', 'running', 'exited', 'failed']),
  canManage: z.boolean(),
  createdAt: z.string(),
})
export type ServiceDto = z.infer<typeof ServiceDto>
/**
 * POST /api/previews/:id/host (托管到服务器; bot owner or group admin): a static site is uploaded from the machine
 * as a new version of its hosted-site artifact (`artifactId`, shown in 作品); any other web preview asks its bot to
 * build one and host it with preview_host (`asked`).
 */
export const PreviewHostRes = z.union([
  z.object({ artifactId: z.string() }),
  z.object({ asked: z.literal(true) }),
])
export type PreviewHostRes = z.infer<typeof PreviewHostRes>
/**
 * GET /api/groups/:id/previews: open previews and live services. 打开 = GET /api/previews/:id/open?path= (also the
 * iframe src); POST /api/previews/:id/close and /api/services/:id/stop → 204 (bot owner or group admin);
 * POST /api/previews/:id/snapshot → 204 retakes the first screen (same people; 409 with the machine's reason).
 * POST /api/previews/:id/start → 204 reopens a closed preview and restarts its stopped service as it was started
 * (same people; 409 with the machine's reason).
 * Machine token (desktop app): GET /api/daemon/previews → the machine's own; POST /api/daemon/previews/:id/close
 * (ClosePreviewReq), /api/daemon/previews/:id/start and /api/daemon/services/:id/stop → 204.
 */
export const GroupPreviewsDto = z.object({
  previews: z.array(PreviewDto),
  services: z.array(ServiceDto),
  /** Bots whose previews this user may manage, closed ones included (their cards offer 启动). */
  manageableBotIds: z.array(z.string()),
})
export type GroupPreviewsDto = z.infer<typeof GroupPreviewsDto>
/** Close body: `stopService` also stops the service behind the preview (409 when its machine is offline). */
export const ClosePreviewReq = z.object({ stopService: z.boolean().optional() })

/**
 * Live view of a `gui` or `miniprogram` preview through LiveKit (plan P12–P14), room = preview id.
 * POST /api/previews/:id/live (members) → a viewer token for this connection. `url` null: the server's own
 * `/livekit` (ws(s)://<its host>/livekit), else an external LiveKit.
 */
export const LiveTokenDto = z.object({ url: z.string().nullable(), token: z.string(), identity: z.string() })
export type LiveTokenDto = z.infer<typeof LiveTokenDto>
/**
 * POST /api/previews/:id/watch (members) → 204: someone is watching; the machine publishes while a viewer renewed
 * within `LIVE_WATCH_SECONDS`, at the highest frame rate its viewers ask for (`LIVE_DEFAULT_FPS` when none does).
 */
export const LIVE_WATCH_SECONDS = 60
export const LIVE_FPS = [30, 60, 90] as const
export type LiveFps = (typeof LIVE_FPS)[number]
export const LIVE_DEFAULT_FPS: LiveFps = 30
export const WatchReq = z.object({ fps: z.union([z.literal(30), z.literal(60), z.literal(90)]).optional() })
export type WatchReq = z.infer<typeof WatchReq>
/**
 * POST /api/previews/:id/control → 204. Members `request` (managers take control at once) and `release` (give it
 * back, or withdraw their request); managers `grant` / `deny` a request and `revoke` control. Control lapses with the
 * controller's watch lease.
 */
export const ControlReq = z.discriminatedUnion('action', [
  z.object({ action: z.literal('request') }),
  z.object({ action: z.literal('release') }),
  z.object({ action: z.literal('grant'), userId: z.string() }),
  z.object({ action: z.literal('deny'), userId: z.string() }),
  z.object({ action: z.literal('revoke') }),
])
export type ControlReq = z.infer<typeof ControlReq>

/** Keys the controller can press besides typing text (`CastInput` `key`, with a letter or digit for shortcuts). */
export const CAST_KEYS = [
  'Enter',
  'Backspace',
  'Delete',
  'Tab',
  'Escape',
  'ArrowUp',
  'ArrowDown',
  'ArrowLeft',
  'ArrowRight',
  'Home',
  'End',
  'PageUp',
  'PageDown',
] as const
const point = { x: z.number().min(0).max(1), y: z.number().min(0).max(1) }
/**
 * The controller's input, as JSON on the LiveKit data channel (topic `input`, to the `cast` participant only); gg-cast
 * replays it on the machine. Points are fractions of the video frame; `wheel` deltas are CSS pixels; `text` is typed
 * as is (IME output included).
 */
export const CastInput = z.discriminatedUnion('t', [
  z.object({ t: z.literal('down'), ...point }),
  z.object({ t: z.literal('move'), ...point }),
  z.object({ t: z.literal('up'), ...point }),
  z.object({ t: z.literal('wheel'), ...point, dx: z.number(), dy: z.number() }),
  z.object({ t: z.literal('text'), text: z.string().min(1).max(1000) }),
  z.object({
    t: z.literal('key'),
    key: z.union([z.enum(CAST_KEYS), z.string().regex(/^[a-z0-9]$/)]),
    mods: z.array(z.enum(['meta', 'ctrl', 'alt', 'shift'])),
  }),
])
export type CastInput = z.infer<typeof CastInput>
export const CAST_INPUT_TOPIC = 'input'

/** POST /api/daemon/previews/:id/cast (machine token, its own preview) → the publisher token for gg-cast. */
export const CastTokenDto = z.object({ url: z.string().nullable(), token: z.string() })
export type CastTokenDto = z.infer<typeof CastTokenDto>

/**
 * Public preview links (plan P8), created by the bot owner or a group admin, always expiring:
 * POST /api/previews/:id/shares → CreatedPreviewShare (the url, with its secret, is shown once);
 * GET /api/previews/:id/shares → PreviewShareDto[]; POST /api/preview-shares/:id/revoke → 204 (managers, sysadmins).
 * Admin console: GET /api/admin/preview-shares → all; PATCH /api/admin/preview-shares/:id → new expiry.
 */
export const PreviewShareDto = z.object({
  id: z.string(),
  previewId: z.string(),
  previewTitle: z.string(),
  groupId: z.string(),
  groupName: z.string(),
  botName: z.string(),
  createdByName: z.string(),
  expiresAt: z.string(),
  revokedAt: z.string().nullable(),
  visitCount: z.number().int(),
  lastVisitAt: z.string().nullable(),
  createdAt: z.string(),
  /** Not revoked, not expired, preview still open. */
  active: z.boolean(),
})
export type PreviewShareDto = z.infer<typeof PreviewShareDto>
export const PREVIEW_SHARE_DEFAULT_DAYS = 7
export const CreatePreviewShareReq = z.object({
  days: z.number().int().min(1).max(365).default(PREVIEW_SHARE_DEFAULT_DAYS),
})
export const CreatedPreviewShare = z.object({ share: PreviewShareDto, url: z.string() })
export type CreatedPreviewShare = z.infer<typeof CreatedPreviewShare>
export const UpdatePreviewShareReq = z.object({ expiresAt: z.iso.datetime() })
