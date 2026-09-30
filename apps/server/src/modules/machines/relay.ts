import type { DaemonFeature, ServerToDaemon } from '@gonggong/protocol'
import { and, eq, isNull } from 'drizzle-orm'
import type { FastifyInstance } from 'fastify'
import { ZodError } from 'zod'
import type { Ctx } from '../../context.js'
import { machines } from '../../db/schema.js'
import { fail, HttpError } from '../../lib/errors.js'
import { idParam } from '../../lib/ids.js'

export const OFFLINE = '机器离线'
export const OUTDATED = '请先升级该机器的 daemon'

/** A live machine of `userId`: its tools and providers are only ever read or changed by its owner. */
export async function ownMachine(ctx: Ctx, userId: string, rawId: string) {
  const [m] = await ctx.db
    .select()
    .from(machines)
    .where(and(eq(machines.id, idParam(rawId, '机器')), isNull(machines.revokedAt)))
  if (!m) return fail('not_found', '机器不存在')
  return m.ownerId === userId ? m : fail('forbidden', '只有机器主人可以管理其 Agent 工具与供应商')
}

export function requireFeature(ctx: Ctx, machineId: string, feature: DaemonFeature, missing = OUTDATED) {
  if (!ctx.hub.isOnline(machineId)) fail('conflict', OFFLINE)
  if (!ctx.hub.features(machineId).includes(feature)) fail('conflict', missing)
}

type Answered = 'tools.result' | 'providers.result' | 'ccswitch.result'

/** One round trip to the daemon; its own error (in its words, keys never included) becomes a 400. */
export async function relay<T extends Answered>(
  ctx: Ctx,
  machineId: string,
  msg: Extract<ServerToDaemon, { requestId: string }>,
  reply: T,
  timeoutMs: number,
) {
  const res = await ctx.hub.request(machineId, msg, reply, timeoutMs)
  if (!res) return fail('conflict', ctx.hub.isOnline(machineId) ? '机器未响应，请稍后重试' : OFFLINE)
  const { ok, error } = res as { ok: boolean; error: string | null }
  return ok ? res : fail('invalid', error ?? '操作失败')
}

/**
 * These routes carry API keys in their bodies: failures are answered without echoing or logging anything from
 * the request (a body that fails to parse would otherwise be quoted in the error).
 */
export function quietErrors(app: FastifyInstance) {
  app.setErrorHandler((err, _req, reply) => {
    if (err instanceof HttpError)
      return reply.status(err.status).send({ error: err.code, message: err.message })
    if (err instanceof ZodError)
      return reply.status(400).send({ error: 'invalid', message: err.issues[0]?.message ?? 'invalid' })
    const status = (err as { statusCode?: number }).statusCode ?? 500
    app.log.warn({ code: (err as { code?: string }).code, status }, 'request failed')
    return reply
      .status(status)
      .send({ error: 'invalid', message: status < 500 ? '请求无效' : 'internal error' })
  })
}
