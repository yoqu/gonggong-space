import { randomUUID } from 'node:crypto'
import {
  TERMINAL_FEATURE,
  TERMINAL_MAX_PER_USER,
  type TerminalCreateReq,
  type TerminalDto,
  type TerminalEndReason,
  type TerminalOpen,
  type TerminalStatus,
} from '@gonggong/protocol'
import { and, eq } from 'drizzle-orm'
import type { z } from 'zod'
import type { Ctx } from '../../context.js'
import type { Db } from '../../db/client.js'
import { bots, groupBots, machines, users } from '../../db/schema.js'
import { fail } from '../../lib/errors.js'
import { isUuid } from '../../lib/ids.js'
import { currentRepo } from '../workspaces/provision.js'
import { auditTerminal } from './audit.js'
import type { TerminalDaemonStream, TerminalSessions } from './transport.js'

export type { TerminalAttachment, TerminalSessions as TerminalTransport } from './transport.js'

type Session = TerminalDto & {
  userId: string
  machineId: string
  cols: number
  rows: number
  attached: boolean
}

type Context = Pick<Ctx, 'hub' | 'now'> & { db: Db }

const dto = ({
  userId: _userId,
  machineId: _machineId,
  cols: _cols,
  rows: _rows,
  attached: _attached,
  ...session
}: Session): TerminalDto => session

export class TerminalService {
  private sessions = new Map<string, Session>()
  private queue: Promise<unknown> = Promise.resolve()

  constructor(
    private ctx: Context,
    private transport: TerminalSessions,
  ) {}

  private serial<T>(operation: () => Promise<T>): Promise<T> {
    const result = this.queue.then(operation, operation)
    this.queue = result.catch(() => {})
    return result
  }

  private async target(userId: string, groupId: string, botId: string, allowRevoked = false) {
    if (!isUuid(groupId) || !isUuid(botId)) return fail('not_found', 'Bot 不存在')
    const [target] = await this.ctx.db
      .select({ machine: machines, ownerDisabled: users.disabledAt })
      .from(machines)
      .innerJoin(users, eq(users.id, machines.ownerId))
      .innerJoin(bots, eq(bots.machineId, machines.id))
      .innerJoin(groupBots, and(eq(groupBots.botId, bots.id), eq(groupBots.groupId, groupId)))
      .where(eq(bots.id, botId))
    if (target && (target.machine.revokedAt || target.ownerDisabled)) {
      for (const session of this.sessions.values()) {
        if (session.machineId === target.machine.id) await this.revoke(session)
      }
      if (target.machine.ownerId !== userId || !allowRevoked)
        return fail('forbidden', '仅机器主人可以使用终端')
    }
    const [row] = await this.ctx.db
      .select({ groupBot: groupBots, bot: bots, machine: machines, ownerDisabled: users.disabledAt })
      .from(groupBots)
      .innerJoin(bots, eq(bots.id, groupBots.botId))
      .innerJoin(machines, eq(machines.id, bots.machineId))
      .innerJoin(users, eq(users.id, machines.ownerId))
      .where(and(eq(groupBots.groupId, groupId), eq(groupBots.botId, botId)))
    if (!row || row.groupBot.removedAt || row.bot.deletedAt) return fail('not_found', 'Bot 不存在')
    if (row.machine.ownerId !== userId || (!allowRevoked && (row.machine.revokedAt || row.ownerDisabled)))
      return fail('forbidden', '仅机器主人可以使用终端')
    return row
  }

  private requireCapability(machine: typeof machines.$inferSelect) {
    if (machine.os !== 'macos' && machine.os !== 'linux')
      return fail('conflict', '网页终端仅支持 macOS 和 Linux')
    if (!this.ctx.hub.features(machine.id).includes(TERMINAL_FEATURE))
      return fail('conflict', 'daemon 未连接或不支持网页终端')
  }

  private session(id: string) {
    const session = isUuid(id) ? this.sessions.get(id) : undefined
    return session ?? fail('not_found', '终端不存在')
  }

  private async revoke(session: Session) {
    if (session.status !== 'running') return
    await this.transport.terminate(session.sessionId, 'revoked')
    session.status = 'closed'
    session.reason = 'revoked'
  }

  create(userId: string, groupId: string, botId: string, input: TerminalCreateReq) {
    return this.serial(async () => {
      const target = await this.target(userId, groupId, botId)
      this.requireCapability(target.machine)
      const active = [...this.sessions.values()].filter(
        (session) => session.userId === userId && session.status === 'running',
      )
      if (active.length >= TERMINAL_MAX_PER_USER) return fail('conflict', '每个用户最多同时打开 4 个终端')
      const timestamp = this.ctx.now().toISOString()
      const session: Session = {
        sessionId: randomUUID(),
        groupId,
        botId,
        userId,
        machineId: target.machine.id,
        status: 'running',
        createdAt: timestamp,
        lastActiveAt: timestamp,
        exitCode: null,
        reason: null,
        cols: input.cols,
        rows: input.rows,
        attached: false,
      }
      this.sessions.set(session.sessionId, session)
      await auditTerminal(this.ctx as Ctx, {
        actorUserId: userId,
        machineId: session.machineId,
        groupId,
        botId,
        sessionId: session.sessionId,
        action: 'create',
        workspace: {
          repo: (await currentRepo(this.ctx as Ctx, groupId, botId))?.id ?? null,
          cdPath: target.groupBot.cdPath,
        },
        status: session.status,
        reason: session.reason,
      })
      return dto(session)
    })
  }

  async authorize(userId: string, groupId: string, botId: string) {
    const target = await this.target(userId, groupId, botId)
    return {
      userId,
      groupId,
      botId,
      machineId: target.machine.id,
      cdPath: target.groupBot.cdPath,
    }
  }

  list(userId: string, groupId: string, botId: string) {
    return this.serial(async () => {
      const sessions = [...this.sessions.values()].filter(
        (session) => session.groupId === groupId && session.botId === botId,
      )
      const target = await this.target(userId, groupId, botId, true)
      const oldMachineIds = new Set(sessions.map((session) => session.machineId))
      for (const machineId of oldMachineIds) {
        const [target] = await this.ctx.db
          .select({ machine: machines, ownerDisabled: users.disabledAt })
          .from(machines)
          .innerJoin(users, eq(users.id, machines.ownerId))
          .where(eq(machines.id, machineId))
        if (target?.machine.revokedAt || target?.ownerDisabled) {
          for (const session of sessions) await this.revoke(session)
        }
      }
      for (const session of sessions) if (session.machineId !== target.machine.id) await this.revoke(session)
      return sessions.map(dto)
    })
  }

  /** Main integration connects this once to the hub's offline event. */
  watchDisconnects() {
    const offline = (machineId: string) => void this.disconnect(machineId)
    this.ctx.hub.on('offline', offline)
    return () => this.ctx.hub.off('offline', offline)
  }

  async attach(userId: string, sessionId: string, after = 0) {
    const session = this.session(sessionId)
    if (session.userId !== userId) return fail('forbidden', '仅机器主人可以使用终端')
    const target = await this.target(userId, session.groupId, session.botId)
    if (session.machineId !== target.machine.id) {
      await this.revoke(session)
      return fail('conflict', '终端已结束，请新建会话')
    }
    if (session.status !== 'running') return fail('conflict', '终端已结束，请新建会话')
    this.requireCapability(target.machine)
    const open: TerminalOpen = {
      action: session.attached ? 'attach' : 'create',
      sessionId,
      groupId: session.groupId,
      botId: session.botId,
      workspace: {
        repo: await currentRepo(this.ctx as Ctx, session.groupId, session.botId),
        cdPath: target.groupBot.cdPath,
      },
      cols: session.cols,
      rows: session.rows,
      after,
    }
    const workspace = { repo: open.workspace.repo?.id ?? null, cdPath: open.workspace.cdPath }
    session.attached = true
    try {
      const attachment = await this.transport.attach(open)
      await auditTerminal(this.ctx as Ctx, {
        actorUserId: userId,
        machineId: session.machineId,
        groupId: session.groupId,
        botId: session.botId,
        sessionId,
        action: 'attach',
        workspace,
        status: session.status,
        reason: session.reason,
      })
      const relayAttachment: TerminalDaemonStream = {
        send: (type, payload) => attachment.send(type, payload),
        subscribe: (onFrame, onDisconnect) => attachment.subscribe(onFrame, onDisconnect),
        pause: () => attachment.pause(),
        resume: () => attachment.resume(),
        close: (reason) => attachment.close(reason),
        detach: (reason = 'browser detached') => {
          attachment.detach(reason)
          if (reason !== 'terminal ended') {
            void auditTerminal(this.ctx as Ctx, {
              actorUserId: userId,
              machineId: session.machineId,
              groupId: session.groupId,
              botId: session.botId,
              sessionId,
              action: 'detach',
              workspace,
              status: session.status,
              reason: session.reason,
            }).catch(() => {})
          }
        },
      }
      return {
        open,
        attachment: relayAttachment,
        terminal: dto(session),
      }
    } catch (error) {
      session.attached = false
      throw error
    }
  }

  async end(userId: string, sessionId: string) {
    const session = this.session(sessionId)
    if (session.userId !== userId) return fail('forbidden', '仅机器主人可以使用终端')
    const target = await this.target(userId, session.groupId, session.botId)
    if (session.machineId !== target.machine.id) {
      await this.revoke(session)
      return fail('conflict', '终端已结束')
    }
    if (session.status !== 'running') return fail('conflict', '终端已结束')
    await this.transport.terminate(sessionId, 'user')
    session.status = 'closed'
    session.reason = 'user'
    await auditTerminal(this.ctx as Ctx, {
      actorUserId: userId,
      machineId: session.machineId,
      groupId: session.groupId,
      botId: session.botId,
      sessionId,
      action: 'terminate',
      workspace: { repo: null, cdPath: null },
      status: session.status,
      reason: session.reason,
    })
    return dto(session)
  }

  owner(userId: string, sessionId: string) {
    return this.serial(async () => {
      const session = this.session(sessionId)
      if (session.userId !== userId) return fail('forbidden', '仅机器主人可以使用终端')
      await this.target(userId, session.groupId, session.botId)
      return { userId: session.userId, machineId: session.machineId, terminal: dto(session) }
    })
  }

  disconnect(machineId: string) {
    return this.serial(async () => {
      for (const session of this.sessions.values()) {
        if (session.machineId === machineId && session.status === 'running') {
          session.status = 'daemon_restart'
          session.reason = 'daemon_restart'
        }
      }
    })
  }

  /** Applies a daemon-reported lifecycle without accepting terminal contents. */
  update(
    sessionId: string,
    status: z.infer<typeof TerminalStatus>,
    exitCode: number | null,
    reason: z.infer<typeof TerminalEndReason> | null,
  ) {
    const session = this.session(sessionId)
    session.status = status
    session.exitCode = exitCode
    session.reason = reason
    session.lastActiveAt = this.ctx.now().toISOString()
    if (status !== 'running') {
      const session = this.sessions.get(sessionId)
      if (session)
        void auditTerminal(this.ctx as Ctx, {
          actorUserId: null,
          machineId: session.machineId,
          groupId: session.groupId,
          botId: session.botId,
          sessionId,
          action: status === 'closed' && reason === 'revoked' ? 'revoke' : 'exit',
          workspace: { repo: null, cdPath: null },
          status,
          reason,
        }).catch(() => {})
    }
    return dto(session)
  }
}
