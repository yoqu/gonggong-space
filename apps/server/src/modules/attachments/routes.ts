import { randomUUID } from 'node:crypto'
import { createReadStream, createWriteStream } from 'node:fs'
import { mkdir, stat, unlink } from 'node:fs/promises'
import { join } from 'node:path'
import { pipeline } from 'node:stream/promises'
import multipart from '@fastify/multipart'
import { and, eq, isNull } from 'drizzle-orm'
import type { FastifyInstance, FastifyReply } from 'fastify'
import type { Ctx } from '../../context.js'
import { requireMachine } from '../../daemon/auth.js'
import { attachments, bots, groupBots } from '../../db/schema.js'
import { fail } from '../../lib/errors.js'
import { idParam } from '../../lib/ids.js'
import { sysParams } from '../admin/params.js'
import { requireUser } from '../auth/session.js'
import { requireMember } from '../groups/service.js'
import { type AttachmentRow, dataDir, inlineType, safeName, type Upload, uploadDto } from './service.js'

async function findAttachment(ctx: Ctx, id: string) {
  const [row] = await ctx.db
    .select()
    .from(attachments)
    .where(eq(attachments.id, idParam(id, '附件')))
  return row ?? fail('not_found', '附件不存在')
}

function sendFile(reply: FastifyReply, a: AttachmentRow) {
  const inline = inlineType(a.mime)
  return reply
    .header('content-type', inline ?? 'application/octet-stream')
    .header(
      'content-disposition',
      `${inline ? 'inline' : 'attachment'}; filename*=UTF-8''${encodeURIComponent(a.name)}`,
    )
    .header('x-content-type-options', 'nosniff')
    .send(createReadStream(join(dataDir(), a.storageKey)))
}

/** Spec §8.7: files attached to messages, size and count bounded by system params; the message send binds them. */
export function attachmentRoutes(ctx: Ctx) {
  return async (app: FastifyInstance) => {
    await app.register(multipart)

    /** multipart: the `groupId` field, then one `file`. */
    app.post('/api/uploads', async (req): Promise<Upload> => {
      const me = await requireUser(ctx, req)
      const maxMb = sysParams().attachmentMaxMb
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
        await pipeline(part.file, createWriteStream(path))
        // busboy stops at the limit and marks the stream truncated instead of failing it.
        if (part.file.truncated) fail('invalid', `单个附件不能超过 ${maxMb} MB`)
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
          name: safeName(part.filename),
          size: (await stat(path)).size,
          mime: part.mimetype || 'application/octet-stream',
          storageKey,
        })
        .returning()
      return uploadDto(row as AttachmentRow)
    })

    app.get<{ Params: { id: string } }>('/api/attachments/:id', async (req, reply) => {
      const me = await requireUser(ctx, req)
      const a = await findAttachment(ctx, req.params.id)
      await requireMember(ctx, a.groupId, me.id)
      return sendFile(reply, a)
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
      if (!hosted) return fail('forbidden', '该机器上没有这个群的 bot')
      return sendFile(reply, a)
    })
  }
}
