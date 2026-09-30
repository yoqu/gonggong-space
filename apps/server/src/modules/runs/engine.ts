import { isDeepStrictEqual } from 'node:util'
import type { RunDone, RunEvent } from '@gonggong/protocol'
import { and, desc, eq, inArray, isNull, sql } from 'drizzle-orm'
import type { Ctx } from '../../context.js'
import type { DaemonHub } from '../../daemon/hub.js'
import { bots, groupBots, runEvents, runs } from '../../db/schema.js'
import { open, seal } from '../../lib/seal.js'
import { onApprovalRequest, voidApprovals } from '../approvals/service.js'
import { publishBot } from '../bots/dto.js'
import { requeueAppends } from '../messages/append.js'
import { memberIds, postMessage } from '../messages/service.js'
import { onQuestionAsk, onQuestionWithdraw, voidQuestions } from '../questions/service.js'
import { updateBotState } from '../workspaces/state.js'
import { publishRun } from './dto.js'
import { redact, redactDeep } from './redact.js'
import { schedule } from './scheduler.js'
import { sealEvent } from './sealed.js'
import { notifyChainDone, stoppedDone } from './stop.js'
import { triggerChain } from './trigger.js'

const LIVE = ['running', 'awaiting_approval', 'awaiting_answer']

type DaemonMsg = Parameters<Parameters<DaemonHub['on']>[1]>[1]

/**
 * Wires daemon run reports into persistence + realtime, and reschedules when machines come online.
 * Each machine's messages are applied strictly in arrival order; a slow machine never holds up the others.
 * Returns a function that detaches and drains.
 */
export function startRunEngine(ctx: Ctx) {
  const chains = new Map<string, Promise<void>>()
  const enqueue = (machineId: string, job: () => Promise<void>) => {
    const next = (chains.get(machineId) ?? Promise.resolve())
      .then(job)
      .catch((err) => console.error('run engine:', err))
      .finally(() => chains.get(machineId) === next && chains.delete(machineId))
    chains.set(machineId, next)
  }
  const onMessage = (machineId: string, msg: DaemonMsg) => {
    const run = (job: () => Promise<void>) => enqueue(machineId, job)
    if (msg.t === 'run.event') run(() => onEvent(ctx, machineId, msg.runId, msg.event))
    else if (msg.t === 'run.done') run(() => onDone(ctx, machineId, msg))
    else if (msg.t === 'approval.request') run(() => onApprovalRequest(ctx, machineId, msg))
    else if (msg.t === 'question.ask') run(() => onQuestionAsk(ctx, machineId, msg))
    else if (msg.t === 'question.withdraw') run(() => onQuestionWithdraw(ctx, machineId, msg))
    else if (msg.t === 'session.config') run(() => onSessionConfig(ctx, machineId, msg))
  }
  const onOnline = (machineId: string) =>
    enqueue(machineId, async () => {
      const owned = await ctx.db
        .select({ id: bots.id })
        .from(bots)
        .where(and(eq(bots.machineId, machineId), isNull(bots.deletedAt)))
      for (const bot of owned) await schedule(ctx, bot.id)
    })
  ctx.hub.on('message', onMessage)
  ctx.hub.on('online', onOnline)
  return async () => {
    ctx.hub.off('message', onMessage)
    ctx.hub.off('online', onOnline)
    await Promise.all(chains.values())
  }
}

/**
 * A live run owned by a bot on this machine; reports from anyone else are dropped. The share lock waits for an
 * in-flight dispatch transaction, so a report racing the scheduler's commit sees the run as running.
 * `ended` also accepts finished runs: background tasks outlive the turn that started them.
 */
async function liveRun(ctx: Ctx, machineId: string, runId: string, ended = false) {
  const [row] = await ctx.db
    .select({ run: runs })
    .from(runs)
    .innerJoin(bots, eq(bots.id, runs.botId))
    .where(
      and(eq(runs.id, runId), eq(bots.machineId, machineId), ended ? undefined : inArray(runs.status, LIVE)),
    )
    .for('share', { of: runs })
  return row?.run
}

async function onEvent(ctx: Ctx, machineId: string, runId: string, raw: RunEvent) {
  const run = await liveRun(ctx, machineId, runId, raw.kind === 'task')
  if (!run) return
  if (raw.kind === 'text' || raw.kind === 'thought') {
    await appendStream(ctx, runId, raw)
    if (raw.kind === 'text' && !raw.agentId)
      ctx.bus.publish(await memberIds(ctx, run.groupId), { t: 'run.delta', runId, text: redact(raw.delta) })
    return
  }
  segments.delete(runId)
  const event = redactDeep(raw)
  await ctx.db.insert(runEvents).values({ runId, kind: event.kind, payload: sealEvent(event) })
  const patch =
    event.kind === 'status' || event.kind === 'tool'
      ? { step: event.kind === 'tool' ? event.title : event.step }
      : event.kind === 'usage'
        ? { usage: event.usage }
        : null
  let card = false
  // Updates of one tool call repeat its title: only a changed card is rebuilt and pushed.
  if (patch && Object.entries(patch).some(([k, v]) => !isDeepStrictEqual(run[k as keyof typeof run], v)))
    for (const row of await ctx.db.update(runs).set(patch).where(eq(runs.id, runId)).returning()) {
      await publishRun(ctx, row)
      card = true
    }
  if (event.kind === 'subagent' || event.kind === 'task') {
    const [field, id] = event.kind === 'subagent' ? ['subagents', event.agentId] : ['tasks', event.taskId]
    const delegation = sql`jsonb_set(${runs.delegation}, ${`{${field}}`}::text[], coalesce(${runs.delegation} -> ${field}, '{}') || jsonb_build_object(${id}::text, ${event.state}::text))`
    for (const row of await ctx.db.update(runs).set({ delegation }).where(eq(runs.id, runId)).returning()) {
      await publishRun(ctx, row)
      card = true
    }
  }
  if (!card)
    ctx.bus.publish(await memberIds(ctx, run.groupId), {
      t: 'run.progress',
      runId,
      groupId: run.groupId,
      botId: run.botId,
    })
}

async function onSessionConfig(
  ctx: Ctx,
  machineId: string,
  msg: Extract<DaemonMsg, { t: 'session.config' }>,
) {
  if (!(await liveRun(ctx, machineId, msg.runId))) return
  const { model, effort } = msg
  for (const row of await ctx.db
    .update(runs)
    .set({ model, effort })
    .where(eq(runs.id, msg.runId))
    .returning())
    await publishRun(ctx, row)
}

type Stream = Extract<RunEvent, { kind: 'text' | 'thought' }>
/** The stream row being extended; no `id` once it rolled over and the next chunk starts a new row. */
type Segment = { id?: number; kind: Stream['kind']; agentId?: string; plain: string }

/** Each chunk rewrites its whole row, so rows roll over at a line end past this size to keep appends linear. */
const SEGMENT = 8 * 1024
/** A line that never ends rolls over here anyway, the one place a secret may be cut. */
const SEGMENT_MAX = 32 * 1024
const OPEN_KEY = /-----BEGIN [A-Z0-9 ]*PRIVATE KEY-----(?![\s\S]*-----END [A-Z0-9 ]*PRIVATE KEY-----)/

/** Plaintext of each live run's stream row, so appends skip reading and decrypting it back. */
const segments = new Map<string, Segment>()

/** Where `plain` rolls over into a new row, if it does: after its last line, never inside a private key block. */
function rollover(plain: string) {
  if (plain.length < SEGMENT) return 0
  const line = plain.lastIndexOf('\n') + 1
  if (line && !OPEN_KEY.test(plain.slice(0, line))) return line
  return plain.length >= SEGMENT_MAX ? plain.length : 0
}

/**
 * Streamed chunks extend the run's latest event of the same kind and agent, so redaction sees whole lines even
 * when a secret is split across chunks.
 */
async function appendStream(ctx: Ctx, runId: string, { kind, delta, agentId }: Stream) {
  const prev = segments.get(runId) ?? (await lastSegment(ctx, runId))
  const same = prev?.kind === kind && prev.agentId === agentId
  let id = same ? prev.id : undefined
  let plain = same ? prev.plain + delta : delta
  const cut = rollover(plain)
  if (cut) {
    await writeSegment(ctx, runId, { id, kind, agentId, plain: plain.slice(0, cut) })
    id = undefined
    plain = plain.slice(cut)
  }
  if (plain) id = await writeSegment(ctx, runId, { id, kind, agentId, plain })
  segments.set(runId, { id, kind, agentId, plain })
}

async function writeSegment(ctx: Ctx, runId: string, { id, kind, agentId, plain }: Segment) {
  const payload = { kind, delta: seal(redact(plain)), agentId }
  if (id !== undefined) {
    await ctx.db.update(runEvents).set({ payload }).where(eq(runEvents.id, id))
    return id
  }
  const [row] = await ctx.db
    .insert(runEvents)
    .values({ runId, kind, payload })
    .returning({ id: runEvents.id })
  return row?.id
}

/** After a restart the cache is empty: the run's latest row, when it is a stream. */
async function lastSegment(ctx: Ctx, runId: string): Promise<Segment | undefined> {
  const [last] = await ctx.db
    .select()
    .from(runEvents)
    .where(eq(runEvents.runId, runId))
    .orderBy(desc(runEvents.id))
    .limit(1)
  if (!last) return
  const e = last.payload as RunEvent
  if (e.kind === 'text' || e.kind === 'thought')
    return { id: last.id, kind: e.kind, agentId: e.agentId, plain: open(e.delta) }
}

async function onDone(ctx: Ctx, machineId: string, done: RunDone) {
  segments.delete(done.runId)
  const owned = await liveRun(ctx, machineId, done.runId)
  if (!owned) return
  const [run] = await ctx.db
    .update(runs)
    .set({
      status: done.outcome === 'completed' ? 'completed' : 'interrupted',
      step: done.outcome === 'failed' ? `agent 异常：${redact(done.error ?? '未知错误')}` : '',
      filesChanged: done.filesChanged,
      patch: done.patch && seal(redact(done.patch)),
      ...(done.usage && { usage: done.usage }),
      ...(done.newSessionReason && { newSessionReason: done.newSessionReason }),
      endedAt: ctx.now(),
      ...(await stoppedDone(ctx, owned, done)),
    })
    .where(and(eq(runs.id, done.runId), inArray(runs.status, LIVE)))
    .returning()
  if (!run) return
  await voidApprovals(ctx, run.id, 'ended')
  await voidQuestions(ctx, run.id)
  if (done.sessionId)
    await ctx.db
      .update(groupBots)
      .set({ sessionId: done.sessionId })
      .where(and(eq(groupBots.groupId, run.groupId), eq(groupBots.botId, run.botId)))
  if (done.git) await updateBotState(ctx, run.groupId, run.botId, { gitStatus: done.git })
  if (done.reply.trim())
    await postMessage(ctx, {
      groupId: run.groupId,
      kind: 'bot',
      authorBotId: run.botId,
      body: redact(done.reply),
      meta: { mentions: [] },
      runId: run.id,
    })
  await publishRun(ctx, run)
  await schedule(ctx, run.botId)
  await publishBot(ctx, run.botId)
  await triggerChain(ctx, run)
  await requeueAppends(ctx, run, done.appendsApplied)
  // Last: a relay hop created above keeps the chain open.
  await notifyChainDone(ctx, run)
}
