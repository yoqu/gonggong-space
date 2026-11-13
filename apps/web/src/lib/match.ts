type PinyinMatch = typeof import('pinyin-pro').match

let pinyin: PinyinMatch | undefined
// The dictionary (~140 KB gzip) stays out of the first load; before it arrives names match literally.
export const pinyinReady = import('pinyin-pro').then((m) => {
  pinyin = m.match
})

const HAN = /[㐀-鿿]/

/**
 * Indices of `text` hit by `query`, null = no match. Case-insensitive substring first, then pinyin for Chinese text:
 * full, initials or mixed, any case (「jwc」「JiangWC」「weichuan」→ 姜维川; polyphones such as 重庆「cq」).
 */
export function matchText(text: string, query: string): number[] | null {
  const q = query.trim().toLowerCase()
  if (!q) return []
  const i = text.toLowerCase().indexOf(q)
  if (i >= 0) return Array.from({ length: q.length }, (_, k) => i + k)
  return pinyin && HAN.test(text) ? (pinyin(text, q) ?? null) : null
}

/** Whether any of the fields matches `query` (an empty query matches everything). */
export const matchAny = (query: string, ...fields: (string | null | undefined)[]) =>
  !query.trim() || fields.some((f) => !!f && matchText(f, query) !== null)
