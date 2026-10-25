import { type DiffFile, type DiffRow, diffRows } from './patch'
import { type DiffBlock, diffBlocks } from './split'

/** Unchanged lines kept on each side of a change, as git does: what `git apply` finds the change by. */
const CONTEXT = 3
const HUNK = /^@@ -(\d+)(?:,(\d+))? \+(\d+)(?:,(\d+))? @@/
const SIGN: Partial<Record<DiffRow['kind'], string>> = { context: ' ', add: '+', del: '-' }

/** The last line of a side (0 old, 1 new) before row `i`: a numbered row's, else its hunk header's (0 = none). */
function lineBefore(rows: DiffRow[], i: number, side: 0 | 1) {
  for (let k = i - 1; k >= 0; k--) {
    const r = rows[k]
    const n = side ? r?.newNo : r?.oldNo
    if (n != null) return n
    const h = r?.kind === 'hunk' ? HUNK.exec(r.text) : null
    // An empty range is named by the line before it, any other by its first line.
    if (h) return Number(h[side ? 3 : 1]) - (h[side ? 4 : 2] === '0' ? 0 : 1)
  }
  return 0
}

/** A hunk header's range, its count left out when 1 as git does. */
const span = (start: number, count: number) => (count === 1 ? `${start}` : `${start},${count}`)

/**
 * One change (`block` of `rows`) as a patch of its own, with up to three unchanged lines around it: what the discard
 * action's `patch` takes back (`git apply -R`).
 */
export function changePatch(path: string, rows: DiffRow[], block: DiffBlock) {
  let start = block.rows[0] ?? 0
  let end = block.rows.at(-1) ?? start
  for (let n = 0; n < CONTEXT && rows[start - 1]?.kind === 'context'; n++) start--
  for (let n = 0; n < CONTEXT && rows[end + 1]?.kind === 'context'; n++) end++
  // A last line without a newline keeps its note, or git would look for the newline.
  if (rows[end + 1]?.kind === 'note') end++
  const part = rows.slice(start, end + 1)
  const old = part.filter((r) => r.oldNo != null)
  const neu = part.filter((r) => r.newNo != null)
  const oldAt = old[0]?.oldNo ?? lineBefore(rows, start, 0)
  const newAt = neu[0]?.newNo ?? lineBefore(rows, start, 1)
  return [
    `diff --git a/${path} b/${path}`,
    `--- a/${path}`,
    `+++ b/${path}`,
    `@@ -${span(oldAt, old.length)} +${span(newAt, neu.length)} @@`,
    ...part.map((r) => `${SIGN[r.kind] ?? ''}${r.text}`),
    '',
  ].join('\n')
}

/**
 * What puts back the change a changePatch took back: its sides swapped, both numbered where the change sits in the work
 * tree, whose lines before it are as they were (git takes a hunk starting at line 1 to start the file).
 */
export function undoPatch(patch: string) {
  let body = false
  return patch
    .split('\n')
    .map((line) => {
      const h = HUNK.exec(line)
      if (h) {
        body = true
        const [at, count, old] = [Number(h[3]), Number(h[4] ?? 1), Number(h[2] ?? 1)]
        const before = count ? at - 1 : at
        return `@@ -${span(at, count)} +${span(old ? before + 1 : before, old)} @@${line.slice(h[0].length)}`
      }
      // Only the lines before the first hunk are headers: a deleted `-- comment` reads `--- comment`.
      if (!body) return line
      return line[0] === '+' ? `-${line.slice(1)}` : line[0] === '-' ? `+${line.slice(1)}` : line
    })
    .join('\n')
}

/** A change as IDEA marks it beside an editor's line numbers, in the lines of the new file. */
export interface LineMark {
  kind: 'added' | 'modified' | 'deleted'
  /** Its first line; a deletion sits on top of it (one past the last line at the end of the file). */
  from: number
  /** Its last line; `from - 1` for a deletion. */
  to: number
  /** The lines it took out. */
  old: string[]
  /** It alone, to roll back. */
  patch: string
}

/** The changes of a file's diff against HEAD, as marks beside the lines of the work tree's version. */
export function lineMarks(file: DiffFile): LineMark[] {
  const rows = diffRows(file.lines)
  return diffBlocks(rows)
    .filter((b) => b.change)
    .map((b): LineMark => {
      const part = b.rows.flatMap((i) => rows[i] ?? [])
      const added = part.filter((r) => r.kind === 'add')
      const old = part.filter((r) => r.kind === 'del').map((r) => r.text)
      const from = added[0]?.newNo ?? lineBefore(rows, b.rows[0] ?? 0, 1) + 1
      return {
        kind: !added.length ? 'deleted' : old.length ? 'modified' : 'added',
        from,
        to: added.at(-1)?.newNo ?? from - 1,
        old,
        patch: changePatch(file.path, rows, b),
      }
    })
}
