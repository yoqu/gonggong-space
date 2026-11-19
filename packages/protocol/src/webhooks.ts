import { z } from 'zod'
import { RunStatus } from './common.js'
import { GONGGONG_TOOL_TITLES } from './tool-titles.js'

// ── Group webhooks (plan 群Webhook): outside systems post into a group and may @ its bots ─────────
export const WEBHOOK_MAX_PER_GROUP = 20
export const WEBHOOK_MAX_BOTS = 10
/** Calls per webhook per minute. */
export const WEBHOOK_RATE_PER_MIN = 20
/** Bytes, UTF-8. Larger bodies or attachments get 413. */
export const WEBHOOK_TEXT_MAX = 16 * 1024
export const WEBHOOK_ATTACHMENT_MAX = 256 * 1024
/** A call repeating a dedupeKey within this window posts nothing. */
export const WEBHOOK_DEDUPE_MS = 24 * 3600_000
/** Where a webhook is called: `${origin}${WEBHOOK_PATH}/<token>`, or POST it with `Authorization: Bearer <token>`. */
export const WEBHOOK_PATH = '/api/hooks'

export const WebhookName = z.string().trim().min(1).max(60)
/** What the @-ed bot is asked to do; null = the default troubleshooting instruction. */
export const WebhookPrompt = z.string().trim().min(1).max(4000)

/**
 * GET /api/groups/:id/webhooks → GroupWebhooksDto (members); POST (CreateWebhookReq, group admins) → WebhookTokenDto.
 * PATCH /api/webhooks/:id (UpdateWebhookReq) → WebhookDto, DELETE, POST /api/webhooks/:id/rotate → WebhookTokenDto:
 * its owner or a group admin.
 */
export const CreateWebhookReq = z.object({
  name: WebhookName,
  /** Candidates to @, most suitable first; empty = it only posts. */
  botIds: z.array(z.string()).max(WEBHOOK_MAX_BOTS).default([]),
  prompt: WebhookPrompt.nullable().default(null),
})
export type CreateWebhookReq = z.infer<typeof CreateWebhookReq>

export const UpdateWebhookReq = z.object({
  name: WebhookName.optional(),
  botIds: z.array(z.string()).max(WEBHOOK_MAX_BOTS).optional(),
  prompt: WebhookPrompt.nullable().optional(),
  enabled: z.boolean().optional(),
})
export type UpdateWebhookReq = z.infer<typeof UpdateWebhookReq>

export const WebhookDto = z.object({
  id: z.string(),
  groupId: z.string(),
  name: z.string(),
  botIds: z.array(z.string()),
  prompt: z.string().nullable(),
  enabled: z.boolean(),
  /** False for one a bot created until its owner or a group admin rotates the token to reveal the URL once. */
  hasToken: z.boolean(),
  lastCalledAt: z.string().nullable(),
  lastRunId: z.string().nullable(),
  lastStatus: RunStatus.nullable(),
  /** Posts in this member's name; turned off when they leave the group. */
  ownerId: z.string(),
  ownerName: z.string(),
  createdByBotId: z.string().nullable(),
  canManage: z.boolean(),
  createdAt: z.string(),
})
export type WebhookDto = z.infer<typeof WebhookDto>
export const GroupWebhooksDto = z.object({ webhooks: z.array(WebhookDto) })
export type GroupWebhooksDto = z.infer<typeof GroupWebhooksDto>
/** The token in plain text, shown once (only its hash is kept); `path` is `${WEBHOOK_PATH}/<token>`. */
export const WebhookTokenDto = z.object({ webhook: WebhookDto, token: z.string(), path: z.string() })
export type WebhookTokenDto = z.infer<typeof WebhookTokenDto>

/**
 * POST /api/hooks/:token (or /api/hooks with a Bearer token), no session → WebhookCallDto. 401 for a wrong, deleted or
 * disabled token alike, 413 over the size limits, 429 over WEBHOOK_RATE_PER_MIN.
 */
export const WebhookCallReq = z.object({
  /** Markdown body of the message. */
  text: z.string().trim().min(1),
  /** true = @ the first available candidate; or names / ids of candidates to try instead, in order. */
  mention: z
    .union([z.boolean(), z.array(z.string().min(1).max(64)).min(1).max(WEBHOOK_MAX_BOTS)])
    .default(false),
  /** Replaces the webhook's instruction for this call. */
  prompt: WebhookPrompt.optional(),
  /** A text file attached to the message (e.g. the console tail), readable by the bot. */
  attachment: z.object({ name: z.string().trim().min(1).max(200), content: z.string() }).optional(),
  dedupeKey: z.string().trim().min(1).max(200).optional(),
})
export type WebhookCallReq = z.infer<typeof WebhookCallReq>

export const WebhookCallDto = z.object({
  messageId: z.string(),
  runId: z.string().nullable(),
  /** A repeated dedupeKey: the earlier message, nothing posted. */
  duplicate: z.boolean().optional(),
  /** Asked to @ but did not: the last run is still going, or no candidate is online. */
  skipped: z.enum(['busy', 'unavailable']).optional(),
})
export type WebhookCallDto = z.infer<typeof WebhookCallDto>

const webhookBots = z.array(z.string().min(1).max(64)).max(WEBHOOK_MAX_BOTS)
export const WebhookCreateArgs = z.object({
  name: WebhookName.describe('Display name shown as the sender, e.g. Jenkins 部署'),
  bots: webhookBots
    .describe(
      'Candidate bots of this group that this webhook may @, best first; omit or [] for post-only (no bot runs)',
    )
    .optional(),
  prompt: WebhookPrompt.describe(
    'Instruction appended when a bot is @-ed; omit for the default troubleshooting prompt',
  ).optional(),
})
export const WebhookListArgs = z.object({})
export const WebhookUpdateArgs = z.object({
  id: z.string().describe('Webhook id from webhook_list'),
  name: WebhookName.optional(),
  bots: webhookBots.optional(),
  prompt: WebhookPrompt.nullable().describe('null restores the default prompt').optional(),
  enabled: z.boolean().describe('false = disable, true = enable').optional(),
})
export const WebhookDeleteArgs = z.object({ id: z.string().describe('Webhook id from webhook_list') })

export const WEBHOOK_TOOLS = {
  webhook_create: {
    title: GONGGONG_TOOL_TITLES.webhook_create,
    description:
      'Create an inbound webhook for this group (e.g. for Jenkins) on behalf of the turn initiator; requires the initiator to be a group admin. ' +
      'For security, the URL/token is never returned to you or the chat — tell the initiator to open Group Settings → Webhook and generate/copy the URL there.',
    input: WebhookCreateArgs,
  },
  webhook_list: {
    title: GONGGONG_TOOL_TITLES.webhook_list,
    description:
      "This group's inbound webhooks: id, name, candidate bots, enabled, token state and last call.",
    input: WebhookListArgs,
  },
  webhook_update: {
    title: GONGGONG_TOOL_TITLES.webhook_update,
    description:
      'Update an inbound webhook (only the fields to change, as in webhook_create); requires the turn initiator to be its owner or a group admin.',
    input: WebhookUpdateArgs,
  },
  webhook_delete: {
    title: GONGGONG_TOOL_TITLES.webhook_delete,
    description: 'Delete an inbound webhook; requires the turn initiator to be its owner or a group admin.',
    input: WebhookDeleteArgs,
  },
} as const
