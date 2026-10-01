import type { FeishuAppStatus } from '@gonggong/protocol'
import * as lark from '@larksuiteoapi/node-sdk'
import { and, eq, isNull, or } from 'drizzle-orm'
import type { Ctx } from '../../context.js'
import { bots, feishuApps } from '../../db/schema.js'
import { open } from '../../lib/seal.js'
import type { FeishuCreds } from './client.js'

export type FeishuAppRow = typeof feishuApps.$inferSelect

/** Inbound events and callbacks 共工 subscribes to, by their Feishu name. */
export interface FeishuInbound {
  'im.message.receive_v1': Parameters<NonNullable<lark.EventHandles['im.message.receive_v1']>>[0]
  'im.message.recalled_v1': Parameters<NonNullable<lark.EventHandles['im.message.recalled_v1']>>[0]
  'card.action.trigger': lark.RawCardActionEvent & {
    action?: { form_value?: Record<string, unknown>; input_value?: string }
  }
}
export type FeishuEventType = keyof FeishuInbound
export const FEISHU_EVENTS = [
  'im.message.receive_v1',
  'im.message.recalled_v1',
  'card.action.trigger',
] as const satisfies readonly FeishuEventType[]

/** One app's long connection; `onEvent`'s result answers the event (a card callback's response). */
export interface FeishuConnector {
  connect(
    app: FeishuCreds,
    hooks: {
      onStatus: (status: FeishuAppStatus, error: string | null) => void
      onEvent: (type: FeishuEventType, data: unknown) => Promise<unknown>
    },
  ): { close: () => void }
}

/** Real connector: the SDK's WSClient, which reconnects by itself. */
export function larkConnector(): FeishuConnector {
  return {
    connect(app, { onStatus, onEvent }) {
      const ws = new lark.WSClient({
        ...app,
        loggerLevel: lark.LoggerLevel.warn,
        onReady: () => onStatus('connected', null),
        onReconnecting: () => onStatus('connecting', null),
        onReconnected: () => onStatus('connected', null),
        onError: (err) => onStatus('error', err.message),
      })
      const dispatcher = new lark.EventDispatcher({}).register(
        Object.fromEntries(FEISHU_EVENTS.map((type) => [type, (data: unknown) => onEvent(type, data)])),
      )
      ws.start({ eventDispatcher: dispatcher }).catch((err: Error) => onStatus('error', err.message))
      return { close: () => ws.close({ force: true }) }
    },
  }
}

export const credsOf = (row: FeishuAppRow): FeishuCreds => ({
  appId: row.appId,
  appSecret: open(row.appSecret),
})

type Handler<K extends FeishuEventType> = (app: FeishuAppRow, event: FeishuInbound[K]) => Promise<unknown>

interface Gateway {
  conns: Map<string, { row: FeishuAppRow; close: () => void }>
  handlers: { [K in FeishuEventType]?: Handler<K> }
  reloading: Promise<void>
}

const gateways = new WeakMap<Ctx, Gateway>()

function state(ctx: Ctx): Gateway {
  let g = gateways.get(ctx)
  if (!g) {
    g = { conns: new Map(), handlers: {}, reloading: Promise.resolve() }
    gateways.set(ctx, g)
  }
  return g
}

/** Registers the handler of one event type (one per type; a later registration replaces it). */
export function onFeishu<K extends FeishuEventType>(ctx: Ctx, type: K, handler: Handler<K>) {
  ;(state(ctx).handlers as Record<string, unknown>)[type] = handler
}

async function setStatus(ctx: Ctx, row: FeishuAppRow, status: FeishuAppStatus, error: string | null) {
  // Only the connection of the row's current credentials may report on it.
  if (state(ctx).conns.get(row.id)?.row !== row) return
  await ctx.db
    .update(feishuApps)
    .set({ status, error })
    .where(and(eq(feishuApps.id, row.id), eq(feishuApps.appSecret, row.appSecret)))
}

function connect(ctx: Ctx, row: FeishuAppRow) {
  const g = state(ctx)
  const entry = { row, close: () => {} }
  g.conns.set(row.id, entry)
  const conn = ctx.feishu.connector.connect(credsOf(row), {
    onStatus: (status, error) => void setStatus(ctx, row, status, error).catch(() => {}),
    onEvent: async (type, data) => {
      const handler = g.handlers[type] as Handler<typeof type> | undefined
      // The row may have been replaced since; handlers get the current one.
      const current = g.conns.get(row.id)?.row
      return handler && current ? handler(current, data as never) : undefined
    },
  })
  entry.close = conn.close
}

/** Apps whose connection should be up: the main app and the apps of live bots. */
const liveApps = (ctx: Ctx) =>
  ctx.db
    .select({ app: feishuApps })
    .from(feishuApps)
    .leftJoin(bots, eq(bots.id, feishuApps.botId))
    .where(or(eq(feishuApps.kind, 'main'), isNull(bots.deletedAt)))

/** Brings the connections in line with `feishu_apps`: new or changed credentials (re)connect, removed ones close. */
export function reloadFeishu(ctx: Ctx): Promise<void> {
  const g = state(ctx)
  g.reloading = g.reloading.then(async () => {
    const rows = (await liveApps(ctx)).map((r) => r.app)
    const wanted = new Map(rows.map((r) => [r.id, r]))
    for (const [id, conn] of g.conns) {
      const next = wanted.get(id)
      if (next && next.appId === conn.row.appId && next.appSecret === conn.row.appSecret) {
        wanted.delete(id)
        continue
      }
      conn.close()
      g.conns.delete(id)
    }
    for (const row of wanted.values()) {
      if (row.status !== 'connecting')
        await ctx.db
          .update(feishuApps)
          .set({ status: 'connecting', error: null })
          .where(eq(feishuApps.id, row.id))
      connect(ctx, { ...row, status: 'connecting', error: null })
    }
  })
  return g.reloading
}

/** Connects every configured app; the returned closer drops all connections. */
export async function startFeishu(ctx: Ctx) {
  await reloadFeishu(ctx)
  return async () => {
    const g = state(ctx)
    await g.reloading
    for (const conn of g.conns.values()) conn.close()
    g.conns.clear()
  }
}
