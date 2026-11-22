/** CJK text and full-width punctuation: a bare URL ends at whitespace, so `（http://x）。然后` would swallow them. */
export const CJK = /[\u2e80-\u9fff\uac00-\ud7af\uf900-\ufaff\ufe30-\ufe4f\uff00-\uffef]/

const URL_RE = /https?:\/\/[^\s<>"']+/g
const HTTP_SCHEME = /^https?:\/\//i
const ANY_SCHEME = /^[a-z][a-z0-9+.-]*:/i

/** Parse an http(s) URL; when `normalizeBare` is true, bare hosts like `example.com` default to `https://`. */
export function parseHttpUrl(raw: string, normalizeBare = false): { url: string; parsed: URL } | null {
  const s = raw.trim()
  if (!s || /\s/.test(s)) return null
  const candidate = HTTP_SCHEME.test(s) ? s : normalizeBare && !ANY_SCHEME.test(s) ? `https://${s}` : ''
  if (!candidate) return null
  try {
    const parsed = new URL(candidate)
    if ((parsed.protocol !== 'http:' && parsed.protocol !== 'https:') || !parsed.hostname) return null
    return { url: candidate, parsed }
  } catch {
    return null
  }
}
/** Sentence punctuation after a link, and a closing bracket the link did not open. */
const TRAILING = /[.,;:!?'"]+$/

const count = (s: string, c: string) => s.split(c).length - 1

function trim(url: string) {
  const cjk = url.search(CJK)
  let u = cjk < 0 ? url : url.slice(0, cjk)
  for (;;) {
    const next = u.replace(TRAILING, '')
    const cut = next.endsWith(')') && count(next, '(') < count(next, ')') ? next.slice(0, -1) : next
    if (cut === u) return u
    u = cut
  }
}

export type UrlPart = { text: string; url?: true }

/** Plain text cut into http(s) links and the text between them. */
export function splitUrls(text: string): UrlPart[] {
  const parts: UrlPart[] = []
  let at = 0
  for (const m of text.matchAll(URL_RE)) {
    const url = trim(m[0])
    if (url.length <= 'https://'.length) continue
    if (m.index > at) parts.push({ text: text.slice(at, m.index) })
    parts.push({ text: url, url: true })
    at = m.index + url.length
  }
  if (at < text.length) parts.push({ text: text.slice(at) })
  return parts.length ? parts : [{ text }]
}

/** Text whose links open in a new tab; a click on one stays with the link (not its row, bubble or banner). */
export function Linkified({ text }: { text: string }) {
  return splitUrls(text).map((p, i) =>
    p.url ? (
      <a
        // biome-ignore lint/suspicious/noArrayIndexKey: parts are positional and never reorder
        key={i}
        href={p.text}
        target="_blank"
        rel="noopener noreferrer"
        onClick={(e) => e.stopPropagation()}
      >
        {p.text}
      </a>
    ) : (
      p.text
    ),
  )
}
