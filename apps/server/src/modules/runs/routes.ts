import {
  type RunDetailDto,
  RunDetailQuery,
  type RunEvent,
  type RunEventsDto,
  type RunSessionDto,
} from '@gonggong/protocol'
import { and, asc, desc, eq, gte, isNotNull, lt, lte, max, or, sql } from 'drizzle-orm'
import type { FastifyInstance, FastifyRequest } from 'fastify'
import { z } from 'zod'
import type { Ctx } from '../../context.js'
import { groupBots, groupMembers, messages, runEvents, runs } from '../../db/schema.js'
import { fail } from '../../lib/errors.js'
import { open } from '../../lib/seal.js'
import { sysParams } from '../admin/params.js'
import { requireUser } from '../auth/session.js'
import { authorName } from '../messages/service.js'
import { runDtoLoader } from './dto.js'
import { flushStream } from './engine.js'
import { openEvent } from './sealed.js'

/** Most rounds the session list returns; older ones are rarely worth scrolling back to. */
const SESSION_ROUNDS = 50

/** A long stream is stored as consecutive rows (see appendStream); clients get it back as one event. */
function joinStreams(events: RunDetailDto['events']) {
  const out: RunDetailDto['events'] = []
  for (const e of events) {
    const last = out.at(-1)
    const prev = last?.event
    if (
      last &&
      (e.event.kind === 'text' || e.event.kind === 'thought') &&
      prev?.kind === e.event.kind &&
      prev.agentId === e.event.agentId
    )
      last.event = { ...prev, delta: prev.delta + e.event.delta }
    else out.push(e)
  }
  return out
}

export function runRoutes(ctx: Ctx) {
  /** The requested run and the join that keeps it to groups the user is a member of. */
  const access = async (req: FastifyRequest) => {
    const user = await requireUser(ctx, req)
    const { id } = z.object({ id: z.uuid() }).parse(req.params)
    return { id, member: and(eq(groupMembers.groupId, runs.groupId), eq(groupMembers.userId, user.id)) }
  }
  const visibleRun = async (req: FastifyRequest) => {
    const { id, member } = await access(req)
    const [row] = await ctx.db
      .select({ run: runs })
      .from(runs)
      .innerJoin(groupMembers, member)
      .where(eq(runs.id, id))
    return row ?? fail('not_found', '运行不存在')
  }
  /** The process from event `since` on (see RunDetailQuery). */
  const eventsSince = async (runId: string, since?: number) => {
    await flushStream(runId)
    const events = await ctx.db
      .select()
      .from(runEvents)
      .where(and(eq(runEvents.runId, runId), since ? gte(runEvents.id, since) : undefined))
      .orderBy(asc(runEvents.id))
    return joinStreams(
      events.map((e) => ({
        id: e.id,
        at: e.createdAt.toISOString(),
        event: openEvent(e.payload as RunEvent),
      })),
    )
  }
  /** The trigger, then the appends the agent took in (a live run may still take all; later ones became runs). */
  const promptsOf = async (
    run: Pick<typeof runs.$inferSelect, 'id' | 'triggerMessageId' | 'endedAt' | 'appendsApplied'>,
  ) => {
    const rows = await ctx.db
      .select()
      .from(messages)
      .where(or(eq(messages.id, run.triggerMessageId), sql`${messages.meta}->>'appendTo' = ${run.id}`))
      .orderBy(asc(messages.seq))
    const trigger = rows.filter((m) => m.id === run.triggerMessageId)
    const appends = rows.filter((m) => m.id !== run.triggerMessageId)
    const kept = [...trigger, ...(run.endedAt ? appends.slice(0, run.appendsApplied) : appends)]
    return Promise.all(
      kept
        .filter((m) => !m.recalledAt)
        .map(async (m) => ({
          id: m.id,
          kind: m.id === run.triggerMessageId ? ('trigger' as const) : ('append' as const),
          author: await authorName(ctx, m),
          body: m.body,
          at: m.createdAt.toISOString(),
        })),
    )
  }
  return async (app: FastifyInstance) => {
    app.get('/api/runs/:id', async (req): Promise<RunDetailDto> => {
      const row = await visibleRun(req)
      const events = await eventsSince(row.run.id, RunDetailQuery.parse(req.query).since)
      const [gb] = await ctx.db
        .select({ sessionId: groupBots.sessionId })
        .from(groupBots)
        .where(and(eq(groupBots.groupId, row.run.groupId), eq(groupBots.botId, row.run.botId)))
      const toDto = await runDtoLoader(ctx, [row.run])
      return {
        run: toDto(row.run),
        patch: row.run.patch && open(row.run.patch),
        patchRepos: row.run.patchRepos,
        purged: row.run.purgedAt !== null,
        sessionId: gb?.sessionId ?? null,
        settings: row.run.settings,
        retentionDays: (await sysParams(ctx.db)).runRetentionDays,
        events,
        prompts: await promptsOf(row.run),
      }
    })

    // Refreshes of an open run: its card comes by realtime, so neither the card nor the (large) patch is read.
    app.get('/api/runs/:id/events', async (req): Promise<RunEventsDto> => {
      const { id, member } = await access(req)
      const [row] = await ctx.db
        .select({
          id: runs.id,
          purgedAt: runs.purgedAt,
          triggerMessageId: runs.triggerMessageId,
          endedAt: runs.endedAt,
          appendsApplied: runs.appendsApplied,
        })
        .from(runs)
        .innerJoin(groupMembers, member)
        .where(eq(runs.id, id))
      const run = row ?? fail('not_found', '运行不存在')
      return {
        events: await eventsSince(run.id, RunDetailQuery.parse(req.query).since),
        prompts: await promptsOf(run),
        purged: run.purgedAt !== null,
      }
    })

    // A session starts at the latest round that opened a new one (every fresh session reports its reason).
    app.get('/api/runs/:id/session', async (req): Promise<RunSessionDto> => {
      const { run } = await visibleRun(req)
      const until = run.startedAt ?? ctx.now()
      const same = and(eq(runs.groupId, run.groupId), eq(runs.botId, run.botId))
      const [first] = await ctx.db
        .select({ at: max(runs.startedAt) })
        .from(runs)
        .where(and(same, isNotNull(runs.newSessionReason), lte(runs.startedAt, until)))
      const rows = await ctx.db
        .select({ run: runs, prompt: messages.body })
        .from(runs)
        .innerJoin(messages, eq(messages.id, runs.triggerMessageId))
        .where(and(same, lt(runs.startedAt, until), first?.at ? gte(runs.startedAt, first.at) : undefined))
        .orderBy(desc(runs.startedAt))
        .limit(SESSION_ROUNDS)
      const toDto = await runDtoLoader(
        ctx,
        rows.map((r) => r.run),
      )
      return { rounds: rows.reverse().map((r) => ({ run: toDto(r.run), prompt: r.prompt })) }
    })
  }
}
