import { isDeepStrictEqual } from 'node:util'
import type { RunDone, RunEvent } from '@gonggong/protocol'
import { and, desc, eq, inArray, isNull, or, sql } from 'drizzle-orm'
import type { Ctx } from '../../context.js'
import type { DaemonHub } from '../../daemon/hub.js'
import { bots, groupBots, messages, runEvents, runs } from '../../db/schema.js'
import { open, seal } from '../../lib/seal.js'
import { onApprovalRequest, voidApprovals } from '../approvals/service.js'
import { publishBot } from '../bots/dto.js'
import { requeueAppends } from '../messages/append.js'
import { authorName, memberIds, messageDto, publishMessage } from '../messages/service.js'
import { onQuestionAsk, onQuestionWithdraw, voidQuestions } from '../questions/service.js'
import { publishBotState, updateBotState } from '../workspaces/state.js'
import { publishRun, type RunRow } from './dto.js'
import { redact, redactDeep } from './redact.js'
import { schedule } from './scheduler.js'
import { sealEvent } from './sealed.js'
import { runStep } from './step.js'
import { notifyChainDone, stoppedDone } from './stop.js'
import { triggerChain } from './trigger.js'

const LIVE = ['running', 'awaiting_approval', 'awaiting_answer']

type DaemonMsg = Parameters<Parameters<DaemonHub['on']>[1]>[1]

/** Approximate bytes of reports one machine may have waiting; past it streamed text/thought is dropped. */
export const MAX_PENDING_BYTES = 32 << 20
const DROP_WARN_MS = 10_000

const MESSAGE_OVERHEAD = 256
const weight = (msg: DaemonMsg) =>
  MESSAGE_OVERHEAD +
  (msg.t !== 'run.event'
    ? 0
    : msg.event.kind === 'text' || msg.event.kind === 'thought'
      ? msg.event.delta.length
      : msg.event.kind === 'tool'
        ? (msg.event.detail?.length ?? 0)
        : 0)

/**
 * Wires daemon run reports into persistence + realtime, and reschedules when machines come online.
 * Each machine's messages are applied strictly in arrival order; a slow machine never holds up the others.
 * A machine's waiting reports are capped at MAX_PENDING_BYTES: past it only streamed text/thought is dropped,
 * every other report (run.done, approvals, questions, ...) is always kept.
 * Returns a function that detaches and drains.
 */
export function startRunEngine(ctx: Ctx) {
  const chains = new Map<string, { tail: Promise<void>; bytes: number; dropped: number; warnedAt: number }>()
  const enqueue = (machineId: string, job: () => Promise<void>, bytes = 0) => {
    const chain = chains.get(machineId) ?? { tail: Promise.resolve(), bytes: 0, dropped: 0, warnedAt: 0 }
    chain.bytes += bytes
    const tail = chain.tail
      .then(job)
      .catch((err) => console.error('run engine:', err))
      .finally(() => {
        chain.bytes -= bytes
        if (chain.tail === tail) chains.delete(machineId)
      })
    chain.tail = tail
    chains.set(machineId, chain)
  }
  const shed = (machineId: string, msg: DaemonMsg) => {
    const chain = chains.get(machineId)
    const streamed = msg.t === 'run.event' && (msg.event.kind === 'text' || msg.event.kind === 'thought')
    if (!chain || !streamed || chain.bytes < MAX_PENDING_BYTES) return false
    chain.dropped++
    if (Date.now() - chain.warnedAt >= DROP_WARN_MS) {
      console.warn(`run engine: machine ${machineId} is behind, dropped ${chain.dropped} streamed chunks`)
      chain.warnedAt = Date.now()
      chain.dropped = 0
    }
    return true
  }
  const onMessage = (machineId: string, msg: DaemonMsg) => {
    if (shed(machineId, msg)) return
    const run = (job: () => Promise<void>) => enqueue(machineId, job, weight(msg))
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
      // Runs whose follow-up work was cut short (e.g. by a server restart) are finished here.
      const unfinished = await ctx.db
        .select({ run: runs })
        .from(runs)
        .innerJoin(bots, eq(bots.id, runs.botId))
        .where(and(eq(bots.machineId, machineId), eq(runs.finalizing, true)))
      for (const { run } of unfinished)
        await finalize(ctx, run).catch((err) => console.error('run finalize:', err))
    })
  ctx.hub.on('message', onMessage)
  ctx.hub.on('online', onOnline)
  return async () => {
    ctx.hub.off('message', onMessage)
    ctx.hub.off('online', onOnline)
    await Promise.all([...chains.values()].map((c) => c.tail))
  }
}

/**
 * A live run owned by a bot on this machine; reports from anyone else are dropped. The share lock waits for an
 * in-flight dispatch transaction, so a report racing the scheduler's commit sees the run as running.
 * `ended` also accepts finished runs: background tasks outlive the turn that started them; `unfinished` the
 * runs still finalizing, for a repeated run.done.
 */
async function liveRun(
  ctx: Ctx,
  machineId: string,
  runId: string,
  accept: 'live' | 'ended' | 'unfinished' = 'live',
) {
  const status = {
    live: inArray(runs.status, LIVE),
    ended: undefined,
    unfinished: or(inArray(runs.status, LIVE), eq(runs.finalizing, true)),
  }[accept]
  const [row] = await ctx.db
    .select({ run: runs })
    .from(runs)
    .innerJoin(bots, eq(bots.id, runs.botId))
    .where(and(eq(runs.id, runId), eq(bots.machineId, machineId), status))
    .for('share', { of: runs })
  return row?.run
}

async function onEvent(ctx: Ctx, machineId: string, runId: string, raw: RunEvent) {
  const run = await liveRun(ctx, machineId, runId, raw.kind === 'task' ? 'ended' : 'live')
  if (!run) return
  if (raw.kind === 'text' || raw.kind === 'thought') {
    await pushDelta(ctx, run, await appendStream(ctx, runId, raw))
    return
  }
  await pushDelta(ctx, run, closeStream(runId))
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
  if (event.kind === 'usage' && event.context)
    await updateBotState(ctx, run.groupId, run.botId, { contextUsage: event.context })
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

async function pushDelta(ctx: Ctx, run: { id: string; groupId: string }, text: string) {
  if (text) ctx.bus.publish(await memberIds(ctx, run.groupId), { t: 'run.delta', runId: run.id, text })
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
type Segment = {
  id?: number
  kind: Stream['kind']
  agentId?: string
  plain: string
  /** Length of the redacted text of `plain` already pushed to viewers. */
  sent: number
}

/** Each chunk rewrites its whole row, so rows roll over at a line end past this size to keep appends linear. */
const SEGMENT = 8 * 1024
/** A line that never ends rolls over here anyway, the one place a secret may be cut. */
const SEGMENT_MAX = 32 * 1024
const OPEN_KEY = /-----BEGIN [A-Z0-9 ]*PRIVATE KEY-----(?![\s\S]*-----END [A-Z0-9 ]*PRIVATE KEY-----)/

const HEADER = /-----BEGIN[^\n]*$/
/** Continuations that turn a still-open quote into a match; a label alone is masked by the cumulative redaction. */
const PROBES = ['a'.repeat(64), 'a"', "a'"]

/** Plaintext of each live run's stream row, so appends skip reading and decrypting it back. */
const segments = new Map<string, Segment>()

/** A run that ended without run.done (daemon lost, account disabled) no longer streams. */
export function forgetStream(runId: string) {
  segments.delete(runId)
}

/** Where `plain` rolls over into a new row, if it does: after its last line, never inside a private key block. */
function rollover(plain: string) {
  if (plain.length < SEGMENT) return 0
  const line = plain.lastIndexOf('\n') + 1
  if (line && !OPEN_KEY.test(plain.slice(0, line))) return line
  return plain.length >= SEGMENT_MAX ? plain.length : 0
}

const isToken = (code: number) => code > 32 && code < 127

/** Only the main agent's replies are pushed live; thoughts and subagent text are read from the stored rows. */
const live = ({ kind, agentId }: Segment) => kind === 'text' && !agentId

/** Redacted text of `seg.plain` up to `end` that viewers have not received yet. */
function unsent(seg: Segment, end: number) {
  const text = redact(seg.plain.slice(0, end)).slice(seg.sent)
  seg.sent += text.length
  return text
}

/**
 * How much of `plain` no later text can rewrite once redacted. Viewers append what they receive, so a secret
 * must never start going out before the rest of it arrives: the trailing token, an open private key block and
 * a value inside an unclosed quote wait for more text.
 */
function settled(plain: string) {
  let end = Math.min(OPEN_KEY.exec(plain)?.index ?? plain.length, HEADER.exec(plain)?.index ?? plain.length)
  while (end > 0 && isToken(plain.charCodeAt(end - 1))) end--
  while (end > 0 && !closed(plain.slice(0, end))) {
    while (end > 0 && !isToken(plain.charCodeAt(end - 1))) end--
    while (end > 0 && isToken(plain.charCodeAt(end - 1))) end--
  }
  return end
}

/** Quotes and labels do not span lines, so the last two lines tell whether a continuation could rewrite `text`. */
function closed(text: string) {
  const last = text.lastIndexOf('\n')
  const tail = text.slice(last < 0 ? 0 : text.lastIndexOf('\n', last - 1) + 1)
  const masked = redact(tail)
  return PROBES.every((probe) => redact(tail + probe).startsWith(masked))
}

/**
 * Streamed chunks extend the run's latest event of the same kind and agent, so redaction sees whole lines even
 * when a secret is split across chunks. Returns the redacted text now safe to push live.
 */
async function appendStream(ctx: Ctx, runId: string, { kind, delta, agentId }: Stream) {
  const prev = segments.get(runId) ?? (await lastSegment(ctx, runId))
  const same = prev?.kind === kind && prev.agentId === agentId
  let out = prev && !same && live(prev) ? unsent(prev, prev.plain.length) : ''
  const seg: Segment = {
    id: same ? prev.id : undefined,
    kind,
    agentId,
    plain: same ? prev.plain + delta : delta,
    sent: same ? prev.sent : 0,
  }
  const cut = rollover(seg.plain)
  if (cut) {
    await writeSegment(ctx, runId, { ...seg, plain: seg.plain.slice(0, cut) })
    if (live(seg)) out += unsent(seg, cut)
    seg.id = undefined
    seg.plain = seg.plain.slice(cut)
    seg.sent = 0
  }
  if (seg.plain) seg.id = await writeSegment(ctx, runId, seg)
  if (live(seg)) out += unsent(seg, settled(seg.plain))
  segments.set(runId, seg)
  return out
}

/** The stream ends: what was held back for a possible secret can go out. */
function closeStream(runId: string) {
  const seg = segments.get(runId)
  segments.delete(runId)
  return seg && live(seg) ? unsent(seg, seg.plain.length) : ''
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
    return { id: last.id, kind: e.kind, agentId: e.agentId, plain: open(e.delta), sent: open(e.delta).length }
}

async function onDone(ctx: Ctx, machineId: string, done: RunDone) {
  const tail = closeStream(done.runId)
  const owned = await liveRun(ctx, machineId, done.runId, 'unfinished')
  if (!owned) return
  await pushDelta(ctx, owned, tail)
  // A repeated run.done for a run that already ended: only its follow-up work is left.
  if (owned.finalizing) return finalize(ctx, owned)
  const ended = await terminate(ctx, owned, done)
  if (ended) await finalize(ctx, ended)
}

/**
 * Ends the run: terminal state, session id, git status and the final reply are stored in one transaction, so a
 * failure never leaves a finished run without its reply (or the reverse). The run stays `finalizing` until
 * `finalize` completed.
 */
async function terminate(ctx: Ctx, owned: RunRow, done: RunDone) {
  const stopped = await stoppedDone(ctx, owned, done)
  const reply = done.reply.trim() ? redact(done.reply) : null
  const ended = await ctx.db.transaction(async (tx) => {
    const [run] = await tx
      .update(runs)
      .set({
        status: done.outcome === 'completed' ? 'completed' : 'interrupted',
        ...(done.outcome === 'failed'
          ? runStep('agent 异常：{error}', { error: done.error ? redact(done.error) : { key: '未知错误' } })
          : { step: '' }),
        filesChanged: done.filesChanged,
        patch: done.patch && seal(redact(done.patch)),
        ...(done.usage && { usage: done.usage }),
        ...(done.newSessionReason && { newSessionReason: done.newSessionReason }),
        endedAt: ctx.now(),
        finalizing: true,
        appendsApplied: done.appendsApplied,
        ...stopped,
      })
      .where(and(eq(runs.id, owned.id), inArray(runs.status, LIVE)))
      .returning()
    if (!run) return null
    const [state] =
      done.sessionId || done.git
        ? await tx
            .update(groupBots)
            .set({
              ...(done.sessionId && { sessionId: done.sessionId }),
              ...(done.git && { gitStatus: done.git }),
            })
            .where(and(eq(groupBots.groupId, run.groupId), eq(groupBots.botId, run.botId)))
            .returning()
        : []
    const [message] = reply
      ? await tx
          .insert(messages)
          .values({
            groupId: run.groupId,
            kind: 'bot',
            authorBotId: run.botId,
            body: reply,
            meta: { mentions: [] },
            runId: run.id,
          })
          .returning()
      : []
    return { run, state, message }
  })
  if (!ended) return
  if (ended.message)
    await publishMessage(ctx, messageDto(ended.message, await authorName(ctx, ended.message)))
  if (ended.state && done.git) await publishBotState(ctx, ended.state)
  return ended.run
}

/**
 * The work after a run ended. Each step is safe to repeat (idempotent, or deduplicated by what it already
 * created), so a failure part-way is finished by the next call: a repeated run.done or the machine's reconnect.
 */
async function finalize(ctx: Ctx, run: RunRow) {
  await voidApprovals(ctx, run.id, 'ended')
  await voidQuestions(ctx, run.id)
  await publishRun(ctx, run)
  await schedule(ctx, run.botId)
  await publishBot(ctx, run.botId)
  await triggerChain(ctx, run)
  await requeueAppends(ctx, run, run.appendsApplied)
  // Last: a relay hop created above keeps the chain open.
  await notifyChainDone(ctx, run)
  await ctx.db.update(runs).set({ finalizing: false }).where(eq(runs.id, run.id))
}
