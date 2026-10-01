import type { Writable } from 'node:stream'
import { hash } from '@node-rs/argon2'
import type { FastifyInstance } from 'fastify'
import WebSocket from 'ws'
import { buildApp } from '../../src/app.js'
import type { Ctx } from '../../src/context.js'
import { DaemonHub } from '../../src/daemon/hub.js'
import { bots, groupBots, groupMembers, groups, machines, teamMembers, users } from '../../src/db/schema.js'
import { newToken, sha256 } from '../../src/lib/crypto.js'
import { createSession, SESSION_COOKIE } from '../../src/modules/auth/session.js'
import type { LiveKit } from '../../src/modules/live/livekit.js'
import { TunnelHub } from '../../src/modules/previews/tunnel.js'
import { createTeam } from '../../src/modules/teams/service.js'
import { Bus } from '../../src/realtime/bus.js'
import { createTestDb } from './db.js'
import { FakeFeishu } from './feishu.js'

export type TestApp = Awaited<ReturnType<typeof createTestApp>>

/** Signs tokens; nothing listens (tests that need a server pass a HostedLiveKit). */
const unreachableLiveKit: LiveKit = {
  endpoint: async () => ({
    url: null,
    api: 'http://127.0.0.1:9',
    key: 'test',
    secret: 'test-secret-'.repeat(3),
  }),
  signalPort: null,
  close: async () => {},
}

/** Real app on an ephemeral port + fresh DB + direct-to-DB seed helpers. */
export async function createTestApp(
  opts: { heartbeatSec?: number; now?: () => Date; livekit?: LiveKit; logStream?: Writable } = {},
) {
  const t = await createTestDb()
  const feishu = new FakeFeishu()
  const ctx: Ctx = {
    db: t.db,
    bus: new Bus(),
    hub: new DaemonHub(),
    tunnels: new TunnelHub(),
    livekit: opts.livekit ?? unreachableLiveKit,
    feishu: { api: feishu.api, connector: feishu.connector },
    now: opts.now ?? (() => new Date()),
    config: {
      heartbeatSec: opts.heartbeatSec ?? 15,
      secureCookies: false,
      fingerprint: null,
      preview: { domain: null, ports: [0, 0], publicUrl: null },
    },
  }
  const app: FastifyInstance = await buildApp(ctx, { logStream: opts.logStream })
  await app.listen({ port: 0, host: '127.0.0.1' })
  const port = (app.server.address() as { port: number }).port
  let n = 0
  /** Owned by the first seeded user; seeded users, groups and bots join it unless told otherwise. */
  let defaultTeam: Promise<string> | undefined
  const teamOf = (teamId: string | undefined) =>
    teamId ?? defaultTeam ?? Promise.reject(new Error('seed a user first'))

  const seed = {
    async team(o: { ownerId: string; name?: string; memberIds?: string[] }) {
      const team = await createTeam(t.db, o.name ?? `团队${++n}`, o.ownerId)
      if (o.memberIds?.length)
        await t.db.insert(teamMembers).values(o.memberIds.map((userId) => ({ teamId: team.id, userId })))
      return team
    },
    /** `teamId: null` leaves the account out of every team. */
    async user(o: Partial<typeof users.$inferInsert> & { password?: string; teamId?: string | null } = {}) {
      n += 1
      const [u] = await t.db
        .insert(users)
        .values({
          account: o.account ?? `u${n}`,
          name: o.name ?? `用户${n}`,
          role: o.role ?? 'member',
          mustChangePassword: o.mustChangePassword ?? false,
          passwordHash: await hash(o.password ?? 'password123'),
          disabledAt: o.disabledAt ?? null,
        })
        .returning()
      if (o.teamId === null) return u!
      if (o.teamId === undefined && !defaultTeam) {
        defaultTeam = seed.team({ ownerId: u!.id, name: '默认团队' }).then((team) => team.id)
        await defaultTeam
      } else await t.db.insert(teamMembers).values({ teamId: await teamOf(o.teamId), userId: u!.id })
      return u!
    },
    /** Cookie header value for an authenticated browser session. */
    async cookie(userId: string) {
      const { token } = await createSession(ctx, userId)
      return `${SESSION_COOKIE}=${token}`
    },
    async machine(ownerId: string, o: Partial<typeof machines.$inferInsert> = {}) {
      const token = newToken('mt')
      const [m] = await t.db
        .insert(machines)
        .values({
          ownerId,
          name: o.name ?? `mac-${++n}`,
          os: o.os ?? 'macos',
          arch: 'aarch64',
          tokenHash: sha256(token),
          ...o,
        })
        .returning()
      return { machine: m!, token }
    },
    async bot(o: Partial<typeof bots.$inferInsert> & { ownerId: string; teamId?: string }) {
      const [b] = await t.db
        .insert(bots)
        .values({
          name: o.name ?? `bot${++n}`,
          agentKind: o.agentKind ?? 'claude',
          binding: o.binding ?? (o.machineId ? 'bound' : 'pending_bind'),
          createdBy: o.createdBy ?? o.ownerId,
          ...o,
          teamId: await teamOf(o.teamId),
        })
        .returning()
      return b!
    },
    async group(o: {
      createdBy: string
      teamId?: string
      kind?: 'group' | 'dm'
      name?: string
      memberIds?: string[]
      botIds?: string[]
    }) {
      const [g] = await t.db
        .insert(groups)
        .values({
          name: o.name ?? `群${++n}`,
          kind: o.kind ?? 'group',
          createdBy: o.createdBy,
          teamId: await teamOf(o.teamId),
        })
        .returning()
      const memberIds = new Set([o.createdBy, ...(o.memberIds ?? [])])
      await t.db
        .insert(groupMembers)
        .values([...memberIds].map((userId) => ({ groupId: g!.id, userId, isAdmin: userId === o.createdBy })))
      if (o.botIds?.length)
        await t.db.insert(groupBots).values(o.botIds.map((botId) => ({ groupId: g!.id, botId })))
      return g!
    },
  }

  return {
    app,
    ctx,
    db: t.db,
    seed,
    feishu,
    url: (path: string) => `http://127.0.0.1:${port}${path}`,
    ws: (path: string, headers: Record<string, string> = {}) =>
      new WebSocket(`ws://127.0.0.1:${port}${path}`, { headers }),
    close: async () => {
      await app.close()
      await t.close()
    },
  }
}

/** Collects JSON messages from a socket; `next()` resolves with the next one. */
export function inbox(ws: WebSocket) {
  const queue: unknown[] = []
  const waiters: ((m: unknown) => void)[] = []
  ws.on('message', (d) => {
    const m = JSON.parse(String(d))
    const w = waiters.shift()
    if (w) w(m)
    else queue.push(m)
  })
  return {
    next: <T = Record<string, unknown>>() =>
      new Promise<T>((r) => (queue.length ? r(queue.shift() as T) : waiters.push(r as (m: unknown) => void))),
    closed: new Promise<number>((r) => ws.on('close', (code) => r(code))),
    opened: new Promise<void>((r) => ws.on('open', () => r())),
  }
}
