import type { RunDone, RunEvent } from '@gonggong/protocol'
import { and, eq, getTableColumns, inArray, isNull, or, type SQL, sql } from 'drizzle-orm'
import type { Ctx } from '../../context.js'
import type { DaemonHub } from '../../daemon/hub.js'
import { attachments, bots, groupBots, messages, runEvents, runs, threadSessions } from '../../db/schema.js'
import { isUuid } from '../../lib/ids.js'
import { seal } from '../../lib/seal.js'
import { onAiApproved, onApprovalRequest, voidApprovals } from '../approvals/service.js'
import { dropMachineActivity, onArtifactActivity } from '../artifacts/activity.js'
import { publishBots } from '../bots/dto.js'
import { mirrorDelta, mirrorRun } from '../feishu/mirror.js'
import { requeueAppends } from '../messages/append.js'
import { runAudience } from '../messages/guests.js'
import { memberMentions, notifyMentions } from '../messages/mentions.js'
import { authorName, type MessageMeta, messageDto, postEvent, publishMessage } from '../messages/service.js'
import { pushToAll } from '../notifications/message-push.js'
import { onQuestionAsk, onQuestionWithdraw, voidQuestions } from '../questions/service.js'
import { settleSchedule } from '../schedules/engine.js'
import { forgetRedactors, runRedactors } from '../secrets/resolve.js'
import { pauseStopped, requeueRun } from '../sync/resolve.js'
import { followOnReply, isArtifactChat, publishThread, touchThread } from '../threads/service.js'
import { settleWebhook } from '../webhooks/service.js'
import { publishBotState, updateContextUsage } from '../workspaces/state.js'
import { cardColumns, LIVE, publishRun, publishStep, type RunRow } from './dto.js'
import { redactDeep } from './redact.js'
import { schedule } from './scheduler.js'
import { sealEvent } from './sealed.js'
import { runStep } from './step.js'
import { notifyChainDone, stoppedDone } from './stop.js'
import {
  appendStream,
  clearLiveContext,
  closeStream,
  dropMachineOwners,
  flushStream,
  forgetCtxStreams,
  forgetStream,
  liveContext,
  type Owner,
  resolveOwner,
  setLiveContext,
} from './streams.js'
import { settleReports, triggerChain } from './trigger.js'

export { flushStream, forgetStream, liveContext }

const { patch: _patch, ...unpatched } = getTableColumns(runs)

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
    else if (msg.t === 'approval.ai_approved') run(() => onAiApproved(ctx, machineId, msg))
    else if (msg.t === 'question.ask') run(() => onQuestionAsk(ctx, machineId, msg))
    else if (msg.t === 'question.withdraw') run(() => onQuestionWithdraw(ctx, machineId, msg))
    else if (msg.t === 'session.config') run(() => onSessionConfig(ctx, machineId, msg))
    else if (msg.t === 'run.continue') run(() => onContinue(ctx, machineId, msg))
    else if (msg.t === 'artifact.activity') run(() => onArtifactActivity(ctx, machineId, msg))
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
  // While a machine is away its runs may end server-side (a /stop while offline): their reports are checked again.
  const onOffline = (machineId: string) => {
    dropMachineOwners(machineId)
    enqueue(machineId, () => dropMachineActivity(ctx, machineId))
  }
  ctx.hub.on('message', onMessage)
  ctx.hub.on('online', onOnline)
  ctx.hub.on('offline', onOffline)
  return async () => {
    ctx.hub.off('message', onMessage)
    ctx.hub.off('online', onOnline)
    ctx.hub.off('offline', onOffline)
    await Promise.all([...chains.values()].map((c) => c.tail))
    await forgetCtxStreams(ctx)
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

/** `accept` as in `liveRun`; only an owner seen live is remembered. */
const ownerOf = (ctx: Ctx, machineId: string, runId: string, accept: 'live' | 'ended' = 'live') =>
  resolveOwner(machineId, runId, () => liveRun(ctx, machineId, runId, accept))

async function onEvent(ctx: Ctx, machineId: string, runId: string, raw: RunEvent) {
  // Background tasks and (Antigravity's) subagents outlive the turn that started them; so does a subagent's process.
  const outlives = raw.kind === 'task' || raw.kind === 'subagent' || ('agentId' in raw && !!raw.agentId)
  const run = await ownerOf(ctx, machineId, runId, outlives ? 'ended' : 'live')
  if (!run) return
  if (raw.kind === 'text' || raw.kind === 'thought') {
    await pushDelta(ctx, run, await appendStream(ctx, runId, raw))
    return
  }
  if (raw.kind === 'usage' && raw.context && raw.breakdown?.live) {
    // Not the group meter's: that shows only what the agent reported.
    setLiveContext(runId, { context: raw.context, breakdown: raw.breakdown })
    ctx.bus.publish(
      await runAudience(ctx, run),
      {
        t: 'run.progress',
        runId,
        groupId: run.groupId,
        botId: run.botId,
        lastActivityAt: ctx.now().toISOString(),
      },
      run.groupId,
    )
    return
  }
  if (raw.kind === 'usage' && raw.breakdown) clearLiveContext(runId)
  await pushDelta(ctx, run, await closeStream(runId))
  const event = redactDeep(raw, (await runRedactors(ctx, runId)).redact)
  const at = ctx.now()
  await ctx.db.insert(runEvents).values({ runId, kind: event.kind, payload: sealEvent(event), createdAt: at })
  // Updates of one tool call repeat its title: only a changed step is pushed.
  const setChanged = (set: Partial<RunRow>, changed: SQL) =>
    ctx.db
      .update(runs)
      .set(set)
      .where(and(eq(runs.id, runId), changed))
      .returning(cardColumns)
  const step = event.kind === 'tool' ? event.title : event.kind === 'status' ? event.step : undefined
  const updated =
    step !== undefined
      ? setChanged({ step }, sql`${runs.step} is distinct from ${step}`)
      : event.kind === 'compaction'
        ? event.status === 'running'
          ? setChanged(COMPACTING, sql`${runs.step} is distinct from ${COMPACTING.step}`)
          : setChanged({ step: '', stepI18n: null }, eq(runs.step, COMPACTING.step))
        : event.kind === 'usage'
          ? setChanged(
              { usage: event.usage },
              sql`${runs.usage} is distinct from ${JSON.stringify(event.usage)}::jsonb`,
            )
          : []
  let card = false
  for (const row of await updated) {
    await publishStep(ctx, row, at)
    // The Feishu card shows the step, not the usage.
    if (event.kind !== 'usage') await mirrorRun(ctx, row)
    card = true
  }
  if (event.kind === 'usage' && event.context)
    await updateContextUsage(ctx, run.groupId, run.botId, sql`${JSON.stringify(event.context)}::jsonb`)
  if (event.kind === 'compaction') await onCompaction(ctx, run, event)
  if (event.kind === 'plan')
    for (const row of await ctx.db
      .update(runs)
      .set({ plan: event.entries.length ? event.entries : null })
      .where(eq(runs.id, runId))
      .returning(cardColumns)) {
      await publishRun(ctx, row)
      card = true
    }
  if (event.kind === 'subagent' || event.kind === 'task') {
    const [field, id] = event.kind === 'subagent' ? ['subagents', event.agentId] : ['tasks', event.taskId]
    const delegation = sql`jsonb_set(${runs.delegation}, ${`{${field}}`}::text[], coalesce(${runs.delegation} -> ${field}, '{}') || jsonb_build_object(${id}::text, ${event.state}::text))`
    for (const row of await ctx.db
      .update(runs)
      .set({ delegation })
      .where(eq(runs.id, runId))
      .returning(cardColumns)) {
      await publishRun(ctx, row)
      card = true
    }
  }
  if (!card)
    ctx.bus.publish(
      await runAudience(ctx, run),
      {
        t: 'run.progress',
        runId,
        groupId: run.groupId,
        botId: run.botId,
        lastActivityAt: at.toISOString(),
      },
      run.groupId,
    )
}

const COMPACTING = runStep('正在压缩上下文')

/** Token counts as the clients show them: 950, 167k, 1.2M. */
const fmtTokens = (n: number) =>
  n >= 999_500 ? `${+(n / 1e6).toFixed(1)}M` : n >= 1000 ? `${Math.round(n / 1000)}k` : String(n)

/** A finished compaction is told to the group; the meter drops to what is left right away. */
async function onCompaction(ctx: Ctx, run: Owner, e: Extract<RunEvent, { kind: 'compaction' }>) {
  if (e.status !== 'completed' && e.status !== 'failed') return
  const [bot] = await ctx.db.select({ name: bots.name }).from(bots).where(eq(bots.id, run.botId))
  const name = bot?.name ?? ''
  if (e.status === 'failed') {
    await postEvent(ctx, run.groupId, '{bot} 压缩上下文失败：{error}', {
      bot: name,
      error: e.error ?? { key: '未知错误' },
    })
    return
  }
  const auto = e.trigger === 'auto'
  if (e.preTokens !== undefined && e.postTokens !== undefined)
    await postEvent(
      ctx,
      run.groupId,
      auto ? '{bot} 已自动压缩上下文：{pre} → {post}' : '{bot} 已压缩上下文：{pre} → {post}',
      { bot: name, pre: fmtTokens(e.preTokens), post: fmtTokens(e.postTokens) },
    )
  else
    await postEvent(ctx, run.groupId, auto ? '{bot} 已自动压缩上下文' : '{bot} 已压缩上下文', { bot: name })
  if (e.postTokens !== undefined)
    await updateContextUsage(
      ctx,
      run.groupId,
      run.botId,
      sql`jsonb_set(${groupBots.contextUsage}, '{used}', to_jsonb(${e.postTokens}::int))`,
    )
}

async function pushDelta(ctx: Ctx, run: { id: string; groupId: string }, text: string) {
  if (!text) return
  ctx.bus.publish(
    await runAudience(ctx, run),
    { t: 'run.delta', runId: run.id, text, lastActivityAt: ctx.now().toISOString() },
    run.groupId,
  )
  mirrorDelta(ctx, run.id, text)
}

/**
 * The agent went on by itself after `msg.runId` ended (a background task finished): a run of the same conversation,
 * triggered like that one, reports it. Running at once; the daemon serializes it with the conversation's turns.
 */
async function onContinue(ctx: Ctx, machineId: string, msg: Extract<DaemonMsg, { t: 'run.continue' }>) {
  const answer = (runId: string | null) => {
    ctx.hub.send(machineId, { t: 'run.continued', requestId: msg.requestId, runId })
  }
  const [prev] = isUuid(msg.runId)
    ? await ctx.db
        .select({ run: runs })
        .from(runs)
        .innerJoin(bots, eq(bots.id, runs.botId))
        .where(and(eq(runs.id, msg.runId), eq(bots.machineId, machineId), isNull(bots.deletedAt)))
    : []
  if (!prev) return answer(null)
  const { run } = prev
  const [row] = await ctx.db
    .insert(runs)
    .values({
      groupId: run.groupId,
      botId: run.botId,
      triggerMessageId: run.triggerMessageId,
      triggerUserId: run.triggerUserId,
      originUserId: run.originUserId,
      audience: run.audience,
      threadRootId: run.threadRootId,
      continuationOf: run.id,
      status: 'running',
      startedAt: ctx.now(),
      model: run.model,
      effort: run.effort,
      settings: run.settings,
      secrets: run.secrets,
      plugins: run.plugins,
    })
    .returning()
  if (!row) return answer(null)
  answer(row.id)
  await publishRun(ctx, row)
  await publishBots(ctx, eq(bots.id, row.botId))
}

async function onSessionConfig(
  ctx: Ctx,
  machineId: string,
  msg: Extract<DaemonMsg, { t: 'session.config' }>,
) {
  if (!(await liveRun(ctx, machineId, msg.runId))) return
  const { model, effort, settings = null } = msg
  for (const row of await ctx.db
    .update(runs)
    .set({ model, effort, settings })
    .where(eq(runs.id, msg.runId))
    .returning())
    await publishRun(ctx, row)
}

async function onDone(ctx: Ctx, machineId: string, done: RunDone) {
  const tail = await closeStream(done.runId)
  // Reports after run.done are checked against the row again.
  await forgetStream(done.runId)
  const owned = await liveRun(ctx, machineId, done.runId, 'unfinished')
  if (!owned) return
  await pushDelta(ctx, owned, tail)
  // A repeated run.done for a run that already ended: only its follow-up work is left.
  if (owned.finalizing) return finalize(ctx, owned)
  // A stopped turn that never started just ends.
  if (done.sync?.outcome === 'waiting' && !owned.stoppedBy) return requeueRun(ctx, owned, done.sync.issue)
  const ended = await terminate(ctx, owned, done)
  if (!ended) return
  if (done.sync?.outcome === 'stopped') await pauseStopped(ctx, ended, done.sync.files)
  await finalize(ctx, ended)
  forgetRedactors(done.runId)
}

/**
 * Ends the run: terminal state, session id, git status and the final reply are stored in one transaction, so a
 * failure never leaves a finished run without its reply (or the reverse). The run stays `finalizing` until
 * `finalize` completed.
 */
async function terminate(ctx: Ctx, owned: RunRow, done: RunDone) {
  const stopped = await stoppedDone(ctx, owned, done)
  const { redact } = await runRedactors(ctx, owned.id)
  const reply = done.reply.trim() ? redact(done.reply) : null
  const userMentions = reply ? await memberMentions(ctx, owned.groupId, reply, { skipCode: true }) : []
  const ended = await ctx.db.transaction(async (tx) => {
    const [run] = await tx
      .update(runs)
      .set({
        status: done.outcome === 'completed' ? 'completed' : 'interrupted',
        ...(done.outcome === 'failed'
          ? runStep('运行出错：{error}', { error: done.error ? redact(done.error) : { key: '未知错误' } })
          : { step: '' }),
        filesChanged: done.filesChanged,
        patch: done.patch && seal(redact(done.patch)),
        patchRepos: done.repos,
        ...(done.usage && { usage: done.usage }),
        ...(done.newSessionReason && { newSessionReason: done.newSessionReason }),
        sessionAfter: done.sessionId,
        endedAt: ctx.now(),
        finalizing: true,
        appendsApplied: done.appendsApplied,
        sync: done.sync,
        ...stopped,
      })
      .where(and(eq(runs.id, owned.id), inArray(runs.status, LIVE)))
      .returning(unpatched)
    if (!run) return null
    // A scheduled turn's session is its own (see buildRunStart): the group keeps resuming its conversation.
    const [trigger] = done.sessionId
      ? await tx
          .select({ meta: messages.meta, threadRootId: messages.threadRootId })
          .from(messages)
          .where(eq(messages.id, run.triggerMessageId))
      : []
    const triggerMeta = trigger?.meta as MessageMeta | undefined
    const sessionId = triggerMeta?.scheduleOf || triggerMeta?.webhookOf ? null : done.sessionId
    // Asked in a thread: the session is the thread's (plan 话题).
    const thread = sessionId ? trigger?.threadRootId : null
    if (thread && sessionId)
      await tx
        .update(threadSessions)
        .set({ sessionId })
        .where(and(eq(threadSessions.rootMessageId, thread), eq(threadSessions.botId, run.botId)))
    const [state] =
      (sessionId && !thread) || done.git
        ? await tx
            .update(groupBots)
            .set({
              ...(sessionId && !thread && { sessionId }),
              ...(done.git && { gitStatus: done.git }),
            })
            .where(and(eq(groupBots.groupId, run.groupId), eq(groupBots.botId, run.botId)))
            .returning()
        : []
    const pages = run.htmlRenders
    const [message] =
      reply || pages.length
        ? await tx
            .insert(messages)
            .values({
              groupId: run.groupId,
              kind: 'bot',
              authorBotId: run.botId,
              body: reply ?? '',
              // Bots it @s are not triggered: only hand_off starts another bot.
              meta: {
                mentions: [],
                ...(userMentions.length > 0 && { userMentions }),
                ...(pages.length > 0 && { htmlRenders: pages }),
              } satisfies MessageMeta,
              runId: run.id,
              threadRootId: run.threadRootId,
            })
            .returning()
        : []
    const [root] =
      message && run.threadRootId
        ? await tx.select().from(messages).where(eq(messages.id, run.threadRootId))
        : []
    if (message && root && !isArtifactChat(root)) await followOnReply(tx, root, message, userMentions)
    if (message && pages.length)
      await tx
        .update(attachments)
        .set({ messageId: message.id })
        .where(
          inArray(
            attachments.id,
            pages.map((p) => p.attachmentId),
          ),
        )
    return { run, state, message, root }
  })
  if (!ended) return
  if (ended.message) {
    const name = await authorName(ctx, ended.message)
    await publishMessage(ctx, messageDto(ended.message, name))
    if (ended.root) await publishThread(ctx, ended.root)
    await notifyMentions(ctx, ended.message, name)
    await pushToAll(ctx, ended.message, name)
  } else if (ended.run.threadRootId) {
    await touchThread(ctx, ended.run.threadRootId)
  }
  if (ended.state && done.git) await publishBotState(ctx, ended.state)
  // The sealed patch just written may be large and nothing after the end reads it, so it is not sent back.
  return { ...ended.run, patch: null }
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
  await publishBots(ctx, eq(bots.id, run.botId))
  await triggerChain(ctx, run)
  await settleReports(ctx, run)
  await settleSchedule(ctx, run)
  await settleWebhook(ctx, run)
  await requeueAppends(ctx, run, run.appendsApplied)
  // Last: a relay hop created above keeps the chain open.
  await notifyChainDone(ctx, run)
  await ctx.db.update(runs).set({ finalizing: false }).where(eq(runs.id, run.id))
}
