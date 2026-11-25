import { z } from 'zod'

// ── Previews (plan 结果预览) ─────────────────────────────────────────────────
export const PreviewKind = z.enum(['http', 'static'])
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
  /** Why the machine could not take the last snapshot, until one works. */
  snapshotError: z.string().nullable(),
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
