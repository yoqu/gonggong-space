import { randomUUID } from 'node:crypto'
import { createWriteStream } from 'node:fs'
import { mkdir, stat, unlink } from 'node:fs/promises'
import { join } from 'node:path'
import { pipeline } from 'node:stream/promises'
import { HtmlRenderRef, injectHtmlRenderBootstrap, type MessageDto } from '@gonggong/protocol'
import { and, eq, inArray } from 'drizzle-orm'
import type { FastifyReply, FastifyRequest } from 'fastify'
import type { Ctx } from '../../context.js'
import { requireMachine } from '../../daemon/auth.js'
import { attachments, bots, messages, runs } from '../../db/schema.js'
import { fail } from '../../lib/errors.js'
import { idParam } from '../../lib/ids.js'
import { FILE_OVERHEAD, openFileRange, sealStream } from '../../lib/seal.js'
import { requireUser } from '../auth/session.js'
import { requireReader } from '../groups/service.js'
import {
  authorName,
  type MessageMeta,
  type MessageRow,
  messageDto,
  publishMessage,
} from '../messages/service.js'
import { LIVE } from '../runs/dto.js'
import { runRedactors } from '../secrets/resolve.js'
import { dataDir, safeName } from './service.js'

/** The daemon inlines local images, up to 25 MiB a page. */
const PAGE_MAX_BYTES = 26 * 1024 * 1024
/** No allow-same-origin: the page runs in an opaque origin, away from the app's session, even opened directly. */
const PAGE_CSP = 'sandbox allow-scripts allow-forms allow-popups'

const invalid = () => fail('invalid', '页面无效')

/** html_render: multipart `title`, `height`, optional `heights` (JSON [[width, height]…]), then the `html` file. */
export async function publishHtmlRender(ctx: Ctx, req: FastifyRequest<{ Params: { runId: string } }>) {
  const machine = await requireMachine(ctx, req)
  const [owned] = await ctx.db
    .select({ run: runs })
    .from(runs)
    .innerJoin(bots, eq(bots.id, runs.botId))
    .where(
      and(
        eq(runs.id, idParam(req.params.runId, '运行不存在')),
        eq(bots.machineId, machine.id),
        inArray(runs.status, LIVE),
      ),
    )
  if (!owned) return fail('not_found', '运行不存在或已结束')
  const { run } = owned
  const fields: Record<string, string> = {}
  let html: string | null = null
  for await (const part of req.parts({ limits: { fileSize: PAGE_MAX_BYTES, files: 1 } })) {
    if (part.type === 'field') {
      fields[part.fieldname] = String(part.value)
      continue
    }
    const chunks: Buffer[] = []
    for await (const chunk of part.file) chunks.push(chunk as Buffer)
    if (part.fieldname !== 'html' || part.file.truncated) return invalid()
    html = Buffer.concat(chunks).toString('utf8')
  }
  const redact = (await runRedactors(ctx, run.id)).redact
  let heights: unknown
  try {
    heights = fields.heights === undefined ? undefined : JSON.parse(fields.heights)
  } catch {
    return invalid()
  }
  const parsed = HtmlRenderRef.omit({ attachmentId: true }).safeParse({
    title: redact(fields.title ?? '').trim(),
    height: Number(fields.height),
    heights,
  })
  if (!parsed.success || !html) return invalid()
  const ref = {
    ...parsed.data,
    ...(parsed.data.heights && { heights: parsed.data.heights.toSorted((a, b) => a[0] - b[0]) }),
  }

  const id = randomUUID()
  const messageId = randomUUID()
  const storageKey = `attachments/${id}`
  const path = join(dataDir(), storageKey)
  await mkdir(join(dataDir(), 'attachments'), { recursive: true })
  const page = injectHtmlRenderBootstrap(html)
  try {
    await pipeline([Buffer.from(page, 'utf8')], sealStream(), createWriteStream(path))
    const message = await ctx.db.transaction(async (tx) => {
      const [live] = await tx
        .select({ id: runs.id })
        .from(runs)
        .where(and(eq(runs.id, run.id), inArray(runs.status, LIVE)))
        .for('update')
      if (!live) return fail('not_found', '运行不存在或已结束')
      await tx.insert(attachments).values({
        id,
        uploaderId: run.originUserId,
        groupId: run.groupId,
        messageId,
        name: safeName(`${ref.title}.html`),
        size: (await stat(path)).size - FILE_OVERHEAD,
        mime: 'text/html',
        storageKey,
      })
      const meta: MessageMeta = { htmlRender: { attachmentId: id, ...ref } }
      const [row] = (await tx
        .insert(messages)
        .values({
          id: messageId,
          groupId: run.groupId,
          kind: 'bot',
          authorBotId: run.botId,
          body: ref.title,
          meta,
          runId: run.id,
        })
        .returning()) as [MessageRow]
      return row
    })
    const dto = messageDto(message, await authorName(ctx, message))
    await publishMessage(ctx, dto)
    return dto satisfies MessageDto
  } catch (e) {
    await unlink(path).catch(() => {})
    throw e
  }
}

/** The page of an html_render message, as a sandboxed document for the chat's frame. */
export async function serveHtmlRender(
  ctx: Ctx,
  req: FastifyRequest<{ Params: { id: string } }>,
  reply: FastifyReply,
) {
  const me = await requireUser(ctx, req)
  const [row] = await ctx.db
    .select({ a: attachments, meta: messages.meta })
    .from(attachments)
    .innerJoin(messages, eq(messages.id, attachments.messageId))
    .where(eq(attachments.id, idParam(req.params.id, '附件不存在')))
  const a = row?.a
  if (!a || (row.meta as MessageMeta).htmlRender?.attachmentId !== a.id)
    return fail('not_found', '附件不存在')
  await requireReader(ctx, a.groupId, me.id)
  return reply
    .header('content-type', 'text/html; charset=utf-8')
    .header('content-security-policy', PAGE_CSP)
    .header('x-content-type-options', 'nosniff')
    .header('cache-control', 'private, max-age=86400')
    .send(await openFileRange(join(dataDir(), a.storageKey)))
}
