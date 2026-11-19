import { z } from 'zod'
import { BotRunOptionArg } from './common.js'
import { GONGGONG_TOOL_TITLES } from './tool-titles.js'
import { WEBHOOK_MAX_BOTS, WebhookName, WebhookPrompt } from './webhooks.js'

// ── Group webhook tools (agent-facing, not translated) ───────────────────────
const webhookBots = z.array(z.string().min(1).max(64)).max(WEBHOOK_MAX_BOTS)
const webhookRunOptions = z.array(BotRunOptionArg).max(WEBHOOK_MAX_BOTS)

export const WebhookCreateArgs = z.object({
  name: WebhookName.describe('Display name shown as the sender, e.g. Jenkins 部署'),
  bots: webhookBots
    .describe(
      'Candidate bots of this group that this webhook may @, best first; omit or [] for post-only (no bot runs)',
    )
    .optional(),
  run_options: webhookRunOptions
    .describe(
      'Model and effort per candidate, only when the user asks; give the full list when changing, [] = all default',
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
  run_options: webhookRunOptions.optional(),
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
