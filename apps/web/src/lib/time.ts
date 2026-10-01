import { locale, t } from '../i18n'

/** BCP 47 tag for `Intl` date formatting. */
export const dateLocale = locale === 'en' ? 'en-US' : 'zh-CN'

export const pad = (n: number) => String(n).padStart(2, '0')

/** Local HH:mm. */
export const hm = (iso: string) => {
  const d = new Date(iso)
  return `${pad(d.getHours())}:${pad(d.getMinutes())}`
}

/** mm:ss left, rounded up so it reaches 00:00 only when time is up. */
export const countdown = (ms: number) => {
  const s = Math.max(0, Math.ceil(ms / 1000))
  return `${pad(Math.floor(s / 60))}:${pad(s % 60)}`
}

export function ago(iso: string) {
  const min = Math.floor((Date.now() - Date.parse(iso)) / 60_000)
  if (min < 1) return t('刚刚')
  if (min < 60) return t('{n} 分钟前', { n: min })
  if (min < 1440) return t('{n} 小时前', { n: Math.floor(min / 60) })
  return t('{n} 天前', { n: Math.floor(min / 1440) })
}
