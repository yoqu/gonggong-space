import {
  TerminalCreateReq,
  type TerminalDto,
  TerminalSpaceCreateReq,
  type TerminalSpaceDto,
  TerminalSpaceUpdateReq,
} from '@gonggong/protocol'
import { and, desc, eq, isNull } from 'drizzle-orm'
import type { FastifyInstance } from 'fastify'
import type { Ctx } from '../../context.js'
import { machines, terminalSpaces } from '../../db/schema.js'
import { fail } from '../../lib/errors.js'
import { isUuid } from '../../lib/ids.js'
import { requireUser } from '../auth/session.js'
import type { TerminalService } from './sessions.js'

type Params = { Params: { id: string } }

const columns = {
  space: terminalSpaces,
  machineName: machines.name,
  machineLabel: machines.label,
}
type Row = { space: typeof terminalSpaces.$inferSelect; machineName: string; machineLabel: string | null }

const dto = ({ space, machineName, machineLabel }: Row): TerminalSpaceDto => ({
  id: space.id,
  machineId: space.machineId,
  machineName: machineLabel ?? machineName,
  name: space.name,
  cwd: space.cwd,
  createdAt: space.createdAt.toISOString(),
  lastActiveAt: space.lastActiveAt.toISOString(),
})

/** 我的机器管理 → 新建终端: machine terminals kept as conversations, each a directory on one of my machines. */
export function terminalSpaceRoutes({ ctx, terminals }: { ctx: Ctx; terminals: TerminalService }) {
  const mine = async (userId: string, id: string) => {
    if (!isUuid(id)) return fail('not_found', '终端不存在')
    const [row] = await ctx.db
      .select(columns)
      .from(terminalSpaces)
      .innerJoin(machines, eq(machines.id, terminalSpaces.machineId))
      .where(and(eq(terminalSpaces.id, id), eq(terminalSpaces.ownerId, userId)))
    return row ?? fail('not_found', '终端不存在')
  }

  return async (app: FastifyInstance) => {
    app.get('/api/terminal-spaces', async (req): Promise<TerminalSpaceDto[]> => {
      const user = await requireUser(ctx, req)
      const rows = await ctx.db
        .select(columns)
        .from(terminalSpaces)
        .innerJoin(machines, eq(machines.id, terminalSpaces.machineId))
        .where(and(eq(terminalSpaces.ownerId, user.id), isNull(machines.revokedAt)))
        .orderBy(desc(terminalSpaces.lastActiveAt))
      return rows.map(dto)
    })

    app.post('/api/terminal-spaces', async (req, reply) => {
      const user = await requireUser(ctx, req)
      const input = TerminalSpaceCreateReq.parse(req.body)
      const [machine] = await ctx.db.select().from(machines).where(eq(machines.id, input.machineId))
      if (!machine || machine.revokedAt) return fail('not_found', '机器不存在或已吊销')
      if (machine.ownerId !== user.id) return fail('forbidden', '仅机器主人可以使用终端')
      if (!input.cwd.startsWith('/')) return fail('invalid', '请填写机器上的绝对路径')
      const [space] = await ctx.db
        .insert(terminalSpaces)
        .values({
          ownerId: user.id,
          machineId: machine.id,
          name: input.name,
          cwd: input.cwd,
          lastActiveAt: ctx.now(),
        })
        .returning()
      return reply
        .status(201)
        .send(dto({ space: space as Row['space'], machineName: machine.name, machineLabel: machine.label }))
    })

    app.patch<Params>('/api/terminal-spaces/:id', async (req): Promise<TerminalSpaceDto> => {
      const user = await requireUser(ctx, req)
      const { name } = TerminalSpaceUpdateReq.parse(req.body)
      const row = await mine(user.id, req.params.id)
      await ctx.db.update(terminalSpaces).set({ name }).where(eq(terminalSpaces.id, row.space.id))
      return dto({ ...row, space: { ...row.space, name } })
    })

    app.delete<Params>('/api/terminal-spaces/:id', async (req, reply) => {
      const user = await requireUser(ctx, req)
      const row = await mine(user.id, req.params.id)
      await terminals.closeSpace(user.id, row.space.id)
      await ctx.db.delete(terminalSpaces).where(eq(terminalSpaces.id, row.space.id))
      return reply.status(204).send()
    })

    /** The space's running shell, or a new one in its directory; opening it moves it up the conversation list. */
    app.post<Params>('/api/terminal-spaces/:id/session', async (req): Promise<TerminalDto> => {
      const user = await requireUser(ctx, req)
      const input = TerminalCreateReq.parse(req.body)
      const terminal = await terminals.openSpace(user.id, req.params.id, input)
      await ctx.db
        .update(terminalSpaces)
        .set({ lastActiveAt: ctx.now() })
        .where(eq(terminalSpaces.id, req.params.id))
      return terminal
    })
  }
}
