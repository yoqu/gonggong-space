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
import { onQuestionAsk, voidQuestions } from '../questions/service.js'
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
 * Daemon messages are applied strictly in arrival order. Returns a function that detaches and drains.
 */
export function startRunEngine(ctx: Ctx) {
  let chain = Promise.resolve()
  const enqueue = (job: () => Promise<void>) => {
    chain = chain.then(job).catch((err) => console.error('run engine:', err))
  }
  const onMessage = (machineId: string, msg: DaemonMsg) => {
    if (msg.t === 'run.event') enqueue(() => onEvent(ctx, machineId, msg.runId, msg.event))
    else if (msg.t === 'run.done') enqueue(() => onDone(ctx, machineId, msg))
    else if (msg.t === 'approval.request') enqueue(() => onApprovalRequest(ctx, machineId, msg))
    else if (msg.t === 'question.ask') enqueue(() => onQuestionAsk(ctx, machineId, msg))
  }
  const onOnline = (machineId: string) =>
    enqueue(async () => {
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
    await chain
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
  const event = redactDeep(raw)
  await ctx.db.insert(runEvents).values({ runId, kind: event.kind, payload: sealEvent(event) })
  const patch =
    event.kind === 'status' || event.kind === 'tool'
      ? { step: event.kind === 'tool' ? event.title : event.step }
      : event.kind === 'usage'
        ? { usage: event.usage }
        : null
  if (patch)
    for (const row of await ctx.db.update(runs).set(patch).where(eq(runs.id, runId)).returning())
      await publishRun(ctx, row)
  if (event.kind === 'subagent' || event.kind === 'task') {
    const [field, id] = event.kind === 'subagent' ? ['subagents', event.agentId] : ['tasks', event.taskId]
    const delegation = sql`jsonb_set(${runs.delegation}, ${`{${field}}`}::text[], coalesce(${runs.delegation} -> ${field}, '{}') || jsonb_build_object(${id}::text, ${event.state}::text))`
    for (const row of await ctx.db.update(runs).set({ delegation }).where(eq(runs.id, runId)).returning())
      await publishRun(ctx, row)
  }
}

type Stream = Extract<RunEvent, { kind: 'text' | 'thought' }>

/**
 * Streamed chunks extend the run's latest event of the same kind and agent, so redaction sees whole segments even
 * when a secret is split across chunks.
 */
async function appendStream(ctx: Ctx, runId: string, { kind, delta, agentId }: Stream) {
  const [last] = await ctx.db
    .select()
    .from(runEvents)
    .where(eq(runEvents.runId, runId))
    .orderBy(desc(runEvents.id))
    .limit(1)
  const prev = last?.payload as Stream | undefined
  if (last && prev && last.kind === kind && prev.agentId === agentId) {
    const payload = { kind, delta: seal(redact(open(prev.delta) + delta)), agentId }
    await ctx.db.update(runEvents).set({ payload }).where(eq(runEvents.id, last.id))
  } else
    await ctx.db
      .insert(runEvents)
      .values({ runId, kind, payload: { kind, delta: seal(redact(delta)), agentId } })
}

async function onDone(ctx: Ctx, machineId: string, done: RunDone) {
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
      newSessionReason: done.newSessionReason,
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
  const reply = done.reply.trim()
    ? await postMessage(ctx, {
        groupId: run.groupId,
        kind: 'bot',
        authorBotId: run.botId,
        body: redact(done.reply),
        meta: { mentions: [] },
        runId: run.id,
      })
    : null
  await publishRun(ctx, run)
  await schedule(ctx, run.botId)
  await publishBot(ctx, run.botId)
  if (reply) await triggerChain(ctx, run, reply)
  await requeueAppends(ctx, run, done.appendsApplied)
  // Last: a relay hop created above keeps the chain open.
  await notifyChainDone(ctx, run)
}
