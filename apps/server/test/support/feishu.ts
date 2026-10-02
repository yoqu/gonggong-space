import type { FeishuAppStatus } from '@gonggong/protocol'
import {
  type FeishuApi,
  type FeishuBody,
  type FeishuChat,
  type FeishuCreds,
  type FeishuDevConfig,
  FeishuError,
  type FeishuHistoryItem,
  FeishuRegisterError,
  type FeishuRegistration,
  type FeishuTokens,
  type FeishuUser,
} from '../../src/modules/feishu/client.js'
import type { FeishuConnector, FeishuEventType, FeishuInbound } from '../../src/modules/feishu/gateway.js'

type Hooks = Parameters<FeishuConnector['connect']>[1]

export interface SentMessage {
  appId: string
  chatId: string
  messageId: string
  msgType: FeishuBody['msgType']
  /** Parsed `content`. */
  content: Record<string, unknown>
  replyTo?: string
  /** Sent as this user (token) instead of as the app. */
  userToken?: string
}

/** A Feishu user of the fake tenant; `fake.user()` fills the ids. */
export type FakeUser = FeishuUser

/**
 * In-memory Feishu for server tests: records every outbound call and delivers inbound events through the
 * connection the gateway opened for an app, exactly as the real long connection would.
 */
export class FakeFeishu {
  /** App IDs whose credentials fail `verify` (and whose connection reports an error). */
  readonly invalid = new Set<string>()
  readonly sent: SentMessage[] = []
  readonly cardUpdates: { appId: string; messageId: string; card: Record<string, unknown> }[] = []
  readonly edits: { appId: string; messageId: string; body: FeishuBody; userToken?: string }[] = []
  readonly recalls: { appId: string; messageId: string; userToken?: string }[] = []
  readonly botsAdded: { appId: string; chatId: string; botAppId: string }[] = []
  /** Images uploaded per app; the key is `img_<n>`. */
  readonly images: { appId: string; key: string; data: Buffer }[] = []
  /** Emoji reactions added through the API; `removed` once taken back. */
  readonly reactions: {
    appId: string
    messageId: string
    emoji: string
    reactionId: string
    removed: boolean
  }[] = []
  /** CardKit entities by card_id: current JSON and streaming state. */
  readonly cards = new Map<string, { appId: string; card: Record<string, unknown>; streaming: boolean }>()
  /** Every CardKit operation in call order. */
  readonly cardOps: {
    cardId: string
    op: 'update' | 'text' | 'settings'
    sequence: number
    elementId?: string
    text?: string
    data?: Record<string, unknown>
  }[] = []
  /** `createCard` fails with this message when set (e.g. the app lacks cardkit:card:write). */
  cardkitError: string | null = null
  /** Chats each app's bot is in. */
  readonly chats = new Map<string, FeishuChat[]>()
  /** Chat history by chat id, oldest first (read by `listMessages`). */
  readonly history = new Map<string, FeishuHistoryItem[]>()
  /** Attachments by file key. */
  readonly files = new Map<string, Buffer>()
  /** Dev config applied per app (`configure`). */
  readonly configs: { appId: string; config: FeishuDevConfig }[] = []
  /** `configure` fails with this message when set. */
  configureError: string | null = null
  /** 扫码创建 sessions waiting for the admin to scan; settle them with `approve` / `deny`. */
  readonly registrations: (FeishuRegistration & { url: string; settle: (r: FeishuCreds | Error) => void })[] =
    []
  private readonly codes = new Map<string, FakeUser>()
  private readonly tokens = new Map<string, FakeUser>()
  private readonly conns = new Map<string, { hooks: Hooks; open: boolean }>()
  private n = 0

  private next(prefix: string) {
    return `${prefix}_${++this.n}`
  }

  /** A tenant user; pass the result to `authorize` / `message`. */
  user(o: Partial<FakeUser> = {}): FakeUser {
    const k = ++this.n
    return {
      unionId: `on_${k}`,
      openId: `ou_${k}`,
      userId: `uid_${k}`,
      name: `飞书用户${k}`,
      email: `user${k}@example.com`,
      avatar: null,
      ...o,
    }
  }

  /** The `code` the authorization page would redirect back with after `user` consents. */
  authorize(user: FakeUser) {
    const code = this.next('code')
    this.codes.set(code, user)
    return code
  }

  /** The admin confirms the newest registration on Feishu: it yields these credentials. */
  approve(creds: FeishuCreds) {
    this.pending().settle(creds)
  }

  /** The newest registration ends without an app ('access_denied', 'expired_token', …). */
  deny(reason = 'access_denied') {
    this.pending().settle(new FeishuRegisterError(reason, reason))
  }

  private pending() {
    const r = this.registrations.at(-1)
    if (!r) throw new Error('no pending Feishu registration')
    return r
  }

  /** Whether the gateway currently holds an open connection for the app. */
  connected(appId: string) {
    return this.conns.get(appId)?.open ?? false
  }

  /** Reports a connection state change of the app, as the SDK would. */
  setStatus(appId: string, status: FeishuAppStatus, error: string | null = null) {
    this.conn(appId).hooks.onStatus(status, error)
  }

  /** Delivers an inbound event to the app's connection; resolves with the handler's answer. */
  emit<K extends FeishuEventType>(appId: string, type: K, data: FeishuInbound[K]) {
    return this.conn(appId).hooks.onEvent(type, data)
  }

  /** A text message `from` sends to `chatId`, delivered to `appId` (@-mentioned users/bots via `mentions`). */
  message(
    appId: string,
    o: {
      chatId: string
      from: FakeUser
      text: string
      messageId?: string
      parentId?: string
      mentions?: { key: string; name: string; openId: string }[]
    },
  ) {
    const messageId = o.messageId ?? this.next('om')
    const done = this.emit(appId, 'im.message.receive_v1', {
      app_id: appId,
      sender: {
        sender_id: { union_id: o.from.unionId, open_id: o.from.openId, user_id: o.from.userId ?? undefined },
        sender_type: 'user',
      },
      message: {
        message_id: messageId,
        parent_id: o.parentId,
        root_id: o.parentId,
        create_time: String(Date.now()),
        chat_id: o.chatId,
        chat_type: 'group',
        message_type: 'text',
        content: JSON.stringify({ text: o.text }),
        mentions: o.mentions?.map((m) => ({ key: m.key, name: m.name, id: { open_id: m.openId } })),
      },
    })
    return { messageId, done }
  }

  /** `operator` clicks a card button (or submits a form) on a message `appId` sent. */
  cardAction(
    appId: string,
    o: {
      messageId: string
      chatId: string
      operator: FakeUser
      value: unknown
      formValue?: Record<string, unknown>
    },
  ) {
    return this.emit(appId, 'card.action.trigger', {
      operator: {
        open_id: o.operator.openId,
        union_id: o.operator.unionId,
        user_id: o.operator.userId ?? undefined,
      },
      action: { value: o.value, tag: 'button', form_value: o.formValue },
      context: { open_message_id: o.messageId, open_chat_id: o.chatId },
    })
  }

  recalled(appId: string, o: { messageId: string; chatId: string }) {
    return this.emit(appId, 'im.message.recalled_v1', {
      message_id: o.messageId,
      chat_id: o.chatId,
      recall_type: 'message_owner',
    })
  }

  private conn(appId: string) {
    const c = this.conns.get(appId)
    if (!c?.open) throw new Error(`no open Feishu connection for ${appId}`)
    return c
  }

  /** Text the card's `elementId` shows now: the last streamed text, else its content in the card JSON. */
  cardText(cardId: string, elementId: string) {
    const streamed = this.cardOps.findLast(
      (o) => o.cardId === cardId && o.op === 'text' && o.elementId === elementId,
    )
    const last = this.cardOps.findLast((o) => o.cardId === cardId && o.op !== 'settings')
    if (streamed && last === streamed) return streamed.text
    const elements = (
      this.cards.get(cardId)?.card.body as { elements?: { element_id?: string; content?: string }[] }
    )?.elements
    return elements?.find((e) => e.element_id === elementId)?.content
  }

  /** CardKit requires the creating app and a strictly growing sequence per card. */
  private cardOp(app: FeishuCreds, cardId: string, sequence: number) {
    this.check(app.appId)
    const entity = this.cards.get(cardId)
    if (!entity || entity.appId !== app.appId) throw new FeishuError(300301, 'card not found')
    const last = this.cardOps.findLast((o) => o.cardId === cardId)
    if (last && sequence <= last.sequence) throw new FeishuError(300317, 'sequence did not increase')
    return entity
  }

  private check(appId: string) {
    if (this.invalid.has(appId)) throw new FeishuError(10014, 'app secret invalid')
  }

  private userOf(token: string) {
    const user = this.tokens.get(token)
    if (!user) throw new FeishuError(99991668, 'user access token invalid')
    return user
  }

  private grant(user: FakeUser): FeishuTokens {
    const accessToken = this.next('u')
    const refreshToken = this.next('ur')
    this.tokens.set(accessToken, user)
    this.tokens.set(refreshToken, user)
    return {
      accessToken,
      refreshToken,
      expiresAt: new Date(Date.now() + 7200_000),
      refreshExpiresAt: new Date(Date.now() + 30 * 86400_000),
    }
  }

  readonly connector: FeishuConnector = {
    connect: (app, hooks) => {
      const c = { hooks, open: true }
      this.conns.set(app.appId, c)
      if (this.invalid.has(app.appId)) hooks.onStatus('error', 'app secret invalid')
      else hooks.onStatus('connected', null)
      return {
        close: () => {
          c.open = false
        },
      }
    },
  }

  readonly api: FeishuApi = {
    verify: async (app) => this.check(app.appId),
    send: async (app, chatId, body, opts = {}) => {
      this.check(app.appId)
      if (opts.userToken) this.userOf(opts.userToken)
      const messageId = this.next('om')
      this.sent.push({
        appId: app.appId,
        chatId,
        messageId,
        msgType: body.msgType,
        content: JSON.parse(body.content),
        ...(opts.replyTo && { replyTo: opts.replyTo }),
        ...(opts.userToken && { userToken: opts.userToken }),
      })
      return { messageId }
    },
    updateCard: async (app, messageId, card) => {
      this.check(app.appId)
      this.cardUpdates.push({ appId: app.appId, messageId, card: JSON.parse(card) })
    },
    edit: async (app, messageId, body, userToken) => {
      this.check(app.appId)
      this.edits.push({ appId: app.appId, messageId, body, ...(userToken && { userToken }) })
    },
    recall: async (app, messageId, userToken) => {
      this.check(app.appId)
      this.recalls.push({ appId: app.appId, messageId, ...(userToken && { userToken }) })
    },
    uploadImage: async (app, data) => {
      this.check(app.appId)
      const key = `img_${this.images.length + 1}`
      this.images.push({ appId: app.appId, key, data })
      return key
    },
    addReaction: async (app, messageId, emoji) => {
      this.check(app.appId)
      const reactionId = this.next('rc')
      this.reactions.push({ appId: app.appId, messageId, emoji, reactionId, removed: false })
      return reactionId
    },
    removeReaction: async (app, messageId, reactionId) => {
      this.check(app.appId)
      const r = this.reactions.find((x) => x.reactionId === reactionId && x.messageId === messageId)
      if (!r || r.removed) throw new FeishuError(231003, 'reaction not found')
      r.removed = true
    },
    createCard: async (app, card) => {
      this.check(app.appId)
      if (this.cardkitError) throw new FeishuError(99991672, this.cardkitError)
      const json = JSON.parse(card) as { config?: { streaming_mode?: boolean } }
      const cardId = this.next('card')
      this.cards.set(cardId, { appId: app.appId, card: json, streaming: !!json.config?.streaming_mode })
      return cardId
    },
    updateCardEntity: async (app, cardId, card, sequence) => {
      this.cardOp(app, cardId, sequence)
      const entity = this.cards.get(cardId)!
      entity.card = JSON.parse(card)
      this.cardOps.push({ cardId, op: 'update', sequence, data: entity.card })
    },
    streamText: async (app, cardId, elementId, text, sequence) => {
      const entity = this.cardOp(app, cardId, sequence)
      if (!entity.streaming) throw new FeishuError(300309, 'streaming mode is closed')
      this.cardOps.push({ cardId, op: 'text', sequence, elementId, text })
    },
    cardSettings: async (app, cardId, settings, sequence) => {
      const entity = this.cardOp(app, cardId, sequence)
      const data = JSON.parse(settings) as { config?: { streaming_mode?: boolean } }
      if (data.config?.streaming_mode !== undefined) entity.streaming = data.config.streaming_mode
      this.cardOps.push({ cardId, op: 'settings', sequence, data })
    },
    download: async (app, _messageId, fileKey) => {
      this.check(app.appId)
      const file = this.files.get(fileKey)
      if (!file) throw new FeishuError(234003, 'file not found')
      return file
    },
    authorizeUrl: (appId, redirectUri, state) =>
      `https://feishu.test/authorize?${new URLSearchParams({ client_id: appId, redirect_uri: redirectUri, state })}`,
    exchangeCode: async (app, code) => {
      this.check(app.appId)
      const user = this.codes.get(code)
      if (!user) throw new FeishuError(20003, 'invalid code')
      this.codes.delete(code)
      return this.grant(user)
    },
    refresh: async (app, refreshToken) => {
      this.check(app.appId)
      const user = this.userOf(refreshToken)
      this.tokens.delete(refreshToken)
      return this.grant(user)
    },
    userInfo: async (app, userToken) => {
      this.check(app.appId)
      return this.userOf(userToken)
    },
    listChats: async (app) => {
      this.check(app.appId)
      return this.chats.get(app.appId) ?? []
    },
    listMessages: async (app, chatId, userToken, { before, limit }) => {
      this.check(app.appId)
      this.userOf(userToken)
      const items = (this.history.get(chatId) ?? []).filter((m) => !before || m.createdAt < before)
      return items.slice(-limit)
    },
    addBot: async (app, chatId, botAppId) => {
      this.check(app.appId)
      this.botsAdded.push({ appId: app.appId, chatId, botAppId })
    },
    register: (reg) =>
      new Promise<FeishuCreds>((resolve, reject) => {
        const url = `https://feishu.test/register/${this.next('reg')}`
        const entry = {
          ...reg,
          url,
          settle: (r: FeishuCreds | Error) => {
            this.registrations.splice(this.registrations.indexOf(entry), 1)
            if (r instanceof Error) reject(r)
            else resolve(r)
          },
        }
        this.registrations.push(entry)
        reg.signal.addEventListener(
          'abort',
          () => entry.settle(new FeishuRegisterError('abort', 'aborted')),
          {
            once: true,
          },
        )
        reg.onUrl(url, 600)
      }),
    configure: async (app, config) => {
      this.check(app.appId)
      if (this.configureError) throw new FeishuError(99991672, this.configureError)
      this.configs.push({ appId: app.appId, config })
    },
  }
}
