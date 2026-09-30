import { randomUUID } from 'node:crypto'
import {
  type DaemonToServer,
  FILE_TEXT_MAX_BYTES,
  type FilesTreeDto,
  type FileTextDto,
  INLINE_FILE_MIMES,
  type ServerToDaemon,
  type TunnelHead,
} from '@gonggong/protocol'
import { and, eq } from 'drizzle-orm'
import type { FastifyInstance, FastifyReply, FastifyRequest } from 'fastify'
import { z } from 'zod'
import type { Ctx } from '../../context.js'
import { groupBots } from '../../db/schema.js'
import { fail } from '../../lib/errors.js'
import { idParam } from '../../lib/ids.js'
import { requireUser } from '../auth/session.js'
import { activeBots, requireMember } from '../groups/service.js'
import { currentRepo, onlineMachine } from './provision.js'

type Answer = Extract<DaemonToServer, { t: 'files.tree.result' | 'files.read.result' }>
type Ask = Extract<ServerToDaemon, { t: 'files.tree' | 'files.read' }>
/** An ask without the fields `ask` fills in, per message type. */
type AskBody = {
  [K in Ask['t']]: Omit<Extract<Ask, { t: K }>, 'requestId' | 'groupId' | 'botId' | 'workspace'>
}[Ask['t']]
type Req = FastifyRequest<{ Params: { id: string; botId: string }; Querystring: unknown }>

const TIMEOUT_MS = 10_000
/** Request headers the workspace file server understands (seeking and revalidation). */
const FORWARDED = ['range', 'if-range', 'if-none-match']
const RETURNED = ['content-type', 'content-length', 'content-range', 'accept-ranges', 'etag', 'cache-control']
const INLINE = new Set<string>(INLINE_FILE_MIMES)

/** Relative to the workspace root, without leading or trailing slashes ('' = the root). */
const Query = z.object({
  path: z
    .string()
    .default('')
    .transform((p) => p.replace(/^\/+|\/+$/g, '')),
  ignored: z.enum(['0', '1']).optional(),
})

const offline = (bot: string) => fail('conflict', `${bot} 离线，无法读取文件`)

/** GET /api/groups/:id/bots/:botId/files/{tree,text,raw} — the read-only files browser (group members). */
export function workspaceFileRoutes(ctx: Ctx) {
  return async (app: FastifyInstance) => {
    /** The member-visible bot and its workspace, with the query. */
    async function target(req: Req) {
      const me = await requireUser(ctx, req)
      const { group } = await requireMember(ctx, req.params.id, me.id)
      const query = Query.parse(req.query)
      const botId = idParam(req.params.botId, 'bot ')
      const bot = (await activeBots(ctx, group.id)).find((b) => b.id === botId)
      if (!bot) return fail('not_found', '该 Bot 不在群内')
      const [gb] = await ctx.db
        .select({ cdPath: groupBots.cdPath, state: groupBots.workspaceState })
        .from(groupBots)
        .where(and(eq(groupBots.groupId, group.id), eq(groupBots.botId, bot.id)))
      if (gb?.state === 'unbound') return fail('conflict', `${bot.name} 尚未设置工作区`)
      const workspace = { repo: await currentRepo(ctx, group.id), cdPath: gb?.cdPath ?? null }
      return { groupId: group.id, bot, workspace, query }
    }

    async function ask<T extends Answer['t']>(t: Awaited<ReturnType<typeof target>>, msg: AskBody, reply: T) {
      const machineId = onlineMachine(ctx, t.bot.machineId)
      if (!machineId) return offline(t.bot.name)
      const full = {
        ...msg,
        requestId: randomUUID(),
        groupId: t.groupId,
        botId: t.bot.id,
        workspace: t.workspace,
      }
      const res =
        ((await ctx.hub.request(machineId, full as Ask, reply, TIMEOUT_MS)) as
          | Extract<Answer, { t: T }>
          | undefined) ?? offline(t.bot.name)
      if (res.error) return fail('conflict', res.error)
      return res
    }

    app.get('/api/groups/:id/bots/:botId/files/tree', async (req: Req): Promise<FilesTreeDto> => {
      const t = await target(req)
      const { path, ignored } = t.query
      const res = await ask(t, { t: 'files.tree', path, showIgnored: ignored === '1' }, 'files.tree.result')
      return { path, entries: res.entries, truncated: res.truncated }
    })

    app.get('/api/groups/:id/bots/:botId/files/text', async (req: Req): Promise<FileTextDto> => {
      const t = await target(req)
      const { path } = t.query
      if (!path) return fail('invalid', '缺少文件路径')
      const res = await ask(t, { t: 'files.read', path, maxBytes: FILE_TEXT_MAX_BYTES }, 'files.read.result')
      return { path, size: res.size, binary: res.binary, mime: res.mime, text: res.text }
    })

    /**
     * Raw bytes (media, PDF, downloads) streamed from the daemon's workspace file server over the preview tunnel,
     * Range included. Always sandboxed and never sniffed; only INLINE_FILE_MIMES display in place.
     */
    app.get('/api/groups/:id/bots/:botId/files/raw', async (req: Req, reply: FastifyReply) => {
      const t = await target(req)
      const { path } = t.query
      if (!path) return fail('invalid', '缺少文件路径')
      const conn = t.bot.machineId ? ctx.tunnels.get(t.bot.machineId) : undefined
      if (!conn) return offline(t.bot.name)
      const headers = FORWARDED.flatMap((k) => {
        const v = req.headers[k]
        return typeof v === 'string' ? [[k, v] as [string, string]] : []
      })
      let stream: ReturnType<typeof conn.open>
      try {
        stream = conn.open({
          files: { groupId: t.groupId, botId: t.bot.id, workspace: t.workspace },
          method: req.method === 'HEAD' ? 'HEAD' : 'GET',
          path: `/${path.split('/').map(encodeURIComponent).join('/')}`,
          headers,
          upgrade: false,
        })
      } catch {
        return fail('conflict', `${t.bot.name} 的文件读取繁忙，请稍后再试`)
      }
      stream.end()
      let head: TunnelHead
      try {
        head = await stream.head
      } catch (err) {
        return fail('conflict', (err as Error).message)
      }
      if (head.status >= 400 && head.status !== 416) {
        const chunks: Buffer[] = []
        for await (const c of stream) chunks.push(c as Buffer)
        return fail(head.status === 404 ? 'not_found' : 'conflict', Buffer.concat(chunks).toString())
      }
      const kept = head.headers.filter(([k]) => RETURNED.includes(k.toLowerCase()))
      const type = kept.find(([k]) => k.toLowerCase() === 'content-type')?.[1] ?? ''
      const inline = INLINE.has(type.split(';')[0]?.trim().toLowerCase() ?? '')
      const name = encodeURIComponent(path.split('/').pop() ?? path)
      reply.code(head.status).headers({
        ...Object.fromEntries(kept),
        'content-security-policy': 'sandbox',
        'x-content-type-options': 'nosniff',
        'content-disposition': `${inline ? 'inline' : 'attachment'}; filename*=UTF-8''${name}`,
      })
      return reply.send(stream)
    })
  }
}
