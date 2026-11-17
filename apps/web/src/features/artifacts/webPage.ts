import { ArtifactLinkRatio } from '@gonggong/protocol'
import { t } from '../../i18n'
import type { IconName } from '../../ui'

/** What the manifest takes as a link's URL (protocol `GgArtifactLink.url`). */
export const HTTP_URL = /^https?:\/\/[^\s"'<>\\`]+$/i
export const URL_MAX = 2000
export const validUrl = (url: string) => url.length <= URL_MAX && HTTP_URL.test(url)

const FEISHU = /(^|\.)(feishu\.cn|feishu\.net|larksuite\.com|larkoffice\.com)$/i
/** The URL's host; the URL itself when it does not parse (the pattern above lets a few such through). */
export function hostOf(url: string) {
  try {
    return new URL(url).hostname
  } catch {
    return url
  }
}
export const isFeishu = (url: string) => FEISHU.test(hostOf(url))
/** No favicons from the page's site: a Feishu doc gets the doc icon, anything else the globe. */
export const linkIcon = (url: string): IconName => (isFeishu(url) ? 'doc' : 'globe')
export const ratioItems = () =>
  ArtifactLinkRatio.options.map((r) => ({ value: r, label: r === 'free' ? t('自由') : r }))
