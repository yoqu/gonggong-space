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
