import {
  type Answer,
  type Attachment,
  GONGGONG_TOOLS,
  type GonggongToolName,
  type Question,
} from '@gonggong/protocol'
import { and, asc, desc, eq, gt, gte, ilike, inArray, isNull, lt, lte, or, type SQL, sql } from 'drizzle-orm'
import { z } from 'zod'
import type { Ctx } from '../../context.js'
import {
  bots,
  groupBots,
  groupMembers,
  groupRepos,
  groups,
  messages,
  questionSets,
  runs,
  users,
} from '../../db/schema.js'
import { isUuid } from '../../lib/ids.js'
import { open } from '../../lib/seal.js'
import { likePattern, patchPaths, snippet } from '../../lib/text.js'
import { groupParams } from '../groups/params.js'
import { activeBots } from '../groups/service.js'
import type { MessageMeta } from '../messages/service.js'
import { closeOwnPreview, exposeGui, exposePreview } from '../previews/service.js'

type Run = typeof runs.$inferSelect
type Group = typeof groups.$inferSelect
type Args<N extends GonggongToolName> = z.infer<(typeof GONGGONG_TOOLS)[N]['input']>
type Scope = { run: Run; groups: Map<string, Group>; pick: (id?: string) => Group }
/** `groups`: whose content the call returned, audited when not the run's own (plan C9). */
export type ToolOutput = { text: string; attachments?: Attachment[]; groups: string[] }

/** A failure the agent can act on: returned as an `isError` tool result, not an HTTP error. */
export class ToolError extends Error {}
export const refuse = (message: string): never => {
  throw new ToolError(message)
}

const BODY_MAX = 2000
const PATCH_MAX = 20_000
const TYPE: Record<Question['type'], string> = {
  single: '单选',
  multi: '多选',
  yesno: '是/否',
  text: '自由文本',
}
const STATE: Record<string, string> = { pending: '等待回答', expired: '超时未答', void: '已作废' }
const MODE: Record<string, string> = { partition: '分区模式', force: '强制同步' }

const time = (d: Date) => d.toISOString().slice(0, 16).replace('T', ' ')
const clip = (s: string, max = BODY_MAX) =>
  s.length > max ? `${s.slice(0, max)}…（已截断，共 ${s.length} 字）` : s

/** The run's own conversation plus the other live groups its bot is in; private chats only from inside (plan C4). */
async function scopeOf(ctx: Ctx, run: Run): Promise<Scope> {
  const joined = ctx.db
    .select({ id: groupBots.groupId })
    .from(groupBots)
    .where(and(eq(groupBots.botId, run.botId), isNull(groupBots.removedAt)))
  const rows = await ctx.db
    .select()
    .from(groups)
    .where(
      or(
        eq(groups.id, run.groupId),
        and(inArray(groups.id, joined), isNull(groups.archivedAt), eq(groups.kind, 'group')),
      ),
    )
    .orderBy(asc(groups.createdAt))
  const map = new Map(rows.map((g) => [g.id, g]))
  const pick = (id = run.groupId) => map.get(id) ?? refuse(`无权读取该群或群不存在：${id}`)
  return { run, groups: map, pick }
}

const date = (s: string) => {
  const d = new Date(s)
  return Number.isNaN(d.getTime()) ? refuse(`时间格式无效：${s}`) : d
}

/** Humans' messages and bots' final replies (what agents get as context), with the common filters. */
function messageRows(
  ctx: Ctx,
  where: SQL | undefined,
  f: { author?: string; since?: string; until?: string },
) {
  return ctx.db
    .select({
      seq: messages.seq,
      groupId: messages.groupId,
      body: messages.body,
      meta: messages.meta,
      at: messages.createdAt,
      author: sql<string>`coalesce(${users.name}, ${bots.name}, '')`,
    })
    .from(messages)
    .leftJoin(users, eq(users.id, messages.authorUserId))
    .leftJoin(bots, eq(bots.id, messages.authorBotId))
    .where(
      and(
        where,
        inArray(messages.kind, ['user', 'bot']),
        sql`${messages.meta}->>'command' is null`,
        isNull(messages.recalledAt),
        f.author
          ? or(ilike(users.name, likePattern(f.author)), ilike(bots.name, likePattern(f.author)))
          : undefined,
        f.since ? gte(messages.createdAt, date(f.since)) : undefined,
        f.until ? lte(messages.createdAt, date(f.until)) : undefined,
      ),
    )
}
type MessageRow = Awaited<ReturnType<typeof messageRows>>[number]

const attachmentsOf = (m: Pick<MessageRow, 'meta'>) => (m.meta as MessageMeta).attachments ?? []

function line(m: MessageRow) {
  const files = attachmentsOf(m).map((a) => a.name)
  return `[#${m.seq} ${time(m.at)}] ${m.author}: ${clip(m.body)}${files.length ? `（附件：${files.join('、')}）` : ''}`
}

async function listMessages(ctx: Ctx, s: Scope, a: Args<'list_messages'>): Promise<ToolOutput> {
  const g = s.pick(a.group)
  const limit = a.limit ?? 20
  const rows = (where?: SQL) => messageRows(ctx, and(eq(messages.groupId, g.id), where), a)
  let list: MessageRow[]
  if (a.after !== undefined)
    list = await rows(gt(messages.seq, a.after)).orderBy(asc(messages.seq)).limit(limit)
  else if (a.around !== undefined) {
    const older = await rows(lte(messages.seq, a.around))
      .orderBy(desc(messages.seq))
      .limit(Math.floor((limit - 1) / 2) + 1)
    const newer = await rows(gt(messages.seq, a.around))
      .orderBy(asc(messages.seq))
      .limit(limit - older.length)
    list = [...older.reverse(), ...newer]
  } else
    list = (
      await rows(a.before === undefined ? undefined : lt(messages.seq, a.before))
        .orderBy(desc(messages.seq))
        .limit(limit)
    ).reverse()
  const first = list[0]
  const last = list.at(-1)
  if (!first || !last) return { text: '没有符合条件的消息', groups: [] }
  const out = [`群「${g.name}」#${first.seq}–#${last.seq}（${list.length} 条）`, ...list.map(line)]
  if (list.length === limit && a.around === undefined)
    out.push(a.after === undefined ? `更早：before=${first.seq}` : `更新：after=${last.seq}`)
  return { text: out.join('\n'), groups: [g.id] }
}

async function searchMessages(ctx: Ctx, s: Scope, a: Args<'search_messages'>): Promise<ToolOutput> {
  const targets = a.group === 'all' ? [...s.groups.values()] : [s.pick(a.group)]
  const list = await messageRows(
    ctx,
    and(
      inArray(
        messages.groupId,
        targets.map((g) => g.id),
      ),
      ilike(messages.body, likePattern(a.query)),
    ),
    a,
  )
    .orderBy(desc(messages.seq))
    .limit(a.limit ?? 10)
  if (!list.length) return { text: `没有命中「${a.query}」的消息`, groups: [] }
  const lines = list.map(
    (m) =>
      `[#${m.seq} ${time(m.at)}] ${s.groups.get(m.groupId)?.name} · ${m.author}: ${snippet(m.body, a.query)}`,
  )
  return {
    text: [`命中「${a.query}」${list.length} 条（从新到旧）`, ...lines].join('\n'),
    groups: [...new Set(list.map((m) => m.groupId))],
  }
}

async function getGroupInfo(ctx: Ctx, s: Scope, a: Args<'get_group_info'>): Promise<ToolOutput> {
  const g = s.pick(a.group)
  const [repo] = await ctx.db
    .select()
    .from(groupRepos)
    .where(eq(groupRepos.groupId, g.id))
    .orderBy(asc(groupRepos.createdAt))
    .limit(1)
  const members = await ctx.db
    .select({ name: users.name, isAdmin: groupMembers.isAdmin })
    .from(groupMembers)
    .innerJoin(users, eq(users.id, groupMembers.userId))
    .where(eq(groupMembers.groupId, g.id))
    .orderBy(asc(groupMembers.joinedAt))
  const botRows = await ctx.db
    .select({ bot: bots, owner: users.name })
    .from(groupBots)
    .innerJoin(bots, eq(bots.id, groupBots.botId))
    .innerJoin(users, eq(users.id, bots.ownerId))
    .where(and(eq(groupBots.groupId, g.id), isNull(groupBots.removedAt)))
    .orderBy(asc(groupBots.addedAt))
  const others = [...s.groups.values()].filter((x) => x.id !== g.id)
  const out = [
    `群「${g.name}」（${g.kind === 'dm' ? '私聊' : '群聊'} · ${MODE[g.mode] ?? g.mode}）`,
    g.notice ? `公告：${g.notice}` : null,
    repo ? `仓库：${repo.url}（${repo.baseBranch}）` : '仓库：未绑定',
    '成员：',
    ...members.map((m) => `- ${m.name}${m.isAdmin ? '（管理员）' : ''}`),
    'bot：',
    ...botRows.map(({ bot, owner }) => {
      const online = bot.machineId && ctx.hub.isOnline(bot.machineId)
      const self = bot.id === s.run.botId ? '（你）' : ''
      return `- ${bot.name}${self} · 主人 ${owner} · ${bot.agentKind} · ${online ? '在线' : '离线'}`
    }),
    ...(others.length ? ['其他可读的群：', ...others.map((x) => `- ${x.name}（id: ${x.id}）`)] : []),
  ]
  return { text: out.filter((l) => l !== null).join('\n'), groups: [g.id] }
}

type QuestionSet = typeof questionSets.$inferSelect

function questionBlock(prefix: string, set: QuestionSet, answeredBy: string | null) {
  const answers = set.answers as Answer[] | null
  const head =
    set.status === 'answered'
      ? `${prefix} · ${answeredBy ?? '群成员'} 的回答：`
      : `${prefix}（${STATE[set.status] ?? set.status}）：`
  const lines = (set.questions as Question[]).map((q, i) => {
    const base = `${i + 1}. ${q.title}（${TYPE[q.type]}）`
    if (!answers) return base
    const a = answers.find((x) => x.questionId === q.id)
    const parts = (a?.choices ?? []).map((c) => q.options[c]).filter((o) => o !== undefined)
    const text = a?.text?.trim()
    if (text) parts.push(q.type === 'text' ? text : `其他：${text}`)
    return `${base}→ ${parts.join('、') || '（未作答）'}`
  })
  return [head, ...lines].join('\n')
}

function questionRows(ctx: Ctx, where: SQL) {
  return ctx.db
    .select({ set: questionSets, bot: bots.name, answeredBy: users.name })
    .from(questionSets)
    .innerJoin(runs, eq(runs.id, questionSets.runId))
    .innerJoin(bots, eq(bots.id, runs.botId))
    .leftJoin(users, eq(users.id, questionSets.answeredBy))
    .where(where)
}

async function getRun(ctx: Ctx, s: Scope, a: Args<'get_run'>): Promise<ToolOutput> {
  const ref = a.run ?? `#${a.message}`
  let runId = a.run
  if (a.message !== undefined) {
    const [m] = await ctx.db
      .select({ runId: messages.runId })
      .from(messages)
      .where(and(eq(messages.seq, a.message), inArray(messages.groupId, [...s.groups.keys()])))
    runId = m?.runId ?? refuse(`#${a.message} 不是 Bot 的运行回复`)
  }
  const [r] = runId && isUuid(runId) ? await ctx.db.select().from(runs).where(eq(runs.id, runId)) : []
  const group = r && s.groups.get(r.groupId)
  if (!r || !group) return refuse(`找不到该运行：${ref}`)
  const [bot] = await ctx.db.select({ name: bots.name }).from(bots).where(eq(bots.id, r.botId))
  const [trigger] = await messageRows(ctx, eq(messages.id, r.triggerMessageId), {})
  const [reply] = await messageRows(ctx, and(eq(messages.runId, r.id), eq(messages.kind, 'bot')), {})
    .orderBy(desc(messages.seq))
    .limit(1)
  const questions = await questionRows(ctx, eq(questionSets.runId, r.id)).orderBy(asc(questionSets.createdAt))
  const patch = r.patch ? open(r.patch) : null
  const files = patch ? patchPaths(patch) : []
  const usage = r.usage as { totalTokens?: number } | null
  const out = [
    `运行 ${r.id} · ${bot?.name} · 群「${group.name}」`,
    trigger ? `触发（#${trigger.seq}）${trigger.author}: ${clip(trigger.body)}` : null,
    `状态：${r.status}${r.step ? ` · ${r.step}` : ''}`,
    `时间：${time(r.queuedAt)} → ${r.endedAt ? time(r.endedAt) : '进行中'}`,
    r.summary ? `摘要：${r.summary}` : null,
    files.length ? `改动文件：${files.join('、')}` : r.filesChanged ? `改动文件：${r.filesChanged} 个` : null,
    usage?.totalTokens ? `用量：${usage.totalTokens} tokens` : null,
    ...questions.map((q) => questionBlock('提问', q.set, q.answeredBy)),
    reply ? `回复（#${reply.seq}）：${clip(reply.body)}` : null,
  ]
  if (a.include_patch)
    out.push(
      patch
        ? `diff：\n${clip(patch, PATCH_MAX)}`
        : r.purgedAt
          ? '运行过程已过期，diff 已清理'
          : '本轮没有 diff',
    )
  return { text: out.filter((l) => l !== null).join('\n'), groups: [r.groupId] }
}

async function listQuestions(ctx: Ctx, s: Scope, a: Args<'list_questions'>): Promise<ToolOutput> {
  const g = s.pick(a.group)
  const rows = await questionRows(ctx, eq(runs.groupId, g.id))
    .orderBy(desc(questionSets.createdAt))
    .limit(a.limit ?? 10)
  if (!rows.length) return { text: '暂无提问', groups: [] }
  const blocks = rows.map(
    (q) => `[${time(q.set.createdAt)}] ${questionBlock(`${q.bot} 提问`, q.set, q.answeredBy)}`,
  )
  return { text: blocks.join('\n\n'), groups: [g.id] }
}

async function fetchAttachments(ctx: Ctx, s: Scope, a: Args<'fetch_attachments'>): Promise<ToolOutput> {
  const [m] = await ctx.db
    .select({ groupId: messages.groupId, meta: messages.meta })
    .from(messages)
    .where(and(eq(messages.seq, a.message), inArray(messages.groupId, [...s.groups.keys()])))
  if (!m) return refuse(`找不到消息 #${a.message}`)
  const attachments = attachmentsOf(m)
  if (!attachments.length) return refuse(`#${a.message} 没有附件`)
  return { text: `#${a.message} 的附件：`, attachments, groups: [m.groupId] }
}

/** Registers the next hop; it starts once this run completes (spec §4.6), so the reply is in its context. */
async function handOff(ctx: Ctx, s: Scope, a: Args<'hand_off'>): Promise<ToolOutput> {
  const { run } = s
  const max = (await groupParams(ctx, s.pick())).chainMaxHops
  if (run.hop >= max) refuse(`接力已达上限（${max} 跳），不能再交给其他 Bot；请在回复里说明，由群成员决定`)
  const members = await activeBots(ctx, run.groupId)
  const name = a.bot.trim().replace(/^@/, '')
  const bot = members.find((b) => b.name === name)
  if (bot?.id === run.botId) refuse('不能交给自己')
  if (!bot) {
    const others = members.filter((b) => b.id !== run.botId).map((b) => b.name)
    return refuse(`本群没有叫「${name}」的 Bot，可接手的有：${others.join('、') || '无'}`)
  }
  const task = a.task.trim()
  const handoffs = [...run.handoffs.filter((h) => h.botId !== bot.id), { botId: bot.id, task }]
  await ctx.db.update(runs).set({ handoffs }).where(eq(runs.id, run.id))
  return {
    text: `已登记：本轮结束后由「${bot.name}」接手（任务：${task}）。回复里不需要再 @ 它。`,
    groups: [],
  }
}

const TOOLS: { [N in GonggongToolName]: (ctx: Ctx, s: Scope, a: Args<N>) => Promise<ToolOutput> } = {
  list_messages: listMessages,
  search_messages: searchMessages,
  get_group_info: getGroupInfo,
  get_run: getRun,
  list_questions: listQuestions,
  fetch_attachments: fetchAttachments,
  preview_expose: async (ctx, s, a) => ({ text: await exposePreview(ctx, s.run, a), groups: [] }),
  preview_gui: async (ctx, s, a) => ({ text: await exposeGui(ctx, s.run, a), groups: [] }),
  preview_close: async (ctx, s, a) => ({ text: await closeOwnPreview(ctx, s.run, a.preview), groups: [] }),
  hand_off: handOff,
}

export async function callTool(
  ctx: Ctx,
  run: Run,
  name: GonggongToolName,
  args: unknown,
): Promise<ToolOutput> {
  const parsed = GONGGONG_TOOLS[name].input.safeParse(args ?? {})
  if (!parsed.success) return refuse(`参数无效：${z.prettifyError(parsed.error)}`)
  const tool = TOOLS[name] as (ctx: Ctx, s: Scope, a: unknown) => Promise<ToolOutput>
  return tool(ctx, await scopeOf(ctx, run), parsed.data)
}
