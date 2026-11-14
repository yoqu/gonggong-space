import multipart from '@fastify/multipart'
import { FEISHU_CARD_IMAGES_MAX } from '@gonggong/protocol'
import { and, eq } from 'drizzle-orm'
import type { FastifyInstance } from 'fastify'
import type { Ctx } from '../../context.js'
import { requireMachine } from '../../daemon/auth.js'
import { bots, feishuMessageLinks, runs } from '../../db/schema.js'
import { fail } from '../../lib/errors.js'
import { idParam } from '../../lib/ids.js'
import { LIVE } from '../runs/dto.js'
import { FeishuError } from './client.js'
import { credsOf } from './gateway.js'
import { appOfBot, boundChat, cardBody } from './mirror.js'

/** Feishu's limits for message images and card content. */
const IMAGE_MAX_BYTES = 10 * 1024 * 1024
const CARD_MAX_BYTES = 30 * 1024
const IMAGE_TYPES = ['png', 'jpg', 'jpeg', 'gif', 'webp', 'bmp', 'tiff', 'ico']
/** Multipart field of an image: `image.<placeholder>`. */
const IMAGE_FIELD = 'image.'

type Json = null | boolean | number | string | Json[] | { [k: string]: Json }

const isObject = (v: unknown): v is Record<string, Json> =>
  typeof v === 'object' && v !== null && !Array.isArray(v)

/** Every string value of the card that equals a placeholder becomes that image's key. */
function fill(v: Json, keys: Map<string, string>): Json {
  if (typeof v === 'string') return keys.get(v) ?? v
  if (Array.isArray(v)) return v.map((x) => fill(x, keys))
  if (isObject(v)) return Object.fromEntries(Object.entries(v).map(([k, x]) => [k, fill(x, keys)]))
  return v
}

function strings(v: Json, out = new Set<string>()) {
  if (typeof v === 'string') out.add(v)
  else if (Array.isArray(v)) for (const x of v) strings(x, out)
  else if (isObject(v)) for (const x of Object.values(v)) strings(x, out)
  return out
}

/**
 * The gonggong MCP `feishu_send_card` of a live run: its bot's machine sends a custom card (Feishu card JSON 2.0)
 * with the workspace images it references; they are uploaded with the bot's app and their keys put in place of
 * the placeholders, then the card replies to the run's trigger in the group's bound chat as the bot.
 */
export function feishuCardRoutes(ctx: Ctx) {
  return async (app: FastifyInstance) => {
    await app.register(multipart)

    app.post<{ Params: { runId: string } }>('/api/daemon/runs/:runId/feishu-card', async (req) => {
      const machine = await requireMachine(ctx, req)
      const [run] = await ctx.db
        .select({
          id: runs.id,
          status: runs.status,
          groupId: runs.groupId,
          botId: runs.botId,
          trigger: runs.triggerMessageId,
        })
        .from(runs)
        .innerJoin(bots, eq(bots.id, runs.botId))
        .where(and(eq(runs.id, idParam(req.params.runId, '运行不存在')), eq(bots.machineId, machine.id)))
      if (!run || !LIVE.includes(run.status)) return fail('not_found', '运行不存在或已结束')

      let raw: string | undefined
      const images = new Map<string, { name: string; data: Buffer }>()
      const parts = req.parts({ limits: { fileSize: IMAGE_MAX_BYTES, files: FEISHU_CARD_IMAGES_MAX } })
      for await (const part of parts) {
        if (part.type === 'field') {
          if (part.fieldname === 'card') raw = String(part.value)
          continue
        }
        const name = part.filename
        if (!IMAGE_TYPES.includes(name.split('.').pop()?.toLowerCase() ?? '')) {
          part.file.resume()
          return fail('invalid', '图片 {name} 的格式飞书不支持，可用 {types}', {
            name,
            types: IMAGE_TYPES.join('、'),
          })
        }
        const data = await part.toBuffer().catch(() => null)
        if (!data || part.file.truncated)
          return fail('invalid', '图片 {name} 超过飞书的 10 MB 上限', { name })
        if (part.fieldname.startsWith(IMAGE_FIELD))
          images.set(part.fieldname.slice(IMAGE_FIELD.length), { name, data })
      }

      let card: Json
      try {
        card = JSON.parse(raw ?? '')
      } catch {
        return fail('invalid', '卡片不是合法的 JSON')
      }
      if (
        !isObject(card) ||
        card.schema !== '2.0' ||
        !isObject(card.body) ||
        !Array.isArray(card.body.elements)
      )
        return fail('invalid', '卡片须是飞书卡片 JSON 2.0：schema 为 "2.0"，内容放在 body.elements')
      const used = strings(card)
      for (const key of images.keys())
        if (!used.has(key)) return fail('invalid', '卡片里没有用到图片占位符 {key}', { key })

      const chat = await boundChat(ctx.db, run.groupId)
      if (!chat) return fail('conflict', '本群未关联飞书群，无法发送飞书卡片')
      const bot = await appOfBot(ctx, run.botId)
      if (!bot) return fail('conflict', '空间未配置飞书应用，无法发送飞书卡片')
      const creds = credsOf(bot)
      const refused = (what: string) => (err: unknown) => {
        if (!(err instanceof FeishuError)) throw err
        return fail('conflict', '飞书拒绝了{what}：{reason}', { what, reason: `${err.code} ${err.message}` })
      }

      const keys = new Map<string, string>()
      for (const [key, img] of images)
        keys.set(key, await ctx.feishu.api.uploadImage(creds, img.data).catch(refused(img.name)))
      const filled = fill(card, keys) as object
      if (Buffer.byteLength(JSON.stringify(filled)) > CARD_MAX_BYTES)
        return fail('invalid', '卡片超过飞书的 30 KB 上限')

      const [trigger] = await ctx.db
        .select({ feishuMessageId: feishuMessageLinks.feishuMessageId, chatId: feishuMessageLinks.chatId })
        .from(feishuMessageLinks)
        .where(and(eq(feishuMessageLinks.messageId, run.trigger), eq(feishuMessageLinks.kind, 'message')))
      const replyTo = trigger?.chatId === chat.chatId ? trigger.feishuMessageId : undefined
      const sent = await ctx.feishu.api
        .send(creds, chat.chatId, cardBody(filled), { replyTo })
        .catch(refused('卡片'))
      await ctx.db.insert(feishuMessageLinks).values({
        feishuMessageId: sent.messageId,
        chatId: chat.chatId,
        appId: bot.appId,
        direction: 'out',
        kind: 'custom_card',
        runId: run.id,
      })
      return { chat: chat.name }
    })
  }
}
