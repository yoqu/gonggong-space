import {
  type ConversationDayDto,
  type ConversationMetricsDto,
  type ConversationOpsDto,
  type ConversationOverviewDto,
  ConversationStatsQuery,
  type ConversationStatsRowDto,
  ConversationStatsRowsQuery,
  type RunStatus,
  TERMINAL_RUN_STATUS,
} from '@gonggong/protocol'
import {
  and,
  asc,
  desc,
  eq,
  exists,
  gte,
  inArray,
  isNotNull,
  isNull,
  lt,
  ne,
  or,
  type SQL,
  sql,
} from 'drizzle-orm'
import type { FastifyInstance, FastifyRequest } from 'fastify'
import type { Ctx } from '../../context.js'
import {
  bots,
  groupMembers,
  groups,
  machines,
  messages,
  runs,
  teamMembers,
  teams,
  users,
} from '../../db/schema.js'
import { idParam } from '../../lib/ids.js'
import { requireSysadmin, requireUser } from '../auth/session.js'
import { requireTeam } from '../teams/service.js'

const DAY_MS = 86_400_000
const count = sql<number>`count(*)`.mapWith(Number)
const chat = inArray(messages.kind, ['user', 'bot'])
const msg = {
  userMessages: sql<number>`count(*) filter (where ${messages.kind} = 'user')`.mapWith(Number),
  botMessages: sql<number>`count(*) filter (where ${messages.kind} = 'bot')`.mapWith(Number),
  activeUsers: sql<number>`count(distinct ${messages.authorUserId})`.mapWith(Number),
  conversations: sql<number>`count(distinct ${messages.groupId})`.mapWith(Number),
}
const run = {
  runs: count,
  endedRuns: sql<number>`count(*) filter (where ${inArray(runs.status, [...TERMINAL_RUN_STATUS])})`.mapWith(
    Number,
  ),
  completedRuns: sql<number>`count(*) filter (where ${runs.status} = 'completed')`.mapWith(Number),
}
const avgRunMs = sql<number | null>`round(avg(extract(epoch from ${runs.endedAt} - ${runs.startedAt}) * 1000)
  filter (where ${runs.status} = 'completed'))`.mapWith(Number)

/** Where each breakdown finds its key in messages and in runs. */
const DIMENSIONS = {
  conversation: { msg: messages.groupId, run: runs.groupId },
  user: { msg: messages.authorUserId, run: runs.originUserId },
  bot: { msg: messages.authorBotId, run: runs.botId },
  team: { msg: groups.teamId, run: groups.teamId },
} as const

/** 管理后台 · 会话统计: every team, or the one picked. */
async function platformScope(ctx: Ctx, req: FastifyRequest, teamId?: string) {
  await requireSysadmin(ctx, req)
  return teamId ? idParam(teamId, '团队不存在') : undefined
}

/** 团队设置 · 会话统计: the team's admins. */
async function teamScope(ctx: Ctx, req: FastifyRequest) {
  const me = await requireUser(ctx, req)
  const { id } = req.params as { id: string }
  return (await requireTeam(ctx, me.id, id, 'admin')).team.id
}

const inTeam = (teamId: string | undefined) => (teamId ? eq(groups.teamId, teamId) : undefined)
const FAILED: RunStatus[] = ['interrupted', 'expired', 'forbidden']
const median = (xs: number[]) => {
  if (!xs.length) return null
  const s = [...xs].sort((a, b) => a - b)
  const mid = s.length >> 1
  return s.length % 2 ? s[mid]! : (s[mid - 1]! + s[mid]!) / 2
}

const dayIn = (at: Date, timeZone: string) =>
  new Intl.DateTimeFormat('en-CA', { timeZone, year: 'numeric', month: '2-digit', day: '2-digit' }).format(at)
const minusDays = (day: string, n: number) =>
  new Date(Date.parse(`${day}T00:00:00Z`) - n * DAY_MS).toISOString().slice(0, 10)
const latest = (...xs: (Date | null | undefined)[]) =>
  xs.reduce<Date | null>((a, b) => (b && (!a || b > a) ? b : a), null)?.toISOString() ?? null

/** Message, run and conversation counts per window, day and breakdown; counts only, never content. */
export function conversationStatsRoutes(ctx: Ctx) {
  return async (app: FastifyInstance) => {
    stats(app, '/api/admin/conversation-stats', (req, teamId) => platformScope(ctx, req, teamId))
    stats(app, '/api/teams/:id/conversation-stats', (req) => teamScope(ctx, req))
  }

  function stats(
    app: FastifyInstance,
    base: string,
    scoped: (req: FastifyRequest, teamId?: string) => Promise<string | undefined>,
  ) {
    app.get(`${base}/overview`, async (req): Promise<ConversationOverviewDto> => {
      const q = ConversationStatsQuery.parse(req.query)
      const scope = inTeam(await scoped(req, q.teamId))
      const now = ctx.now().getTime()
      const from = new Date(now - q.days * DAY_MS)
      const [kinds, statuses, current, previous, days] = await Promise.all([
        ctx.db
          .select({ kind: groups.kind, n: count })
          .from(groups)
          .where(and(isNull(groups.archivedAt), scope))
          .groupBy(groups.kind),
        ctx.db
          .select({ status: sql<RunStatus>`${runs.status}`, count })
          .from(runs)
          .innerJoin(groups, eq(groups.id, runs.groupId))
          .where(and(gte(runs.queuedAt, from), scope))
          .groupBy(runs.status)
          .orderBy(desc(count), asc(runs.status)),
        metrics(scope, from, new Date(now)),
        metrics(scope, new Date(now - 2 * q.days * DAY_MS), from),
        daily(scope, q.days, q.tz),
      ])
      return {
        groups: kinds.find((k) => k.kind === 'group')?.n ?? 0,
        dms: kinds.find((k) => k.kind === 'dm')?.n ?? 0,
        current,
        previous,
        daily: days,
        statuses,
      }
    })

    app.get(base, async (req): Promise<ConversationStatsRowDto[]> => {
      const q = ConversationStatsRowsQuery.parse(req.query)
      return rows(inTeam(await scoped(req, q.teamId)), q.by, new Date(ctx.now().getTime() - q.days * DAY_MS))
    })

    app.get(`${base}/ops`, async (req): Promise<ConversationOpsDto> => {
      const q = ConversationStatsQuery.parse(req.query)
      const teamId = await scoped(req, q.teamId)
      const now = ctx.now().getTime()
      const from = new Date(now - q.days * DAY_MS)
      const [retention, activation, failures, audience] = await Promise.all([
        retained(inTeam(teamId), new Date(now - 2 * q.days * DAY_MS), from),
        activated(teamId, from),
        failed(inTeam(teamId), from),
        byAudience(inTeam(teamId), from),
      ])
      return { retention, activation, failures, audience }
    })
  }

  async function retained(scope: SQL | undefined, prevFrom: Date, from: Date) {
    const posters = (since: Date, until?: Date) =>
      ctx.db
        .selectDistinct({ id: messages.authorUserId })
        .from(messages)
        .innerJoin(groups, eq(groups.id, messages.groupId))
        .where(
          and(
            eq(messages.kind, 'user'),
            isNotNull(messages.authorUserId),
            gte(messages.createdAt, since),
            until && lt(messages.createdAt, until),
            scope,
          ),
        )
    const [before, now] = await Promise.all([posters(prevFrom, from), posters(from)])
    const current = new Set(now.map((r) => r.id))
    return { previous: before.length, retained: before.filter((r) => current.has(r.id)).length }
  }

  /** Memberships begun since `from`, each with its first run in that team since joining. */
  async function activated(teamId: string | undefined, from: Date) {
    const joiners = await ctx.db
      .select({
        joinedAt: teamMembers.joinedAt,
        first:
          sql<Date | null>`min(${runs.queuedAt}) filter (where ${groups.teamId} = ${teamMembers.teamId})`.mapWith(
            runs.queuedAt,
          ),
      })
      .from(teamMembers)
      .leftJoin(
        runs,
        and(eq(runs.originUserId, teamMembers.userId), gte(runs.queuedAt, teamMembers.joinedAt)),
      )
      .leftJoin(groups, eq(groups.id, runs.groupId))
      .where(and(gte(teamMembers.joinedAt, from), teamId ? eq(teamMembers.teamId, teamId) : undefined))
      .groupBy(teamMembers.teamId, teamMembers.userId, teamMembers.joinedAt)
    const hours = joiners.flatMap((j) =>
      j.first ? [(j.first.getTime() - j.joinedAt.getTime()) / 3_600_000] : [],
    )
    const mid = median(hours)
    return {
      joined: joiners.length,
      activated: hours.length,
      medianHours: mid === null ? null : Math.round(mid * 10) / 10,
    }
  }

  async function failed(scope: SQL | undefined, from: Date) {
    const failure = and(inArray(runs.status, FAILED), isNull(runs.stoppedBy))
    const ended = and(gte(runs.endedAt, from), scope)
    const [[totals], reasons] = await Promise.all([
      ctx.db
        .select({
          endedRuns: count,
          failedRuns: sql<number>`count(*) filter (where ${failure})`.mapWith(Number),
        })
        .from(runs)
        .innerJoin(groups, eq(groups.id, runs.groupId))
        .where(and(inArray(runs.status, [...TERMINAL_RUN_STATUS]), ended)),
      ctx.db
        .select({ status: sql<RunStatus>`${runs.status}`, step: runs.step, count })
        .from(runs)
        .innerJoin(groups, eq(groups.id, runs.groupId))
        .where(and(failure, ended))
        .groupBy(runs.status, runs.step)
        .orderBy(desc(count), asc(runs.status), asc(runs.step))
        .limit(10),
    ])
    return { ...totals!, reasons }
  }

  /** Runs queued since `from` by builders vs 使用者; see ConversationOpsDto.audience for who builds. */
  async function byAudience(scope: SQL | undefined, from: Date) {
    const origins = await ctx.db
      .select({ id: runs.originUserId, n: count })
      .from(runs)
      .innerJoin(groups, eq(groups.id, runs.groupId))
      .where(and(gte(runs.queuedAt, from), scope))
      .groupBy(runs.originUserId)
    const out = { userRuns: 0, builderRuns: 0, users: 0, builders: 0 }
    if (!origins.length) return out
    const builders = new Set((await buildersAmong(origins.map((o) => o.id))).map((u) => u.id))
    for (const o of origins) {
      if (builders.has(o.id)) {
        out.builderRuns += o.n
        out.builders += 1
      } else {
        out.userRuns += o.n
        out.users += 1
      }
    }
    return out
  }

  /**
   * Server-side useIsBuilder without the browser opt-in. DMs don't count: their opener is their admin, Feishu DMs
   * included, which would make every 使用者 a builder.
   */
  function buildersAmong(ids: string[]) {
    return ctx.db
      .select({ id: users.id })
      .from(users)
      .where(
        and(
          inArray(users.id, ids),
          or(
            eq(users.role, 'sysadmin'),
            exists(
              ctx.db
                .select({ x: sql`1` })
                .from(teamMembers)
                .where(and(eq(teamMembers.userId, users.id), ne(teamMembers.role, 'member'))),
            ),
            exists(
              ctx.db
                .select({ x: sql`1` })
                .from(machines)
                .where(and(eq(machines.ownerId, users.id), isNull(machines.revokedAt))),
            ),
            exists(
              ctx.db
                .select({ x: sql`1` })
                .from(bots)
                .where(and(eq(bots.ownerId, users.id), isNull(bots.deletedAt))),
            ),
            exists(
              ctx.db
                .select({ x: sql`1` })
                .from(groupMembers)
                .innerJoin(groups, eq(groups.id, groupMembers.groupId))
                .where(
                  and(
                    eq(groupMembers.userId, users.id),
                    eq(groupMembers.isAdmin, true),
                    eq(groups.kind, 'group'),
                    isNull(groups.archivedAt),
                  ),
                ),
            ),
          ),
        ),
      )
  }

  async function metrics(scope: SQL | undefined, from: Date, to: Date): Promise<ConversationMetricsDto> {
    const [[m], [r], [c]] = await Promise.all([
      ctx.db
        .select(msg)
        .from(messages)
        .innerJoin(groups, eq(groups.id, messages.groupId))
        .where(and(chat, gte(messages.createdAt, from), lt(messages.createdAt, to), scope)),
      ctx.db
        .select({ ...run, avgRunMs })
        .from(runs)
        .innerJoin(groups, eq(groups.id, runs.groupId))
        .where(and(gte(runs.queuedAt, from), lt(runs.queuedAt, to), scope)),
      ctx.db
        .select({ n: count })
        .from(groups)
        .where(and(gte(groups.createdAt, from), lt(groups.createdAt, to), scope)),
    ])
    const { conversations, ...rest } = m!
    return { activeConversations: conversations, newConversations: c!.n, ...rest, ...r! }
  }

  async function daily(scope: SQL | undefined, n: number, tz: string): Promise<ConversationDayDto[]> {
    const now = ctx.now()
    const days = Array.from({ length: n }, (_, i) => minusDays(dayIn(now, tz), n - 1 - i))
    // A day spans at most 26h across zones/DST; the exact cut happens on `day` below.
    const since = new Date(now.getTime() - (n + 1) * DAY_MS)
    const dayOf = (at: typeof messages.createdAt | typeof runs.queuedAt) =>
      sql<string>`to_char(${at} at time zone ${tz}, 'YYYY-MM-DD')`
    // Positional GROUP BY: the tz parameter makes the expression differ textually between SELECT and GROUP BY.
    const msgRows = await ctx.db
      .select({ day: dayOf(messages.createdAt), ...msg })
      .from(messages)
      .innerJoin(groups, eq(groups.id, messages.groupId))
      .where(and(chat, gte(messages.createdAt, since), scope))
      .groupBy(sql`1`)
    const runRows = await ctx.db
      .select({ day: dayOf(runs.queuedAt), runs: count })
      .from(runs)
      .innerJoin(groups, eq(groups.id, runs.groupId))
      .where(and(gte(runs.queuedAt, since), scope))
      .groupBy(sql`1`)
    const byDay = new Map(msgRows.map((r) => [r.day, r]))
    const runsByDay = new Map(runRows.map((r) => [r.day, r.runs]))
    return days.map((day) => {
      const m = byDay.get(day)
      return {
        day,
        activeConversations: m?.conversations ?? 0,
        userMessages: m?.userMessages ?? 0,
        botMessages: m?.botMessages ?? 0,
        activeUsers: m?.activeUsers ?? 0,
        runs: runsByDay.get(day) ?? 0,
      }
    })
  }

  async function rows(
    scope: SQL | undefined,
    by: keyof typeof DIMENSIONS,
    from: Date,
  ): Promise<ConversationStatsRowDto[]> {
    const dim = DIMENSIONS[by]
    const msgRows = await ctx.db
      .select({
        key: dim.msg,
        ...msg,
        last: sql<Date>`max(${messages.createdAt})`.mapWith(messages.createdAt),
      })
      .from(messages)
      .innerJoin(groups, eq(groups.id, messages.groupId))
      .where(and(chat, gte(messages.createdAt, from), isNotNull(dim.msg), scope))
      .groupBy(dim.msg)
    const runRows = await ctx.db
      .select({
        key: dim.run,
        ...run,
        users: sql<number>`count(distinct ${runs.originUserId})`.mapWith(Number),
        last: sql<Date>`max(${runs.queuedAt})`.mapWith(runs.queuedAt),
      })
      .from(runs)
      .innerJoin(groups, eq(groups.id, runs.groupId))
      .where(and(gte(runs.queuedAt, from), scope))
      .groupBy(dim.run)
    const keys = [...new Set([...msgRows, ...runRows].map((r) => r.key as string))]
    if (!keys.length) return []
    const names = new Map((await entities(by, keys)).map((e) => [e.key, e]))
    const msgBy = new Map(msgRows.map((r) => [r.key, r]))
    const runBy = new Map(runRows.map((r) => [r.key, r]))
    return keys
      .flatMap((key) => {
        const e = names.get(key)
        if (!e) return []
        const m = msgBy.get(key)
        const r = runBy.get(key)
        return [
          {
            ...e,
            conversations: m?.conversations ?? 0,
            userMessages: m?.userMessages ?? 0,
            botMessages: m?.botMessages ?? 0,
            activeUsers: (by === 'bot' ? r?.users : m?.activeUsers) ?? 0,
            runs: r?.runs ?? 0,
            endedRuns: r?.endedRuns ?? 0,
            completedRuns: r?.completedRuns ?? 0,
            lastActiveAt: latest(m?.last, r?.last),
          },
        ]
      })
      .sort(
        (a, b) =>
          b.userMessages + b.botMessages - (a.userMessages + a.botMessages) ||
          b.runs - a.runs ||
          a.name.localeCompare(b.name),
      )
  }

  /** Display fields of the rows' subjects. */
  function entities(by: keyof typeof DIMENSIONS, keys: string[]) {
    const none = { kind: sql<null>`null`, teamName: sql<null>`null`, ownerName: sql<null>`null` }
    switch (by) {
      case 'conversation':
        return ctx.db
          .select({
            key: groups.id,
            name: groups.name,
            kind: sql<'group' | 'dm'>`${groups.kind}`,
            teamName: teams.name,
            ownerName: users.name,
          })
          .from(groups)
          .innerJoin(teams, eq(teams.id, groups.teamId))
          .innerJoin(users, eq(users.id, groups.createdBy))
          .where(inArray(groups.id, keys))
      case 'user':
        return ctx.db
          .select({ key: users.id, name: users.name, ...none })
          .from(users)
          .where(inArray(users.id, keys))
      case 'bot':
        return ctx.db
          .select({
            key: bots.id,
            name: bots.name,
            kind: none.kind,
            teamName: teams.name,
            ownerName: users.name,
          })
          .from(bots)
          .innerJoin(teams, eq(teams.id, bots.teamId))
          .innerJoin(users, eq(users.id, bots.ownerId))
          .where(inArray(bots.id, keys))
      case 'team':
        return ctx.db
          .select({ key: teams.id, name: teams.name, ...none })
          .from(teams)
          .where(inArray(teams.id, keys))
    }
  }
}
