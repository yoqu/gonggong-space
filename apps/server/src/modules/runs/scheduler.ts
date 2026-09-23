import type { AgentKind, ContextMessage, RunStart, Tier } from '@aiws/protocol'
import { and, asc, desc, eq, gt, inArray, isNull, lt, ne, or, type SQL, sql } from 'drizzle-orm'
import type { Ctx } from '../../context.js'
import type { Db } from '../../db/client.js'
import { bots, groupBots, groupRepos, messages, runs, users } from '../../db/schema.js'
import { sysParams } from '../admin/params.js'
import { publishBot } from '../bots/dto.js'
import { enabledMcpServers } from '../mcp/routes.js'
import type { MessageMeta } from '../messages/service.js'
import { unreadyRepoGroups } from '../workspaces/state.js'
import { publishRun, type RunRow } from './dto.js'
import { interruptNote } from './stop.js'

type Tx = Parameters<Parameters<Db['transaction']>[0]>[0]
type Bot = typeof bots.$inferSelect

const WAITING = ['queued', 'offline_wait']
/** Runs holding one of the bot's concurrency slots. */
const ACTIVE = ['running', 'awaiting_approval', 'awaiting_answer']
const OFFLINE = { status: 'offline_wait', step: 'bot 离线，等待上线', startedAt: null }
const WORKSPACE_WAIT = '工作区准备中'

/**
 * Server-authoritative scheduling (plan D22): dispatches the bot's waiting runs in trigger order while its machine
 * is online and it has free slots; the rest wait as queued (with position) or offline_wait.
 */
export async function schedule(ctx: Ctx, botId: string) {
  const changed = await ctx.db.transaction(async (tx) => {
    await tx.execute(sql`select pg_advisory_xact_lock(hashtext(${botId}))`)
    const [bot] = await tx.select().from(bots).where(eq(bots.id, botId))
    if (!bot) return []
    const waiting = await tx
      .select({ run: runs })
      .from(runs)
      .innerJoin(messages, eq(messages.id, runs.triggerMessageId))
      .where(and(eq(runs.botId, botId), inArray(runs.status, WAITING)))
      .orderBy(asc(messages.seq))
    if (!waiting.length) return []
    const active = await tx
      .select({ groupId: runs.groupId })
      .from(runs)
      .where(and(eq(runs.botId, botId), inArray(runs.status, ACTIVE)))
    const unready = await unreadyRepoGroups(tx, botId)
    let busy = active.length
    // One conversation per (group, bot): a group's next turn waits for its previous one (spec §8.9).
    const busyGroups = new Set(active.map((r) => r.groupId))
    const groupQueue = new Map<string, number>()
    let position = 0
    const out: RunRow[] = []
    const setRun = async (id: string, patch: Partial<RunRow>) =>
      out.push(...(await tx.update(runs).set(patch).where(eq(runs.id, id)).returning()))
    for (const { run } of waiting) {
      const machineId = bot.machineId && ctx.hub.isOnline(bot.machineId) ? bot.machineId : null
      if (machineId && busyGroups.has(run.groupId)) {
        const n = (groupQueue.get(run.groupId) ?? 0) + 1
        groupQueue.set(run.groupId, n)
        const step = `本群上一轮未结束，排第 ${n}`
        if (run.status !== 'queued' || run.step !== step) await setRun(run.id, { status: 'queued', step })
        continue
      }
      // Repo groups dispatch only once the bot's clone is ready; the workspace engine reschedules then.
      if (machineId && unready.has(run.groupId)) {
        if (run.status !== 'queued' || run.step !== WORKSPACE_WAIT)
          await setRun(run.id, { status: 'queued', step: WORKSPACE_WAIT })
        continue
      }
      if (machineId && busy < bot.concurrency) {
        const start = await buildRunStart(tx, bot, run)
        if (start.settled) out.push(start.settled)
        // Mark running before sending: a fast run.done then waits on this row lock instead of missing the run.
        const [running] = await tx
          .update(runs)
          .set({ status: 'running', step: '', startedAt: ctx.now() })
          .where(eq(runs.id, run.id))
          .returning()
        if (running && ctx.hub.send(machineId, start.msg)) {
          busy += 1
          busyGroups.add(run.groupId)
          await tx
            .update(groupBots)
            .set({
              contextSeq: sql`greatest(${groupBots.contextSeq}, ${start.triggerSeq})`,
              newSessionReason: null,
            })
            .where(and(eq(groupBots.groupId, run.groupId), eq(groupBots.botId, bot.id)))
          out.push(running)
        } else await setRun(run.id, OFFLINE)
        continue
      }
      const next = machineId ? { status: 'queued', step: `该 bot 忙，排第 ${++position}` } : OFFLINE
      if (next.status !== run.status || next.step !== run.step) await setRun(run.id, next)
    }
    return out
  })
  for (const run of changed) await publishRun(ctx, run)
  if (changed.some((r) => r.status === 'running')) await publishBot(ctx, botId)
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
  if (!trigger || !gb) throw new Error(`run ${run.id} lost its trigger message or group membership`)
  const context = await contextMessages(
    tx,
    and(
      eq(messages.groupId, run.groupId),
      gt(messages.seq, gb.contextSeq),
      lt(messages.seq, trigger.seq),
      or(isNull(messages.authorBotId), ne(messages.authorBotId, bot.id)),
    ),
  )
  // A /new request wins over any session id a still-running turn reported after the request.
  const resumeSessionId = gb.newSessionReason ? null : gb.sessionId
  const fallbackContext = resumeSessionId
    ? (
        await contextMessages(
          tx,
          and(eq(messages.groupId, run.groupId), lt(messages.seq, trigger.seq)),
          (
            await sysParams(tx)
          ).sessionReplayCount,
        )
      ).reverse()
    : []
  const interrupted = await interruptNote(tx, run, trigger.at.toISOString())
  const note = interrupted ? [interrupted.note] : []
  const msg: RunStart = {
    t: 'run.start',
    runId: run.id,
    groupId: run.groupId,
    bot: {
      id: bot.id,
      name: bot.name,
      agentKind: bot.agentKind as AgentKind,
      systemPrompt: bot.systemPrompt,
      tier: bot.tier as Tier,
    },
    workspace: {
      repo: repo ? { id: repo.id, url: repo.url, branch: repo.baseBranch } : null,
      cdPath: gb.cdPath,
    },
    resumeSessionId,
    newSessionReason: gb.newSessionReason,
    prompt: {
      text: trigger.body,
      triggeredBy: trigger.author ?? trigger.bot ?? '',
      context: [...context, ...note],
      fallbackContext: resumeSessionId ? [...fallbackContext, ...note] : [],
      attachments: (trigger.meta as MessageMeta).attachments ?? [],
      quote: quoteOf(trigger.meta as MessageMeta),
    },
    mcpServers: await enabledMcpServers(tx),
  }
  return { msg, triggerSeq: trigger.seq, settled: interrupted?.settled }
}

/** Humans' messages and bots' final replies; `limit` takes the latest ones (newest first). */
async function contextMessages(tx: Tx, where: SQL | undefined, limit?: number): Promise<ContextMessage[]> {
  const q = tx
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
    .where(and(where, inArray(messages.kind, ['user', 'bot']), sql`${messages.meta}->>'command' is null`))
  const rows = await (limit ? q.orderBy(desc(messages.seq)).limit(limit) : q.orderBy(asc(messages.seq)))
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
