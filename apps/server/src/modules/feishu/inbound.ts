import { randomUUID } from 'node:crypto'
import { createWriteStream } from 'node:fs'
import { mkdir, stat } from 'node:fs/promises'
import { join } from 'node:path'
import { Readable } from 'node:stream'
import { pipeline } from 'node:stream/promises'
import type { Attachment, Question } from '@gonggong/protocol'
import { and, eq, inArray, isNull, or, sql } from 'drizzle-orm'
import type { Ctx } from '../../context.js'
import {
  approvals,
  attachments,
  bots,
  feishuChats,
  feishuMessageLinks,
  groupMembers,
  messages,
  questionSets,
  runs,
} from '../../db/schema.js'
import { translator } from '../../i18n/index.js'
import { HttpError } from '../../lib/errors.js'
import { FILE_OVERHEAD, sealStream } from '../../lib/seal.js'
import { sysParams } from '../admin/params.js'
import { decideApproval } from '../approvals/service.js'
import { dataDir, safeName } from '../attachments/service.js'
import { dmsOf, isSharedWith } from '../bots/shares.js'
import { fullAccessForRun } from '../bots/tier.js'
import { createGroup } from '../groups/create.js'
import { activeBots } from '../groups/service.js'
import { resolveQuote } from '../messages/quote.js'
import { eraseMessage, recallMessage } from '../messages/recall.js'
import {
  type MessageMeta,
  type MessageRow,
  messageDto,
  postEvent,
  publishMessage,
} from '../messages/service.js'
import { answerQuestions } from '../questions/service.js'
import { rerunFor, triggerRuns } from '../runs/trigger.js'
import { groupRedactor } from '../secrets/resolve.js'
import { approvalCard, type CardValue, formAnswers, noticeCard, questionCard } from './cards.js'
import { credsOf, type FeishuAppRow, type FeishuInbound, onFeishu } from './gateway.js'
import { publicUrl } from './identity.js'
import { boundChat, enqueue, linkOf, markBound, markRendered, userOfFeishu } from './mirror.js'

const zt = translator('zh')

type Receive = FeishuInbound['im.message.receive_v1']
type Mention = { key: string; name: string }
type File = { key: string; type: 'image' | 'file'; name: string }

const escapeRe = (s: string) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')

/** Text of a Feishu message with its @ placeholders named, plus the files it carries. */
export function parseContent(
  type: string,
  raw: string,
  mentions: Mention[] = [],
): { body: string; files: File[] } {
  // Feishu keeps the spaces typed around a mention next to the one it inserts itself.
  const named = (s: string) =>
    mentions
      .reduce(
        (acc, m) =>
          acc.replace(new RegExp(`[ \\t\\u00a0]*${escapeRe(m.key)}[ \\t\\u00a0]*`, 'g'), ` @${m.name} `),
        s,
      )
      .replace(/^ +| +$/gm, '')
  let c: Record<string, unknown>
  try {
    c = JSON.parse(raw)
  } catch {
    return { body: '', files: [] }
  }
  if (type === 'text') return { body: named(String(c.text ?? '')).trim(), files: [] }
  if (type === 'image')
    return { body: '', files: [{ key: String(c.image_key), type: 'image', name: 'image.png' }] }
  if (type === 'file')
    return {
      body: '',
      files: [{ key: String(c.file_key), type: 'file', name: String(c.file_name ?? 'file') }],
    }
  if (type === 'post') {
    // Received posts are flat; history items may wrap them per locale ({ zh_cn: { title, content } }).
    if (!Array.isArray(c.content)) c = (Object.values(c)[0] ?? {}) as Record<string, unknown>
    const files: File[] = []
    const lines = ((c.content as Record<string, unknown>[][] | undefined) ?? []).map((line) =>
      line
        .map((el) => {
          if (el.tag === 'text' || el.tag === 'a') return String(el.text ?? '')
          if (el.tag === 'at') return `@${String(el.user_name ?? '')}`
          if (el.tag === 'img') files.push({ key: String(el.image_key), type: 'image', name: 'image.png' })
          return ''
        })
        .join(''),
    )
    const body = [c.title ? String(c.title) : '', ...lines].filter(Boolean).join('\n')
    return { body: named(body).trim(), files }
  }
  return { body: `[${type}]`, files: [] }
}

const MAGIC: [string, number[]][] = [
  ['image/png', [0x89, 0x50, 0x4e, 0x47]],
  ['image/jpeg', [0xff, 0xd8, 0xff]],
  ['image/gif', [0x47, 0x49, 0x46]],
]
const mimeOf = (data: Buffer, f: File) =>
  f.type === 'image'
    ? (MAGIC.find(([, sig]) => sig.every((b, i) => data[i] === b))?.[0] ?? 'image/webp')
    : 'application/octet-stream'

/** Downloads the message's files into 共工 attachments of `uploaderId` (unbound until the message is stored). */
async function fetchFiles(
  ctx: Ctx,
  app: FeishuAppRow,
  messageId: string,
  files: File[],
  o: { uploaderId: string; groupId: string },
) {
  const { attachmentMaxMb, attachmentsPerMessage } = await sysParams(ctx.db)
  const stored: Attachment[] = []
  for (const f of files.slice(0, attachmentsPerMessage)) {
    const data = await ctx.feishu.api.download(credsOf(app), messageId, f.key, f.type)
    if (data.length > attachmentMaxMb * 1024 * 1024) continue
    const id = randomUUID()
    const storageKey = `attachments/${id}`
    await mkdir(join(dataDir(), 'attachments'), { recursive: true })
    const path = join(dataDir(), storageKey)
    await pipeline(Readable.from([data]), sealStream(), createWriteStream(path))
    const values = {
      id,
      uploaderId: o.uploaderId,
      groupId: o.groupId,
      name: safeName(f.name, await groupRedactor(ctx, o.groupId)),
      size: (await stat(path)).size - FILE_OVERHEAD,
      mime: mimeOf(data, f),
      storageKey,
    }
    await ctx.db.insert(attachments).values(values)
    stored.push({ id, name: values.name, size: values.size, mime: values.mime, messageId: '' })
  }
  return stored
}

/** A Feishu reply to a mirrored message or a run's card quotes it, as a web quote would. */
async function quoteOf(ctx: Ctx, groupId: string, parentId: string | undefined) {
  const link = parentId ? await linkOf(ctx, parentId) : undefined
  const ref =
    link?.kind === 'message' && link.messageId
      ? { kind: 'message' as const, id: link.messageId }
      : link?.runId
        ? { kind: 'run' as const, id: link.runId }
        : undefined
  if (!ref) return undefined
  return resolveQuote(ctx, groupId, ref).catch((err) => {
    if (!(err instanceof HttpError)) throw err
    return undefined
  })
}

const reply = (ctx: Ctx, app: FeishuAppRow, ev: Receive, card: object) =>
  ctx.feishu.api.send(
    credsOf(app),
    ev.message.chat_id,
    { msgType: 'interactive', content: JSON.stringify(card) },
    { replyTo: ev.message.message_id },
  )

/** The 认证共工账号 button, back to `next` once verified. */
async function verifyAction(ctx: Ctx, next: string) {
  const base = await publicUrl(ctx)
  return base
    ? { label: zt('认证共工账号'), url: `${base}/api/auth/feishu/start?next=${encodeURIComponent(next)}` }
    : undefined
}

type Target = { groupId: string; botId: string; user: { id: string; name: string } }

/** A message in a Feishu chat bound to a group: the @-ed bot runs there if the sender is a member. */
async function groupTarget(ctx: Ctx, app: FeishuAppRow, ev: Receive): Promise<Target | undefined> {
  const botId = app.botId
  if (app.kind !== 'bot' || !botId) return
  const [chat] = await ctx.db
    .select()
    .from(feishuChats)
    .where(and(eq(feishuChats.chatId, ev.message.chat_id), isNull(feishuChats.unboundAt)))
  if (!chat)
    return void (await reply(
      ctx,
      app,
      ev,
      noticeCard(zt('这个飞书群还没有绑定共工群，请群管理员在共工的群设置中绑定。')),
    ))
  const groupId = chat.groupId
  if (!(await activeBots(ctx, groupId)).some((b) => b.id === botId))
    return void (await reply(ctx, app, ev, noticeCard(zt('这个 Bot 不在绑定的共工群中，请先把它加入该群。'))))
  const user = await userOfFeishu(ctx, ev.sender.sender_id?.union_id)
  const [member] = user
    ? await ctx.db
        .select()
        .from(groupMembers)
        .where(and(eq(groupMembers.groupId, groupId), eq(groupMembers.userId, user.id)))
    : []
  if (!user || !member) {
    const text = user
      ? zt('你还不是对应共工群的成员，不能使用这个 Bot。请联系群管理员把你加入群。')
      : zt('使用 Bot 前需要先认证共工账号，认证后重新 @ 即可。')
    const action = user ? undefined : await verifyAction(ctx, `/g/${groupId}`)
    return void (await reply(ctx, app, ev, noticeCard(text, action)))
  }
  return { groupId, botId, user }
}

/** Single chats opening their 共工 DM, one at a time per chat so two quick messages share one DM. */
const opening = new Map<string, Promise<unknown>>()

/** The user's DM with the bot (opened if missing), bound to their single chat with the bot's app. */
function dmOf(ctx: Ctx, user: Target['user'], bot: typeof bots.$inferSelect, chatId: string) {
  const open = async () => {
    const [dm] = await dmsOf(ctx, bot.id, [user.id], true)
    const groupId =
      dm?.id ??
      (await createGroup(ctx, user, bot.teamId, {
        name: bot.name,
        kind: 'dm',
        memberIds: [],
        botIds: [bot.id],
        repo: null,
      }))
    if ((await boundChat(ctx.db, groupId))?.chatId === chatId) return groupId
    // The bot got another app (a new single chat), or the DM was deleted: the old binding gives way.
    await ctx.db.transaction(async (tx) => {
      await tx
        .update(feishuChats)
        .set({ unboundAt: ctx.now() })
        .where(
          and(
            or(eq(feishuChats.groupId, groupId), eq(feishuChats.chatId, chatId)),
            isNull(feishuChats.unboundAt),
          ),
        )
      await tx
        .insert(feishuChats)
        .values({ groupId, chatId, name: bot.name, boundBy: user.id, createdAt: ctx.now() })
    })
    markBound(ctx, groupId)
    return groupId
  }
  const next = (opening.get(chatId) ?? Promise.resolve()).catch(() => {}).then(open)
  opening.set(chatId, next)
  void next.then(
    () => opening.get(chatId) === next && opening.delete(chatId),
    () => opening.get(chatId) === next && opening.delete(chatId),
  )
  return next
}

/** A single chat with a bot's own app: no @ needed, the bot runs in the sender's DM with it. */
async function singleChatTarget(ctx: Ctx, app: FeishuAppRow, ev: Receive): Promise<Target | undefined> {
  if (app.kind !== 'bot' || !app.botId) return
  const user = await userOfFeishu(ctx, ev.sender.sender_id?.union_id)
  if (!user)
    return void (await reply(
      ctx,
      app,
      ev,
      noticeCard(zt('使用 Bot 前需要先认证共工账号，认证后重新发送即可。'), await verifyAction(ctx, '/')),
    ))
  const [bot] = await ctx.db
    .select()
    .from(bots)
    .where(and(eq(bots.id, app.botId), isNull(bots.deletedAt)))
  if (!bot) return
  if (bot.ownerId !== user.id && !(await isSharedWith(ctx, bot.id, user.id)))
    return void (await reply(
      ctx,
      app,
      ev,
      noticeCard(zt('这个 Bot 还没有共享给你，请在共工中向 Bot 主人申请共享后再发送。')),
    ))
  return { groupId: await dmOf(ctx, user, bot, ev.message.chat_id), botId: bot.id, user }
}

const SYNC_ALL_NOTICE = '飞书群里的消息现在会全部同步到本群（不触发 Bot），群管理员可在「群设置 · 飞书」关闭'

/**
 * 同步全部飞书消息: a user message of a bound chat, as the main app gets them all, is stored without running any bot.
 * One that @-s a bot is also delivered by that bot's app: whichever comes second finds the link (the bot's then
 * adds its mention and runs it). Queued behind the group's Feishu sends so 共工's own messages are known by then.
 */
async function syncChatMessage(ctx: Ctx, app: FeishuAppRow, ev: Receive) {
  const [chat] = await ctx.db
    .select()
    .from(feishuChats)
    .where(and(eq(feishuChats.chatId, ev.message.chat_id), isNull(feishuChats.unboundAt)))
  if (!chat?.syncAll) return
  enqueue(ctx, chat.groupId, () => storeChatMessage(ctx, app, ev, chat))
}

async function storeChatMessage(
  ctx: Ctx,
  app: FeishuAppRow,
  ev: Receive,
  chat: typeof feishuChats.$inferSelect,
) {
  const msg = ev.message
  if (await linkOf(ctx, msg.message_id)) return
  const { groupId } = chat
  const unionId = ev.sender.sender_id?.union_id
  const user = await userOfFeishu(ctx, unionId)
  const [member] = user
    ? await ctx.db
        .select()
        .from(groupMembers)
        .where(and(eq(groupMembers.groupId, groupId), eq(groupMembers.userId, user.id)))
    : []
  const author = member ? user : undefined
  const name = author
    ? undefined
    : ((unionId && (await ctx.feishu.api.chatMemberNames(credsOf(app), msg.chat_id)).get(unionId)) ??
      '飞书用户')
  const mentions = (msg.mentions ?? []).map((m) => ({ key: m.key, name: m.name }))
  const { body, files } = parseContent(msg.message_type, msg.content, mentions)
  // Files of a sender without a 共工 account are kept under whoever bound the chat.
  const uploads = await fetchFiles(ctx, app, msg.message_id, files, {
    uploaderId: author?.id ?? chat.boundBy,
    groupId,
  })
  const quote = await quoteOf(ctx, groupId, msg.parent_id)
  // On by default, also for chats bound before it existed: the group learns why Feishu chatter shows up now.
  const [noticed] = await ctx.db
    .select({ id: messages.id })
    .from(messages)
    .where(
      and(
        eq(messages.groupId, groupId),
        eq(messages.kind, 'event'),
        sql`${messages.meta}->'i18n'->>'key' = ${SYNC_ALL_NOTICE}`,
      ),
    )
    .limit(1)
  if (!noticed) await postEvent(ctx, groupId, SYNC_ALL_NOTICE)
  const row = await ctx.db.transaction(async (tx) => {
    await tx.execute(sql`select pg_advisory_xact_lock(hashtext(${`feishu:${msg.message_id}`}))`)
    const [link] = await tx
      .select()
      .from(feishuMessageLinks)
      .where(eq(feishuMessageLinks.feishuMessageId, msg.message_id))
    if (link) return undefined
    const id = randomUUID()
    const meta: MessageMeta = {
      mentions: [],
      feishu: name === undefined ? {} : { name },
      ...(uploads.length && { attachments: uploads.map((a) => ({ ...a, messageId: id })) }),
      ...(quote && { quote }),
    }
    const [m] = (await tx
      .insert(messages)
      .values({ id, groupId, kind: 'user', authorUserId: author?.id ?? null, body, meta })
      .returning()) as [MessageRow]
    if (uploads.length)
      await tx
        .update(attachments)
        .set({ messageId: id })
        .where(
          inArray(
            attachments.id,
            uploads.map((a) => a.id),
          ),
        )
    await tx.insert(feishuMessageLinks).values({
      feishuMessageId: msg.message_id,
      chatId: msg.chat_id,
      appId: app.appId,
      direction: 'in',
      kind: 'message',
      messageId: id,
    })
    return m
  })
  if (!row) {
    if (uploads.length)
      await ctx.db.delete(attachments).where(
        inArray(
          attachments.id,
          uploads.map((a) => a.id),
        ),
      )
    return
  }
  await publishMessage(ctx, messageDto(row, author?.name ?? ''))
}

/**
 * A Feishu user @-ed a bot through its own app in a bound chat, or wrote to it in a single chat: store the message
 * as theirs and run the bot (plan §2.1).
 */
async function onReceive(ctx: Ctx, app: FeishuAppRow, ev: Receive) {
  if (ev.sender.sender_type !== 'user') return
  if (app.kind === 'main') return ev.message.chat_type === 'group' ? syncChatMessage(ctx, app, ev) : undefined
  const msg = ev.message
  const known = await linkOf(ctx, msg.message_id)
  if (known?.direction === 'out') return
  const target =
    msg.chat_type === 'p2p' ? await singleChatTarget(ctx, app, ev) : await groupTarget(ctx, app, ev)
  if (!target) return
  const { groupId, botId, user } = target

  const mentions = (msg.mentions ?? []).map((m) => ({ key: m.key, name: m.name }))
  const { body, files } = parseContent(msg.message_type, msg.content, mentions)
  const uploads = known
    ? []
    : await fetchFiles(ctx, app, msg.message_id, files, { uploaderId: user.id, groupId })
  const quote = known ? undefined : await quoteOf(ctx, groupId, msg.parent_id)
  // Every @-ed bot's app delivers the same message: the first stores it, the others add their bot to it.
  const { row, created } = await ctx.db.transaction(async (tx) => {
    await tx.execute(sql`select pg_advisory_xact_lock(hashtext(${`feishu:${msg.message_id}`}))`)
    const [link] = await tx
      .select()
      .from(feishuMessageLinks)
      .where(eq(feishuMessageLinks.feishuMessageId, msg.message_id))
    if (link?.messageId) {
      const [m] = (await tx
        .update(messages)
        .set({
          meta: sql`jsonb_set(${messages.meta}, '{mentions}', (${messages.meta}->'mentions') || to_jsonb(${botId}::text))`,
        })
        .where(and(eq(messages.id, link.messageId), sql`not (${messages.meta}->'mentions') ? ${botId}`))
        .returning()) as MessageRow[]
      return { row: m, created: false }
    }
    const id = randomUUID()
    const meta: MessageMeta = {
      mentions: [botId],
      ...(uploads.length && { attachments: uploads.map((a) => ({ ...a, messageId: id })) }),
      ...(quote && { quote }),
      feishu: {},
    }
    const [m] = (await tx
      .insert(messages)
      .values({ id, groupId, kind: 'user', authorUserId: user.id, body, meta })
      .returning()) as [MessageRow]
    if (uploads.length)
      await tx
        .update(attachments)
        .set({ messageId: id })
        .where(
          inArray(
            attachments.id,
            uploads.map((a) => a.id),
          ),
        )
    await tx.insert(feishuMessageLinks).values({
      feishuMessageId: msg.message_id,
      chatId: msg.chat_id,
      appId: app.appId,
      direction: 'in',
      kind: 'message',
      messageId: id,
    })
    return { row: m, created: true }
  })
  if (!created && uploads.length)
    await ctx.db.delete(attachments).where(
      inArray(
        attachments.id,
        uploads.map((a) => a.id),
      ),
    )
  if (!row) return
  if (created) {
    await publishMessage(ctx, messageDto(row, user.name))
    await triggerRuns(ctx, row)
  } else await rerunFor(ctx, row, [botId])
}

async function onRecalled(ctx: Ctx, ev: FeishuInbound['im.message.recalled_v1']) {
  const link = ev.message_id ? await linkOf(ctx, ev.message_id) : undefined
  if (link?.direction !== 'in' || !link.messageId) return
  const [m] = await ctx.db.select().from(messages).where(eq(messages.id, link.messageId))
  if (!m || m.recalledAt) return
  if (!m.authorUserId) {
    if ((m.meta as MessageMeta).feishu) await eraseMessage(ctx, m)
    return
  }
  const user = { id: m.authorUserId, name: '' }
  await recallMessage(ctx, user, m.id).catch((err) => {
    if (!(err instanceof HttpError)) throw err
  })
}

const toast = (type: 'success' | 'error', content: string) => ({ toast: { type, content } })

/**
 * Card buttons and forms: the operator answers or approves exactly as on the web, with the same rights. A run
 * card is updated by the run sync the decision leads to; a card of its own (sent before approvals and questions
 * moved into the run card) is answered with its settled state.
 */
async function onCardAction(ctx: Ctx, ev: FeishuInbound['card.action.trigger']) {
  const value = ev.action?.value as CardValue | undefined
  const messageId = ev.context?.open_message_id
  if (!value || !messageId) return {}
  const user = await userOfFeishu(ctx, ev.operator?.union_id)
  if (!user) return toast('error', zt('请先认证共工账号'))
  const own = (await linkOf(ctx, messageId))?.kind !== 'run_card'
  try {
    if (value.k === 'answer') {
      const [row] = await ctx.db
        .select({ q: questionSets, bot: bots.name })
        .from(questionSets)
        .innerJoin(runs, eq(runs.id, questionSets.runId))
        .innerJoin(bots, eq(bots.id, runs.botId))
        .where(eq(questionSets.id, value.q))
      if (!row) return toast('error', zt('提问不存在'))
      const questions = row.q.questions as Question[]
      const answers = formAnswers(questions, ev.action?.form_value ?? {})
      await answerQuestions(ctx, user, row.q.runId, row.q.id, answers, [])
      if (!own) return toast('success', zt('已提交回答'))
      const card = questionCard({
        bot: row.bot,
        id: row.q.id,
        questions,
        status: 'answered',
        by: user.name,
        answers,
      })
      markRendered(ctx, messageId, card)
      return { ...toast('success', zt('已提交回答')), card: { type: 'raw', data: card } }
    }
    const [row] = await ctx.db
      .select({ a: approvals, bot: bots.name })
      .from(approvals)
      .innerJoin(runs, eq(runs.id, approvals.runId))
      .innerJoin(bots, eq(bots.id, runs.botId))
      .where(eq(approvals.id, value.a))
    if (!row) return toast('error', zt('审批请求不存在'))
    if (value.k === 'full') await fullAccessForRun(ctx, user.id, row.a.runId)
    const status =
      value.k === 'full'
        ? 'approved'
        : (await decideApproval(ctx, user, row.a.runId, row.a.id, value.o)).status
    if (!own) return toast('success', zt('已处理'))
    const card = approvalCard({
      bot: row.bot,
      id: row.a.id,
      title: row.a.title,
      detail: row.a.detail,
      options: [],
      remember: [],
      status,
      by: user.name,
    })
    markRendered(ctx, messageId, card)
    return { ...toast('success', zt('已处理')), card: { type: 'raw', data: card } }
  } catch (err) {
    if (err instanceof HttpError) return toast('error', err.message)
    throw err
  }
}

/** Subscribes the mirror to the Feishu events of every connected app. */
export function startFeishuInbound(ctx: Ctx) {
  onFeishu(ctx, 'im.message.receive_v1', (app, ev) => onReceive(ctx, app, ev))
  onFeishu(ctx, 'im.message.recalled_v1', (_app, ev) => onRecalled(ctx, ev))
  onFeishu(ctx, 'card.action.trigger', (_app, ev) => onCardAction(ctx, ev))
}
