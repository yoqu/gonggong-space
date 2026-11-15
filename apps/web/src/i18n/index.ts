import { createTranslator } from '@gonggong/protocol'
import type { en } from './en'
import { locale } from './locale'

export { locale, setLocale } from './locale'

// Only English reads the dictionary, so Chinese never downloads it; the await holds importers back,
// so module-level t() calls still see it.
const dict = locale === 'en' ? (await import('./en')).en : ({} as typeof en)
export const t = createTranslator(locale, dict)

if (typeof document !== 'undefined') {
  document.documentElement.lang = locale === 'en' ? 'en' : 'zh-CN'
  if (document.title === '共工空间') document.title = t('共工空间')
}
