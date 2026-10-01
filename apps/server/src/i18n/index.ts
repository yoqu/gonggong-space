import { AsyncLocalStorage } from 'node:async_hooks'
import {
  createTranslator,
  type I18nParams,
  type Locale,
  type ProtocolKey,
  protocolEn,
  resolveLocale,
} from '@gonggong/protocol'
import type { FastifyInstance } from 'fastify'
import { en } from './en.js'

const dict = { ...protocolEn, ...en }
export type MessageKey = keyof typeof dict
const translators = { zh: createTranslator('zh', dict), en: createTranslator('en', dict) }
const store = new AsyncLocalStorage<Locale>()

/** The requester's language (its Accept-Language); Chinese outside a request. */
export const locale = (): Locale => store.getStore() ?? 'zh'
export const t = (key: MessageKey, params?: I18nParams) => translators[locale()](key, params)
/** For text rendered outside a request, e.g. a web push in its subscriber's language. */
export const translator = (l: Locale) => translators[l]
/** Always Chinese: text persisted for every reader, e.g. an event's `body`. */
export const zh = (key: ProtocolKey, params?: I18nParams) => translators.zh(key, params)
export const zhText = translators.zh.text

export function localize(app: FastifyInstance) {
  app.addHook('onRequest', (req, _reply, done) =>
    store.run(resolveLocale(req.headers['accept-language']), done),
  )
}
