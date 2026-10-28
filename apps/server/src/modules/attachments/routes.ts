import { randomUUID } from 'node:crypto'
import { createWriteStream } from 'node:fs'
import { mkdir, stat, unlink } from 'node:fs/promises'
import { join } from 'node:path'
import { pipeline } from 'node:stream/promises'
import multipart from '@fastify/multipart'
import { type MessageDto, SendAttachmentsArgs } from '@gonggong/protocol'
import { and, eq, inArray, isNull } from 'drizzle-orm'
import type { FastifyInstance, FastifyReply, FastifyRequest } from 'fastify'
import type { Ctx } from '../../context.js'
import { requireMachine } from '../../daemon/auth.js'
import { attachments, bots, groupBots, messages, runs } from '../../db/schema.js'
import { fail } from '../../lib/errors.js'
import { idParam } from '../../lib/ids.js'
import { FILE_OVERHEAD, openFileRange, sealStream } from '../../lib/seal.js'
import { sysParams } from '../admin/params.js'
import { requireUser } from '../auth/session.js'
import { effectiveParams } from '../groups/params.js'
import { requireMember, requireReader } from '../groups/service.js'
import {
  authorName,
  type MessageMeta,
  type MessageRow,
  messageDto,
  publishMessage,
} from '../messages/service.js'
import { LIVE } from '../runs/dto.js'
import { groupRedactor, runRedactors } from '../secrets/resolve.js'
import { publishHtmlRender, serveHtmlRender } from './html-render.js'
import { type AttachmentRow, dataDir, inlineType, safeName, type Upload, uploadDto } from './service.js'

async function findAttachment(ctx: Ctx, id: string) {
  const [row] = await ctx.db
    .select()
    .from(attachments)
    .where(eq(attachments.id, idParam(id, '附件不存在')))
  return row ?? fail('not_found', '附件不存在')
}

async function sendFile(req: FastifyRequest, reply: FastifyReply, a: AttachmentRow) {
  const inline = inlineType(a.mime)
  reply
    .header('content-type', inline ?? 'application/octet-stream')
    .header(
      'content-disposition',
      `${inline ? 'inline' : 'attachment'}; filename*=UTF-8''${encodeURIComponent(a.name)}`,
    )
    .header('x-content-type-options', 'nosniff')
    .header('accept-ranges', 'bytes')
  const range = inline ? req.headers.range : undefined
  if (range) {
    const m = /^bytes=(\d*)-(\d*)$/.exec(range)
    const suffix = m && !m[1] ? Number(m[2]) : null
    const start = m?.[1] ? Number(m[1]) : suffix ? Math.max(0, a.size - suffix) : 0
    const end = m?.[2] && m[1] ? Math.min(Number(m[2]), a.size - 1) : a.size - 1
    if (!m || (!m[1] && !m[2]) || suffix === 0 || start >= a.size || end < start)
      return reply.code(416).header('content-range', `bytes */${a.size}`).send()
    return reply
      .code(206)
      .header('content-range', `bytes ${start}-${end}/${a.size}`)
      .header('content-length', end - start + 1)
      .send(await openFileRange(join(dataDir(), a.storageKey), { start, end }))
  }
  return reply.header('content-length', a.size).send(await openFileRange(join(dataDir(), a.storageKey)))
}

async function sendAgentAttachments(ctx: Ctx, req: FastifyRequest<{ Params: { runId: string } }>) {
  const machine = await requireMachine(ctx, req)
  const runId = idParam(req.params.runId, '运行不存在')
  const [owned] = await ctx.db
    .select({ run: runs })
    .from(runs)
    .innerJoin(bots, eq(bots.id, runs.botId))
    .where(and(eq(runs.id, runId), eq(bots.machineId, machine.id), inArray(runs.status, LIVE)))
  if (!owned) return fail('not_found', '运行不存在或已结束')
  const { run } = owned
  const params = await effectiveParams(ctx.db, run.groupId)
  const redact = (await runRedactors(ctx, run.id)).redact
  const messageId = randomUUID()
  const stored: { values: typeof attachments.$inferInsert; path: string }[] = []
  let text = ''
  let files = 0
  const cleanup = () => Promise.all(stored.map((f) => unlink(f.path).catch(() => {})))
  try {
    const parts = req.parts({
      limits: { fileSize: params.attachmentMaxMb * 1024 * 1024, files: params.attachmentsPerMessage },
    })
    for await (const part of parts) {
      if (part.type === 'field') {
        if (part.fieldname === 'text') text = String(part.value)
        continue
      }
      if (part.fieldname !== 'files') {
        part.file.resume()
        return fail('invalid', '附件无效')
      }
      files++
      if (files > params.attachmentsPerMessage) {
        part.file.resume()
        return fail('invalid', '每条消息最多 {max} 个附件', { max: params.attachmentsPerMessage })
      }
      const id = randomUUID()
      const storageKey = `attachments/${id}`
      const path = join(dataDir(), storageKey)
      await mkdir(join(dataDir(), 'attachments'), { recursive: true })
      try {
        await pipeline(part.file, sealStream(), createWriteStream(path))
        if (part.file.truncated)
          fail('invalid', '单个附件不能超过 {maxMb} MB', { maxMb: params.attachmentMaxMb })
      } catch (e) {
        await unlink(path).catch(() => {})
        throw e
      }
      stored.push({
        path,
        values: {
          id,
          uploaderId: run.originUserId,
          groupId: run.groupId,
          messageId,
          name: safeName(part.filename, await groupRedactor(ctx, run.groupId)),
          size: (await stat(path)).size - FILE_OVERHEAD,
          mime: part.mimetype || 'application/octet-stream',
          storageKey,
        },
      })
    }
    SendAttachmentsArgs.shape.text.parse(text)
    if (!stored.length) return fail('invalid', '附件无效')
    const message = await ctx.db.transaction(async (tx) => {
      const [live] = await tx
        .select({ id: runs.id })
        .from(runs)
        .where(and(eq(runs.id, run.id), inArray(runs.status, LIVE)))
        .for('update')
      if (!live) return fail('not_found', '运行不存在或已结束')
      await tx.insert(attachments).values(stored.map((f) => f.values))
      const meta: MessageMeta = {
        attachments: stored.map((f) => ({
          id: f.values.id as string,
          name: f.values.name,
          size: f.values.size,
          mime: f.values.mime,
          messageId,
        })),
      }
      const [message] = (await tx
        .insert(messages)
        .values({
          id: messageId,
          groupId: run.groupId,
          kind: 'bot',
          authorBotId: run.botId,
          body: redact(text),
          meta,
          runId: run.id,
        })
        .returning()) as [MessageRow]
      return message
    })
    const dto = messageDto(message, await authorName(ctx, message))
    await publishMessage(ctx, dto)
    return dto satisfies MessageDto
  } catch (e) {
    await cleanup()
    throw e
  }
}

/** Spec §8.7: files attached to messages, size and count bounded by system params; the message send binds them. */
export function attachmentRoutes(ctx: Ctx) {
  return async (app: FastifyInstance) => {
    await app.register(multipart)

    /** multipart: the `groupId` field, then one `file`. */
    app.post('/api/uploads', async (req): Promise<Upload> => {
      const me = await requireUser(ctx, req)
      const maxMb = (await sysParams(ctx.db)).attachmentMaxMb
      const part = await req.file({ limits: { fileSize: maxMb * 1024 * 1024, files: 1 } })
      if (!part) return fail('invalid', '缺少文件')
      const field = part.fields.groupId
      const groupId = field && 'value' in field ? String(field.value) : ''
      try {
        if (!groupId) fail('invalid', '缺少 groupId')
        await requireMember(ctx, groupId, me.id)
      } catch (e) {
        part.file.resume()
        throw e
      }
      const id = randomUUID()
      const storageKey = `attachments/${id}`
      const path = join(dataDir(), storageKey)
      await mkdir(join(dataDir(), 'attachments'), { recursive: true })
      try {
        await pipeline(part.file, sealStream(), createWriteStream(path))
        // busboy stops at the limit and marks the stream truncated instead of failing it.
        if (part.file.truncated) fail('invalid', '单个附件不能超过 {maxMb} MB', { maxMb })
      } catch (e) {
        await unlink(path).catch(() => {})
        throw e
      }
      const [row] = await ctx.db
        .insert(attachments)
        .values({
          id,
          uploaderId: me.id,
          groupId,
          name: safeName(part.filename, await groupRedactor(ctx, groupId)),
          size: (await stat(path)).size - FILE_OVERHEAD,
          mime: part.mimetype || 'application/octet-stream',
          storageKey,
        })
        .returning()
      return uploadDto(row as AttachmentRow)
    })

    app.get<{ Params: { id: string } }>('/api/attachments/:id', async (req, reply) => {
      const me = await requireUser(ctx, req)
      const a = await findAttachment(ctx, req.params.id)
      await requireReader(ctx, a.groupId, me.id)
      return sendFile(req, reply, a)
    })

    /** The daemon writes attachments into the workspace of every bot of the group it hosts (plan D6). */
    app.get<{ Params: { id: string } }>('/api/daemon/attachments/:id', async (req, reply) => {
      const machine = await requireMachine(ctx, req)
      const a = await findAttachment(ctx, req.params.id)
      const [hosted] = await ctx.db
        .select({ id: bots.id })
        .from(groupBots)
        .innerJoin(bots, eq(bots.id, groupBots.botId))
        .where(
          and(eq(groupBots.groupId, a.groupId), eq(bots.machineId, machine.id), isNull(groupBots.removedAt)),
        )
        .limit(1)
      if (!hosted) return fail('forbidden', '该机器上没有这个群的 Bot')
      return sendFile(req, reply, a)
    })

    app.post<{ Params: { runId: string } }>('/api/daemon/runs/:runId/attachments', (req) =>
      sendAgentAttachments(ctx, req),
    )

    app.post<{ Params: { runId: string } }>('/api/daemon/runs/:runId/html-renders', (req) =>
      publishHtmlRender(ctx, req),
    )

    app.get<{ Params: { id: string } }>('/api/attachments/:id/render', (req, reply) =>
      serveHtmlRender(ctx, req, reply),
    )
  }
}
