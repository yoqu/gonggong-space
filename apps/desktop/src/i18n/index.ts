import { createTranslator } from '@gonggong/protocol'
import { locale } from '@web/i18n'
import { en } from './en'

export { locale, setLocale } from '@web/i18n'
export const t = createTranslator(locale, en)
