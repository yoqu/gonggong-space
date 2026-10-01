import { randomUUID } from 'node:crypto'
import type { FeishuRegisterDto, FeishuRegisterStatus, I18nParams } from '@gonggong/protocol'
import { eq } from 'drizzle-orm'
import type { Ctx } from '../../context.js'
import { feishuApps } from '../../db/schema.js'
import { type MessageKey, t } from '../../i18n/index.js'
import { fail } from '../../lib/errors.js'
import { appDto, botApp, mainApp, saveApp } from './apps.js'
import {
  BOT_CALLBACKS,
  BOT_EVENTS,
  BOT_TENANT_SCOPES,
  type FeishuCreds,
  type FeishuDevConfig,
  FeishuError,
  FeishuRegisterError,
  MAIN_TENANT_SCOPES,
  USER_SCOPES,
} from './client.js'
import type { FeishuAppRow } from './gateway.js'
import { publicUrl } from './identity.js'

/** Whose app a session creates (or, with `update`, re-confirms). */
export type RegisterTarget = { kind: 'main' } | { kind: 'bot'; botId: string; teamId: string; name: string }

type Text = { key: MessageKey; params?: I18nParams }

interface Session {
  id: string
  userId: string
  target: string
  url: string
  expiresAt: Date
  status: FeishuRegisterStatus
  error: Text | null
  configError: Text | null
  app: FeishuAppRow | undefined
  abort: AbortController
}

/** Settled sessions stay readable this long so the dialog can show the outcome. */
const KEEP_MS = 10 * 60_000
/** The dev config's long-connection mode only saves while the app holds a connection. */
const CONNECT_WAIT_MS = 15_000

const sessions = new WeakMap<Ctx, Map<string, Session>>()
const of = (ctx: Ctx) => {
  let m = sessions.get(ctx)
  if (!m) {
    m = new Map()
    sessions.set(ctx, m)
  }
  return m
}

const keyOf = (target: RegisterTarget) => (target.kind === 'main' ? 'main' : `bot:${target.botId}`)
const rowOf = (ctx: Ctx, target: RegisterTarget) =>
  target.kind === 'main' ? mainApp(ctx) : botApp(ctx, target.botId)

const tr = (text: Text | null) => (text ? t(text.key, text.params) : null)

export const registerDto = (s: Session): FeishuRegisterDto => ({
  id: s.id,
  url: s.url,
  expiresAt: s.expiresAt.toISOString(),
  status: s.status,
  error: tr(s.error),
  app: appDto(s.app),
  configError: tr(s.configError),
})

/** The caller's own session; others' sessions do not exist for them. */
export function registerSession(ctx: Ctx, userId: string, id: string) {
  const s = of(ctx).get(id)
  return s && s.userId === userId ? s : undefined
}

export function cancelRegister(s: Session) {
  s.abort.abort()
}

/** Aborts every pending session (server shutdown). */
export function stopRegister(ctx: Ctx) {
  for (const s of of(ctx).values()) s.abort.abort()
}

/**
 * 扫码创建: starts Feishu's device flow and resolves with the QR link. The admin's confirmation is awaited in the
 * background; the app is then saved like a manual entry and its sensitive dev config applied.
 */
export async function startRegister(
  ctx: Ctx,
  userId: string,
  target: RegisterTarget,
  update: FeishuAppRow | undefined,
): Promise<Session> {
  const key = keyOf(target)
  for (const s of of(ctx).values()) if (s.target === key && s.status === 'waiting') s.abort.abort()
  const s: Session = {
    id: randomUUID(),
    userId,
    target: key,
    url: '',
    expiresAt: ctx.now(),
    status: 'waiting',
    error: null,
    configError: null,
    app: undefined,
    abort: new AbortController(),
  }
  const main = target.kind === 'main'
  let ready!: () => void
  const urlReady = new Promise<void>((resolve) => {
    ready = resolve
  })
  const done = ctx.feishu.api.register({
    name: main ? '共工' : target.name,
    desc: main ? '共工登录与消息同步' : '共工 Bot',
    scopes: main
      ? { tenant: MAIN_TENANT_SCOPES, user: USER_SCOPES }
      : { tenant: BOT_TENANT_SCOPES, user: [] },
    events: main ? [] : BOT_EVENTS,
    callbacks: main ? [] : BOT_CALLBACKS,
    ...(update && { appId: update.appId }),
    signal: s.abort.signal,
    onUrl: (url, expireIn) => {
      s.url = url
      s.expiresAt = new Date(ctx.now().getTime() + expireIn * 1000)
      ready()
    },
  })
  const settled = done.then(
    (creds) => finish(ctx, s, target, creds),
    (err) => ended(s, err),
  )
  // The device flow fails before producing a link when Feishu cannot be reached.
  await Promise.race([urlReady, settled])
  if (!s.url) return fail('invalid', '飞书创建应用失败：{reason}', { reason: tr(s.error) ?? '' })
  of(ctx).set(s.id, s)
  void settled.finally(() => setTimeout(() => of(ctx).delete(s.id), KEEP_MS).unref())
  return s
}

function ended(s: Session, err: unknown) {
  const reason = err instanceof FeishuRegisterError ? err.reason : 'error'
  if (reason === 'abort') s.status = 'cancelled'
  else if (reason === 'expired_token') s.status = 'expired'
  else {
    s.status = 'failed'
    s.error =
      reason === 'access_denied'
        ? { key: '已在飞书中拒绝授权' }
        : { key: '飞书创建应用失败：{reason}', params: { reason: (err as Error).message } }
  }
}

async function finish(ctx: Ctx, s: Session, target: RegisterTarget, creds: FeishuCreds) {
  const owner =
    target.kind === 'main' ? target : { kind: 'bot' as const, botId: target.botId, teamId: target.teamId }
  try {
    await saveApp(ctx, owner, creds, s.userId)
  } catch (err) {
    s.status = 'failed'
    s.error = { key: '飞书创建应用失败：{reason}', params: { reason: (err as Error).message } }
    return
  }
  s.configError = await applyDevConfig(ctx, target, creds)
  s.app = await rowOf(ctx, target)
  s.status = 'succeeded'
}

/** Long connection for a bot app's events and callbacks; the OAuth redirect URL for the main app. */
async function applyDevConfig(ctx: Ctx, target: RegisterTarget, creds: FeishuCreds): Promise<Text | null> {
  let config: FeishuDevConfig
  if (target.kind === 'main') {
    const base = await publicUrl(ctx)
    if (!base) return { key: '未设置对外地址，重定向 URL 需在飞书开发者后台手动添加' }
    config = { redirectUrls: [`${base}/api/auth/feishu/callback`] }
  } else {
    await connected(ctx, creds.appId)
    config = { websocket: { events: BOT_EVENTS, callbacks: BOT_CALLBACKS } }
  }
  try {
    await ctx.feishu.api.configure(creds, config)
    return null
  } catch (err) {
    if (!(err instanceof FeishuError)) throw err
    return { key: '自动配置失败：{reason}', params: { reason: err.message } }
  }
}

async function connected(ctx: Ctx, appId: string) {
  const until = Date.now() + CONNECT_WAIT_MS
  while (Date.now() < until) {
    const [row] = await ctx.db.select().from(feishuApps).where(eq(feishuApps.appId, appId))
    if (row?.status === 'connected') return
    await new Promise((r) => setTimeout(r, 500))
  }
}
