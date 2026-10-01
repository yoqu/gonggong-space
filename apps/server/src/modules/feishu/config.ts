import { eq, isNotNull } from 'drizzle-orm'
import type { Ctx } from '../../context.js'
import { feishuApps } from '../../db/schema.js'
import { t } from '../../i18n/index.js'
import { BOT_CALLBACKS, BOT_EVENTS, type FeishuDevConfig, FeishuError } from './client.js'
import { credsOf, type FeishuAppRow } from './gateway.js'
import { publicUrl } from './identity.js'

const NO_PUBLIC_URL = 'no_public_url'
/** A new app's first version awaits the Feishu admin's approval; its scopes (and so the dev config) work only after. */
const RETRY_MS = 60_000

export const configErrorText = (raw: string | null) =>
  raw === null
    ? null
    : raw === NO_PUBLIC_URL
      ? t('未设置对外地址，重定向 URL 需在飞书开发者后台手动添加')
      : t('自动配置失败：{reason}', { reason: raw })

/**
 * Applies what scan-created apps cannot get through `addons`: the long connection for a bot app's events and
 * callbacks, the OAuth redirect URL for the main app. The outcome is kept on the row (`config_error`).
 */
export async function configureApp(ctx: Ctx, row: FeishuAppRow) {
  let error: string | null = null
  let config: FeishuDevConfig | null = { websocket: { events: BOT_EVENTS, callbacks: BOT_CALLBACKS } }
  if (row.kind === 'main') {
    const base = await publicUrl(ctx)
    config = base ? { redirectUrls: [`${base}/api/auth/feishu/callback`] } : null
    if (!config) error = NO_PUBLIC_URL
  }
  if (config)
    try {
      await ctx.feishu.api.configure(credsOf(row), config)
    } catch (err) {
      if (!(err instanceof FeishuError)) throw err
      error = err.message
    }
  const [saved] = await ctx.db
    .update(feishuApps)
    .set({ configError: error })
    .where(eq(feishuApps.id, row.id))
    .returning()
  return saved
}

/** One pass over the apps whose dev config is still pending. */
export async function retryFeishuConfig(ctx: Ctx) {
  for (const row of await ctx.db.select().from(feishuApps).where(isNotNull(feishuApps.configError)))
    await configureApp(ctx, row)
}

export function startFeishuConfigRetry(ctx: Ctx) {
  const timer = setInterval(() => {
    retryFeishuConfig(ctx).catch((err) => console.error('feishu config retry:', err))
  }, RETRY_MS)
  return async () => clearInterval(timer)
}
