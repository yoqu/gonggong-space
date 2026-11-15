import { z } from 'zod'

// ── Notifications ───────────────────────────────────────────────────────────
export const NotificationType = z.enum([
  'approval',
  'question',
  'offline_expired',
  'chain_done',
  'bot_confirm',
  'bot_shared',
  'repo_access',
  'schedule_paused',
  'sync_drift',
  'sync_conflict',
  'mention',
  'bot_share_request',
  'bot_share_decided',
  'git_operation_request',
  'install_request',
  'install_request_decided',
  'listing_reviewed',
  'listing_submitted',
  'listing_banned',
  'listing_upgraded',
  'join_request',
  'join_decided',
  'reminder',
  'plugin_trust',
  'link_request',
])
export const NotificationDto = z.object({
  id: z.string(),
  /** null for platform-level notices, shown in every team. */
  teamId: z.string().nullable(),
  type: NotificationType,
  payload: z.record(z.string(), z.unknown()),
  readAt: z.string().nullable(),
  /** The approval / question it asks for was settled (by anyone, a timeout, or the run ending). */
  resolvedAt: z.string().nullable(),
  createdAt: z.string(),
})
export type NotificationDto = z.infer<typeof NotificationDto>
/** GET /api/notifications/unread: the badge, over the list's scope; counting stops at 100 (shown as 99+). */
export const NotificationUnreadDto = z.object({ n: z.number().int() })
export type NotificationUnreadDto = z.infer<typeof NotificationUnreadDto>

/** Also sent as browser push, only to the people who can act (spec §8.11); others stay in the in-app center. */
export const PUSHED_NOTIFICATION_TYPES: readonly NotificationDto['type'][] = [
  'reminder',
  'link_request',
  'plugin_trust',
  'approval',
  'question',
  'offline_expired',
  'chain_done',
  'mention',
  'bot_share_request',
  'bot_share_decided',
  'git_operation_request',
  'install_request',
  'install_request_decided',
  'listing_submitted',
  'listing_reviewed',
  'listing_banned',
  'join_request',
  'join_decided',
]
export const PushKeyDto = z.object({ publicKey: z.string() })
export const PushSubscriptionReq = z.object({
  endpoint: z.url(),
  keys: z.object({ p256dh: z.string().min(1), auth: z.string().min(1) }),
})
export type PushSubscriptionReq = z.infer<typeof PushSubscriptionReq>
