import { randomUUID } from 'node:crypto'
import {
  type DiagCheck,
  type GitAccessCmd,
  type GitAccessTest,
  GitAccessTestReq,
  type GitAccessView,
  GitTokenInput,
  TrustHostReq,
} from '@gonggong/protocol'
import type { FastifyInstance } from 'fastify'
import type { Ctx } from '../../context.js'
import { audit } from '../../lib/audit.js'
import { fail } from '../../lib/errors.js'
import { requireUser } from '../auth/session.js'
import { ownMachine, quietErrors, relay, requireFeature } from './relay.js'

const TIMEOUT_MS = 30_000
/** ls-remote is given 30 s on the machine, plus a host key scan. */
const TEST_TIMEOUT_MS = 60_000
/** `gg doctor` reaches the server and every agent. */
const DIAG_TIMEOUT_MS = 60_000

type Command = Omit<GitAccessCmd, 't' | 'requestId'>

/** Git access of a machine (ssh keys, HTTPS tokens, access tests): its owner's, relayed live, nothing kept here. */
export function gitAccessRoutes(ctx: Ctx) {
  return async (app: FastifyInstance) => {
    quietErrors(app)
    const run = async (userId: string, machineId: string, cmd: Command, timeoutMs = TIMEOUT_MS) => {
      const m = await ownMachine(ctx, userId, machineId, '只有机器主人可以管理其 Git 访问')
      requireFeature(ctx, m.id, 'gitAccess')
      const msg = { t: 'gitaccess.cmd', requestId: randomUUID(), ...cmd } as const
      return { machineId: m.id, res: await relay(ctx, m.id, msg, 'gitaccess.result', timeoutMs) }
    }
    const view = (v: GitAccessView | null) => v ?? fail('conflict', '机器未响应，请稍后重试')
    const record = (actorUserId: string, action: string, detail: Record<string, string>) =>
      audit(ctx, { category: 'admin', actorUserId, action, detail })

    app.get<{ Params: { id: string } }>('/api/machines/:id/git-access', async (req) => {
      const me = await requireUser(ctx, req)
      return view((await run(me.id, req.params.id, { action: 'status' })).res.view)
    })

    app.post<{ Params: { id: string } }>('/api/machines/:id/git-access/ssh-key', async (req) => {
      const me = await requireUser(ctx, req)
      const { machineId, res } = await run(me.id, req.params.id, { action: 'genKey' })
      await record(me.id, 'machine.git.key', { machineId })
      return view(res.view)
    })

    app.put<{ Params: { id: string } }>('/api/machines/:id/git-access/tokens', async (req) => {
      const me = await requireUser(ctx, req)
      const token = GitTokenInput.parse(req.body)
      const { machineId, res } = await run(me.id, req.params.id, { action: 'saveToken', token })
      await record(me.id, 'machine.git.token', { machineId, host: token.host })
      return view(res.view)
    })

    app.delete<{ Params: { id: string; host: string } }>(
      '/api/machines/:id/git-access/tokens/:host',
      async (req) => {
        const me = await requireUser(ctx, req)
        const { res } = await run(me.id, req.params.id, { action: 'removeToken', host: req.params.host })
        return view(res.view)
      },
    )

    app.post<{ Params: { id: string } }>(
      '/api/machines/:id/git-access/test',
      async (req): Promise<GitAccessTest> => {
        const me = await requireUser(ctx, req)
        const { url } = GitAccessTestReq.parse(req.body)
        const { res } = await run(me.id, req.params.id, { action: 'test', url }, TEST_TIMEOUT_MS)
        return res.test ?? fail('conflict', '机器未响应，请稍后重试')
      },
    )

    app.post<{ Params: { id: string } }>('/api/machines/:id/git-access/known-hosts', async (req) => {
      const me = await requireUser(ctx, req)
      const { host } = TrustHostReq.parse(req.body)
      const { machineId, res } = await run(me.id, req.params.id, { action: 'trustHost', host })
      await record(me.id, 'machine.git.trust', { machineId, host })
      return view(res.view)
    })

    app.get<{ Params: { id: string } }>('/api/machines/:id/diag', async (req): Promise<DiagCheck[]> => {
      const me = await requireUser(ctx, req)
      const m = await ownMachine(ctx, me.id, req.params.id, '只有机器主人可以查看其诊断')
      requireFeature(ctx, m.id, 'diag')
      const msg = { t: 'diag.run', requestId: randomUUID() } as const
      const res = await ctx.hub.request(m.id, msg, 'diag.result', DIAG_TIMEOUT_MS)
      return res?.checks ?? fail('conflict', '机器未响应，请稍后重试')
    })
  }
}
