import type { ContextMessage } from '@gonggong/protocol'

/** Hangul Jamo, CJK radicals … Hangul syllables, compatibility ideographs and forms, full-width forms, CJK ext. B+. */
const WIDE = /[ᄀ-ᅟ⺀-〾ぁ-㏿㐀-䶿一-鿿ꥠ-꥿가-힯豈-﫿︰-﹏＀-｠￠-￦\u{20000}-\u{3FFFD}]/u

const charTokens = (c: string) => (WIDE.test(c) ? 1 : 0.25)

/** Rough token count: CJK / full-width characters ≈ 1 token each, other text ≈ 4 characters per token. */
export function estimateTokens(text: string): number {
  let wide = 0
  let other = 0
  for (const c of text) {
    if (WIDE.test(c)) wide++
    else other++
  }
  return wide + Math.ceil(other / 4)
}

/** Tokens of one context line as the daemon renders it: `[#seq time] author: body（附件：…）`. */
export function messageTokens(m: ContextMessage): number {
  const files = m.attachments.length
    ? `（附件：${m.attachments.map((a) => `.gonggong/attachments/${a.messageId}/${a.name}`).join('、')}）`
    : ''
  return estimateTokens(`[#${m.seq} 2026-01-01 00:00 UTC] ${m.author}: ${m.body}${files}\n`)
}

// Agent-facing: not translated.
const clipNote = (seq: number) => `…（已截断，全文用 list_messages(around=${seq}) 查看）`

function clip(m: ContextMessage, budget: number): ContextMessage {
  const note = clipNote(m.seq)
  let room = budget - messageTokens({ ...m, body: note }) - 1
  let body = ''
  for (const c of m.body) {
    room -= charTokens(c)
    if (room < 0) break
    body += c
  }
  return { ...m, body: body + note }
}

/**
 * The newest messages (given newest first) whose total stays within `budget` tokens, stopping at the first that
 * does not fit; a newest message too long on its own is clipped to the budget. `complete`: every row was kept whole.
 */
export function fitBudget(newestFirst: ContextMessage[], budget: number) {
  const kept: ContextMessage[] = []
  let used = 0
  for (const m of newestFirst) {
    const cost = messageTokens(m)
    if (used + cost > budget) {
      if (!kept.length) kept.push(clip(m, budget))
      return { kept, complete: false }
    }
    used += cost
    kept.push(m)
  }
  return { kept, complete: true }
}
