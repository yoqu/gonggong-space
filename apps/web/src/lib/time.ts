import { locale, t } from '../i18n'

/** BCP 47 tag for `Intl` date formatting. */
export const dateLocale = locale === 'en' ? 'en-US' : 'zh-CN'

export const pad = (n: number) => String(n).padStart(2, '0')

/** Local HH:mm. */
export const hm = (iso: string) => {
  const d = new Date(iso)
  return `${pad(d.getHours())}:${pad(d.getMinutes())}`
}

/** Local HH:mm:ss. */
export const hms = (iso: string) => {
  const d = new Date(iso)
  return `${pad(d.getHours())}:${pad(d.getMinutes())}:${pad(d.getSeconds())}`
}

const ymd = (d: Date) => `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`

/** Local YYYY-MM-DD HH:mm:ss. */
export const fullTime = (iso: string) => `${ymd(new Date(iso))} ${hms(iso)}`

/** HH:mm:ss, with MM-DD in front when not on the day of `ref`. */
export const stamp = (iso: string, ref: string | null) => {
  const d = new Date(iso)
  return !ref || ymd(d) === ymd(new Date(ref)) ? hms(iso) : `${ymd(d).slice(5)} ${hms(iso)}`
}

/** mm:ss left, rounded up so it reaches 00:00 only when time is up. */
export const countdown = (ms: number) => {
  const s = Math.max(0, Math.ceil(ms / 1000))
  return `${pad(Math.floor(s / 60))}:${pad(s % 60)}`
}

export function ago(iso: string, now = Date.now()) {
  const min = Math.floor((now - Date.parse(iso)) / 60_000)
  if (min < 1) return t('刚刚')
  if (min < 60) return t('{n} 分钟前', { n: min })
  if (min < 1440) return t('{n} 小时前', { n: Math.floor(min / 60) })
  return t('{n} 天前', { n: Math.floor(min / 1440) })
}
