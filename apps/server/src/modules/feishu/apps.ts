import type { FeishuAppDto, FeishuAppReq, FeishuAppStatus } from '@gonggong/protocol'
import { eq } from 'drizzle-orm'
import type { Ctx } from '../../context.js'
import { feishuApps } from '../../db/schema.js'
import { audit } from '../../lib/audit.js'
import { fail } from '../../lib/errors.js'
import { seal } from '../../lib/seal.js'
import { FeishuError } from './client.js'
import { type FeishuAppRow, reloadFeishu } from './gateway.js'

export const appDto = (row: FeishuAppRow | undefined): FeishuAppDto | null =>
  row
    ? {
        appId: row.appId,
        status: row.status as FeishuAppStatus,
        error: row.error,
        updatedAt: row.updatedAt.toISOString(),
      }
    : null

/** The system-wide main app (F1), if configured. */
export async function mainApp(ctx: Ctx) {
  const [row] = await ctx.db.select().from(feishuApps).where(eq(feishuApps.kind, 'main'))
  return row
}

/** The bot's own app, if bound. */
export async function botApp(ctx: Ctx, botId: string) {
  const [row] = await ctx.db.select().from(feishuApps).where(eq(feishuApps.botId, botId))
  return row
}

type Owner = { kind: 'main' } | { kind: 'bot'; botId: string; teamId: string }

/** Verifies the credentials with Feishu, then stores them (sealed) for `owner` and (re)connects. */
export async function saveApp(ctx: Ctx, owner: Owner, req: FeishuAppReq, actorUserId: string) {
  if (!/^cli_[0-9a-z]+$/.test(req.appId)) fail('invalid', 'App ID 应以 cli_ 开头')
  const current = owner.kind === 'main' ? await mainApp(ctx) : await botApp(ctx, owner.botId)
  const [taken] = await ctx.db.select().from(feishuApps).where(eq(feishuApps.appId, req.appId))
  if (taken && taken.id !== current?.id) fail('conflict', '该飞书应用已被其他 Bot 或主应用使用')
  try {
    await ctx.feishu.api.verify(req)
  } catch (err) {
    if (!(err instanceof FeishuError)) throw err
    fail('invalid', '飞书校验失败：{reason}', { reason: err.message })
  }
  const values = {
    appId: req.appId,
    appSecret: seal(req.appSecret),
    status: 'connecting',
    error: null,
    updatedBy: actorUserId,
    updatedAt: ctx.now(),
  }
  if (current) await ctx.db.update(feishuApps).set(values).where(eq(feishuApps.id, current.id))
  else
    await ctx.db
      .insert(feishuApps)
      .values(
        owner.kind === 'main'
          ? { ...values, kind: 'main' }
          : { ...values, kind: 'bot', botId: owner.botId, teamId: owner.teamId },
      )
  await reloadFeishu(ctx)
  await audit(ctx, {
    category: 'admin',
    actorUserId,
    teamId: owner.kind === 'bot' ? owner.teamId : null,
    action: 'feishu.app.save',
    detail: { kind: owner.kind, appId: req.appId, ...(owner.kind === 'bot' && { botId: owner.botId }) },
  })
  return appDto(owner.kind === 'main' ? await mainApp(ctx) : await botApp(ctx, owner.botId))
}

export async function removeApp(ctx: Ctx, row: FeishuAppRow | undefined, actorUserId: string) {
  if (!row) return
  await ctx.db.delete(feishuApps).where(eq(feishuApps.id, row.id))
  await reloadFeishu(ctx)
  await audit(ctx, {
    category: 'admin',
    actorUserId,
    teamId: row.teamId,
    action: 'feishu.app.remove',
    detail: { kind: row.kind, appId: row.appId, ...(row.botId && { botId: row.botId }) },
  })
}
