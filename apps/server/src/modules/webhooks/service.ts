import {
  type CreateWebhookReq,
  type UpdateWebhookReq,
  WEBHOOK_MAX_PER_GROUP,
  WEBHOOK_PATH,
  type WebhookDto,
  type WebhookTokenDto,
} from '@gonggong/protocol'
import { and, asc, count, eq, isNull, type SQL } from 'drizzle-orm'
import type { Ctx } from '../../context.js'
import { groupMembers, runs, users, webhooks } from '../../db/schema.js'
import { audit } from '../../lib/audit.js'
import { newToken, sha256 } from '../../lib/crypto.js'
import { fail } from '../../lib/errors.js'
import { groupAdmins } from '../groups/service.js'
import type { RunRow } from '../runs/dto.js'
import { checkBotRunOptions, checkCandidateBots } from '../runs/pick.js'

export type WebhookRow = typeof webhooks.$inferSelect
export type WebhookActor =
  | { userId: string }
  | { botId: string; runId: string; botName: string; originUserId: string }

/** Default instruction appended to the bot's context when a webhook @-s it without a custom prompt. */
export const DEFAULT_WEBHOOK_PROMPT =
  '请读取附件日志，定位失败原因与相关提交，能小改修复就按仓库约定修复并推送，否则在群里说明原因与建议，必要时 @ 提交人。'

const live = isNull(webhooks.deletedAt)

export function loadWebhooks(ctx: Ctx, where?: SQL) {
  return ctx.db
    .select({ w: webhooks, ownerName: users.name, lastStatus: runs.status })
    .from(webhooks)
    .innerJoin(users, eq(users.id, webhooks.ownerId))
    .leftJoin(runs, eq(runs.id, webhooks.lastRunId))
    .where(and(live, where))
    .orderBy(asc(webhooks.createdAt))
}
type Loaded = Awaited<ReturnType<typeof loadWebhooks>>[number]

export const webhookDto = ({ w, ownerName, lastStatus }: Loaded, canManage: boolean): WebhookDto => ({
  id: w.id,
  groupId: w.groupId,
  name: w.name,
  botIds: w.botIds,
  runOptions: w.runOptions,
  prompt: w.promptTemplate,
  enabled: w.enabled,
  hasToken: w.tokenHash !== null,
  lastCalledAt: w.lastCalledAt?.toISOString() ?? null,
  lastRunId: w.lastRunId,
  lastStatus: (lastStatus as WebhookDto['lastStatus']) ?? null,
  ownerId: w.ownerId,
  ownerName,
  createdByBotId: w.createdByBotId,
  canManage,
  createdAt: w.createdAt.toISOString(),
})

const manages = (w: WebhookRow, userId: string, admins: Set<string>) =>
  w.ownerId === userId || admins.has(userId)

export async function groupWebhooks(ctx: Ctx, groupId: string, userId: string) {
  const { admins } = await groupAdmins(ctx, groupId)
  const rows = await loadWebhooks(ctx, eq(webhooks.groupId, groupId))
  return { webhooks: rows.map((r) => webhookDto(r, manages(r.w, userId, admins))) }
}

export async function publishWebhooks(ctx: Ctx, groupId: string) {
  const { members, admins } = await groupAdmins(ctx, groupId)
  const rows = await loadWebhooks(ctx, eq(webhooks.groupId, groupId))
  for (const userId of members)
    ctx.bus.publish([userId], {
      t: 'group.webhooks',
      groupId,
      webhooks: rows.map((r) => webhookDto(r, manages(r.w, userId, admins))),
    })
}

export async function webhookById(ctx: Ctx, id: string) {
  const [row] = await loadWebhooks(ctx, eq(webhooks.id, id))
  return row
}

/** Owner or group admin (403), as a member of its group (404 otherwise). */
export async function requireManageWebhook(ctx: Ctx, w: WebhookRow, userId: string) {
  const [m] = await ctx.db
    .select({ isAdmin: groupMembers.isAdmin })
    .from(groupMembers)
    .where(and(eq(groupMembers.groupId, w.groupId), eq(groupMembers.userId, userId)))
  if (!m) return fail('not_found', 'Webhook 不存在')
  if (w.ownerId !== userId && !m.isAdmin) fail('forbidden', '仅 Webhook 主人或群管理员可操作')
}

async function record(
  ctx: Ctx,
  w: WebhookRow,
  action: string,
  actor: WebhookActor,
  extra?: Record<string, unknown>,
) {
  const actorUserId = 'userId' in actor ? actor.userId : null
  const by = 'userId' in actor ? { by: 'user' } : { by: 'bot', botId: actor.botId, runId: actor.runId }
  await audit(ctx, {
    category: 'webhook',
    action: `webhook.${action}`,
    actorUserId,
    groupId: w.groupId,
    detail: { webhookId: w.id, name: w.name, ...by, ...extra },
  })
}

/**
 * Creates a webhook. Human calls get a plaintext token once (stored hashed); bot calls create it without a token
 * so the secret never enters agent context or group chat — an admin rotates it in Group Settings to copy the URL.
 */
export async function createWebhook(
  ctx: Ctx,
  groupId: string,
  req: CreateWebhookReq,
  ownerId: string,
  actor: WebhookActor,
): Promise<{ row: WebhookRow; token: string | null }> {
  const [n] = await ctx.db
    .select({ n: count() })
    .from(webhooks)
    .where(and(live, eq(webhooks.groupId, groupId)))
  if ((n?.n ?? 0) >= WEBHOOK_MAX_PER_GROUP)
    fail('invalid', '每个群最多 {n} 个 Webhook', { n: WEBHOOK_MAX_PER_GROUP })
  const botIds = await checkCandidateBots(ctx, groupId, req.botIds)
  const actorUserId = 'userId' in actor ? actor.userId : actor.originUserId
  const runOptions = await checkBotRunOptions(ctx, groupId, req.runOptions, botIds, actorUserId)
  const token = 'userId' in actor ? newToken('gwh') : null
  const [row] = (await ctx.db
    .insert(webhooks)
    .values({
      groupId,
      ownerId,
      createdByBotId: 'botId' in actor ? actor.botId : null,
      createdByRunId: 'runId' in actor ? actor.runId : null,
      name: req.name,
      tokenHash: token ? sha256(token) : null,
      botIds,
      runOptions,
      promptTemplate: req.prompt,
      createdAt: ctx.now(),
    })
    .returning()) as [WebhookRow]
  await record(ctx, row, 'create', actor)
  await publishWebhooks(ctx, groupId)
  return { row, token }
}

export async function updateWebhook(ctx: Ctx, w: WebhookRow, req: UpdateWebhookReq, actor: WebhookActor) {
  const botIds = req.botIds !== undefined ? await checkCandidateBots(ctx, w.groupId, req.botIds) : w.botIds
  const actorUserId = 'userId' in actor ? actor.userId : actor.originUserId
  const runOptions =
    req.botIds !== undefined || req.runOptions !== undefined
      ? await checkBotRunOptions(
          ctx,
          w.groupId,
          req.runOptions ?? w.runOptions,
          botIds,
          actorUserId,
          w.runOptions,
        )
      : w.runOptions
  const [row] = (await ctx.db
    .update(webhooks)
    .set({
      ...(req.name !== undefined && { name: req.name }),
      botIds,
      runOptions,
      ...(req.prompt !== undefined && { promptTemplate: req.prompt }),
      ...(req.enabled !== undefined && { enabled: req.enabled }),
    })
    .where(eq(webhooks.id, w.id))
    .returning()) as [WebhookRow]
  await record(
    ctx,
    row,
    req.enabled === false ? 'disable' : req.enabled && !w.enabled ? 'enable' : 'update',
    actor,
  )
  await publishWebhooks(ctx, w.groupId)
  return row
}

export async function rotateWebhook(
  ctx: Ctx,
  w: WebhookRow,
  actor: { userId: string },
): Promise<WebhookTokenDto> {
  const token = newToken('gwh')
  await ctx.db
    .update(webhooks)
    .set({ tokenHash: sha256(token) })
    .where(eq(webhooks.id, w.id))
  await record(ctx, w, 'rotate', actor)
  await publishWebhooks(ctx, w.groupId)
  const loaded = await webhookById(ctx, w.id)
  if (!loaded) return fail('not_found', 'Webhook 不存在')
  return { webhook: webhookDto(loaded, true), token, path: `${WEBHOOK_PATH}/${token}` }
}

export async function deleteWebhook(ctx: Ctx, w: WebhookRow, actor: WebhookActor) {
  await ctx.db
    .update(webhooks)
    .set({ deletedAt: ctx.now(), enabled: false, tokenHash: null })
    .where(eq(webhooks.id, w.id))
  await record(ctx, w, 'delete', actor)
  await publishWebhooks(ctx, w.groupId)
}

/** Refreshes the group's webhook list when a webhook-triggered run reaches a terminal status. */
export async function settleWebhook(ctx: Ctx, run: RunRow) {
  const [w] = await ctx.db
    .select({ groupId: webhooks.groupId })
    .from(webhooks)
    .where(and(eq(webhooks.lastRunId, run.id), live))
  if (w) await publishWebhooks(ctx, w.groupId)
}
