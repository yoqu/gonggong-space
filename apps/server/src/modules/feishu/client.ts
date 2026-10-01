import type { Readable } from 'node:stream'
import * as lark from '@larksuiteoapi/node-sdk'

/** An app's credentials (secret already unsealed). */
export interface FeishuCreds {
  appId: string
  appSecret: string
}

/** A message body as the Feishu IM API takes it: `content` is the JSON string for `msgType`. */
export interface FeishuBody {
  msgType: 'text' | 'post' | 'interactive' | 'image' | 'file'
  content: string
}

export interface FeishuTokens {
  accessToken: string
  refreshToken: string | null
  expiresAt: Date
  refreshExpiresAt: Date | null
}

export interface FeishuUser {
  unionId: string
  openId: string
  /** Tenant-wide id; null without the field scope. */
  userId: string | null
  name: string
  email: string | null
  avatar: string | null
}

export interface FeishuChat {
  chatId: string
  name: string
  avatar: string | null
}

export interface FeishuHistoryItem {
  messageId: string
  msgType: string
  /** Raw JSON content as Feishu returns it. */
  content: string
  /** open_id (user) or app id (bot) of the sender. */
  senderId: string
  senderType: 'user' | 'app'
  createdAt: Date
}

/** Failure reported by Feishu (`code` is Feishu's error code, 0 when the request itself failed). */
export class FeishuError extends Error {
  constructor(
    readonly code: number,
    message: string,
  ) {
    super(message)
  }
}

/** The Feishu open API surface 共工 uses; the server swaps in a fake in tests. Every call throws FeishuError. */
export interface FeishuApi {
  /** Fetches a tenant token: proves the App ID / Secret pair. */
  verify(app: FeishuCreds): Promise<void>
  /** Sends to a chat as the app, or as the user when `userToken` is given; `replyTo` replies to that message. */
  send(
    app: FeishuCreds,
    chatId: string,
    body: FeishuBody,
    opts?: { replyTo?: string; userToken?: string },
  ): Promise<{ messageId: string }>
  /** Replaces the content of a card message the app sent. */
  updateCard(app: FeishuCreds, messageId: string, card: string): Promise<void>
  /** Edits a text / post message its sender (the app, or the user of `userToken`) sent. */
  edit(app: FeishuCreds, messageId: string, body: FeishuBody, userToken?: string): Promise<void>
  recall(app: FeishuCreds, messageId: string, userToken?: string): Promise<void>
  /** A file or image attached to a message the app can see. */
  download(app: FeishuCreds, messageId: string, fileKey: string, type: 'image' | 'file'): Promise<Buffer>
  /** The authorization page of the app's OAuth (web login). */
  authorizeUrl(appId: string, redirectUri: string, state: string): string
  exchangeCode(app: FeishuCreds, code: string, redirectUri: string): Promise<FeishuTokens>
  refresh(app: FeishuCreds, refreshToken: string): Promise<FeishuTokens>
  userInfo(app: FeishuCreds, userToken: string): Promise<FeishuUser>
  /** Chats the app's bot is in. */
  listChats(app: FeishuCreds): Promise<FeishuChat[]>
  /** Recent messages of a chat read as the user, oldest first, ending before `before` when given. */
  listMessages(
    app: FeishuCreds,
    chatId: string,
    userToken: string,
    opts: { before?: Date; limit: number },
  ): Promise<FeishuHistoryItem[]>
  /** Adds the bot of `botAppId` to the chat (the calling app must be in it). */
  addBot(app: FeishuCreds, chatId: string, botAppId: string): Promise<void>
}

type Res<T> = { code?: number; msg?: string; data?: T }

function ok<T>(res: Res<T>): T {
  if (res.code) throw new FeishuError(res.code, res.msg ?? 'feishu error')
  return res.data as T
}

/** axios rejects 4xx/5xx; Feishu puts its code and message in the body. */
async function call<T>(p: Promise<Res<T>>): Promise<T> {
  try {
    return ok(await p)
  } catch (err) {
    if (err instanceof FeishuError) throw err
    const data = (err as { response?: { data?: { code?: number; msg?: string } } }).response?.data
    throw new FeishuError(data?.code ?? 0, data?.msg ?? (err as Error).message)
  }
}

const at = (seconds: number | undefined, now = Date.now()) =>
  seconds ? new Date(now + seconds * 1000) : null

function tokens(r: lark.AccessTokenResponse): FeishuTokens {
  return {
    accessToken: r.accessToken,
    refreshToken: r.refreshToken ?? null,
    expiresAt: at(r.expiresIn) ?? new Date(),
    refreshExpiresAt: at(r.refreshTokenExpiresIn),
  }
}

async function buffer(stream: Readable) {
  const chunks: Buffer[] = []
  for await (const chunk of stream) chunks.push(chunk as Buffer)
  return Buffer.concat(chunks)
}

/** Real implementation on `@larksuiteoapi/node-sdk`; one cached SDK client (and tenant token) per app. */
export function larkApi(): FeishuApi {
  const clients = new Map<string, { secret: string; client: lark.Client }>()
  const client = ({ appId, appSecret }: FeishuCreds) => {
    const hit = clients.get(appId)
    if (hit?.secret === appSecret) return hit.client
    const fresh = new lark.Client({ appId, appSecret, loggerLevel: lark.LoggerLevel.warn })
    clients.set(appId, { secret: appSecret, client: fresh })
    return fresh
  }
  const as = (userToken?: string) => (userToken ? lark.withUserAccessToken(userToken) : undefined)

  return {
    async verify(app) {
      await call(
        client(app).auth.v3.tenantAccessToken.internal({
          data: { app_id: app.appId, app_secret: app.appSecret },
        }),
      )
    },

    async send(app, chatId, body, opts = {}) {
      const data = { msg_type: body.msgType, content: body.content }
      const sent = opts.replyTo
        ? await call(
            client(app).im.v1.message.reply({ path: { message_id: opts.replyTo }, data }, as(opts.userToken)),
          )
        : await call(
            client(app).im.v1.message.create(
              { params: { receive_id_type: 'chat_id' }, data: { ...data, receive_id: chatId } },
              as(opts.userToken),
            ),
          )
      if (!sent?.message_id) throw new FeishuError(0, 'no message_id')
      return { messageId: sent.message_id }
    },

    async updateCard(app, messageId, card) {
      await call(
        client(app).im.v1.message.patch({ path: { message_id: messageId }, data: { content: card } }),
      )
    },

    async edit(app, messageId, body, userToken) {
      await call(
        client(app).im.v1.message.update(
          { path: { message_id: messageId }, data: { msg_type: body.msgType, content: body.content } },
          as(userToken),
        ),
      )
    },

    async recall(app, messageId, userToken) {
      await call(client(app).im.v1.message.delete({ path: { message_id: messageId } }, as(userToken)))
    },

    async download(app, messageId, fileKey, type) {
      try {
        const res = await client(app).im.v1.messageResource.get({
          params: { type },
          path: { message_id: messageId, file_key: fileKey },
        })
        return await buffer(res.getReadableStream())
      } catch (err) {
        const data = (err as { response?: { data?: { code?: number; msg?: string } } }).response?.data
        throw new FeishuError(data?.code ?? 0, data?.msg ?? (err as Error).message)
      }
    },

    authorizeUrl(appId, redirectUri, state) {
      const q = new URLSearchParams({
        client_id: appId,
        response_type: 'code',
        redirect_uri: redirectUri,
        state,
      })
      return `https://accounts.feishu.cn/open-apis/authen/v1/authorize?${q}`
    },

    async exchangeCode(app, code, redirectUri) {
      try {
        return tokens(await client(app).accessToken.retrieveByAuthorizationCode({ code, redirectUri }))
      } catch (err) {
        throw new FeishuError(0, (err as Error).message)
      }
    },

    async refresh(app, refreshToken) {
      try {
        return tokens(await client(app).accessToken.refresh({ refreshToken }))
      } catch (err) {
        throw new FeishuError(0, (err as Error).message)
      }
    },

    async userInfo(app, userToken) {
      const u = await call(client(app).authen.v1.userInfo.get(undefined, lark.withUserAccessToken(userToken)))
      if (!u?.union_id || !u.open_id) throw new FeishuError(0, 'no union_id')
      return {
        unionId: u.union_id,
        openId: u.open_id,
        userId: u.user_id ?? null,
        name: u.name ?? '',
        email: u.enterprise_email || u.email || null,
        avatar: u.avatar_url ?? null,
      }
    },

    async listChats(app) {
      const out: FeishuChat[] = []
      try {
        for await (const page of await client(app).im.v1.chat.listWithIterator({
          params: { page_size: 100 },
        }))
          for (const c of page?.items ?? [])
            if (c.chat_id) out.push({ chatId: c.chat_id, name: c.name ?? '', avatar: c.avatar ?? null })
      } catch (err) {
        if (err instanceof FeishuError) throw err
        throw new FeishuError(0, (err as Error).message)
      }
      return out
    },

    async listMessages(app, chatId, userToken, { before, limit }) {
      const data = await call(
        client(app).im.v1.message.list(
          {
            params: {
              container_id_type: 'chat',
              container_id: chatId,
              sort_type: 'ByCreateTimeDesc',
              page_size: limit,
              ...(before && { end_time: String(Math.floor(before.getTime() / 1000)) }),
            },
          },
          lark.withUserAccessToken(userToken),
        ),
      )
      return (data?.items ?? [])
        .map((m) => ({
          messageId: m.message_id ?? '',
          msgType: m.msg_type ?? '',
          content: m.body?.content ?? '',
          senderId: m.sender?.id ?? '',
          senderType: (m.sender?.sender_type === 'app' ? 'app' : 'user') as 'user' | 'app',
          createdAt: new Date(Number(m.create_time ?? 0)),
        }))
        .reverse()
    },

    async addBot(app, chatId, botAppId) {
      await call(
        client(app).im.v1.chatMembers.create({
          path: { chat_id: chatId },
          params: { member_id_type: 'app_id' },
          data: { id_list: [botAppId] },
        }),
      )
    },
  }
}
