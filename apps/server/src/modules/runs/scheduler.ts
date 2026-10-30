import {
  type AgentKind,
  type Approval,
  type ContextMessage,
  type GitProtocol,
  type RunStart,
  type Tier,
  UI_BLOCKS_GUIDE,
} from '@gonggong/protocol'
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
import { feishuHint } from '../agent-tools/feishu.js'
import { pluginHint } from '../agent-tools/plugins.js'
import { runArtifacts } from '../artifacts/service.js'
import { botCatalog, resolveConfig } from '../bots/config.js'
import { publishBot } from '../bots/dto.js'
import { gitIdentity } from '../bots/git.js'
import { runTier } from '../bots/tier.js'
import { boundChat } from '../feishu/mirror.js'
import { effectiveParams } from '../groups/params.js'
import { knowledgeContext } from '../knowledge/context.js'
import { substitute } from '../mcp/secrets.js'
import { enabledMcpServers } from '../mcp/service.js'
import { type MessageMeta, userAuthorName } from '../messages/service.js'
import { runPlugins } from '../plugins/service.js'
import { resolveSecrets } from '../secrets/resolve.js'
import { enabledSkills } from '../skills/service.js'
import { runSyncStart } from '../sync/store.js'
import { sendDueInits, syncHeld, syncOutdated } from '../sync/switch.js'
import { unreadyGroups } from '../workspaces/state.js'
import { fitBudget } from './context-budget.js'
import { publishRuns, type RunRow } from './dto.js'
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
      .select({ run: runs, meta: messages.meta })
      .from(runs)
      .innerJoin(messages, eq(messages.id, runs.triggerMessageId))
      .where(and(eq(runs.botId, botId), inArray(runs.status, WAITING)))
      .orderBy(asc(messages.seq))
    if (!waiting.length) return { out: [], dispatches: [] }
    // A daemon that cannot sync runs its turns unsynced; nothing of force sync holds them.
    const unsynced = syncOutdated(ctx, bot.machineId)
    const held = unsynced ? new Map() : await syncHeld(tx, botId)
    // A continuation (the agent going on by itself after a turn) ends once the group's next turn reaches the daemon.
    const active = await tx
      .select({ groupId: runs.groupId })
      .from(runs)
      .where(and(eq(runs.botId, botId), inArray(runs.status, ACTIVE), isNull(runs.continuationOf)))
    const unready = await unreadyGroups(tx, botId)
    let busy = active.length
    // One conversation per (group, bot): a group's next turn waits for its previous one (spec §8.9).
    const busyGroups = new Set(active.map((r) => r.groupId))
    const groupQueue = new Map<string, number>()
    let position = 0
    const out: RunRow[] = []
    const dispatches: {
      run: RunRow
      machineId: string
      msg: RunStart
      triggerSeq: number
      knowledgeAt: Date | null
      detached: boolean
    }[] = []
    const setRun = async (id: string, patch: Partial<RunRow>) =>
      out.push(...(await tx.update(runs).set(patch).where(eq(runs.id, id)).returning()))
    for (const { run, meta } of waiting) {
      const machineId = bot.machineId && ctx.hub.isOnline(bot.machineId) ? bot.machineId : null
      if (machineId && busyGroups.has(run.groupId)) {
        const n = (groupQueue.get(run.groupId) ?? 0) + 1
        groupQueue.set(run.groupId, n)
        const step = runStep('本群上一轮未结束，排第 {n}', { n })
        if (run.status !== 'queued' || run.step !== step.step)
          await setRun(run.id, { status: 'queued', ...step })
        continue
      }
      // A mode switch, local edits or a held conflict hold new turns until settled (§3.5, F11, F12); the sync engine
      // reschedules then. The merge turn settling a held conflict is the one that goes.
      const hold = machineId && held.get(run.groupId)
      if (hold && !(hold.held && (meta as MessageMeta).syncResolve)) {
        if (run.status !== 'queued' || run.step !== hold.step.step)
          await setRun(run.id, { status: 'queued', ...hold.step })
        continue
      }
      // Dispatch only once the bot's clone / directory is ready; the workspace engine reschedules then.
      if (machineId && unready.has(run.groupId)) {
        if (run.status !== 'queued' || run.step !== WORKSPACE_WAIT.step)
          await setRun(run.id, { status: 'queued', ...WORKSPACE_WAIT })
        continue
      }
      if (machineId && busy < bot.concurrency) {
        const at = ctx.now()
        const start = await buildRunStart(tx, bot, run, !unsynced, at, ctx.hub.features(machineId))
        if (start.settled) out.push(start.settled)
        // Marked running inside the transaction, sent only after it committed: a fast run.done then finds the
        // committed running row, and a rollback never leaves a daemon executing a run the server has queued.
        const [running] = await tx
          .update(runs)
          .set({
            status: 'running',
            step: '',
            startedAt: ctx.now(),
            // A requeued turn's waiting reason is over.
            sync: null,
            ...start.config,
            secrets: start.secrets,
            plugins: start.msg.plugins,
            artifacts: start.msg.artifacts.map((a) => a.id),
            // Known up front so the live round already starts its own session; run.done may refine it.
            newSessionReason: start.msg.resumeSessionId ? null : (start.msg.newSessionReason ?? 'first'),
          })
          .where(eq(runs.id, run.id))
          .returning()
        if (running) {
          busy += 1
          busyGroups.add(run.groupId)
          out.push(running)
          dispatches.push({
            run: running,
            machineId,
            msg: start.msg,
            triggerSeq: start.triggerSeq,
            // An agent command got no knowledge base either.
            knowledgeAt: start.msg.command ? null : at,
            detached: start.detached,
          })
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
  for (const { run, machineId, msg, triggerSeq, knowledgeAt, detached } of changed.dispatches) {
    if (ctx.hub.send(machineId, msg)) {
      // After the send: a cursor advanced for a start that never went out would drop that context for good.
      // A detached (scheduled) turn moves none of the conversation's cursors, nor uses up a pending /new.
      if (!detached)
        await ctx.db
          .update(groupBots)
          .set({
            contextSeq: sql`greatest(${groupBots.contextSeq}, ${triggerSeq})`,
            newSessionReason: null,
            ...(knowledgeAt && { knowledgeAt }),
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
  await publishRuns(ctx, settled)
  if (settled.some((r) => r.status === 'running')) await publishBot(ctx, botId)
  await sendDueInits(ctx, botId)
}

/** Tools left out of a session's list where they cannot work (still refused by the server if called). */
const FEISHU_TOOLS = ['list_feishu_messages', 'feishu_send_card']
const PLUGIN_TOOLS = ['plugin_catalog', 'creation_propose']
const ARTIFACT_TOOLS = ['artifact_checkout']

/** 禁止直推基准分支, for the agent (the daemon also asks the owner before any push to it). */
const branchHint = (base: string) =>
  `本群开启了「禁止直推基准分支」：不要直接提交或推送到基准分支 ${base}。当前在 ${base} 上时，改代码前先新建一个分支（名字不限）；已经在其他分支上就直接在该分支开发、提交并推送，不用另建分支。需要合并时告诉触发人发起合并请求。推送到 ${base} 需要 Bot 主人审批。`

/** The group's extra repos, which the agent's own files may not tell it about (Codex reads no AGENTS.md outside cwd). */
const extraReposHint = (repos: { url: string; branch: string }[], protectBase: boolean) =>
  [
    '本群除主仓库外还有附加仓库，已克隆好并作为附加目录提供给你（目录名即仓库名）：',
    ...repos.map(
      (r) =>
        `- ${r.url
          .replace(/\.git\/?$/, '')
          .split(/[/:]/)
          .at(-1)}：${r.url}（默认分支 ${r.branch}）`,
    ),
    '改动某个附加仓库前，先读它根目录的 AGENTS.md 和 CLAUDE.md（它们不一定会自动加载）；在附加仓库里执行 git 命令要先 cd 到该目录。',
    ...(protectBase ? ['「禁止直推基准分支」对附加仓库同样适用，各以其默认分支为基准。'] : []),
  ].join('\n')

/** `features`: the bot's daemon's (it is online). */
export async function buildRunStart(
  tx: Tx,
  bot: Bot,
  run: RunRow,
  synced: boolean,
  now: Date,
  features: string[],
) {
  // Reads issued together are pipelined on the transaction's connection: one round trip per batch, not per read.
  const [[trigger], [group], [gb], repoRows, [owner], params, catalog, mcpServers, skills, secrets] =
    await Promise.all([
      tx
        .select({
          seq: messages.seq,
          body: messages.body,
          meta: messages.meta,
          at: messages.createdAt,
          author: userAuthorName,
          bot: bots.name,
        })
        .from(messages)
        .leftJoin(users, eq(users.id, messages.authorUserId))
        .leftJoin(bots, eq(bots.id, messages.authorBotId))
        .where(eq(messages.id, run.triggerMessageId)),
      tx
        .select({ name: groups.name, kind: groups.kind, protectBase: groups.protectBase })
        .from(groups)
        .where(eq(groups.id, run.groupId)),
      tx
        .select()
        .from(groupBots)
        .where(and(eq(groupBots.groupId, run.groupId), eq(groupBots.botId, bot.id))),
      tx
        .select()
        .from(groupRepos)
        .where(eq(groupRepos.groupId, run.groupId))
        .orderBy(asc(groupRepos.createdAt)),
      tx.select({ protocol: users.gitProtocol }).from(users).where(eq(users.id, bot.ownerId)),
      effectiveParams(tx, run.groupId),
      botCatalog(tx, bot),
      enabledMcpServers(tx, run.groupId),
      enabledSkills(tx, run.groupId),
      resolveSecrets(tx, { groupId: run.groupId, botId: bot.id, originUserId: run.originUserId }, now),
    ])
  if (!trigger || !gb || !group) throw new Error(`run ${run.id} lost its trigger message or group membership`)
  const repo = repoRows.find((r) => r.isPrimary)
  const extras = repo ? repoRows.filter((r) => !r.isPrimary) : []
  const protocol = (owner?.protocol ?? 'auto') as GitProtocol
  const meta = trigger.meta as MessageMeta
  const at = trigger.at.toISOString()
  // An agent command carries no group context, so it leaves the context cursor where it was.
  const command = meta.agentCommand ?? null
  const since = and(
    eq(messages.groupId, run.groupId),
    gt(messages.seq, gb.contextSeq),
    lt(messages.seq, trigger.seq),
    or(isNull(messages.authorBotId), ne(messages.authorBotId, bot.id)),
  )
  // A scheduled turn runs in a session of its own and leaves the group's conversation as it was (see detached).
  const detached = !!meta.scheduleOf
  // A /new request wins over any session id a still-running turn reported after the request.
  const resumeSessionId = detached || gb.newSessionReason ? null : gb.sessionId
  const [recent, replay, interrupted, feishu, relay, scheduled, tier, sync, kb, plugins, hosted] =
    await Promise.all([
      // Older messages stay out of the prompt; the agent reads them with the gonggong tools (plan C1).
      command ? null : contextMessages(tx, since, params.contextInlineTokens),
      resumeSessionId && !command
        ? contextMessages(
            tx,
            and(eq(messages.groupId, run.groupId), lt(messages.seq, trigger.seq)),
            params.sessionReplayTokens,
          )
        : null,
      interruptNote(tx, run, at),
      boundChat(tx, run.groupId),
      run.parentRunId ? relayNote(tx, run.parentRunId, at) : [],
      meta.scheduleOf ? scheduleNote(tx, meta.scheduleOf, at) : null,
      runTier(tx, (gb.tier ?? bot.tier) as Tier),
      synced ? runSyncStart(tx, run.groupId, bot.id, meta.syncResolve?.decisions ?? null) : null,
      // A resumed session that already got the knowledge base only hears what changed since.
      command ? null : knowledgeContext(tx, run.groupId, bot.id, resumeSessionId ? gb.knowledgeAt : null),
      params.pluginsEnabled && bot.machineId
        ? runPlugins(tx, run.groupId, bot, bot.machineId, features, secrets.env)
        : [],
      // Only daemons that check artifacts out and upload them get any (old ones keep publishing with preview_static).
      features.includes('artifacts') && !command ? runArtifacts(tx, run.groupId, bot.id, meta) : null,
    ])
  const context = recent?.kept.reverse() ?? []
  const fallbackContext = replay?.kept.reverse() ?? []
  const omitted = !recent || recent.complete ? 0 : (await countContext(tx, since)) - context.length
  const config = resolveConfig(catalog, meta.runOptions?.[bot.id], gb, bot)
  const note = [
    ...(interrupted ? [interrupted.note] : []),
    ...relay,
    ...(scheduled ? [scheduled] : []),
    ...(hosted?.note
      ? [{ seq: 0, author: '共工空间', kind: 'user' as const, body: hosted.note, at, attachments: [] }]
      : []),
  ]
  const kbNote = (body: string | null | undefined): ContextMessage[] =>
    body ? [{ seq: 0, author: '共工空间', kind: 'user', body, at, attachments: [] }] : []
  // A DM's single chat with the bot app is synced whole: nothing to read from Feishu.
  const feishuHinted = group.kind === 'group' && feishu
  const kbNow = kbNote(resumeSessionId && gb.knowledgeAt ? kb?.changes : kb?.full)
  const protectBase = group.protectBase && !!repo
  const msg: RunStart = {
    t: 'run.start',
    runId: run.id,
    groupId: run.groupId,
    groupName: group.name,
    bot: {
      id: bot.id,
      name: bot.name,
      agentKind: bot.agentKind as AgentKind,
      systemPrompt: [
        ...(feishuHinted ? [feishuHint(feishuHinted.syncAll)] : []),
        ...(protectBase && repo ? [branchHint(repo.baseBranch)] : []),
        ...(extras.length
          ? [
              extraReposHint(
                extras.map((r) => ({ url: r.url, branch: r.baseBranch })),
                protectBase,
              ),
            ]
          : []),
        ...(command ? [] : [UI_BLOCKS_GUIDE]),
        ...(command || !plugins.length ? [] : [pluginHint(plugins.map((p) => p.name))]),
        bot.systemPrompt,
      ]
        .filter((s) => s.trim())
        .join('\n\n'),
      tier,
      approval: bot.approval as Approval,
      allowlist: bot.allowlist,
      alwaysAllow: bot.alwaysAllow,
      git: gitIdentity(bot),
      agentSettings: bot.agentSettings,
      ...config,
    },
    workspace: {
      repo: repo
        ? {
            id: repo.id,
            url: repo.url,
            branch: repo.baseBranch,
            protocol,
          }
        : null,
      cdPath: gb.cdPath,
      protectBase,
      extraDirs: gb.extraDirs,
      extraRepos: extras.map((r) => ({ id: r.id, url: r.url, branch: r.baseBranch, protocol })),
    },
    resumeSessionId,
    newSessionReason: detached ? 'schedule' : gb.newSessionReason,
    prompt: {
      text: meta.artifactNote ? `${trigger.body}\n\n${meta.artifactNote}` : trigger.body,
      triggeredBy: trigger.author ?? trigger.bot ?? '',
      context: [...kbNow, ...context, ...note],
      omitted,
      fallbackContext: resumeSessionId ? [...kbNote(kb?.full), ...fallbackContext, ...note] : [],
      attachments: meta.attachments ?? [],
      quote: quoteOf(meta),
    },
    // A server missing a secret's value is left out of this run (plan 团队密钥-方案 §8).
    mcpServers: mcpServers.flatMap((c) => substitute(c, secrets.env) ?? []),
    skills: skills.map(({ name, versionId, digest }) => ({ name, versionId, digest })),
    plugins,
    // An agent command may open the session, so it hides nothing.
    hiddenTools: command
      ? []
      : [
          ...(feishu ? [] : FEISHU_TOOLS),
          ...(plugins.length ? [] : PLUGIN_TOOLS),
          ...(features.includes('artifacts') ? [] : ARTIFACT_TOOLS),
        ],
    command,
    sync,
    artifacts: hosted?.refs ?? [],
    artifactExclude: hosted?.exclude ?? [],
    env: secrets.env,
  }
  return {
    msg,
    config,
    secrets: secrets.secrets,
    triggerSeq: command ? 0 : trigger.seq,
    settled: interrupted?.settled,
    detached,
  }
}

/** A relay hop whose previous hop's changes did not make it into a version is told so (F10); the chain goes on. */
async function relayNote(tx: Tx, parentRunId: string, at: string): Promise<ContextMessage[]> {
  const [parent] = await tx.select({ sync: runs.sync }).from(runs).where(eq(runs.id, parentRunId))
  const s = parent?.sync
  const why =
    s?.outcome === 'error'
      ? `its submit failed (${s.reason})`
      : s?.outcome === 'held'
        ? `${s.files} file(s) conflict with a newer version and wait for a decision`
        : null
  if (!why) return []
  // Agent-facing: not translated.
  const body = `The previous relay hop's changes were not synced: ${why}. They are not in your workspace; check before relying on them.`
  return [{ seq: 0, author: '共工空间', kind: 'user', body, at, attachments: [] }]
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

/** Rows read per query, and at most this many in all: a huge backlog is only counted in `omitted`. */
const CONTEXT_PAGE = 100
const CONTEXT_MAX_ROWS = 500

/** Humans' messages and bots' final replies: the latest ones within `budget` tokens, newest first. */
async function contextMessages(tx: Tx, where: SQL | undefined, budget: number) {
  const rows: ContextMessage[] = []
  for (let before: number | null = null; rows.length < CONTEXT_MAX_ROWS; ) {
    const page = await contextPage(tx, before === null ? where : and(where, lt(messages.seq, before)))
    rows.push(...page)
    const fit = fitBudget(rows, budget)
    if (!fit.complete || page.length < CONTEXT_PAGE) return fit
    before = page[page.length - 1]?.seq ?? null
  }
  return { ...fitBudget(rows, budget), complete: false }
}

async function contextPage(tx: Tx, where: SQL | undefined): Promise<ContextMessage[]> {
  const rows = await tx
    .select({
      seq: messages.seq,
      kind: messages.kind,
      body: messages.body,
      meta: messages.meta,
      at: messages.createdAt,
      user: userAuthorName,
      bot: bots.name,
    })
    .from(messages)
    .leftJoin(users, eq(users.id, messages.authorUserId))
    .leftJoin(bots, eq(bots.id, messages.authorBotId))
    .where(contextFilter(where))
    .orderBy(desc(messages.seq))
    .limit(CONTEXT_PAGE)
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
