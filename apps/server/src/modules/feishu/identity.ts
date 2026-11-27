import { eq } from 'drizzle-orm'
import type { Ctx } from '../../context.js'
import { feishuIdentities } from '../../db/schema.js'
import { open, seal } from '../../lib/seal.js'
import { sysParams } from '../admin/params.js'
import { mainApp } from './apps.js'
import { FeishuError } from './client.js'
import { credsOf } from './gateway.js'

const SKEW_MS = 60_000

/** Feishu refresh tokens are single-use: concurrent refreshes for one user must share one call. */
const pending = new Map<string, Promise<string | null>>()

/** The user's main-app access token, refreshed when about to expire; null when not linked, revoked or the main app is gone. */
export function userToken(ctx: Ctx, userId: string): Promise<string | null> {
  const running = pending.get(userId)
  if (running) return running
  const p = currentToken(ctx, userId).finally(() => pending.delete(userId))
  pending.set(userId, p)
  return p
}

async function currentToken(ctx: Ctx, userId: string): Promise<string | null> {
  const [row] = await ctx.db.select().from(feishuIdentities).where(eq(feishuIdentities.userId, userId))
  if (!row?.accessToken) return null
  if (row.expiresAt && row.expiresAt.getTime() - SKEW_MS > ctx.now().getTime()) return open(row.accessToken)
  const app = await mainApp(ctx)
  const usable = row.refreshToken && (!row.refreshExpiresAt || row.refreshExpiresAt > ctx.now())
  if (!app || !usable) return null
  try {
    const tokens = await ctx.feishu.api.refresh(credsOf(app), open(row.refreshToken as string))
    await ctx.db
      .update(feishuIdentities)
      .set({
        accessToken: seal(tokens.accessToken),
        refreshToken: tokens.refreshToken ? seal(tokens.refreshToken) : null,
        expiresAt: tokens.expiresAt,
        refreshExpiresAt: tokens.refreshExpiresAt,
        updatedAt: ctx.now(),
      })
      .where(eq(feishuIdentities.id, row.id))
    return tokens.accessToken
  } catch (err) {
    if (!(err instanceof FeishuError)) throw err
    await ctx.db
      .update(feishuIdentities)
      .set({ accessToken: null, refreshToken: null, updatedAt: ctx.now() })
      .where(eq(feishuIdentities.id, row.id))
    return null
  }
}

/** Base URL for links back to 共工 (cards, OAuth redirect); null until the admin sets 对外地址. */
export async function publicUrl(ctx: Ctx): Promise<string | null> {
  return (await sysParams(ctx.db)).publicUrl || null
}

/** Opens a 共工 page: in the browser, or from a Feishu card in Feishu's sidebar. */
export type CardUrl = (path: string, where?: 'sidebar') => string

const APPLINK = 'https://applink.feishu.cn/client'

/**
 * Links back to 共工 for Feishu cards; null until 对外地址 is set. With 飞书网页应用 on they go through the main app's
 * 网页应用 (a Feishu tab), else to the browser.
 */
export async function cardUrl(ctx: Ctx): Promise<CardUrl | null> {
  const p = await sysParams(ctx.db)
  if (!p.publicUrl) return null
  const main = p.feishuWebApp ? await mainApp(ctx) : undefined
  return (path, where) => {
    const target = encodeURIComponent(`${p.publicUrl}${path}`)
    if (main)
      return `${APPLINK}/web_app/open?appId=${main.appId}${where ? `&mode=${where}` : ''}&lk_target_url=${target}`
    return where ? `${APPLINK}/web_url/open?mode=sidebar-semi&url=${target}` : `${p.publicUrl}${path}`
  }
}
