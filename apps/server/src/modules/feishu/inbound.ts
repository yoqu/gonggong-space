import { randomUUID } from 'node:crypto'
import { createWriteStream } from 'node:fs'
import { mkdir, stat } from 'node:fs/promises'
import { join } from 'node:path'
import { Readable } from 'node:stream'
import { pipeline } from 'node:stream/promises'
import type { Attachment, Question } from '@gonggong/protocol'
import { and, eq, inArray, isNull, sql } from 'drizzle-orm'
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
import { activeBots } from '../groups/service.js'
import { resolveQuote } from '../messages/quote.js'
import { recallMessage } from '../messages/recall.js'
import { type MessageMeta, type MessageRow, messageDto, publishMessage } from '../messages/service.js'
import { answerQuestions } from '../questions/service.js'
import { rerunFor, triggerRuns } from '../runs/trigger.js'
import { approvalCard, type CardValue, formAnswers, noticeCard, questionCard } from './cards.js'
import { credsOf, type FeishuAppRow, type FeishuInbound, onFeishu } from './gateway.js'
import { publicUrl } from './identity.js'
import { linkOf, markRendered, userOfFeishu } from './mirror.js'

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
      name: safeName(f.name),
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
  return resolveQuote(ctx, groupId, ref).then(
    (q) => q.quote,
    (err) => {
      if (!(err instanceof HttpError)) throw err
      return undefined
    },
  )
}

const reply = (ctx: Ctx, app: FeishuAppRow, ev: Receive, card: object) =>
  ctx.feishu.api.send(
    credsOf(app),
    ev.message.chat_id,
    { msgType: 'interactive', content: JSON.stringify(card) },
    { replyTo: ev.message.message_id },
  )

/** A Feishu user @-ed a bot through its own app: store the message as theirs and run the bot (plan §2.1). */
async function onReceive(ctx: Ctx, app: FeishuAppRow, ev: Receive) {
  const botId = app.botId
  if (app.kind !== 'bot' || !botId || ev.sender.sender_type !== 'user') return
  const msg = ev.message
  const known = await linkOf(ctx, msg.message_id)
  if (known?.direction === 'out') return
  const [chat] = await ctx.db
    .select()
    .from(feishuChats)
    .where(and(eq(feishuChats.chatId, msg.chat_id), isNull(feishuChats.unboundAt)))
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
    const base = await publicUrl(ctx)
    const next = encodeURIComponent(`/g/${groupId}`)
    const action = base
      ? { label: zt('认证共工账号'), url: `${base}/api/auth/feishu/start?next=${next}` }
      : undefined
    const text = user
      ? zt('你还不是对应共工群的成员，不能使用这个 Bot。请联系群管理员把你加入群。')
      : zt('使用 Bot 前需要先认证共工账号，认证后重新 @ 即可。')
    return void (await reply(ctx, app, ev, noticeCard(text, user ? undefined : action)))
  }

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
  if (!m?.authorUserId || m.recalledAt) return
  const user = { id: m.authorUserId, name: '' }
  await recallMessage(ctx, user, m.id).catch((err) => {
    if (!(err instanceof HttpError)) throw err
  })
}

const toast = (type: 'success' | 'error', content: string) => ({ toast: { type, content } })

/** Card buttons and forms: the operator answers or approves exactly as on the web, with the same rights. */
async function onCardAction(ctx: Ctx, ev: FeishuInbound['card.action.trigger']) {
  const value = ev.action?.value as CardValue | undefined
  const messageId = ev.context?.open_message_id
  if (!value || !messageId) return {}
  const user = await userOfFeishu(ctx, ev.operator?.union_id)
  if (!user) return toast('error', zt('请先认证共工账号'))
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
    const decided = await decideApproval(ctx, user, row.a.runId, row.a.id, value.o)
    const card = approvalCard({
      bot: row.bot,
      id: row.a.id,
      title: row.a.title,
      detail: row.a.detail,
      options: [],
      status: decided.status,
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
