import { create } from 'zustand'

/** A changed run: base lines [bs, be) became side lines [ss, se). */
export interface Hunk {
  bs: number
  be: number
  ss: number
  se: number
}

/** Edit distance past which a diff stops looking for matches and calls the rest one change. */
const MAX_EDITS = 2000

/** The changes from `a` to `b` (Myers), lines compared through `key`. */
export function diffLines(a: string[], b: string[], key: (s: string) => string = (s) => s): Hunk[] {
  const ka = a.map(key)
  const kb = b.map(key)
  let pre = 0
  while (pre < ka.length && pre < kb.length && ka[pre] === kb[pre]) pre++
  let suf = 0
  while (
    suf < ka.length - pre &&
    suf < kb.length - pre &&
    ka[ka.length - 1 - suf] === kb[kb.length - 1 - suf]
  )
    suf++
  const x0 = ka.slice(pre, ka.length - suf)
  const y0 = kb.slice(pre, kb.length - suf)
  const matches = (myers(x0, y0) ?? []).map(([i, j]) => [i + pre, j + pre] as const)
  const hunks: Hunk[] = []
  let i = 0
  let j = 0
  for (const [mi, mj] of [
    ...Array.from({ length: pre }, (_, n) => [n, n] as const),
    ...matches,
    ...Array.from({ length: suf }, (_, n) => [ka.length - suf + n, kb.length - suf + n] as const),
    [ka.length, kb.length] as const,
  ]) {
    if (mi > i || mj > j) hunks.push({ bs: i, be: mi, ss: j, se: mj })
    i = mi + 1
    j = mj + 1
  }
  return hunks
}

/** The matched index pairs of a shortest edit script, or null past MAX_EDITS. */
function myers(a: string[], b: string[]): [number, number][] | null {
  const n = a.length
  const m = b.length
  const limit = Math.min(n + m, MAX_EDITS)
  const off = limit + 1
  const at = (v: Int32Array, k: number) => v[k + off] as number
  // Moving down (an insertion) from diagonal k+1 rather than right (a deletion) from k-1.
  const down = (v: Int32Array, k: number, d: number) => k === -d || (k !== d && at(v, k - 1) < at(v, k + 1))
  let v = new Int32Array(2 * off + 1)
  const trace: Int32Array[] = []
  for (let d = 0; d <= limit; d++) {
    trace.push(v)
    v = v.slice()
    for (let k = -d; k <= d; k += 2) {
      let x = down(v, k, d) ? at(v, k + 1) : at(v, k - 1) + 1
      let y = x - k
      while (x < n && y < m && a[x] === b[y]) {
        x++
        y++
      }
      v[k + off] = x
      if (x >= n && y >= m) return backtrack(trace, at, down, n, m)
    }
  }
  return null
}

function backtrack(
  trace: Int32Array[],
  at: (v: Int32Array, k: number) => number,
  down: (v: Int32Array, k: number, d: number) => boolean,
  n: number,
  m: number,
): [number, number][] {
  const out: [number, number][] = []
  let x = n
  let y = m
  for (let d = trace.length - 1; d >= 0; d--) {
    const v = trace[d] as Int32Array
    const k = x - y
    const prevK = down(v, k, d) ? k + 1 : k - 1
    const prevX = d === 0 ? 0 : at(v, prevK)
    const prevY = d === 0 ? 0 : prevX - prevK
    while (x > prevX && y > prevY) {
      x--
      y--
      out.push([x, y])
    }
    x = prevX
    y = prevY
  }
  return out.reverse()
}

export type PieceKind = 'same' | 'ours' | 'theirs' | 'both' | 'conflict'

/**
 * A stretch of the three-way merge, each side's lines of it: agreed on, changed by one side only, changed alike by both,
 * or changed differently (a conflict).
 */
export interface Piece {
  kind: PieceKind
  base: string[]
  ours: string[]
  theirs: string[]
}

export const noWhitespace = (s: string) => s.replace(/\s+/g, '')

/**
 * base → ours and base → theirs as pieces. Changes to the same or touching base lines conflict (as git has it); the
 * lines both sides start or end a conflict with alike are moved out of it, as zdiff3 does.
 */
export function threeWay(
  base: string[],
  ours: string[],
  theirs: string[],
  ignoreWhitespace = false,
): Piece[] {
  const key = ignoreWhitespace ? noWhitespace : (s: string) => s
  const ho = diffLines(base, ours, key)
  const ht = diffLines(base, theirs, key)
  const out: Piece[] = []
  let i = 0
  let j = 0
  let pos = 0
  // Side line minus base line, past the hunks walked.
  let dOurs = 0
  let dTheirs = 0
  const same = (to: number) => {
    if (to > pos)
      out.push({
        kind: 'same',
        base: base.slice(pos, to),
        ours: ours.slice(pos + dOurs, to + dOurs),
        theirs: theirs.slice(pos + dTheirs, to + dTheirs),
      })
  }
  while (i < ho.length || j < ht.length) {
    const o0 = ho[i]
    const t0 = ht[j]
    const first = (o0 && (!t0 || o0.bs <= t0.bs) ? o0 : t0) as Hunk
    const go: Hunk[] = []
    const gt: Hunk[] = []
    if (first === o0) go.push(ho[i++] as Hunk)
    else gt.push(ht[j++] as Hunk)
    const bs = first.bs
    let be = first.be
    // Pull in every hunk of either side that overlaps or touches the run so far.
    for (;;) {
      const o = ho[i]
      const t = ht[j]
      const h = o && o.bs <= be ? o : t && t.bs <= be ? t : null
      if (!h) break
      if (h === o) go.push(ho[i++] as Hunk)
      else gt.push(ht[j++] as Hunk)
      be = Math.max(be, h.be)
    }
    same(bs)
    const span = (hs: Hunk[], d: number, side: string[]) => {
      const f = hs[0]
      const l = hs.at(-1)
      return f && l ? side.slice(f.ss - (f.bs - bs), l.se + (be - l.be)) : side.slice(bs + d, be + d)
    }
    const b = base.slice(bs, be)
    const o = span(go, dOurs, ours)
    const t = span(gt, dTheirs, theirs)
    for (const h of go) dOurs += h.se - h.ss - (h.be - h.bs)
    for (const h of gt) dTheirs += h.se - h.ss - (h.be - h.bs)
    pos = be
    if (!gt.length) out.push({ kind: 'ours', base: b, ours: o, theirs: t })
    else if (!go.length) out.push({ kind: 'theirs', base: b, ours: o, theirs: t })
    else out.push(...conflict(b, o, t, key))
  }
  same(base.length)
  return out
}

/** Both sides changed these lines: alike, or a conflict without the lines they start and end with alike. */
function conflict(base: string[], ours: string[], theirs: string[], key: (s: string) => string): Piece[] {
  const eq = (a: string | undefined, b: string | undefined) => a != null && b != null && key(a) === key(b)
  if (ours.length === theirs.length && ours.every((l, n) => eq(l, theirs[n])))
    return [{ kind: 'both', base, ours, theirs }]
  let pre = 0
  while (pre < ours.length && pre < theirs.length && eq(ours[pre], theirs[pre])) pre++
  let suf = 0
  while (
    suf < ours.length - pre &&
    suf < theirs.length - pre &&
    eq(ours[ours.length - 1 - suf], theirs[theirs.length - 1 - suf])
  )
    suf++
  const both = (o: string[], t: string[]): Piece[] =>
    o.length ? [{ kind: 'both', base: [], ours: o, theirs: t }] : []
  return [
    ...both(ours.slice(0, pre), theirs.slice(0, pre)),
    {
      kind: 'conflict',
      base,
      ours: ours.slice(pre, ours.length - suf),
      theirs: theirs.slice(pre, theirs.length - suf),
    },
    ...both(ours.slice(ours.length - suf), theirs.slice(theirs.length - suf)),
  ]
}

/**
 * IDEA's Resolve Simple Conflicts: both sides' changes merged line by line when none overlap (nor insert at the same
 * place, unless alike); null otherwise.
 */
export function simpleMerge(base: string[], ours: string[], theirs: string[]): string[] | null {
  const hunks = [
    ...diffLines(base, ours).map((h) => ({ ...h, lines: ours.slice(h.ss, h.se) })),
    ...diffLines(base, theirs).map((h) => ({ ...h, lines: theirs.slice(h.ss, h.se) })),
  ].sort((a, b) => a.bs - b.bs || a.be - b.be)
  const out: string[] = []
  let pos = 0
  let last: (typeof hunks)[number] | null = null
  for (const h of hunks) {
    if (last) {
      const alike = last.bs === h.bs && last.be === h.be && last.lines.join('\n') === h.lines.join('\n')
      if (alike) continue
      if (h.bs < last.be || (h.bs === last.bs && h.be === h.bs && last.be === last.bs)) return null
    }
    out.push(...base.slice(pos, h.bs), ...h.lines)
    pos = h.be
    last = h
  }
  out.push(...base.slice(pos))
  return out
}

/** Where a side of a change stands: not decided yet, taken into the result, or left out (or not changed at all). */
export type SideState = 'open' | 'applied' | 'ignored'

/** A piece in the result: its lines there, each side's state, and whether it was typed into. */
export interface PieceState {
  lines: string[]
  ours: SideState
  theirs: SideState
  edited: boolean
}

const changes = (p: Piece, side: 'ours' | 'theirs') =>
  p.kind === side || p.kind === 'both' || p.kind === 'conflict'

/** A change as it was before anything was taken: the base, each side that changed it open. */
export const openState = (p: Piece): PieceState => ({
  lines: p.base,
  ours: changes(p, 'ours') ? 'open' : 'ignored',
  theirs: changes(p, 'theirs') ? 'open' : 'ignored',
  edited: false,
})

/** What the merge starts from: changes no other change is in the way of are taken (the same change once). */
export function initialState(p: Piece): PieceState {
  if (p.kind === 'same') return { lines: p.base, ours: 'ignored', theirs: 'ignored', edited: false }
  if (p.kind === 'both') return { lines: p.ours, ours: 'applied', theirs: 'applied', edited: false }
  if (p.kind === 'conflict') return openState(p)
  return applySide(p, openState(p), p.kind)
}

/** IDEA's » / «: a side replaces the base, or comes after the other side when that was taken already. */
export function applySide(p: Piece, s: PieceState, side: 'ours' | 'theirs'): PieceState {
  const other = side === 'ours' ? s.theirs : s.ours
  return { ...s, lines: other === 'applied' ? [...s.lines, ...p[side]] : p[side], [side]: 'applied' }
}

/** IDEA's ×: the side is left out. */
export const ignoreSide = (s: PieceState, side: 'ours' | 'theirs'): PieceState => ({
  ...s,
  [side]: 'ignored',
})

export const isResolved = (s: PieceState) => s.edited || (s.ours !== 'open' && s.theirs !== 'open')

/** A conflict the magic wand can settle, settled; null when it can't. */
export function magic(p: Piece, s: PieceState): PieceState | null {
  if (p.kind !== 'conflict' || isResolved(s)) return null
  const lines = simpleMerge(p.base, p.ours, p.theirs)
  return lines ? { lines, ours: 'applied', theirs: 'applied', edited: false } : null
}

export type Eol = '\n' | '\r\n'

/**
 * Texts as lines without their ends: CRLF when the first given text uses it, `trailing` when every non-empty one
 * ends with a newline (then not a last empty line).
 */
export function splitTexts(texts: string[]): { sides: string[][]; eol: Eol; trailing: boolean } {
  const eol: Eol = texts.find((x) => x.includes('\n'))?.includes('\r\n') ? '\r\n' : '\n'
  const filled = texts.filter((x) => x !== '')
  const trailing = filled.length > 0 && filled.every((x) => x.endsWith('\n'))
  const sides = texts.map((x) => {
    if (x === '') return []
    const lines = x.split(/\r?\n/)
    if (trailing) lines.pop()
    return lines
  })
  return { sides, eol, trailing }
}

export const joinText = (lines: string[], eol: Eol, trailing: boolean) =>
  lines.length ? lines.join(eol) + (trailing ? eol : '') : ''

/** A merge in progress: what it was worked out from (base, ours, theirs), and each piece's state. */
export interface MergeDraft {
  source: string
  ignoreWhitespace: boolean
  states: PieceState[]
}

export const mergeDraftKey = (botId: string, repo: string | null, path: string) =>
  `${botId}\n${repo ?? ''}\n${path}`

/** Merges in progress by (bot, repo, file), kept for the session so switching tabs loses nothing. */
export const useMergeDrafts = create<{
  drafts: Record<string, MergeDraft>
  save: (key: string, draft: MergeDraft | null) => void
}>()((set) => ({
  drafts: {},
  save: (key, draft) =>
    set((s) => {
      const drafts = { ...s.drafts }
      if (draft) drafts[key] = draft
      else delete drafts[key]
      return { drafts }
    }),
}))
