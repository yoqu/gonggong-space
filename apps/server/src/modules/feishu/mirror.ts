import type { PermissionOption, Question, RunStatus } from '@gonggong/protocol'
import { TERMINAL_RUN_STATUS } from '@gonggong/protocol'
import { and, asc, eq, isNull } from 'drizzle-orm'
import type { Ctx } from '../../context.js'
import type { Db } from '../../db/client.js'
import {
  approvals,
  bots,
  feishuChats,
  feishuIdentities,
  feishuMessageLinks,
  messages,
  questionSets,
  runs,
  users,
} from '../../db/schema.js'
import { botApp, mainApp } from './apps.js'
import { approvalCard, questionCard, runCard } from './cards.js'
import { type FeishuBody, FeishuError } from './client.js'
import { credsOf, type FeishuAppRow } from './gateway.js'
import { publicUrl, userToken } from './identity.js'

/** Run cards change at most this often; the final state is never held back. */
export const CARD_THROTTLE_MS = 2000

type Row = typeof runs.$inferSelect
type Link = typeof feishuMessageLinks.$inferSelect

interface Mirror {
  /** Per group: Feishu calls of a chat stay in order (a run card replies to the mirrored @ sent before it). */
  queues: Map<string, Promise<void>>
  /** Card JSON last sent per Feishu message, so unchanged state is not re-sent. */
  rendered: Map<string, string>
  /** Per run: when its card last changed, and the deferred update if one is due. */
  throttle: Map<string, { at: number; timer?: NodeJS.Timeout }>
}

const mirrors = new WeakMap<Ctx, Mirror>()

function state(ctx: Ctx) {
  let m = mirrors.get(ctx)
  if (!m) {
    m = { queues: new Map(), rendered: new Map(), throttle: new Map() }
    mirrors.set(ctx, m)
  }
  return m
}

/** Feishu is best effort: a failed call is logged and never fails the 共工 side. */
function enqueue(ctx: Ctx, groupId: string, task: () => Promise<void>) {
  const { queues } = state(ctx)
  const next = (queues.get(groupId) ?? Promise.resolve()).then(task).catch((err) => {
    console.error('feishu mirror:', err instanceof FeishuError ? `${err.code} ${err.message}` : err)
  })
  queues.set(groupId, next)
  void next.then(() => {
    if (queues.get(groupId) === next) queues.delete(groupId)
  })
}

/** Resolves once every queued Feishu call has run (tests, shutdown). */
export async function feishuIdle(ctx: Ctx) {
  const { queues } = state(ctx)
  while (queues.size) await Promise.all(queues.values())
}

/** Drops deferred card updates (app close). */
export function stopFeishuMirror(ctx: Ctx) {
  for (const t of state(ctx).throttle.values()) clearTimeout(t.timer)
  state(ctx).throttle.clear()
}

/** The Feishu chat bound to the group, if any (plan §2.5). */
export async function boundChat(db: Pick<Db, 'select'>, groupId: string) {
  const [row] = await db
    .select()
    .from(feishuChats)
    .where(and(eq(feishuChats.groupId, groupId), isNull(feishuChats.unboundAt)))
  return row
}

/** The 共工 account behind a Feishu user (by union_id), if linked and enabled. */
export async function userOfFeishu(ctx: Ctx, unionId: string | undefined) {
  if (!unionId) return undefined
  const [row] = await ctx.db
    .select({ id: users.id, name: users.name })
    .from(feishuIdentities)
    .innerJoin(users, eq(users.id, feishuIdentities.userId))
    .where(and(eq(feishuIdentities.unionId, unionId), isNull(users.disabledAt)))
  return row
}

export async function linkOf(ctx: Ctx, feishuMessageId: string) {
  const [row] = await ctx.db
    .select()
    .from(feishuMessageLinks)
    .where(eq(feishuMessageLinks.feishuMessageId, feishuMessageId))
  return row
}

/** The app speaking for a bot: its own, or the main app until it has one. */
async function appOfBot(ctx: Ctx, botId: string) {
  return (await botApp(ctx, botId)) ?? (await mainApp(ctx))
}

const textBody = (text: string): FeishuBody => ({ msgType: 'text', content: JSON.stringify({ text }) })
const cardBody = (card: object): FeishuBody => ({ msgType: 'interactive', content: JSON.stringify(card) })

/**
 * A web message that @-s bots goes to the bound chat through the main app: as its author when they authorized
 * Feishu, otherwise as 「名字：…」.
 */
export async function mirrorUserMessage(
  ctx: Ctx,
  message: typeof messages.$inferSelect,
  author: { id: string; name: string },
) {
  const chat = await boundChat(ctx.db, message.groupId)
  if (!chat) return
  enqueue(ctx, message.groupId, async () => {
    const main = await mainApp(ctx)
    if (!main) return
    const app = credsOf(main)
    const token = await userToken(ctx, author.id)
    let sent: { messageId: string } | null = null
    if (token)
      sent = await ctx.feishu.api
        .send(app, chat.chatId, textBody(message.body), { userToken: token })
        .catch((err) => {
          if (!(err instanceof FeishuError)) throw err
          return null
        })
    const byUser = !!sent
    sent ??= await ctx.feishu.api.send(app, chat.chatId, textBody(`${author.name}：${message.body}`))
    await ctx.db.insert(feishuMessageLinks).values({
      feishuMessageId: sent.messageId,
      chatId: chat.chatId,
      appId: main.appId,
      direction: 'out',
      kind: 'message',
      messageId: message.id,
      ...(byUser && { refId: author.id }),
    })
  })
}

/** Out links sent as a user keep that user in `refId`: their token is needed to recall or edit it. */
async function asSender(ctx: Ctx, link: Link) {
  const main = await mainApp(ctx)
  if (!main) return null
  const token = link.refId ? await userToken(ctx, link.refId) : undefined
  return { app: credsOf(main), token: token ?? undefined }
}

/** 共工 recall of a mirrored message recalls its Feishu copy (an inbound one is the Feishu user's own). */
export async function mirrorRecall(ctx: Ctx, messageId: string, groupId: string) {
  const [link] = await ctx.db
    .select()
    .from(feishuMessageLinks)
    .where(and(eq(feishuMessageLinks.messageId, messageId), eq(feishuMessageLinks.direction, 'out')))
  if (!link) return
  enqueue(ctx, groupId, async () => {
    const sender = await asSender(ctx, link)
    if (sender) await ctx.feishu.api.recall(sender.app, link.feishuMessageId, sender.token)
  })
}

/** 共工 edit of a mirrored message edits its Feishu copy. */
export async function mirrorEdit(
  ctx: Ctx,
  message: Pick<typeof messages.$inferSelect, 'id' | 'groupId' | 'body'>,
  authorName: string,
) {
  const [link] = await ctx.db
    .select()
    .from(feishuMessageLinks)
    .where(and(eq(feishuMessageLinks.messageId, message.id), eq(feishuMessageLinks.direction, 'out')))
  if (!link) return
  enqueue(ctx, message.groupId, async () => {
    const sender = await asSender(ctx, link)
    if (!sender) return
    const text = link.refId ? message.body : `${authorName}：${message.body}`
    await ctx.feishu.api.edit(sender.app, link.feishuMessageId, textBody(text), sender.token)
  })
}

/** Called on every run change (publishRun): mirrors its card, question and approval cards to the bound chat. */
export async function mirrorRun(ctx: Ctx, run: Row) {
  if (!(await boundChat(ctx.db, run.groupId))) return
  enqueue(ctx, run.groupId, () => syncRun(ctx, run.id))
}

async function syncRun(ctx: Ctx, runId: string) {
  const [row] = await ctx.db
    .select({ run: runs, bot: bots.name })
    .from(runs)
    .innerJoin(bots, eq(bots.id, runs.botId))
    .where(eq(runs.id, runId))
  if (!row) return
  const { run } = row
  const [trigger] = await ctx.db
    .select()
    .from(feishuMessageLinks)
    .where(
      and(eq(feishuMessageLinks.messageId, run.triggerMessageId), eq(feishuMessageLinks.kind, 'message')),
    )
  const app = await appOfBot(ctx, run.botId)
  if (!trigger || !app) return
  await syncRunCard(ctx, app, trigger, row.bot, run)
  await syncQuestions(ctx, app, trigger, row.bot, run.id)
  await syncApprovals(ctx, app, trigger, row.bot, run.id)
}

async function cardLink(
  ctx: Ctx,
  kind: 'run_card' | 'question' | 'approval',
  key: { runId?: string; refId?: string },
) {
  const [link] = await ctx.db
    .select()
    .from(feishuMessageLinks)
    .where(
      and(
        eq(feishuMessageLinks.kind, kind),
        key.runId ? eq(feishuMessageLinks.runId, key.runId) : undefined,
        key.refId ? eq(feishuMessageLinks.refId, key.refId) : undefined,
      ),
    )
  return link
}

/** Sends the card as a reply to the trigger the first time, then updates it when its content changed. */
async function putCard(
  ctx: Ctx,
  app: FeishuAppRow,
  trigger: Link,
  existing: Link | undefined,
  card: object,
  link: Pick<typeof feishuMessageLinks.$inferInsert, 'kind' | 'runId' | 'refId'>,
) {
  const json = JSON.stringify(card)
  const { rendered } = state(ctx)
  if (existing) {
    if (rendered.get(existing.feishuMessageId) === json) return
    await ctx.feishu.api.updateCard(credsOf(app), existing.feishuMessageId, json)
    rendered.set(existing.feishuMessageId, json)
    return
  }
  const sent = await ctx.feishu.api.send(credsOf(app), trigger.chatId, cardBody(card), {
    replyTo: trigger.feishuMessageId,
  })
  rendered.set(sent.messageId, json)
  await ctx.db.insert(feishuMessageLinks).values({
    feishuMessageId: sent.messageId,
    chatId: trigger.chatId,
    appId: app.appId,
    direction: 'out',
    ...link,
  })
}

/** Remembers what a card callback answered with, so the next sync does not update the card again. */
export function markRendered(ctx: Ctx, feishuMessageId: string, card: object) {
  state(ctx).rendered.set(feishuMessageId, JSON.stringify(card))
}

async function syncRunCard(ctx: Ctx, app: FeishuAppRow, trigger: Link, bot: string, run: Row) {
  const existing = await cardLink(ctx, 'run_card', { runId: run.id })
  const terminal = TERMINAL_RUN_STATUS.includes(run.status as RunStatus)
  const { throttle } = state(ctx)
  const last = throttle.get(run.id)
  const wait = last ? last.at + CARD_THROTTLE_MS - Date.now() : 0
  if (existing && !terminal && wait > 0) {
    if (!last?.timer && last)
      last.timer = setTimeout(() => {
        last.timer = undefined
        enqueue(ctx, run.groupId, () => syncRun(ctx, run.id))
      }, wait).unref()
    return
  }
  clearTimeout(last?.timer)
  const [reply] = terminal
    ? await ctx.db
        .select({ body: messages.body })
        .from(messages)
        .where(and(eq(messages.runId, run.id), eq(messages.kind, 'bot')))
        .orderBy(asc(messages.seq))
        .limit(1)
    : []
  const base = await publicUrl(ctx)
  const card = runCard({
    bot,
    status: run.status as RunStatus,
    step: run.step,
    reply: reply?.body ?? null,
    url: base ? `${base}/g/${run.groupId}?run=${run.id}` : null,
  })
  await putCard(ctx, app, trigger, existing, card, { kind: 'run_card', runId: run.id })
  if (terminal) throttle.delete(run.id)
  else throttle.set(run.id, { at: Date.now() })
}

async function syncQuestions(ctx: Ctx, app: FeishuAppRow, trigger: Link, bot: string, runId: string) {
  const rows = await ctx.db
    .select({ q: questionSets, by: users.name })
    .from(questionSets)
    .leftJoin(users, eq(users.id, questionSets.answeredBy))
    .where(eq(questionSets.runId, runId))
  for (const { q, by } of rows) {
    const existing = await cardLink(ctx, 'question', { refId: q.id })
    if (!existing && q.status !== 'pending') continue
    const card = questionCard({ bot, id: q.id, questions: q.questions as Question[], status: q.status, by })
    await putCard(ctx, app, trigger, existing, card, { kind: 'question', runId, refId: q.id })
  }
}

async function syncApprovals(ctx: Ctx, app: FeishuAppRow, trigger: Link, bot: string, runId: string) {
  const rows = await ctx.db
    .select({ a: approvals, by: users.name })
    .from(approvals)
    .leftJoin(users, eq(users.id, approvals.decidedBy))
    .where(eq(approvals.runId, runId))
  for (const { a, by } of rows) {
    const existing = await cardLink(ctx, 'approval', { refId: a.id })
    if (!existing && a.status !== 'pending') continue
    const card = approvalCard({
      bot,
      id: a.id,
      title: a.title,
      detail: a.detail,
      options: a.options as PermissionOption[],
      status: a.status,
      by,
    })
    await putCard(ctx, app, trigger, existing, card, { kind: 'approval', runId, refId: a.id })
  }
}
