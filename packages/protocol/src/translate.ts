// Free of zod, so clients that only translate (the desktop app) don't bundle it.

export type Locale = 'zh' | 'en'

/** A translatable text: `key` is the Chinese source template; a param may itself be a translatable text. */
export type I18nText = { key: string; params?: I18nParams }
export type I18nParams = { [name: string]: string | number | I18nText }

/** Chinese unless the tag names another language: an unset, `C` or `POSIX` environment keeps the default. */
export function resolveLocale(tag?: string | null): Locale {
  const t = tag?.split(/[,;]/)[0]?.trim().toLowerCase() ?? ''
  return !t || t === '*' || t.startsWith('zh') || t === 'c' || t.startsWith('c.') || t === 'posix'
    ? 'zh'
    : 'en'
}

/**
 * Fills `{name}` placeholders; `{n:item|items}` picks the singular when `n` is 1.
 * Nested texts are translated with `tr`.
 */
export function interpolate(template: string, params: I18nParams | undefined, tr: (t: I18nText) => string) {
  if (!params) return template
  const value = (k: string) => {
    const v = params[k]
    return v === undefined ? undefined : typeof v === 'object' ? tr(v) : String(v)
  }
  return template.replace(
    /\{(\w+)(?::([^|}]*)\|([^}]*))?\}/g,
    (m, k: string, one?: string, other?: string) => {
      if (one === undefined) return value(k) ?? m
      return Number(params[k]) === 1 ? one : (other ?? '')
    },
  )
}

/**
 * Gettext style: the Chinese source is the key; English comes from `en`, falling back to the source.
 * A `#context` suffix tells apart identical Chinese with different English (`'关闭#off'`); Chinese drops it.
 */
export function createTranslator<D extends Record<string, string>>(locale: Locale, en: D) {
  const dict: Record<string, string> = en
  const text = (t: I18nText): string =>
    interpolate((locale === 'en' ? dict[t.key] : undefined) ?? t.key.replace(/#[a-z]+$/, ''), t.params, text)
  const t = (key: keyof D & string, params?: I18nParams) => text({ key, params })
  return Object.assign(t, { text })
}
export type Translator<D extends Record<string, string>> = ReturnType<typeof createTranslator<D>>
