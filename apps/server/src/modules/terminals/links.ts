import type { FastifyInstance, FastifyRequest } from 'fastify'
import { z } from 'zod'
import { fail } from '../../lib/errors.js'

export type TerminalLinkTarget = { userId: string; groupId: string; botId: string; cdPath?: string | null }
export type TerminalLinkUser = { id: string }

type Options = {
  user: (req: FastifyRequest) => Promise<TerminalLinkUser | null>
  authorize: (userId: string, groupId: string, botId: string) => Promise<TerminalLinkTarget | null>
  exists: (target: TerminalLinkTarget, file: { path: string }) => Promise<boolean>
}

const RequestBody = z.object({
  path: z.string().min(1).max(4096),
  line: z.number().int().min(1).max(1_000_000).default(1),
})

export function workspaceRelativePath(raw: string): string | null {
  if (/[\0\\]/u.test(raw) || /^[a-zA-Z][a-zA-Z\d+.-]*:/u.test(raw) || raw.startsWith('/')) return null
  if (/%[0-9a-f]{2}/iu.test(raw)) return null
  const parts = raw.split('/')
  if (parts.some((part) => part === '..') || parts.at(-1) === '') return null
  return parts.filter((part) => part && part !== '.').join('/') || null
}

/** Integration supplies TerminalService.target authorization and a daemon workspace-only existence check. */
export function terminalLinkRoutes(options: Options) {
  return async (app: FastifyInstance) => {
    app.post<{ Params: { groupId: string; botId: string } }>(
      '/api/groups/:groupId/bots/:botId/terminal-links/resolve',
      async (req) => {
        const user = await options.user(req)
        if (!user) return fail('unauthorized', '请先登录')
        const input = RequestBody.parse(req.body)
        const path = workspaceRelativePath(input.path)
        if (!path) return fail('invalid', '文件路径不合法：{path}', { path: input.path })
        const target = await options.authorize(user.id, req.params.groupId, req.params.botId)
        if (!target) return fail('forbidden', '仅机器主人可以使用终端')
        return { path, line: input.line, exists: await options.exists(target, { path }) }
      },
    )
  }
}
