import { createTranslator, type Locale, resolveLocale } from '@gonggong/protocol'
import { en } from './en'

const KEY = 'gg.locale'

function stored() {
  try {
    return localStorage.getItem(KEY)
  } catch {
    return null
  }
}

const saved = stored()
export const locale: Locale = saved === 'zh' || saved === 'en' ? saved : resolveLocale(navigator.language)
export const t = createTranslator(locale, en)
export type MessageKey = keyof typeof en

/** Every text is resolved once at load, so a switch reloads the page. */
export function setLocale(next: Locale) {
  try {
    localStorage.setItem(KEY, next)
  } catch {}
  location.reload()
}

if (typeof document !== 'undefined') {
  document.documentElement.lang = locale === 'en' ? 'en' : 'zh-CN'
  if (document.title === '共工空间') document.title = t('共工空间')
}
