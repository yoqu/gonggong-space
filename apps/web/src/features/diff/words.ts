import type { DiffRow } from './patch'
import type { DiffBlock } from './split'

/** A changed stretch of a line, [start, end) in string offsets. */
export type WordRange = [start: number, end: number]

/** What a changed stretch is made of: words, or single characters (IDEA's Highlight characters). */
export type MarkUnit = 'words' | 'chars'
const TOKEN: Record<MarkUnit, RegExp> = {
  /** Words, runs of whitespace, and any other single character (punctuation, each CJK character). */
  words: /[\w$]+|\s+|[^\w$\s]/gu,
  chars: /[\s\S]/gu,
}
/** Longer lines (minified code, data) keep plain line tints. */
const MAX_LINE = 500
/** Token pairs one line pair may compare once its common start and end are cut off. */
const MAX_CELLS = 40_000
/** Pairs sharing less of their non-blank text are rewrites: marking words would light up nearly everything. */
const MIN_COMMON = 0.3

/** The changed ranges of an edited line on each side; null when the pair is too long or too different to mark. */
export function wordDiff(a: string, b: string, unit: MarkUnit = 'words'): [WordRange[], WordRange[]] | null {
  if (a.length > MAX_LINE || b.length > MAX_LINE) return null
  const x = a.match(TOKEN[unit]) ?? []
  const y = b.match(TOKEN[unit]) ?? []
  let head = 0
  while (head < x.length && head < y.length && x[head] === y[head]) head++
  let tail = 0
  while (tail < x.length - head && tail < y.length - head && x.at(-1 - tail) === y.at(-1 - tail)) tail++
  const n = x.length - head - tail
  const m = y.length - head - tail
  if (n * m > MAX_CELLS) return null
  // lcs[i * w + j]: the longest common token run of the middles from x[head + i] and y[head + j] on.
  const w = m + 1
  const lcs = new Uint16Array((n + 1) * w)
  const at = (i: number, j: number) => lcs[i * w + j] ?? 0
  for (let i = n - 1; i >= 0; i--)
    for (let j = m - 1; j >= 0; j--)
      lcs[i * w + j] =
        x[head + i] === y[head + j] ? at(i + 1, j + 1) + 1 : Math.max(at(i + 1, j), at(i, j + 1))
  const keepX = x.map((_, k) => k < head || k >= head + n)
  const keepY = y.map((_, k) => k < head || k >= head + m)
  for (let i = 0, j = 0; i < n && j < m; ) {
    if (x[head + i] === y[head + j]) {
      keepX[head + i] = true
      keepY[head + j] = true
      i++
      j++
    } else if (at(i + 1, j) >= at(i, j + 1)) i++
    else j++
  }
  if (solid(x, keepX) + solid(y, keepY) < MIN_COMMON * (solid(x) + solid(y))) return null
  return [ranges(x, keepX), ranges(y, keepY)]
}

/** Non-blank characters of the tokens (only the kept ones when given). */
const solid = (tokens: string[], keep?: boolean[]) =>
  tokens.reduce((n, tk, k) => (tk.trim() && (!keep || keep[k]) ? n + tk.length : n), 0)

function ranges(tokens: string[], keep: boolean[]): WordRange[] {
  const out: WordRange[] = []
  let at = 0
  tokens.forEach((tk, k) => {
    if (!keep[k]) {
      const last = out.at(-1)
      if (last?.[1] === at) last[1] = at + tk.length
      else out.push([at, at + tk.length])
    }
    at += tk.length
  })
  return out
}

/** Changed ranges by row index, for each deleted line paired with an added one side by side. */
export function wordMarks(
  rows: DiffRow[],
  blocks: DiffBlock[],
  unit: MarkUnit = 'words',
): Map<number, WordRange[]> {
  const marks = new Map<number, WordRange[]>()
  for (const block of blocks) {
    if (!block.change) continue
    for (const [o, n] of block.pairs) {
      if (o === null || n === null) continue
      const a = rows[o]
      const b = rows[n]
      if (a?.kind !== 'del' || b?.kind !== 'add') continue
      const d = wordDiff(a.text, b.text, unit)
      if (d?.[0].length) marks.set(o, d[0])
      if (d?.[1].length) marks.set(n, d[1])
    }
  }
  return marks
}
