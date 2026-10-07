import { z } from 'zod'
import type * as tr from './translate.js'

export { createTranslator, interpolate, resolveLocale, type Translator } from './translate.js'

export const Locale = z.enum(['zh', 'en'])
export type Locale = tr.Locale

export type I18nText = tr.I18nText
export type I18nParams = tr.I18nParams
export const I18nText: z.ZodType<I18nText> = z.lazy(() =>
  z.object({
    key: z.string(),
    params: z.record(z.string(), z.union([z.string(), z.number(), I18nText])).optional(),
  }),
)
