import { and, eq, inArray } from 'drizzle-orm'
import type { Ctx } from '../../context.js'
import {
  attachments,
  bots,
  feishuApps,
  feishuIdentities,
  feishuMessageLinks,
  groups,
  type messages,
  runs,
  users,
} from '../../db/schema.js'
import { type AttachmentRow, openStored } from '../attachments/service.js'
import type { MessageMeta } from '../messages/service.js'
import { mainApp } from './apps.js'
import { type FeishuBody, type FeishuCreds, FeishuError, type FeishuFileType } from './client.js'
import { credsOf } from './gateway.js'
import { publicUrl, userToken } from './identity.js'
import { appOfBot, boundChat, enqueue } from './mirror.js'

type Link = typeof feishuMessageLinks.$inferSelect
type MessageRow = typeof messages.$inferSelect

/** Feishu takes images up to 10 MB in these formats; anything else goes as a file of at most 30 MB. */
const IMAGE_MAX_BYTES = 10 * 1024 * 1024
const FILE_MAX_BYTES = 30 * 1024 * 1024
const IMAGE_MIMES = [
  'image/jpeg',
  'image/png',
  'image/webp',
  'image/gif',
  'image/tiff',
  'image/bmp',
  'image/x-icon',
]
const FILE_TYPES: Record<string, FeishuFileType> = {
  pdf: 'pdf',
  doc: 'doc',
  docx: 'doc',
  xls: 'xls',
  xlsx: 'xls',
  ppt: 'ppt',
  pptx: 'ppt',
}

const textBody = (text: string): FeishuBody => ({ msgType: 'text', content: JSON.stringify({ text }) })

async function appById(ctx: Ctx, appId: string) {
  const [row] = await ctx.db.select().from(feishuApps).where(eq(feishuApps.appId, appId))
  return row
}

/** A DM's binding is a user's single chat with a bot app: the app the chat's messages came in through. */
async function singleChatApp(ctx: Ctx, chatId: string) {
  const [link] = await ctx.db
    .select({ appId: feishuMessageLinks.appId })
    .from(feishuMessageLinks)
    .where(and(eq(feishuMessageLinks.chatId, chatId), eq(feishuMessageLinks.direction, 'in')))
    .limit(1)
  return link && appById(ctx, link.appId)
}

/** The body with each @ of a member linked to Feishu as a real Feishu @ (by union id, valid for any app). */
async function withFeishuAts(ctx: Ctx, body: string, userIds: string[]) {
  if (!userIds.length) return body
  const linked = await ctx.db
    .select({ name: users.name, unionId: feishuIdentities.unionId })
    .from(feishuIdentities)
    .innerJoin(users, eq(users.id, feishuIdentities.userId))
    .where(inArray(feishuIdentities.userId, userIds))
  // Longest first, so 「@王磊磊」 is not taken for 「@王磊」.
  return linked
    .sort((a, b) => b.name.length - a.name.length)
    .reduce((text, u) => text.split(`@${u.name}`).join(`<at user_id="${u.unionId}">${u.name}</at>`), body)
}

/** The message's attachment rows, in the order it lists them. */
async function filesOf(ctx: Ctx, meta: MessageMeta) {
  const ids = (meta.attachments ?? []).map((a) => a.id)
  if (!ids.length) return []
  const rows = await ctx.db.select().from(attachments).where(inArray(attachments.id, ids))
  return ids.flatMap((id) => rows.filter((r) => r.id === id))
}

/** A 共工 attachment as a Feishu message; one over Feishu's limits is named with a link to the 共工 message. */
async function attachmentBody(ctx: Ctx, app: FeishuCreds, a: AttachmentRow, url: string | null) {
  const image = IMAGE_MIMES.includes(a.mime) && a.size <= IMAGE_MAX_BYTES
  if (!image && a.size > FILE_MAX_BYTES)
    return textBody(
      `${a.name}（${Math.ceil(a.size / 1024 / 1024)} MB，超过飞书上限，请在共工查看）${url ?? ''}`,
    )
  const data = Buffer.concat((await (await openStored(a)).toArray()) as Buffer[])
  if (image)
    return {
      msgType: 'image',
      content: JSON.stringify({ image_key: await ctx.feishu.api.uploadImage(app, data) }),
    } satisfies FeishuBody
  const type = FILE_TYPES[a.name.split('.').pop()?.toLowerCase() ?? ''] ?? 'stream'
  const key = await ctx.feishu.api.uploadFile(app, a.name, type, data)
  return { msgType: 'file', content: JSON.stringify({ file_key: key }) } satisfies FeishuBody
}

/**
 * Sends the files after the text, as the user of `as` when Feishu lets them, else as the app. A file Feishu refuses
 * is logged and skipped, so one bad file does not hold back the rest.
 */
async function sendFiles(
  ctx: Ctx,
  from: { appId: string; creds: FeishuCreds },
  chatId: string,
  files: AttachmentRow[],
  o: {
    messageId: string
    url: string | null
    replyTo?: string
    /** Sends as this user first. */
    as?: { userId: string; token: string } | null
    /** The first file stands for the message (it had no text): a run card replies to it. */
    first?: boolean
  },
) {
  let first = o.first ?? false
  for (const file of files) {
    try {
      const body = await attachmentBody(ctx, from.creds, file, o.url)
      const asUser =
        o.as &&
        (await ctx.feishu.api
          .send(from.creds, chatId, body, { userToken: o.as.token, replyTo: o.replyTo })
          .catch((err) => {
            if (!(err instanceof FeishuError)) throw err
            return null
          }))
      const sent = asUser || (await ctx.feishu.api.send(from.creds, chatId, body, { replyTo: o.replyTo }))
      await ctx.db.insert(feishuMessageLinks).values({
        feishuMessageId: sent.messageId,
        chatId,
        appId: from.appId,
        direction: 'out',
        kind: first ? 'message' : 'attachment',
        messageId: o.messageId,
        ...(asUser && o.as && { refId: o.as.userId }),
      })
      first = false
    } catch (err) {
      if (!(err instanceof FeishuError)) throw err
      console.error('feishu attachment:', file.name, `${err.code} ${err.message}`)
    }
  }
}

/**
 * A web message that @-s bots or members goes to the bound chat through the main app: as its author when they authorized
 * Feishu, otherwise as 「名字：…」; its attachments follow as images and files. A DM's single chat only has the bot app
 * in it, which sends as 「名字：…」.
 */
export async function mirrorUserMessage(ctx: Ctx, message: MessageRow, author: { id: string; name: string }) {
  const chat = await boundChat(ctx.db, message.groupId)
  if (!chat?.syncOutbound) return
  enqueue(ctx, message.groupId, async () => {
    const [group] = await ctx.db
      .select({ kind: groups.kind })
      .from(groups)
      .where(eq(groups.id, message.groupId))
    const dm = group?.kind === 'dm'
    const from = dm ? await singleChatApp(ctx, chat.chatId) : await mainApp(ctx)
    if (!from) return
    const app = credsOf(from)
    const token = dm ? null : await userToken(ctx, author.id)
    const meta = message.meta as MessageMeta
    const files = await filesOf(ctx, meta)
    const body = await withFeishuAts(
      ctx,
      meta.mentionsAll ? message.body.split('@所有人').join('<at user_id="all">所有人</at>') : message.body,
      meta.userMentions ?? [],
    )
    // A thread reply quotes its root in the chat, when the root went there (Feishu threads are not mapped).
    const [root] = message.threadRootId
      ? await ctx.db
          .select({ id: feishuMessageLinks.feishuMessageId })
          .from(feishuMessageLinks)
          .where(
            and(
              eq(feishuMessageLinks.messageId, message.threadRootId),
              eq(feishuMessageLinks.chatId, chat.chatId),
            ),
          )
          .limit(1)
      : []
    const replyTo = root?.id
    let sent: { messageId: string } | null = null
    if (token && body.trim())
      sent = await ctx.feishu.api
        .send(app, chat.chatId, textBody(body), { userToken: token, replyTo })
        .catch((err) => {
          if (!(err instanceof FeishuError)) throw err
          return null
        })
    const byUser = !!sent
    // Without text, a proxied message still needs the author's name in front of its files.
    const proxied = body.trim() || files.map((f) => f.name).join('、')
    if (!sent && (body.trim() || !token))
      sent = await ctx.feishu.api.send(app, chat.chatId, textBody(`${author.name}：${proxied}`), { replyTo })
    if (sent)
      await ctx.db.insert(feishuMessageLinks).values({
        feishuMessageId: sent.messageId,
        chatId: chat.chatId,
        appId: from.appId,
        direction: 'out',
        kind: 'message',
        messageId: message.id,
        ...(byUser && { refId: author.id }),
      })
    const base = await publicUrl(ctx)
    await sendFiles(ctx, { appId: from.appId, creds: app }, chat.chatId, files, {
      messageId: message.id,
      url: base && `${base}/g/${message.groupId}?msg=${message.id}`,
      replyTo,
      as: token ? { userId: author.id, token } : null,
      first: !sent,
    })
  })
}

/**
 * Files a bot sends during a run (send_attachments) follow its run card: they go to the chat its trigger is in, through
 * the bot's app, replying to the trigger.
 */
export async function mirrorBotAttachments(ctx: Ctx, message: MessageRow) {
  if (!message.runId) return
  const [row] = await ctx.db
    .select({ trigger: feishuMessageLinks, botId: runs.botId, bot: bots.name })
    .from(runs)
    .innerJoin(bots, eq(bots.id, runs.botId))
    .innerJoin(
      feishuMessageLinks,
      and(eq(feishuMessageLinks.messageId, runs.triggerMessageId), eq(feishuMessageLinks.kind, 'message')),
    )
    .where(eq(runs.id, message.runId))
    .limit(1)
  if (!row) return
  const { trigger } = row
  enqueue(ctx, message.groupId, async () => {
    const from = await appOfBot(ctx, row.botId)
    if (!from) return
    const app = credsOf(from)
    const files = await filesOf(ctx, message.meta as MessageMeta)
    const opts = { replyTo: trigger.feishuMessageId }
    if (message.body.trim()) {
      const text = from.botId === row.botId ? message.body : `${row.bot}：${message.body}`
      const sent = await ctx.feishu.api.send(app, trigger.chatId, textBody(text), opts)
      await ctx.db.insert(feishuMessageLinks).values({
        feishuMessageId: sent.messageId,
        chatId: trigger.chatId,
        appId: from.appId,
        direction: 'out',
        kind: 'attachment',
        messageId: message.id,
      })
    }
    const base = await publicUrl(ctx)
    await sendFiles(ctx, { appId: from.appId, creds: app }, trigger.chatId, files, {
      messageId: message.id,
      url: base && `${base}/g/${message.groupId}?msg=${message.id}`,
      ...opts,
    })
  })
}

/** Out links sent as a user keep that user in `refId`: their token is needed to recall or edit it. */
async function asSender(ctx: Ctx, link: Link) {
  const from = await appById(ctx, link.appId)
  if (!from) return null
  const token = link.refId ? await userToken(ctx, link.refId) : undefined
  return { app: credsOf(from), token: token ?? undefined }
}

/** 共工 recall of a mirrored message recalls its Feishu copies, text and files (an inbound one is the Feishu user's own). */
export async function mirrorRecall(ctx: Ctx, messageId: string, groupId: string) {
  const links = await ctx.db
    .select()
    .from(feishuMessageLinks)
    .where(
      and(
        eq(feishuMessageLinks.messageId, messageId),
        eq(feishuMessageLinks.direction, 'out'),
        inArray(feishuMessageLinks.kind, ['message', 'attachment']),
      ),
    )
  if (!links.length) return
  enqueue(ctx, groupId, async () => {
    for (const link of links) {
      const sender = await asSender(ctx, link)
      if (sender) await ctx.feishu.api.recall(sender.app, link.feishuMessageId, sender.token)
    }
  })
}

/** 共工 edit of a mirrored message edits its Feishu copy. */
export async function mirrorEdit(
  ctx: Ctx,
  message: { id: string; groupId: string; body: string; userMentions?: string[] },
  authorName: string,
) {
  const [link] = await ctx.db
    .select()
    .from(feishuMessageLinks)
    .where(
      and(
        eq(feishuMessageLinks.messageId, message.id),
        eq(feishuMessageLinks.direction, 'out'),
        eq(feishuMessageLinks.kind, 'message'),
      ),
    )
  if (!link) return
  enqueue(ctx, message.groupId, async () => {
    const sender = await asSender(ctx, link)
    if (!sender) return
    const body = await withFeishuAts(ctx, message.body, message.userMentions ?? [])
    const text = link.refId ? body : `${authorName}：${body}`
    await ctx.feishu.api.edit(sender.app, link.feishuMessageId, textBody(text), sender.token)
  })
}
