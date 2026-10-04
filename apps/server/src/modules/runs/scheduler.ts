import type { AgentKind, Approval, ContextMessage, GitProtocol, RunStart, Tier } from '@gonggong/protocol'
import { and, asc, count, desc, eq, gt, inArray, isNull, lt, ne, or, type SQL, sql } from 'drizzle-orm'
import type { Ctx } from '../../context.js'
import type { Db } from '../../db/client.js'
import {
  bots,
  groupBots,
  groupRepos,
  groups,
  messages,
  runs,
  schedules,
  teams,
  users,
} from '../../db/schema.js'
import { FEISHU_HINT } from '../agent-tools/feishu.js'
import { botCatalog, resolveConfig } from '../bots/config.js'
import { publishBot } from '../bots/dto.js'
import { runTier } from '../bots/tier.js'
import { boundChat } from '../feishu/mirror.js'
import { effectiveParams } from '../groups/params.js'
import { enabledMcpServers } from '../mcp/routes.js'
import type { MessageMeta } from '../messages/service.js'
import { runSyncStart } from '../sync/store.js'
import { sendDueInits, syncHeld } from '../sync/switch.js'
import { unreadyGroups } from '../workspaces/state.js'
import { publishRun, type RunRow } from './dto.js'
import { runStep } from './step.js'
import { interruptNote } from './stop.js'

type Tx = Parameters<Parameters<Db['transaction']>[0]>[0]
type Bot = typeof bots.$inferSelect

const WAITING = ['queued', 'offline_wait']
/** Runs holding one of the bot's concurrency slots. */
export const ACTIVE = ['running', 'awaiting_approval', 'awaiting_answer']
const OFFLINE = { status: 'offline_wait', ...runStep('Bot 离线，等待上线'), startedAt: null }
const WORKSPACE_WAIT = runStep('工作区准备中')

/**
 * Server-authoritative scheduling (plan D22): dispatches the bot's waiting runs in trigger order while its machine
 * is online and it has free slots; the rest wait as queued (with position) or offline_wait.
 */
export async function schedule(ctx: Ctx, botId: string) {
  const changed = await ctx.db.transaction(async (tx) => {
    await tx.execute(sql`select pg_advisory_xact_lock(hashtext(${botId}))`)
    const [row] = await tx
      .select({ bot: bots, archivedAt: teams.archivedAt })
      .from(bots)
      .innerJoin(teams, eq(teams.id, bots.teamId))
      .where(eq(bots.id, botId))
    // Plan D15: an archived team's bots are no longer dispatched.
    if (!row || row.archivedAt) return { out: [], dispatches: [] }
    const { bot } = row
    const waiting = await tx
      .select({ run: runs })
      .from(runs)
      .innerJoin(messages, eq(messages.id, runs.triggerMessageId))
      .where(and(eq(runs.botId, botId), inArray(runs.status, WAITING)))
      .orderBy(asc(messages.seq))
    if (!waiting.length) return { out: [], dispatches: [] }
    const held = await syncHeld(tx, botId)
    const active = await tx
      .select({ groupId: runs.groupId })
      .from(runs)
      .where(and(eq(runs.botId, botId), inArray(runs.status, ACTIVE)))
    const unready = await unreadyGroups(tx, botId)
    let busy = active.length
    // One conversation per (group, bot): a group's next turn waits for its previous one (spec §8.9).
    const busyGroups = new Set(active.map((r) => r.groupId))
    const groupQueue = new Map<string, number>()
    let position = 0
    const out: RunRow[] = []
    const dispatches: { run: RunRow; machineId: string; msg: RunStart; triggerSeq: number }[] = []
    const setRun = async (id: string, patch: Partial<RunRow>) =>
      out.push(...(await tx.update(runs).set(patch).where(eq(runs.id, id)).returning()))
    for (const { run } of waiting) {
      const machineId = bot.machineId && ctx.hub.isOnline(bot.machineId) ? bot.machineId : null
      if (machineId && busyGroups.has(run.groupId)) {
        const n = (groupQueue.get(run.groupId) ?? 0) + 1
        groupQueue.set(run.groupId, n)
        const step = runStep('本群上一轮未结束，排第 {n}', { n })
        if (run.status !== 'queued' || run.step !== step.step)
          await setRun(run.id, { status: 'queued', ...step })
        continue
      }
      // A mode switch holds new turns until it is done (§3.5); the sync engine reschedules then.
      const hold = machineId && held.get(run.groupId)
      if (hold) {
        if (run.status !== 'queued' || run.step !== hold.step)
          await setRun(run.id, { status: 'queued', ...hold })
        continue
      }
      // Dispatch only once the bot's clone / directory is ready; the workspace engine reschedules then.
      if (machineId && unready.has(run.groupId)) {
        if (run.status !== 'queued' || run.step !== WORKSPACE_WAIT.step)
          await setRun(run.id, { status: 'queued', ...WORKSPACE_WAIT })
        continue
      }
      if (machineId && busy < bot.concurrency) {
        const start = await buildRunStart(tx, bot, run)
        if (start.settled) out.push(start.settled)
        // Marked running inside the transaction, sent only after it committed: a fast run.done then finds the
        // committed running row, and a rollback never leaves a daemon executing a run the server has queued.
        const [running] = await tx
          .update(runs)
          .set({
            status: 'running',
            step: '',
            startedAt: ctx.now(),
            ...start.config,
            // Known up front so the live round already starts its own session; run.done may refine it.
            newSessionReason: start.msg.resumeSessionId ? null : (start.msg.newSessionReason ?? 'first'),
          })
          .where(eq(runs.id, run.id))
          .returning()
        if (running) {
          busy += 1
          busyGroups.add(run.groupId)
          out.push(running)
          dispatches.push({ run: running, machineId, msg: start.msg, triggerSeq: start.triggerSeq })
        }
        continue
      }
      const next = machineId
        ? { status: 'queued', ...runStep('该 Bot 忙，排第 {n}', { n: ++position }) }
        : OFFLINE
      if (next.status !== run.status || next.step !== run.step) await setRun(run.id, next)
    }
    return { out, dispatches }
  })
  const unsent = new Map<string, RunRow>()
  for (const { run, machineId, msg, triggerSeq } of changed.dispatches) {
    if (ctx.hub.send(machineId, msg)) {
      // After the send: a cursor advanced for a start that never went out would drop that context for good.
      await ctx.db
        .update(groupBots)
        .set({
          contextSeq: sql`greatest(${groupBots.contextSeq}, ${triggerSeq})`,
          newSessionReason: null,
        })
        .where(and(eq(groupBots.groupId, run.groupId), eq(groupBots.botId, botId)))
    } else {
      // The machine dropped since the transaction. (A crash between commit and send leaves a running run the
      // daemon never got; its next hello lists no such run and reconcileRuns interrupts it.)
      const [back] = await ctx.db
        .update(runs)
        .set(OFFLINE)
        .where(and(eq(runs.id, run.id), eq(runs.status, 'running')))
        .returning()
      if (back) unsent.set(run.id, back)
    }
  }
  const settled = changed.out.map((r) => unsent.get(r.id) ?? r)
  for (const run of settled) await publishRun(ctx, run)
  if (settled.some((r) => r.status === 'running')) await publishBot(ctx, botId)
  await sendDueInits(ctx, botId)
}

async function buildRunStart(tx: Tx, bot: Bot, run: RunRow) {
  const [trigger] = await tx
    .select({
      seq: messages.seq,
      body: messages.body,
      meta: messages.meta,
      at: messages.createdAt,
      author: users.name,
      bot: bots.name,
    })
    .from(messages)
    .leftJoin(users, eq(users.id, messages.authorUserId))
    .leftJoin(bots, eq(bots.id, messages.authorBotId))
    .where(eq(messages.id, run.triggerMessageId))
  const [group] = await tx.select({ name: groups.name }).from(groups).where(eq(groups.id, run.groupId))
  const [gb] = await tx
    .select()
    .from(groupBots)
    .where(and(eq(groupBots.groupId, run.groupId), eq(groupBots.botId, bot.id)))
  const [repo] = await tx
    .select()
    .from(groupRepos)
    .where(eq(groupRepos.groupId, run.groupId))
    .orderBy(asc(groupRepos.createdAt))
    .limit(1)
  if (!trigger || !gb || !group) throw new Error(`run ${run.id} lost its trigger message or group membership`)
  const [owner] = await tx
    .select({ protocol: users.gitProtocol })
    .from(users)
    .where(eq(users.id, bot.ownerId))
  const params = await effectiveParams(tx, run.groupId)
  const meta = trigger.meta as MessageMeta
  // An agent command carries no group context, so it leaves the context cursor where it was.
  const command = meta.agentCommand ?? null
  const since = and(
    eq(messages.groupId, run.groupId),
    gt(messages.seq, gb.contextSeq),
    lt(messages.seq, trigger.seq),
    or(isNull(messages.authorBotId), ne(messages.authorBotId, bot.id)),
  )
  // Older messages stay out of the prompt; the agent reads them with the gonggong tools (plan C1).
  const context = command ? [] : (await contextMessages(tx, since, params.contextInlineMax)).reverse()
  const omitted =
    command || context.length < params.contextInlineMax ? 0 : (await countContext(tx, since)) - context.length
  // A /new request wins over any session id a still-running turn reported after the request.
  const resumeSessionId = gb.newSessionReason ? null : gb.sessionId
  const fallbackContext =
    resumeSessionId && !command
      ? (
          await contextMessages(
            tx,
            and(eq(messages.groupId, run.groupId), lt(messages.seq, trigger.seq)),
            Math.min(params.sessionReplayCount, params.contextInlineMax),
          )
        ).reverse()
      : []
  const interrupted = await interruptNote(tx, run, trigger.at.toISOString())
  const feishu = await boundChat(tx, run.groupId)
  const config = resolveConfig(await botCatalog(tx, bot), meta.runOptions?.[bot.id], gb, bot)
  const note = [
    ...(interrupted ? [interrupted.note] : []),
    ...(meta.scheduleOf ? [await scheduleNote(tx, meta.scheduleOf, trigger.at.toISOString())] : []),
  ]
  const msg: RunStart = {
    t: 'run.start',
    runId: run.id,
    groupId: run.groupId,
    groupName: group.name,
    bot: {
      id: bot.id,
      name: bot.name,
      agentKind: bot.agentKind as AgentKind,
      systemPrompt: feishu
        ? [FEISHU_HINT, bot.systemPrompt].filter((s) => s.trim()).join('\n\n')
        : bot.systemPrompt,
      tier: await runTier(tx, (gb.tier ?? bot.tier) as Tier),
      approval: bot.approval as Approval,
      allowlist: bot.allowlist,
      ...config,
    },
    workspace: {
      repo: repo
        ? {
            id: repo.id,
            url: repo.url,
            branch: repo.baseBranch,
            protocol: (owner?.protocol ?? 'auto') as GitProtocol,
          }
        : null,
      cdPath: gb.cdPath,
    },
    resumeSessionId,
    newSessionReason: gb.newSessionReason,
    prompt: {
      text: trigger.body,
      triggeredBy: trigger.author ?? trigger.bot ?? '',
      context: [...context, ...note],
      omitted,
      fallbackContext: resumeSessionId ? [...fallbackContext, ...note] : [],
      attachments: meta.attachments ?? [],
      quote: quoteOf(meta),
    },
    mcpServers: await enabledMcpServers(tx, run.groupId),
    command,
    sync: await runSyncStart(tx, run.groupId, bot.id),
  }
  return { msg, config, triggerSeq: command ? 0 : trigger.seq, settled: interrupted?.settled }
}

/** Tells the agent its turn came from a scheduled task, so it can retire the task once it is no longer needed. */
async function scheduleNote(tx: Tx, id: string, at: string): Promise<ContextMessage> {
  const [s] = await tx.select({ name: schedules.name }).from(schedules).where(eq(schedules.id, id))
  return {
    seq: 0,
    author: '共工空间',
    kind: 'user',
    body: `本轮由定时任务「${s?.name ?? ''}」（id ${id}）触发。任务不再需要时，可用 gonggong 的 schedule_delete 删除它。`,
    at,
    attachments: [],
  }
}

const contextFilter = (where: SQL | undefined) =>
  and(
    where,
    inArray(messages.kind, ['user', 'bot']),
    sql`${messages.meta}->>'command' is null`,
    isNull(messages.recalledAt),
  )

async function countContext(tx: Tx, where: SQL | undefined) {
  const [row] = await tx.select({ n: count() }).from(messages).where(contextFilter(where))
  return row?.n ?? 0
}

/** Humans' messages and bots' final replies; the latest `limit` ones, newest first. */
async function contextMessages(tx: Tx, where: SQL | undefined, limit: number): Promise<ContextMessage[]> {
  const rows = await tx
    .select({
      seq: messages.seq,
      kind: messages.kind,
      body: messages.body,
      meta: messages.meta,
      at: messages.createdAt,
      user: users.name,
      bot: bots.name,
    })
    .from(messages)
    .leftJoin(users, eq(users.id, messages.authorUserId))
    .leftJoin(bots, eq(bots.id, messages.authorBotId))
    .where(contextFilter(where))
    .orderBy(desc(messages.seq))
    .limit(limit)
  return rows.map((r) => ({
    seq: r.seq,
    author: r.user ?? r.bot ?? '',
    kind: r.kind as ContextMessage['kind'],
    body: r.body,
    at: r.at.toISOString(),
    attachments: (r.meta as MessageMeta).attachments ?? [],
  }))
}

function quoteOf(meta: MessageMeta): RunStart['prompt']['quote'] {
  return meta.quote ? { author: meta.quote.who, body: meta.quote.text } : null
}
