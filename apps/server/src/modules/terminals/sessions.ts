import { randomUUID } from 'node:crypto'
import {
  TERMINAL_FEATURE,
  TERMINAL_MAX_PER_USER,
  type TerminalCreateReq,
  type TerminalDto,
  type TerminalEndReason,
  type TerminalLive,
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
import type { TerminalAttachment, TerminalSessions } from './transport.js'

export type { TerminalAttachment, TerminalSessions as TerminalTransport } from './transport.js'

type Session = TerminalDto & {
  userId: string
  machineId: string
  cols: number
  rows: number
  attached: boolean
}

type Context = Pick<Ctx, 'hub' | 'now'> & { db: Db }
type Target = Awaited<ReturnType<TerminalService['target']>>

const dto = ({
  userId: _userId,
  machineId: _machineId,
  cols: _cols,
  rows: _rows,
  attached: _attached,
  ...session
}: Session): TerminalDto => session

/**
 * Sessions live in memory; the daemon owns the shells. A daemon going offline leaves them running, and its next
 * hello reconciles both ways: shells it no longer has end as daemon_restart, shells this server forgot are adopted.
 */
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

  private async target(userId: string, groupId: string, botId: string) {
    if (!isUuid(groupId) || !isUuid(botId)) return fail('not_found', 'Bot 不存在')
    const [row] = await this.ctx.db
      .select({ groupBot: groupBots, bot: bots, machine: machines, ownerDisabled: users.disabledAt })
      .from(groupBots)
      .innerJoin(bots, eq(bots.id, groupBots.botId))
      .innerJoin(machines, eq(machines.id, bots.machineId))
      .innerJoin(users, eq(users.id, machines.ownerId))
      .where(and(eq(groupBots.groupId, groupId), eq(groupBots.botId, botId)))
    if (!row || row.groupBot.removedAt || row.bot.deletedAt) return fail('not_found', 'Bot 不存在')
    if (row.machine.ownerId !== userId) return fail('forbidden', '仅机器主人可以使用终端')
    return { ...row, revoked: !!(row.machine.revokedAt || row.ownerDisabled) }
  }

  private requireUsable(target: Target) {
    if (target.revoked) return fail('forbidden', '仅机器主人可以使用终端')
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

  /** The owner's session, revoked first if its machine was revoked or its bot moved to another machine. */
  private async owned(userId: string, sessionId: string) {
    const session = this.session(sessionId)
    if (session.userId !== userId) return fail('forbidden', '仅机器主人可以使用终端')
    const target = await this.target(userId, session.groupId, session.botId)
    this.expire(session, target)
    this.requireUsable(target)
    return { session, target }
  }

  private expire(session: Session, target: Target) {
    if (target.revoked || session.machineId !== target.machine.id) this.revoke(session)
  }

  /** The shell's machine is no longer this bot's or no longer trusted: stop serving it without waiting on it. */
  private revoke(session: Session) {
    if (session.status !== 'running') return
    this.finish(session, 'closed', null, 'revoked')
    void this.transport.terminate(session).catch(() => {})
  }

  private finish(
    session: Session,
    status: z.infer<typeof TerminalStatus>,
    exitCode: number | null,
    reason: z.infer<typeof TerminalEndReason>,
  ) {
    session.status = status
    session.exitCode = exitCode
    session.reason = reason
    session.lastActiveAt = this.ctx.now().toISOString()
    void auditTerminal(this.ctx as Ctx, {
      actorUserId: null,
      machineId: session.machineId,
      groupId: session.groupId,
      botId: session.botId,
      sessionId: session.sessionId,
      action: reason === 'revoked' ? 'revoke' : 'exit',
      workspace: { repo: null, cdPath: null },
      status,
      reason,
    }).catch(() => {})
  }

  create(userId: string, groupId: string, botId: string, input: TerminalCreateReq) {
    return this.serial(async () => {
      const target = await this.target(userId, groupId, botId)
      this.requireUsable(target)
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
    this.requireUsable(target)
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
      const target = await this.target(userId, groupId, botId)
      const sessions = [...this.sessions.values()].filter(
        (session) => session.groupId === groupId && session.botId === botId,
      )
      for (const session of sessions) this.expire(session, target)
      return sessions.map(dto)
    })
  }

  /** Applies a daemon hello's running shells. */
  reconcile(machineId: string, live: TerminalLive[]) {
    return this.serial(async () => {
      const running = new Set(live.map((terminal) => terminal.sessionId))
      for (const session of this.sessions.values()) {
        // A session never attached has no shell yet; its first attach creates one.
        if (
          session.machineId === machineId &&
          session.attached &&
          session.status === 'running' &&
          !running.has(session.sessionId)
        )
          this.finish(session, 'daemon_restart', null, 'daemon_restart')
      }
      const unknown = live.filter((terminal) => !this.sessions.has(terminal.sessionId))
      if (!unknown.length) return
      const [machine] = await this.ctx.db
        .select({ ownerId: machines.ownerId })
        .from(machines)
        .where(eq(machines.id, machineId))
      if (!machine) return
      for (const terminal of unknown) {
        this.sessions.set(terminal.sessionId, {
          ...terminal,
          userId: machine.ownerId,
          machineId,
          status: 'running',
          lastActiveAt: this.ctx.now().toISOString(),
          exitCode: null,
          reason: null,
          attached: true,
        })
      }
    })
  }

  /** An ended session comes back without an attachment, so the socket can report how it ended. */
  async attach(userId: string, sessionId: string, after = 0) {
    const { session, target } = await this.owned(userId, sessionId)
    if (session.status !== 'running') return { terminal: dto(session) }
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
    const audit = (action: 'attach' | 'detach') =>
      auditTerminal(this.ctx as Ctx, {
        actorUserId: userId,
        machineId: session.machineId,
        groupId: session.groupId,
        botId: session.botId,
        sessionId,
        action,
        workspace: { repo: open.workspace.repo?.id ?? null, cdPath: open.workspace.cdPath },
        status: session.status,
        reason: session.reason,
      })
    const daemon = await this.transport.attach(open, session.machineId)
    session.attached = true
    await audit('attach')
    const attachment: TerminalAttachment = {
      send: (type, payload) => daemon.send(type, payload),
      subscribe: (onFrame, onDisconnect) => daemon.subscribe(onFrame, onDisconnect),
      close: (reason) => {
        daemon.close(reason)
        if (reason !== 'terminal ended') void audit('detach').catch(() => {})
      },
    }
    return { open, attachment, terminal: dto(session) }
  }

  async end(userId: string, sessionId: string) {
    const { session, target } = await this.owned(userId, sessionId)
    if (session.status !== 'running') return fail('conflict', '终端已结束')
    this.requireCapability(target.machine)
    await this.transport.terminate(session)
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

  /** Applies a daemon-reported end without accepting terminal contents. */
  update(
    sessionId: string,
    state: {
      status: z.infer<typeof TerminalStatus>
      exitCode: number | null
      reason: z.infer<typeof TerminalEndReason> | null
    },
  ) {
    const session = this.sessions.get(sessionId)
    if (session?.status !== 'running' || state.status === 'running') return
    this.finish(session, state.status, state.exitCode, state.reason ?? 'exited')
  }
}
