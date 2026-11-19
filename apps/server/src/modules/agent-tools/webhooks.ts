import type { GONGGONG_TOOLS } from '@gonggong/protocol'
import { and, eq } from 'drizzle-orm'
import type { z } from 'zod'
import type { Ctx } from '../../context.js'
import { groupMembers, type runs, webhooks } from '../../db/schema.js'
import { isUuid } from '../../lib/ids.js'
import { activeBots } from '../groups/service.js'
import {
  createWebhook,
  deleteWebhook,
  loadWebhooks,
  updateWebhook,
  type WebhookRow,
  webhookById,
} from '../webhooks/service.js'
import { botActorOf, botIdsOf, formatRunOptionLines, RUN_STATUS_ZH, runOptionsOf } from './bots.js'
import { asTool, refuse, type ToolOutput } from './service.js'

type Run = typeof runs.$inferSelect
type Args<N extends keyof typeof GONGGONG_TOOLS> = z.infer<(typeof GONGGONG_TOOLS)[N]['input']>

async function requireOriginAdmin(ctx: Ctx, run: Run) {
  const [m] = await ctx.db
    .select({ isAdmin: groupMembers.isAdmin })
    .from(groupMembers)
    .where(and(eq(groupMembers.groupId, run.groupId), eq(groupMembers.userId, run.originUserId)))
  if (!m) return refuse('发起本轮的人已不在本群，不能管理 Webhook')
  if (!m.isAdmin) refuse('只有群管理员可以创建 Webhook')
}

async function targetWebhook(ctx: Ctx, run: Run, id: string): Promise<WebhookRow> {
  const row = isUuid(id) ? await webhookById(ctx, id) : undefined
  if (!row || row.w.groupId !== run.groupId)
    return refuse(`本群没有 id 为 ${id} 的 Webhook，请用 webhook_list 查看`)
  const [m] = await ctx.db
    .select({ isAdmin: groupMembers.isAdmin })
    .from(groupMembers)
    .where(and(eq(groupMembers.groupId, run.groupId), eq(groupMembers.userId, run.originUserId)))
  if (!m || (row.w.ownerId !== run.originUserId && !m.isAdmin))
    refuse('只有该 Webhook 的主人或群管理员可以修改或删除它')
  return row.w
}

export async function webhookCreate(ctx: Ctx, run: Run, a: Args<'webhook_create'>): Promise<ToolOutput> {
  await requireOriginAdmin(ctx, run)
  const botIds = a.bots?.length ? await botIdsOf(ctx, run, a.bots) : []
  const runOptions = a.run_options ? await runOptionsOf(ctx, run, a.run_options) : {}
  const actor = await botActorOf(ctx, run)
  const { row } = await asTool(() =>
    createWebhook(
      ctx,
      run.groupId,
      { name: a.name, botIds, runOptions, prompt: a.prompt ?? null },
      run.originUserId,
      actor,
    ),
  )
  const names = new Map((await activeBots(ctx, run.groupId)).map((b) => [b.id, b.name]))
  const botsText = row.botIds.length
    ? row.botIds.map((id) => names.get(id) ?? '已移出').join(' → ')
    : '仅发消息，不 @ Bot'
  return {
    text: [
      `已创建 Webhook「${row.name}」（id ${row.id}）。`,
      `候选 Bot：${botsText}`,
      ...formatRunOptionLines(row.runOptions, names),
      '出于安全原因，令牌不会发给 Bot 或写入聊天记录；请告诉发起人在「群设置 → Webhook」里点「生成令牌」复制调用 URL（仅显示一次）。',
    ].join('\n'),
    groups: [],
  }
}

export async function webhookList(ctx: Ctx, run: Run): Promise<ToolOutput> {
  const rows = await loadWebhooks(ctx, eq(webhooks.groupId, run.groupId))
  if (!rows.length) return { text: '本群还没有 Webhook', groups: [run.groupId] }
  const names = new Map((await activeBots(ctx, run.groupId)).map((b) => [b.id, b.name]))
  const lines = rows.map(({ w, lastStatus }) => {
    const bots = w.botIds.length ? w.botIds.map((id) => names.get(id) ?? '已移出').join(' → ') : '仅发消息'
    const tokenState = w.tokenHash ? '已生成令牌' : '待生成令牌'
    const state = w.enabled ? '启用中' : '已停用'
    const last = w.lastCalledAt
      ? ` · 最近调用 ${w.lastCalledAt.toISOString()}${lastStatus ? `（${RUN_STATUS_ZH[lastStatus] ?? lastStatus}）` : ''}`
      : ''
    return `- 「${w.name}」（id ${w.id}）· ${state} · ${tokenState} · 候选 ${bots}${last}`
  })
  return { text: [`本群的 Webhook（${rows.length} 个）：`, ...lines].join('\n'), groups: [run.groupId] }
}

export async function webhookUpdate(ctx: Ctx, run: Run, a: Args<'webhook_update'>): Promise<ToolOutput> {
  const w = await targetWebhook(ctx, run, a.id)
  const req = {
    ...(a.name !== undefined && { name: a.name }),
    ...(a.bots !== undefined && { botIds: await botIdsOf(ctx, run, a.bots) }),
    ...(a.run_options !== undefined && { runOptions: await runOptionsOf(ctx, run, a.run_options) }),
    ...(a.prompt !== undefined && { prompt: a.prompt }),
    ...(a.enabled !== undefined && { enabled: a.enabled }),
  }
  const actor = await botActorOf(ctx, run)
  const row = await asTool(() => updateWebhook(ctx, w, req, actor))
  return {
    text: `已更新 Webhook「${row.name}」（id ${row.id}，${row.enabled ? '启用中' : '已停用'}）`,
    groups: [],
  }
}

export async function webhookDelete(ctx: Ctx, run: Run, a: Args<'webhook_delete'>): Promise<ToolOutput> {
  const w = await targetWebhook(ctx, run, a.id)
  await deleteWebhook(ctx, w, await botActorOf(ctx, run))
  return { text: `已删除 Webhook「${w.name}」`, groups: [] }
}
