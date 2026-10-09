import { and, eq, isNotNull, ne } from 'drizzle-orm'
import type { Ctx } from '../../context.js'
import { feishuApps } from '../../db/schema.js'
import { t } from '../../i18n/index.js'
import { BOT_CALLBACKS, BOT_EVENTS, type FeishuDevConfig, FeishuError, MAIN_EVENTS } from './client.js'
import { credsOf, type FeishuAppRow } from './gateway.js'
import { publicUrl } from './identity.js'

const NO_PUBLIC_URL = 'no_public_url'
/** Feishu modifies only apps created in its developer console (code 210021); others never succeed. */
const NOT_MODIFIABLE = 'not_modifiable'
const NOT_MODIFIABLE_CODE = 210021
/** A new app's first version awaits the Feishu admin's approval; its scopes (and so the dev config) work only after. */
const RETRY_MS = 60_000

export const configErrorText = (raw: string | null) =>
  raw === null
    ? null
    : raw === NO_PUBLIC_URL
      ? t('未设置对外地址，重定向 URL 需在飞书开发者后台手动添加')
      : raw === NOT_MODIFIABLE
        ? t(
            '该应用不是在飞书开发者后台创建的，无法自动配置；请在开发者后台手动配置长连接事件与回调、重定向 URL',
          )
        : t('自动配置失败：{reason}', { reason: raw })

/**
 * Applies what scan-created apps cannot get through `addons`: the long connection for a bot app's events and
 * callbacks, the member events and OAuth redirect URL for the main app. The outcome is kept on the row (`config_error`).
 */
export async function configureApp(ctx: Ctx, row: FeishuAppRow) {
  let error: string | null = null
  let config: FeishuDevConfig = { websocket: { events: BOT_EVENTS, callbacks: BOT_CALLBACKS } }
  if (row.kind === 'main') {
    const base = await publicUrl(ctx)
    config = {
      websocket: { events: MAIN_EVENTS, callbacks: [] },
      ...(base && { redirectUrls: [`${base}/api/auth/feishu/callback`] }),
    }
    if (!base) error = NO_PUBLIC_URL
  }
  try {
    await ctx.feishu.api.configure(credsOf(row), config)
  } catch (err) {
    if (!(err instanceof FeishuError)) throw err
    error = err.code === NOT_MODIFIABLE_CODE ? NOT_MODIFIABLE : err.message
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
  for (const row of await ctx.db
    .select()
    .from(feishuApps)
    .where(and(isNotNull(feishuApps.configError), ne(feishuApps.configError, NOT_MODIFIABLE))))
    await configureApp(ctx, row)
}

export function startFeishuConfigRetry(ctx: Ctx) {
  const timer = setInterval(() => {
    retryFeishuConfig(ctx).catch((err) => console.error('feishu config retry:', err))
  }, RETRY_MS)
  return async () => clearInterval(timer)
}
