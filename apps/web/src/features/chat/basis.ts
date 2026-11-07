const HEADING = /^(?:\*\*(?:依据|Basis)\*\*|#{2,3}\s*(?:依据|Basis))\s*[:：]?\s*/
const FENCE = /^\s*(`{3,}|~{3,})/

/**
 * A reply's last 依据 / Basis section (business-tone groups end replies with one), split off so it can fold:
 * `main` before its heading, `basis` after it. Null without one, or when either side would be empty.
 */
export function splitBasis(body: string): { main: string; basis: string } | null {
  const lines = body.split('\n')
  let fence: string | null = null
  let at = -1
  lines.forEach((line, i) => {
    const mark = FENCE.exec(line)?.[1]
    if (mark && (!fence || (mark[0] === fence[0] && mark.length >= fence.length))) fence = fence ? null : mark
    else if (!fence && HEADING.test(line)) at = i
  })
  if (at < 0) return null
  const main = lines.slice(0, at).join('\n').trim()
  const basis = [lines[at]?.replace(HEADING, '') ?? '', ...lines.slice(at + 1)].join('\n').trim()
  return main && basis ? { main, basis } : null
}
